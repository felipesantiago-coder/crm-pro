import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import crypto from 'crypto';
import { mapWithConcurrency } from '@/lib/meta-lead-routing';
import {
  fetchEnabledAdAccounts,
  resolveAccountByPageId,
  resolveAccountByVerifyToken,
  resolvePageToken,
  buildWebhookSecretCandidates,
  type AdAccountRef,
} from '@/lib/meta-ad-accounts';
import { processMetaLead, isValidSignature, type MetaLeadOutcome } from '@/lib/meta-ingest/pipeline';
import { createMetaIngestServices, resolveDrainPageToken } from '@/lib/meta-ingest/defaults';
import { ingestWebhookViaInbox, type WebhookInboxChange } from '@/lib/meta-ingest/webhook-inbox';

export const maxDuration = 30;

// Serviços reais do pipeline (Prisma + Graph + Telegram + fila) —
// Fase 3: o processamento por lead vive em src/lib/meta-ingest,
// compartilhado com o polling e com o worker da inbox.
const ingestServices = createMetaIngestServices(db);

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
    /** Unix (segundos) do cadastro — horário REAL do lead (§15). */
    created_time?: number;
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
      /** Page id da entry (entry[].id) — prioriza o PAGE TOKEN salvo
       *  da página (extraído automaticamente pelo diagnóstico) ao
       *  buscar field_data; page tokens não expiram com o user token. */
      pageId: string | null;
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
          leadChanges.push({ change, adAccount: entryAccount, pageId: entry?.id || null });
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

    // 6. FASE 3 — ingestão durável: persiste a inbox idempotente por
    //    leadgen (webhook e polling compartilham o espaço), responde
    //    rápido após a persistência e processa via worker com orçamento
    //    de tempo; estouro fica para retry/drain (nenhum lead perdido).
    //    Flag legacy ou tabela ausente (migration pendente) → caminho
    //    inline legado abaixo, byte a byte o comportamento anterior.
    const buildChangeForInbox = ({ change, adAccount, pageId }: LeadChangeWithAccount): WebhookInboxChange => {
      const leadData = change.value;
      return {
        leadgenId: String(leadData.leadgen_id || 'unknown'),
        formId: leadData.form_id || null,
        formName: leadData.form_name || null,
        campaignId: leadData.campaign_id || null,
        campaignName: leadData.campaign_name || null,
        adId: leadData.ad_id || null,
        adName: leadData.ad_name || null,
        createdTimeRaw: typeof leadData.created_time === 'number' ? leadData.created_time : null,
        fieldData: leadData.field_data || null,
        pageId,
        adAccountId: adAccount.id,
        accountName: adAccount.name,
      };
    };

    const inboxOutcome = await ingestWebhookViaInbox({
      inboxDb: db,
      services: ingestServices,
      changes: leadChanges.map(buildChangeForInbox),
      creatorId,
      budgetMs: 20_000,
      accountResolver: async (adAccountId) => adAccounts.find((a) => a.id === adAccountId) ?? null,
      pageTokenResolver: resolveDrainPageToken,
    });

    let results: LeadProcessResult[];
    if (inboxOutcome.ok) {
      results = inboxOutcome.results;
      console.log(`[Meta Webhook][${reqId}] Inbox durável: ${results.length} evento(s) garantido(s), ${results.filter((r) => r.success).length} sucesso(s) no orçamento`);
    } else {
    // 6b. LEGADO — processar leads EM PARALELO (concorrência limitada)
    //    Cada lead é independente: dedup, criação, fila (round-robin
    //    atômico por fila) e notificações rodam isolados por lead.
    const processLeadChange = async ({ change, adAccount, pageId }: LeadChangeWithAccount): Promise<LeadProcessResult> => {
      const leadData = change.value;
      const changeLeadgenId = leadData?.leadgen_id;
      const accountLabel = `${adAccount.name} (${adAccount.adAccountId})`;
      console.log(`[Meta Webhook] Change: field="${change.field}", leadgen_id=${changeLeadgenId ?? 'none'}, ad=${leadData?.ad_name || 'none'}, campaign=${leadData?.campaign_name || 'none'}, conta=${accountLabel}`);

      const leadgenId = String(leadData.leadgen_id || 'unknown');
      // O Meta envia apenas o ID — o PAGE TOKEN salvo para ESTA página tem
      // prioridade ao buscar field_data (não expira com o user token).
      // Conta sem token + payload sem field_data → LostLead dentro do pipeline.
      const pageToken = resolvePageToken(adAccount, pageId);

      // Fase 3: processamento por lead extraído VERBATIM para o pipeline
      // compartilhado (webhook + polling + worker da inbox usam a MESMA
      // implementação — comportamento observável do webhook preservado).
      const outcome: MetaLeadOutcome = await processMetaLead(ingestServices, {
        channel: 'webhook',
        leadgenId,
        fieldData: leadData.field_data || [],
        createdTimeRaw: typeof leadData.created_time === 'number' ? leadData.created_time : null,
        rawAdName: leadData.ad_name || null,
        rawAdId: leadData.ad_id || null,
        campaignId: leadData.campaign_id || null,
        campaignName: leadData.campaign_name || null,
        formId: leadData.form_id || null,
        formName: leadData.form_name || null,
        adAccountDbId: adAccount.id,
        adAccountName: adAccount.name,
        pageToken,
        creatorId,
        reqId,
      });

      return {
        success: outcome.success,
        clientName: outcome.clientName,
        reason: outcome.reason,
        leadId: outcome.leadgenId,
      };
    };

    // Processamento paralelo com concorrência limitada — preserva a
    // ordem dos resultados e isola falhas individuais por lead.
    const settled = await mapWithConcurrency(leadChanges, 4, processLeadChange);
    results = settled.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      console.error(`[Meta Webhook] ⚠ Erro não tratado no lead ${leadChanges[i]?.change?.value?.leadgen_id}:`, r.reason);
      return { success: false, reason: 'processing_error', leadId: String(leadChanges[i]?.change?.value?.leadgen_id || 'unknown') };
    });
    }

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
