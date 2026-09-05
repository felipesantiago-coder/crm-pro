import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import crypto from 'crypto';
import { parseJsonArray } from '@/lib/meta-ad-accounts';

// ============================================================
// POST /api/webhooks/meta-leads/simulate
//
// Endpoint de SIMULAÇÃO que envia um payload idêntico ao que
// o Meta enviaria, mas com dados de teste. Útil para verificar
// se o pipeline completo (HMAC → resolução da conta → parse →
// Graph API → create client → queue → Telegram) está funcionando
// sem depender de um lead real.
//
// CONFIGURAÇÃO POR CONTA: a assinatura HMAC é calculada com o App
// Secret de uma CONTA de anúncios (a escolhida via ?accountId= ou a
// primeira conta com webhook ativo e secret) e a entry.id usa uma
// page ID vinculada a essa conta — exatamente como o Meta real faria.
//
// SEGURANÇA (qualquer UMA das formas):
//   - Sessão NextAuth com role ADMIN
//   - Header X-Simulate-Secret: <CRON_SECRET>
//   - Query param ?secret=<CRON_SECRET>
// ============================================================

function simulateSignature(payload: string, appSecret: string): string {
  return 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(payload, 'utf8')
    .digest('hex');
}

export async function POST(request: NextRequest) {
  // 1. Autenticação: sessão admin OU CRON_SECRET (não existe mais
  //    app secret global para validar aqui)
  let authorized = false;
  try {
    const session = await getServerSession(authOptions);
    if (session?.user?.role === 'ADMIN') authorized = true;
  } catch {}

  if (!authorized) {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const provided =
        request.headers.get('x-simulate-secret') ||
        new URL(request.url).searchParams.get('secret');
      if (provided === cronSecret) authorized = true;
    }
  }

  if (!authorized) {
    return NextResponse.json(
      { error: 'Não autorizado — use sessão ADMIN ou CRON_SECRET (header X-Simulate-Secret ou ?secret=)' },
      { status: 401 }
    );
  }

  // 2. Escolher a conta de origem da simulação (configuração por conta)
  const body = await request.json().catch(() => ({} as any));
  const requestedAccountId: string | undefined = body?.adAccountId;

  const accounts = await db.metaAdAccount.findMany({
    where: { enabled: true, webhookEnabled: { not: false } },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  }).catch(() => []);

  if (accounts.length === 0) {
    return NextResponse.json(
      { error: 'Nenhuma conta de anúncios com webhook ativo — cadastre uma conta em Anúncios Meta > Contas de Anúncio' },
      { status: 400 }
    );
  }

  const account = accounts.find((a) => a.id === requestedAccountId) || accounts[0];

  if (!account.appSecret) {
    return NextResponse.json(
      {
        error: `A conta "${account.name}" está sem app secret — sem ele a assinatura HMAC não é aceita pelo webhook (configuração por conta)`,
        fix: 'Preencha o App Secret na aba Webhook do card desta conta.',
      },
      { status: 400 }
    );
  }

  const pageIds = parseJsonArray(account.pageIds);
  const entryPageId = body?.pageId || pageIds[0];

  if (!entryPageId) {
    return NextResponse.json(
      {
        error: `A conta "${account.name}" está sem page IDs — o webhook não conseguiria resolver a conta de origem`,
        fix: 'Cadastre ao menos uma page ID na aba Webhook do card desta conta.',
      },
      { status: 400 }
    );
  }

  // 3. Montar payload de simulação (idêntico ao formato do Meta)
  const fakeLeadgenId = `SIM_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  const metaPayload = {
    object: 'page',
    entry: [
      {
        id: entryPageId,
        time: Math.floor(Date.now() / 1000),
        changes: [
          {
            field: 'leadgen',
            value: {
              leadgen_id: fakeLeadgenId,
              ad_id: 'SIM_AD_001',
              ad_name: 'Anúncio Teste Simulação',
              adset_id: 'SIM_ADSET_001',
              adset_name: 'Conjunto de Anúncios Teste',
              campaign_id: 'SIM_CAMPAIGN_001',
              campaign_name: 'Campanha Teste Webhook',
              form_id: 'SIM_FORM_001',
              form_name: 'Formulário Teste Simulação',
              created_time: new Date().toISOString(),
              // field_data vazio — força busca via Graph API
              // Na simulação o Graph API vai falhar (leadgen_id fake)
              // mas o pipeline deve criar o cliente com dados mínimos
            },
          },
        ],
      },
    ],
  };

  const payloadStr = JSON.stringify(metaPayload);
  const signature = simulateSignature(payloadStr, account.appSecret);

  // 4. Informações de diagnóstico
  const diagInfo = {
    simulatedLeadgenId: fakeLeadgenId,
    simulatedForAccount: {
      id: account.id,
      name: account.name,
      adAccountId: account.adAccountId,
      entryPageId,
    },
    payloadSize: payloadStr.length,
    signatureValid: true,
    note: 'Enviando payload simulado assinado com o app secret DESTA conta para o webhook real...',
  };

  // 5. Chamar o webhook internamente
  const baseUrl = request.headers.get('x-forwarded-host')
    ? `https://${request.headers.get('x-forwarded-host')}`
    : request.headers.get('host')
      ? `https://${request.headers.get('host')}`
      : 'http://localhost:3000';

  const webhookUrl = `${baseUrl}/api/webhooks/meta-leads`;

  let httpStatus: number | null = null;
  let responseBody: any = null;

  try {
    const webhookResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signature,
        'User-Agent': 'Meta-Simulation-Test/1.0',
      },
      body: payloadStr,
    });
    httpStatus = webhookResponse.status;
    responseBody = await webhookResponse.json().catch(() => null);
  } catch (fetchErr) {
    return NextResponse.json({
      error: 'Falha ao chamar o webhook internamente',
      details: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
      url: webhookUrl,
      diagInfo,
    }, { status: 500 });
  }

  // 6. Retornar resultado
  const success = httpStatus === 200 && responseBody?.processed === true;

  return NextResponse.json({
    simulation: 'complete',
    success,
    diagInfo,
    webhookCall: {
      url: webhookUrl,
      httpStatus,
      responseBody,
    },
    cleanup: success
      ? `Pipeline OK! Cliente de teste criado. Delete após verificar: busque "Teste Simulação" no CRM ou metaLeadgenId=${fakeLeadgenId}`
      : `Pipeline FALHOU (HTTP ${httpStatus}). Verifique os logs do servidor com [Meta Webhook] para identificar onde parou.`,
  });
}

// GET — Documentação do endpoint
export async function GET() {
  return NextResponse.json({
    endpoint: '/api/webhooks/meta-leads/simulate',
    method: 'POST',
    description: 'Simula um payload do Meta Lead Ads para testar o pipeline completo do webhook PARA UMA CONTA específica.',
    authentication: {
      session: 'Sessão NextAuth ADMIN',
      header: 'X-Simulate-Secret: <CRON_SECRET>',
      query_param: '?secret=<CRON_SECRET>',
    },
    body: {
      adAccountId: '(opcional) id da conta de anúncios — default: primeira conta com webhook ativo e secret',
      pageId: '(opcional) page id de origem — default: primeira page da conta',
    },
    behavior: [
      '1. Escolhe a conta (configuração por conta) e usa o app secret DELA',
      '2. Monta um payload idêntico ao formato do Meta com entry.id = page da conta',
      '3. Calcula HMAC-SHA256 correto',
      '4. Faz POST interno para /api/webhooks/meta-leads',
      '5. Retorna o resultado completo (status, body, diagnóstico)',
    ],
    important: 'A conta precisa ter app secret e page IDs próprios (não existe webhook global).',
  });
}
