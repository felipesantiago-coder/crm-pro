import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import crypto from 'crypto';

// ============================================================
// POST /api/webhooks/meta-leads/simulate
//
// Endpoint de SIMULAÇÃO que envia um payload idêntico ao que
// o Meta enviaria, mas com dados de teste. Útil para verificar
// se o pipeline completo (HMAC → parse → Graph API → create
// client → queue → Telegram) está funcionando sem depender
// de um lead real.
//
// SEGURANÇA: Requer query param ?secret=<meta_app_secret>
// ou header X-Simulate-Secret. Sem isso, retorna 403.
// ============================================================

function simulateSignature(payload: string, appSecret: string): string {
  return 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(payload, 'utf8')
    .digest('hex');
}

export async function POST(request: NextRequest) {
  // 1. Autenticação por secret (mesmo nível de segurança do webhook)
  const querySecret = new URL(request.url).searchParams.get('secret');
  const headerSecret = request.headers.get('x-simulate-secret');
  const providedSecret = querySecret || headerSecret;

  // Buscar app_secret real do banco
  const settings = await db.userSettings.findUnique({
    where: { key: 'meta_app_secret' },
  });
  const realSecret = settings?.value;

  if (!realSecret) {
    return NextResponse.json(
      { error: 'App Secret não configurado no sistema' },
      { status: 500 }
    );
  }

  if (providedSecret !== realSecret) {
    return NextResponse.json(
      { error: 'Secret inválido. Use ?secret=<meta_app_secret> ou header X-Simulate-Secret' },
      { status: 403 }
    );
  }

  // 2. Ler config para verificar estado
  const configSettings = await db.userSettings.findMany({
    where: {
      key: { in: ['meta_webhook_enabled', 'meta_page_access_token'] },
    },
  });
  const configMap: Record<string, string> = {};
  configSettings.forEach((s) => { configMap[s.key] = s.value; });

  const isEnabled = configMap['meta_webhook_enabled'] === 'true';
  const hasPageAccessToken = !!configMap['meta_page_access_token'];

  // 3. Montar payload de simulação (idêntico ao formato do Meta)
  const fakeLeadgenId = `SIM_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  const metaPayload = {
    object: 'page',
    entry: [
      {
        id: '209477248924771',
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
  const signature = simulateSignature(payloadStr, realSecret);

  // 4. Informações de diagnóstico
  const diagInfo = {
    simulatedLeadgenId: fakeLeadgenId,
    webhookEnabled: isEnabled,
    hasPageAccessToken,
    payloadSize: payloadStr.length,
    signatureValid: true,
    note: isEnabled
      ? 'Enviando payload simulado para o webhook real...'
      : 'ATENÇÃO: Webhook está DESABILITADO. O lead será salvo como perdido (comportamento correto).',
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
    description: 'Simula um payload do Meta Lead Ads para testar o pipeline completo do webhook.',
    authentication: {
      query_param: '?secret=<meta_app_secret>',
      header: 'X-Simulate-Secret: <meta_app_secret>',
    },
    behavior: [
      '1. Valida o secret contra o meta_app_secret configurado',
      '2. Monta um payload idêntico ao formato do Meta',
      '3. Calcula HMAC-SHA256 correto',
      '4. Faz POST interno para /api/webhooks/meta-leads',
      '5. Retorna o resultado completo (status, body, diagnóstico)',
    ],
    important: 'Se o webhook estiver DESABILITADO, o lead será salvo como perdido (comportamento correto). Ative o webhook antes de testar.',
  });
}
