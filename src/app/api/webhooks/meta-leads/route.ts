import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import crypto from 'crypto';
import { notifyNewLead, notifyQueueUpdate } from '@/lib/telegram';
import { assignLeadToUser, peekNextUser } from '@/lib/lead-queue';
import { findCapConfigByFormId } from '@/lib/meta-conversions';
import { resolveQueueForMetaLead, mapWithConcurrency } from '@/lib/meta-lead-routing';
import { getMetaFieldValue, formatMetaPhone, extractCustomAnswers, formatCustomAnswersText } from '@/lib/meta-lead-utils';
import {
  fetchEnabledAdAccounts,
  resolveAccountByPageId,
  resolveAccountByVerifyToken,
  resolvePageToken,
  buildWebhookSecretCandidates,
  upsertCampaignBindingAuto,
  type AdAccountRef,
} from '@/lib/meta-ad-accounts';

export const maxDuration = 30;

// ============================================================
// Meta Lead Ads Webhook
// Recebe leads de anúncios do Facebook/Instagram e cria
// automaticamente clientes no CRM.
//
// IMPORTANTE: O Meta envia apenas o leadgen_id no webhook.
// Os dados do formulário são buscados via Graph API.
//
// Fluxo:
//   1. Meta envia POST com leadgen_id
//   2. Chamamos Graph API para buscar os dados do lead
//   3. Criamos o cliente automaticamente com stage LEAD
//
// MULTI-ANÚNCIO: múltiplos leads (de anúncios/formulários
// diferentes) no mesmo payload são processados EM PARALELO
// (concorrência limitada). Cada lead é roteado para a fila de
// atendimento do seu formulário/config de origem — leads de
// fontes diferentes nunca se misturam (ver meta-lead-routing).
// ============================================================

/** Change do webhook que contém um leadgen_id válido. */
interface MetaWebhookChange {
  field: string;
  value: {
    leadgen_id?: string | number;
    field_data?: Array<{ name: string; values: string[] }>;
    ad_name?: string;
    ad_id?: string;
    campaign_name?: string;
    campaign_id?: string;
    form_name?: string;
    form_id?: string;
  };
}

interface LeadProcessResult {
  success: boolean;
  clientName?: string;
  reason?: string;
  leadId?: string;
}

/**
 * Verifica se o hub.verify_token corresponde ao verify token dedicado
 * de alguma conta de anúncios com o webhook PRÓPRIO ativo.
 * CONFIGURAÇÃO EXCLUSIVAMENTE POR CONTA — não existe verify token
 * global. Retorna a conta casada (ou null).
 */
async function matchVerifyToken(token: string): Promise<AdAccountRef | null> {
  try {
    const accounts = await fetchEnabledAdAccounts('webhook');
    return resolveAccountByVerifyToken(accounts, token);
  } catch {
    return null;
  }
}

/**
 * Valida a assinatura HMAC-SHA256 do Meta para garantir que
 * o webhook realmente veio do Facebook/Meta.
 *
 * O Meta envia o header X-Hub-Signature-256 no formato:
 *   sha256=HEX_SIGNATURE
 *
 * A assinatura é calculada sobre o corpo bruto da requisição
 * usando o App Secret como chave.
 */
function isValidSignature(payload: string, signature: string | null, appSecret: string): boolean {
  if (!signature || !appSecret) return false;

  const expected = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(payload, 'utf8')
    .digest('hex');

  // Compara em tempo constante para evitar timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(signature, 'utf8')
    );
  } catch {
    return false;
  }
}

// getFieldValue e formatPhone agora vêm de @/lib/meta-lead-utils
// (importados como getMetaFieldValue e formatMetaPhone)

/**
 * Busca os dados completos do lead via Graph API.
 * O webhook do Meta envia apenas o leadgen_id,
 * sem os field_data. Precisamos chamar a API para obter
 * nome, email, telefone, etc.
 */
async function fetchLeadData(leadgenId: string, pageAccessToken: string): Promise<Array<{ name: string; values: string[] }> | null> {
  try {
    const url = `https://graph.facebook.com/v22.0/${leadgenId}?access_token=${encodeURIComponent(pageAccessToken)}&fields=field_data`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Meta Webhook] fetchLeadData(${leadgenId}) HTTP ${response.status}: ${errorText.slice(0, 300)}`);
      return null;
    }

    const data = await response.json();
    const fieldData = data?.field_data;

    if (!fieldData || !Array.isArray(fieldData)) {
      console.warn(`[Meta Webhook] fetchLeadData(${leadgenId}) — field_data ausente na resposta`);
      return null;
    }

    return fieldData;
  } catch (error) {
    console.error(`[Meta Webhook] Falha ao buscar lead ${leadgenId}:`, error);
    return null;
  }
}

/**
 * Verifica se um cliente já existe com o mesmo telefone ou email
 * para evitar duplicatas de leads do mesmo anúncio.
 */
async function findExistingClient(phone: string | null, email: string | null) {
  const conditions: Array<{ phone: string } | { email: string }> = [];

  if (phone) {
    conditions.push({ phone });
  }
  if (email) {
    conditions.push({ email });
  }

  if (conditions.length === 0) return null;

  const whereClause = conditions.length === 1
    ? conditions[0]
    : { OR: conditions };

  return db.client.findFirst({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Tenta encontrar o empreendimento associado ao anúncio pelo nome.
 * O adName do Meta geralmente coincide com o nome do empreendimento (ex: "Vitta").
 */
async function findEnterpriseByAdName(adName: string): Promise<{ name: string; imageUrl: string | null } | null> {
  if (!adName || adName === 'Anúncio Meta Ads') return null;
  try {
    return await db.enterprise.findFirst({
      where: { name: { contains: adName, mode: 'insensitive' } },
      select: { name: true, imageUrl: true },
    });
  } catch { return null; }
}

// ============================================================
// GET — Verificação do Webhook (hub.challenge)
// O Meta envia esta requisição quando você configura o webhook
// no Facebook Developer / Ads Manager.
// ============================================================
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const reqId = crypto.randomBytes(4).toString('hex');
  console.log(`[Meta Webhook][${reqId}] GET recebido — mode=${mode}, token=${token ? '***' + token.slice(-6) : 'null'}, challenge=${challenge ? 'present' : 'null'}, IP=${request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'}`);

  // Verificação padrão do Meta — aceita EXCLUSIVAMENTE o verify token
  // dedicado de contas de anúncios com webhook próprio ativo (por conta).
  if (mode === 'subscribe' && token && challenge) {
    const account = await matchVerifyToken(token);

    if (!account) {
      console.error(`[Meta Webhook][${reqId}] GET rejeitado — token não corresponde a nenhuma conta (webhook é configurado POR CONTA)`);
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    console.log(`[Meta Webhook][${reqId}] GET hub.challenge VERIFICADO com sucesso (conta: "${account.name}") — Meta está assinando o webhook`);
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // Non-verification GET — log e return generic response
  console.log(`[Meta Webhook][${reqId}] GET não é verificação — retornando status ok`);
  return NextResponse.json({ status: 'ok' });
}

// ============================================================
// POST — Recebimento de Lead
// O Meta envia esta requisição quando alguém preenche um
// formulário de lead em um anúncio.
// ============================================================
export async function POST(request: NextRequest) {
  const reqId = crypto.randomBytes(4).toString('hex');
  const startTime = Date.now();
  console.log(`[Meta Webhook][${reqId}] POST recebido — method=${request.method}, contentType=${request.headers.get('content-type')}, IP=${request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'}, UA=${request.headers.get('user-agent') || 'unknown'}`);

  try {
    // 0. Ler o body UMA VEZ (necessário para validação HMAC)
    const rawBody = await request.text();
    const signature = request.headers.get('x-hub-signature-256');

    // 1. MULTI-CONTA (configuração EXCLUSIVAMENTE por conta): as contas
    //    habilitadas com o WEBHOOK PRÓPRIO ativo fornecem os secrets
    //    para validação HMAC, os verify tokens dedicados e o token de
    //    busca dos leads (resolução pela page — entry[].id). Não existe
    //    webhook global: sem contas configuradas, o lead é salvo como
    //    perdido para recuperação manual.
    const adAccounts = await fetchEnabledAdAccounts('webhook');
    const accountsWithSecret = adAccounts.filter((a) => a.appSecret);
    console.log(`[Meta Webhook][${reqId}] Config: adAccounts=${adAccounts.length} (webhook ativo, com secret: ${accountsWithSecret.length}), bodyLen=${rawBody.length}`);

    if (adAccounts.length === 0) {
      // NENHUMA CONTA COM WEBHOOK ATIVO — Salvar o lead perdido ANTES de rejeitar
      console.error('[Meta Webhook] ⚠ NENHUMA CONTA DE ANÚNCIOS COM WEBHOOK ATIVO — Salvando lead perdido para recuperação futura');
      try {
        // Extrair leadgen_ids do payload para referência futura
        let parsedPayload: any = {};
        try { parsedPayload = JSON.parse(rawBody); } catch {}
        const leadgenIds = (parsedPayload?.entry || [])
          .flatMap((e: any) => (e.changes || []).map((c: any) => String(c.value?.leadgen_id || '')))
          .filter(Boolean);

        await db.lostLead.create({
          data: {
            source: 'meta_webhook_no_accounts',
            name: `Nenhuma conta configurada — ${leadgenIds.length} lead(s): ${leadgenIds.join(', ')}`,
            formData: {
              reason: 'no_accounts_configured',
              leadgenIds,
              rawPayloadPreview: rawBody.slice(0, 3000),
              timestamp: new Date().toISOString(),
            },
          },
        });
        console.warn(`[Meta Webhook] ⚠ Lead perdido salvo na tabela lostLeads (razão: no_accounts_configured, leadgenIds: [${leadgenIds.join(', ')}])`);
      } catch (saveErr) {
        console.error('[Meta Webhook] ⚠ CRÍTICO: Sem contas configuradas E falha ao salvar lead perdido:', saveErr);
      }
      // Retorna 200 (não 503!) para que o Meta NÃO retenta —
      // o lead foi salvo para recuperação manual pelo admin.
      return NextResponse.json(
        { received: true, processed: false, reason: 'no_accounts_configured', saved_for_recovery: true },
        { status: 200 }
      );
    }

    // 2. Validar assinatura HMAC — EXCLUSIVAMENTE contra os app secrets
    //    das contas com webhook próprio ativo (não existe secret global).
    //    buildWebhookSecretCandidates também ignora contas com
    //    webhookEnabled=false (defesa em profundidade).
    const secretCandidates = buildWebhookSecretCandidates(adAccounts);
    if (secretCandidates.length === 0) {
      console.error('[Meta Webhook] ⚠ NENHUM APP SECRET configurado nas contas — impossível validar assinatura.');
      return NextResponse.json({ error: 'App Secret não configurado' }, { status: 403 });
    }

    const signatureValid = !!signature && secretCandidates.some((secret) => isValidSignature(rawBody, signature, secret));

    if (!signatureValid) {
      // ASSINATURA INVÁLIDA — Log detalhado + salvar payload para diagnóstico
      console.error(`[Meta Webhook] ⚠ ASSINATURA INVÁLIDA — header=${signature?.slice(0, 20)}... bodyLen=${rawBody.length}, candidatos testados=${secretCandidates.length}. Verifique o App Secret da conta de origem (configuração por conta).`);
      try {
        let parsedPayload: any = {};
        try { parsedPayload = JSON.parse(rawBody); } catch {}
        const leadgenIds = (parsedPayload?.entry || [])
          .flatMap((e: any) => (e.changes || []).map((c: any) => String(c.value?.leadgen_id || '')))
          .filter(Boolean);

        await db.lostLead.create({
          data: {
            source: 'meta_webhook_invalid_signature',
            name: `Assinatura inválida — ${leadgenIds.length} lead(s): ${leadgenIds.join(', ')}`,
            formData: {
              reason: 'invalid_signature',
              leadgenIds,
              signatureHeader: signature?.slice(0, 30) || 'missing',
              bodyLength: rawBody.length,
              rawPayloadPreview: rawBody.slice(0, 3000),
              timestamp: new Date().toISOString(),
            },
          },
        });
      } catch {}
      return NextResponse.json({ error: 'Assinatura inválida' }, { status: 401 });
    }

    // 3. Parsear o payload
    let body: { object?: string; entry?: Array<{ id?: string; changes?: Array<{ field: string; value?: Record<string, unknown> }> }> };
    try {
      body = JSON.parse(rawBody);
    } catch {
      console.error(`[Meta Webhook] ⚠ Payload JSON inválido (primeiros 200 chars): ${rawBody.slice(0, 200)}`);
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }

    // 4. Coletar TODOS os changes com leadgen_id (multi-anúncio: um
    //    único payload pode trazer leads de formulários diferentes).
    //    MULTI-CONTA: entry[].id é o page id — resolve a conta de
    //    origem de cada entrada. Página SEM conta vinculada → os leads
    //    da entrada são salvos como perdidos (não há token global para
    //    buscá-los) e as demais entradas seguem normalmente.
    const entries = body.entry || [];

    const allFields = entries.flatMap(e => (e.changes || []).map(c => c.field));
    console.log(`[Meta Webhook] Payload: object=${body.object}, entries=${entries.length}, fields=[${allFields.join(', ')}]`);

    interface LeadChangeWithAccount {
      change: MetaWebhookChange;
      adAccount: AdAccountRef;
    }

    const leadChanges: LeadChangeWithAccount[] = [];
    for (const entry of entries) {
      const entryAccount = resolveAccountByPageId(adAccounts, entry?.id);
      const entryChanges = (entry.changes || []) as MetaWebhookChange[];
      if (!entryAccount) {
        const orphanIds = entryChanges
          .map((c) => String(c.value?.leadgen_id || ''))
          .filter(Boolean);
        if (orphanIds.length > 0) {
          console.error(`[Meta Webhook] ⚠ Página ${entry?.id} não vinculada a NENHUMA conta — salvando ${orphanIds.length} lead(s) como perdido(s)`);
          try {
            await db.lostLead.create({
              data: {
                source: 'meta_webhook_unmapped_page',
                name: `Página ${entry?.id || 'desconhecida'} sem conta — ${orphanIds.length} lead(s): ${orphanIds.join(', ')}`,
                formData: {
                  reason: 'page_nao_vinculada_a_conta',
                  pageId: entry?.id || null,
                  leadgenIds: orphanIds,
                  rawPayloadPreview: rawBody.slice(0, 3000),
                  timestamp: new Date().toISOString(),
                },
              },
            });
          } catch {}
        }
        continue;
      }
      console.log(`[Meta Webhook] Entry ${entry.id} → conta "${entryAccount.name}" (${entryAccount.adAccountId})`);
      for (const change of entryChanges) {
        if (change.value?.leadgen_id) {
          leadChanges.push({ change, adAccount: entryAccount });
        } else {
          console.warn(`[Meta Webhook] ⚠ Change field="${change.field}" sem leadgen_id no value — ignorado`);
        }
      }
    }

    if (leadChanges.length === 0) {
      console.warn('[Meta Webhook] ⚠ Nenhum lead válido de contas conhecidas no payload — nada a processar');
      return NextResponse.json({ received: true, processed: false, reason: 'no_account_mapped' });
    }

    // 5. Resolver creatorId UMA vez (determinístico, igual ao loop legado)
    let creatorId: string | undefined;
    try {
      const admin = await db.user.findFirst({
        where: { role: 'ADMIN' },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      creatorId = admin?.id;
      if (!creatorId) {
        const anyUser = await db.user.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } });
        creatorId = anyUser?.id;
      }
      if (!creatorId) {
        console.error('[Meta Webhook] ⚠ NENHUM USUÁRIO NO SISTEMA — leads serão marcados como no_user');
      }
    } catch {
      console.error('[Meta Webhook] ⚠ Erro ao buscar usuário para createdBy');
    }

    // 6. Processar leads EM PARALELO (concorrência limitada)
    //    Cada lead é independente: dedup, criação, fila (round-robin
    //    atômico por fila) e notificações rodam isolados por lead.
    const processLeadChange = async ({ change, adAccount }: LeadChangeWithAccount): Promise<LeadProcessResult> => {
      const leadData = change.value;
      const changeLeadgenId = leadData?.leadgen_id;
      const accountLabel = `${adAccount.name} (${adAccount.adAccountId})`;
      console.log(`[Meta Webhook] Change: field="${change.field}", leadgen_id=${changeLeadgenId ?? 'none'}, ad=${leadData?.ad_name || 'none'}, campaign=${leadData?.campaign_name || 'none'}, conta=${accountLabel}`);

      const leadgenId = String(leadData.leadgen_id || 'unknown');
      let fieldData = leadData.field_data || [];
      const adName = leadData.ad_name || 'Anúncio Meta Ads';
      const campaignName = leadData.campaign_name || '';
      const formName = leadData.form_name || '';
      const formId = leadData.form_id || '';
      const adId = String(leadData.ad_id || '');
      const campaignId = String(leadData.campaign_id || '');
      const adAccountId = adAccount.id;

      console.log(`[Meta Webhook] Processando leadgen_id=${leadgenId}, formId=${formId}, ad="${adName}", campaign="${campaignName}"${campaignId ? ` (id=${campaignId})` : ''}`);

      // Auto-registro do vínculo campanha → conta (fire-and-forget):
      // permite fila ESPECÍFICA por campanha (MetaCampaignBinding) e
      // gestão independente das campanhas de cada conta.
      if (campaignId) {
        upsertCampaignBindingAuto({ campaignId, campaignName, adAccountId });
      }

      // Auto-populate lead_form_mappings (fire-and-forget, non-critical)
      if (formId) {
        db.leadFormMapping.upsert({
          where: { formId_campaignId: { formId, campaignId: campaignId || '__no_campaign' } },
          create: {
            formId,
            formName: formName || null,
            adId: adId || null,
            adName: adName !== 'Anúncio Meta Ads' ? adName : null,
            campaignId: campaignId || null,
            campaignName: campaignName || null,
            adAccountId: adAccountId || null,
          },
          update: {
            leadCount: { increment: 1 },
            formName: formName || undefined,
            adName: adName !== 'Anúncio Meta Ads' ? adName : undefined,
            adAccountId: adAccountId || undefined,
          },
        }).catch((err: any) => {
          console.warn(`[Meta Webhook] Falha ao upsert form mapping ${formId}:`, err?.message || err);
        });
      }

      // Buscar CAPI config por form_id (para multi-client CAPI).
      // MULTI-CONTA: se o form não está mapeado, usa um config CAPI
      // pertencente à conta de origem (dataset correto por conta).
      let capiConfigId: string | undefined;
      if (formId) {
        try {
          const capiMatch = await findCapConfigByFormId(formId);
          if (capiMatch) {
            capiConfigId = capiMatch.id;
          }
        } catch (capiErr) {
          console.warn(`[Meta Webhook] Falha ao buscar CAPI config para form ${formId}:`, capiErr);
        }
      }
      if (!capiConfigId && adAccountId) {
        try {
          const accConfig = await db.metaCapConfig.findFirst({
            where: { adAccountId, enabled: true },
            select: { id: true },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
          });
          if (accConfig) {
            capiConfigId = accConfig.id;
            console.log(`[Meta Webhook] CAPI config ${accConfig.id} resolvido pela conta ${accountLabel}`);
          }
        } catch (err) {
          console.warn('[Meta Webhook] Falha ao buscar CAPI config da conta (migration pendente?):', err instanceof Error ? err.message : err);
        }
      }

      // ROTEAMENTO MULTI-ANÚNCIO/MULTI-CONTA: prioridade
      // campanha (campaignId) > formulário (formId) > conta >
      // config CAPI > fila default. Sem vínculo → fila default.
      const route = await resolveQueueForMetaLead({
        formId,
        campaignId: campaignId || undefined,
        capiConfigId,
        adAccountId: adAccountId || undefined,
      });
      if (route.routeSource !== 'default') {
        console.log(`[Meta Webhook][${reqId}] Fila roteada para lead ${leadgenId}: "${route.queueName ?? route.queueId}" (${route.routeSource})`);
      }

      // O Meta envia apenas o ID — buscar dados via Graph API.
      // MULTI-CONTA: usa EXCLUSIVAMENTE o token da conta resolvida pela
      // página (não existe token global). Conta sem token + payload sem
      // field_data → lead salvo como perdido (recuperável via importação).
      const pageToken = resolvePageToken(adAccount);
      if (fieldData.length === 0 && pageToken) {
        console.log(`[Meta Webhook] Buscando dados do lead ${leadgenId} via Graph API (field_data vazio no webhook, token da conta "${adAccount.name}")`);
        const fetched = await fetchLeadData(leadgenId, pageToken);
        if (fetched) {
          fieldData = fetched;
        } else {
          console.error(`[Meta Webhook] ⚠ Não foi possível buscar dados do lead ${leadgenId} via Graph API — lead será criado com dados mínimos`);
        }
      } else if (fieldData.length === 0) {
        console.error(`[Meta Webhook] ⚠ Sem field_data e a conta "${adAccount.name}" está sem access token — lead ${leadgenId} salvo como perdido`);
        try {
          await db.lostLead.create({
            data: {
              source: 'meta_webhook_no_account_token',
              name: `Conta "${adAccount.name}" sem token — lead ${leadgenId} (form ${formId || '?'})`,
              formData: {
                reason: 'conta_sem_access_token',
                adAccountId,
                leadgenId,
                campaignId: campaignId || null,
                formId: formId || null,
                timestamp: new Date().toISOString(),
              },
            },
          });
        } catch {}
        return { success: false, clientName: 'Lead Meta Ads', reason: 'no_account_token', leadId: leadgenId };
      } else {
        console.log(`[Meta Webhook] field_data presente no webhook com ${fieldData.length} campos para lead ${leadgenId}`);
      }

      // Extrair campos do formulário
      const rawName = getMetaFieldValue(fieldData, 'full_name')
        || getMetaFieldValue(fieldData, 'name')
        || getMetaFieldValue(fieldData, 'nome')
        || getMetaFieldValue(fieldData, 'nome_completo')
        || 'Lead Meta Ads';

      const rawEmail = getMetaFieldValue(fieldData, 'email')
        || getMetaFieldValue(fieldData, 'e_mail')
        || null;

      const rawPhone = getMetaFieldValue(fieldData, 'phone_number')
        || getMetaFieldValue(fieldData, 'phone')
        || getMetaFieldValue(fieldData, 'celular')
        || getMetaFieldValue(fieldData, 'telefone')
        || null;

      const city = getMetaFieldValue(fieldData, 'city')
        || getMetaFieldValue(fieldData, 'cidade')
        || null;

      // Formatar dados
      const name = rawName?.trim() || 'Lead Meta Ads';
      const email = rawEmail?.trim() || null;
      const phone = formatMetaPhone(rawPhone);
      const region = city?.trim() || null;

      // Extrair respostas customizadas (perguntas extras do formulário)
      const customAnswers = extractCustomAnswers(fieldData);
      const customAnswersText = formatCustomAnswersText(customAnswers);

      console.log(`[Meta Webhook] Dados extraídos: name="${name}", email=${email || 'null'}, phone=${phone || 'null'}, city=${region || 'null'}`);

      // 7. Verificar duplicata por telefone/email
      const existing = await findExistingClient(phone, email);
      let assignedUserName: string | undefined;
      if (existing) {
        console.log(`[Meta Webhook] Cliente existente encontrado: id=${existing.id}, name="${existing.name}" — criando interação`);

        // Criar interação registrando o novo contato do anúncio
        await db.interaction.create({
          data: {
            clientId: existing.id,
            description: `[Meta Ads] Novo lead recebido via anúncio "${adName}"${campaignName ? ` (campanha: ${campaignName})` : ''}. Formulário: ${formName}. Dados: ${email ? `Email: ${email}` : ''}${phone ? ` | Telefone: ${phone}` : ''}${region ? ` | Cidade: ${region}` : ''}. Lead ID: ${leadgenId}${customAnswersText}`,
          },
        });

        // FIX: Also update phone if new one provided
        if (phone) {
          await db.client.update({
            where: { id: existing.id },
            data: { lastInteractionAt: new Date(), ...(phone !== existing.phone ? { phone } : {}) },
          }).catch(() => {});
        } else {
          await db.client.update({
            where: { id: existing.id },
            data: { lastInteractionAt: new Date() },
          }).catch(() => {});
        }

        // Assign via queue even for existing clients — na fila do
        // formulário de origem deste lead (não da origem antiga)
        try {
          const assignResult = await assignLeadToUser({
            leadId: existing.id,
            queueId: route.queueId,
            source: `meta_ads:${(campaignName || adName || '').slice(0, 200)}`,
          });
          if (assignResult.assigned && assignResult.userId) {
            assignedUserName = assignResult.userName;
            console.log(`[Meta Webhook] Fila: lead existente ${existing.id} atribuído a "${assignResult.userName}" (fila=${assignResult.queueId})`);
            await db.client.update({
              where: { id: existing.id },
              data: { createdBy: assignResult.userId },
            }).catch(() => {});
            // Send Telegram notification to assigned agent (await — serverless-safe)
            try {
              const agentUser = await db.user.findUnique({ where: { id: assignResult.userId }, select: { telegramChatId: true, name: true } });
              if (agentUser?.telegramChatId) {
                const ent = await findEnterpriseByAdName(adName);
                console.log(`[Meta Webhook][${reqId}] Enviando notificação Telegram para agente "${agentUser.name}" (lead existente ${existing.id})`);
                await notifyNewLead(agentUser.telegramChatId, {
                  leadName: existing.name,
                  leadPhone: phone || existing.phone || '',
                  leadEmail: email || existing.email || '',
                  enterpriseName: ent?.name,
                  enterpriseImageUrl: ent?.imageUrl || undefined,
                  utmCampaign: campaignName || null,
                  utmSource: 'meta_ads',
                  slug: undefined,
                  assignedUserName: assignResult.userName,
                  customAnswers,
                });
                console.log(`[Meta Webhook][${reqId}] ✅ Notificação Telegram enviada ao agente "${agentUser.name}"`);
              } else {
                console.warn(`[Meta Webhook][${reqId}] Usuário ${agentUser?.name || assignResult.userId} sem Telegram configurado. Lead existente ${existing.id} sem notificação.`);
              }
            } catch (notifyErr) {
              console.warn(`[Meta Webhook][${reqId}] Falha na notificação do agente (lead existente):`, notifyErr);
            }

            // Notify admin about queue rotation (await — serverless-safe)
            if (assignResult.message !== 'already_assigned') {
              try {
                const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { telegramChatId: true } });
                if (admin?.telegramChatId) {
                  const nextUser = await peekNextUser({ queueId: assignResult.queueId });
                  console.log(`[Meta Webhook][${reqId}] Enviando notificação de fila ao admin`);
                  await notifyQueueUpdate(admin.telegramChatId, {
                    source: `meta_ads:${(campaignName || adName || '').slice(0, 200)}`,
                    assignedUserName: assignResult.userName || 'Desconhecido',
                    nextUserName: nextUser?.userName || null,
                    leadName: existing.name,
                    leadPhone: existing.phone || phone || undefined,
                  });
                  console.log(`[Meta Webhook][${reqId}] ✅ Notificação de fila enviada ao admin`);
                } else {
                  console.warn(`[Meta Webhook][${reqId}] Admin sem Telegram configurado — notificação de fila pulada`);
                }
              } catch (err) {
                console.warn(`[Meta Webhook][${reqId}] Admin queue notification failed (existing):`, err instanceof Error ? err.message : err);
              }
            }
          } else {
            console.warn(`[Meta Webhook] ⚠ Fila: não foi possível atribuir lead existente ${existing.id}: ${assignResult.message}`);
          }
        } catch (queueErr) {
          console.error(`[Meta Webhook] ⚠ Falha na atribuição de fila (lead existente ${existing.id}):`, queueErr);
        }

        return {
          success: true,
          clientName: existing.name,
          reason: 'duplicate_added_interaction',
          leadId: leadgenId,
        };
      }

      // 7b. Check for duplicate — dedicated metaLeadgenId column (O(1) indexed lookup)
      try {
        const existingByLeadgenId = await db.client.findUnique({
          where: { metaLeadgenId: leadgenId },
          select: { id: true },
        });
        if (existingByLeadgenId) {
          console.log(`[Meta Webhook] Lead ${leadgenId} já processado anteriormente (client ${existingByLeadgenId.id}) — ignorando`);
          return { success: true, clientName: 'dedup', reason: 'already_processed', leadId: leadgenId };
        }
      } catch (dedupErr) {
        console.warn(`[Meta Webhook] Falha na verificação de duplicata para lead ${leadgenId}:`, dedupErr);
      }

      // 8. Validar creatorId (resolvido uma vez fora do loop paralelo)
      if (!creatorId) {
        console.error(`[Meta Webhook] ⚠ NENHUM USUÁRIO NO SISTEMA — Lead "${name}" (${leadgenId}) PERDIDO!`);
        return { success: false, clientName: name, reason: 'no_user', leadId: leadgenId };
      }

      // 9. Create client FIRST (before queue assignment)
      try {
        const newClient = await db.client.create({
          data: {
            name,
            email: email || undefined,
            phone: phone || undefined,
            region: region || undefined,
            stage: 'LEAD',
            updatePeriod: 1,
            createdBy: creatorId,
            metaLeadgenId: leadgenId,
            metaCapConfigId: capiConfigId,
            notes: `[Meta Ads] Lead recebido automaticamente.\nAnúncio: ${adName}${campaignName ? `\nCampanha: ${campaignName}` : ''}\nFormulário: ${formName}${formId ? ` (ID: ${formId})` : ''}\nLead ID: ${leadgenId}${capiConfigId ? `\nCAPI Config: ${capiConfigId}` : ''}${customAnswersText}`,
          },
        });
        console.log(`[Meta Webhook] ✅ Cliente criado: id=${newClient.id}, name="${name}", phone=${phone || 'null'}, email=${email || 'null'}`);

        // Create initial interaction
        await db.interaction.create({
          data: {
            clientId: newClient.id,
            description: `[Meta Ads] Cliente criado automaticamente via lead do anúncio "${adName}"${campaignName ? ` (campanha: ${campaignName})` : ''}. Origem: Facebook/Instagram Lead Ads.${customAnswersText}`,
          },
        });

        // 10. Assign via queue — na fila roteada pela origem do lead
        let assignedUserId: string | undefined;
        let assignedQueueId: string | undefined;
        try {
          const assignResult = await assignLeadToUser({
            leadId: newClient.id,
            queueId: route.queueId,
            source: `meta_ads:${(campaignName || adName || '').slice(0, 200)}`,
          });
          if (assignResult.assigned && assignResult.userId) {
            assignedUserId = assignResult.userId;
            assignedQueueId = assignResult.queueId;
            assignedUserName = assignResult.userName;
            console.log(`[Meta Webhook] ✅ Fila: client ${newClient.id} atribuído a "${assignResult.userName}" (userId=${assignResult.userId}, fila=${assignResult.queueId})`);
            await db.client.update({
              where: { id: newClient.id },
              data: {
                createdBy: assignedUserId,
                utmSource: 'meta_ads',
                utmCampaign: (campaignName || '').slice(0, 200) || undefined,
              },
            }).catch(() => {});
          } else {
            console.warn(`[Meta Webhook] ⚠ Fila: não foi possível atribuir client ${newClient.id}: ${assignResult.message}`);
          }
        } catch (queueErr) {
          console.error(`[Meta Webhook] ⚠ Falha na atribuição de fila (client ${newClient.id}):`, queueErr);
        }

        // 11. Send Telegram notification to assigned agent (await — serverless-safe)
        const notifyId = assignedUserId || creatorId;
        if (notifyId) {
          try {
            const agentUser = await db.user.findUnique({ where: { id: notifyId }, select: { telegramChatId: true, name: true } });
            if (agentUser?.telegramChatId) {
              const ent = await findEnterpriseByAdName(adName);
              console.log(`[Meta Webhook][${reqId}] Enviando notificação Telegram para agente "${agentUser.name}" (client ${newClient.id})`);
              await notifyNewLead(agentUser.telegramChatId, {
                leadName: newClient.name,
                leadPhone: newClient.phone || '',
                leadEmail: newClient.email || '',
                enterpriseName: ent?.name,
                enterpriseImageUrl: ent?.imageUrl || undefined,
                utmCampaign: campaignName || null,
                utmSource: 'meta_ads',
                slug: undefined,
                assignedUserName: assignedUserName,
                customAnswers,
              });
              console.log(`[Meta Webhook][${reqId}] ✅ Notificação Telegram enviada ao agente "${agentUser.name}"`);
            } else {
              console.warn(`[Meta Webhook][${reqId}] Usuário ${agentUser?.name || notifyId} atribuído mas sem Telegram. Lead ${newClient.id} (${name}) sem notificação.`);
            }
          } catch (notifyErr) {
            console.warn(`[Meta Webhook][${reqId}] Falha na notificação do agente (client ${newClient.id}):`, notifyErr);
          }
        }

        // 12. Notify admin about queue rotation (await — serverless-safe)
        if (assignedUserId && assignedQueueId) {
          try {
            const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { telegramChatId: true } });
            if (admin?.telegramChatId) {
              const nextUser = await peekNextUser({ queueId: assignedQueueId });
              console.log(`[Meta Webhook][${reqId}] Enviando notificação de fila ao admin`);
              await notifyQueueUpdate(admin.telegramChatId, {
                source: `meta_ads:${(campaignName || adName || '').slice(0, 200)}`,
                assignedUserName: assignedUserName || 'Desconhecido',
                nextUserName: nextUser?.userName || null,
                leadName: newClient.name,
                leadPhone: newClient.phone || undefined,
              });
              console.log(`[Meta Webhook][${reqId}] ✅ Notificação de fila enviada ao admin`);
            } else {
              console.warn(`[Meta Webhook][${reqId}] Admin sem Telegram configurado — notificação de fila pulada`);
            }
          } catch (err) {
            console.warn(`[Meta Webhook][${reqId}] Admin queue notification failed (new):`, err instanceof Error ? err.message : err);
          }
        }

        return { success: true, clientName: name, leadId: leadgenId };
      } catch (createError) {
        console.error(`[Meta Webhook] ⚠ Erro ao criar cliente "${name}" (${leadgenId}):`, createError);
        return { success: false, clientName: name, reason: 'create_failed', leadId: leadgenId };
      }
    };

    // Processamento paralelo com concorrência limitada — preserva a
    // ordem dos resultados e isola falhas individuais por lead.
    const settled = await mapWithConcurrency(leadChanges, 4, processLeadChange);
    const results: LeadProcessResult[] = settled.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      console.error(`[Meta Webhook] ⚠ Erro não tratado no lead ${leadChanges[i]?.change?.value?.leadgen_id}:`, r.reason);
      return { success: false, reason: 'processing_error', leadId: String(leadChanges[i]?.change?.value?.leadgen_id || 'unknown') };
    });

    // Log resumo final
    const successCount = results.filter((r) => r.success).length;
    const failedResults = results.filter((r) => !r.success);
    const elapsed = Date.now() - startTime;
    console.log(`[Meta Webhook][${reqId}] Resumo: ${successCount}/${results.length} processados com sucesso em ${elapsed}ms${failedResults.length > 0 ? `. Falhas: ${failedResults.map(r => `${r.reason}(${r.leadId})`).join(', ')}` : ''}`);

    // Incrementar contador de leads recebidos
    if (successCount > 0) {
      try {
        const currentSetting = await db.userSettings.findUnique({
          where: { key: 'meta_lead_count' },
        });
        const currentCount = parseInt(currentSetting?.value || '0', 10);
        await db.userSettings.upsert({
          where: { key: 'meta_lead_count' },
          update: { value: String(currentCount + successCount) },
          create: { key: 'meta_lead_count', value: String(successCount) },
        });
      } catch (countError) {
        // Non-critical: counter update failed silently
      }
    }

    return NextResponse.json({
      received: true,
      processed: true,
      results,
      total: results.length,
      succeeded: successCount,
    });
  } catch (error) {
    console.error('[Meta Webhook] ⚠ ERRO INTERNO:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}
