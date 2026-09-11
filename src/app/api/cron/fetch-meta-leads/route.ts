import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { mapWithConcurrency, resolveQueueForMetaLead } from '@/lib/meta-lead-routing';
import { fetchEnabledAdAccounts, parseJsonArray } from '@/lib/meta-ad-accounts';
import { processMetaLead } from '@/lib/meta-ingest/pipeline';
import { createMetaIngestServices, resolveDrainPageToken } from '@/lib/meta-ingest/defaults';
import { isMetaCursorV2Enabled } from '@/lib/meta-ingest/flags';
import { ensureInboxItemInfallible, drainInbox, sanitizeError, type MetaInboxPayload, type MetaInboxRow } from '@/lib/meta-ingest/inbox';
import {
  acquirePollingLease,
  renewPollingLease,
  releasePollingLease,
  reserveQuotaSlot,
  refundQuotaSlot,
  loadPollingCursor,
  advancePollingCursor,
  recordCursorError,
  fetchAllLeadsPages,
  type LeaseAcquisition,
  type CursorRow,
  type MetaPollingDbSlice,
  type MetaLeadLike,
  type GraphLeadsResponse,
} from '@/lib/meta-ingest/polling';
import type { MetaInboxDbSlice } from '@/lib/meta-ingest/inbox';
import { extractGraphErrorCode } from '@/lib/meta-oauth';
import { clearAccountAuthState, registerAccountAuthFailure } from '@/lib/meta-oauth-server';

// maxDuration=10s no Hobby (Vercel impõe). Pro permite até 300s.
export const maxDuration = 10;

// ============================================================
// GET /api/cron/fetch-meta-leads
//
// Cron job que busca novos leads no Meta a cada 5 minutos.
// Chamado pelo Vercel Cron, serviço externo ou botão admin.
//
// MULTI-ANÚNCIO + MULTI-CONTA: todos os formulários são consultados EM PARALELO
// com watermark individual por formulário — se a busca de um form
// falha, os demais avançam normalmente e o form com falha repete
// a janela na próxima execução (nenhum lead é pulado). Cada lead
// é roteado para a fila de atendimento do seu formulário/campanha/
// conta de origem (meta-lead-routing), igual ao webhook — assim webhook
// e polling podem rodar simultaneamente sem confundir fontes.
//
// MULTI-TOKEN (configuração EXCLUSIVAMENTE por conta): cada conta de
// anúncios (MetaAdAccount) é consultada com o PRÓPRIO access token,
// usando os formIds vinculados a ela. NÃO existe polling global.
//
// ESCOPO POR CONTA: ?accountId=<id> restringe a execução a UMA conta
// (usado pelo botão "Executar polling agora" dentro do card da conta).
//
// Autenticação (qualquer UMA das formas):
//   - Sessão NextAuth com role ADMIN (botão "Executar Agora")
//   - Header Authorization: Bearer <CRON_SECRET>
//   - Query param ?secret=<CRON_SECRET> (cron-job.org)
// ============================================================

// Serviços reais do pipeline (Prisma + Telegram + fila) — Fase 3.
const ingestServices = createMetaIngestServices(db);

// FASE 3 — lease distribuído: escopo único, TTL com folga e deadline
// do run (maxDuration 10s → orçamento de ~7,5s; sobras ficam na inbox).
const POLLING_LEASE_SCOPE = 'polling';
const POLLING_LEASE_TTL_MS = 90_000;
const POLLING_RUN_BUDGET_MS = 7_500;

// Timeout conservador para chamadas externas (Graph API)
const GRAPH_API_TIMEOUT_MS = 8_000;

// Limite máximo de form IDs por execução (evita abuso).
// Multi-conta: o total soma forms de todas as contas + globais.
const MAX_FORM_IDS = 50;

// Limite máximo de leads processados por execução
const MAX_LEADS_PER_RUN = 50;

// Concorrência de consultas aos formulários na Graph API
const FORM_CONCURRENCY = 4;

// Concorrência de importação de leads dentro de um formulário
const LEAD_CONCURRENCY = 5;

// In-flight lock: impede execução concorrente do polling (por instância)
let isRunning = false;

/** Lead do endpoint /leads — fatia idêntica ao tipo do polling lib. */
type MetaLead = MetaLeadLike;

/** Alvo de polling: um form consultado com o token da sua conta (ou global). */
interface PollTarget {
  formId: string;
  token: string;
  adAccountId: string | null;
  accountName: string | null;
}

async function authenticate(request: NextRequest): Promise<boolean> {
  // 1. Admin autenticado via sessão (botão "Executar Agora" da UI)
  try {
    const session = await getServerSession(authOptions);
    if (session?.user?.role === 'ADMIN') return true;
  } catch {}

  // 2. Vercel Cron / serviço externo via CRON_SECRET
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return false;
  }

  // Vercel Cron envia header Authorization: Bearer <secret>
  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${cronSecret}`) return true;

  // Fallback: query param (para serviços externos como cron-job.org)
  const querySecret = new URL(request.url).searchParams.get('secret');
  if (querySecret === cronSecret) return true;

  return false;
}

async function getConfig() {
  const settings = await db.userSettings.findMany({
    where: { key: { in: ['meta_polling_last_run', 'meta_polling_form_watermarks'] } },
    select: { key: true, value: true },
  });
  const map: Record<string, string> = {};
  settings.forEach(s => { map[s.key] = s.value; });

  // Watermarks individuais por formulário: { "formId": "ISO-date", ... }
  let formWatermarks: Record<string, string> = {};
  try { formWatermarks = JSON.parse(map['meta_polling_form_watermarks'] || '{}') || {}; } catch { formWatermarks = {}; }

  return {
    lastRun: map['meta_polling_last_run'] || null,
    formWatermarks,
  };
}

async function fetchRecentLeads(formId: string, pageAccessToken: string, since: string): Promise<MetaLead[]> {
  const url = `https://graph.facebook.com/v26.0/${formId}/leads?fields=field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,form_name,created_time&limit=100&since=${encodeURIComponent(since)}&access_token=${encodeURIComponent(pageAccessToken)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GRAPH_API_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 200)}`);
    }
    const data = await response.json();
    return data?.data || [];
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Importa UM lead Meta via o pipeline compartilhado da Fase 3
 * (src/lib/meta-ingest) — a MESMA implementação usada pelo webhook,
 * pelo worker da inbox e pelo drain. Comportamento observável do
 * polling preservado: textos "[Meta Polling]", dedup metaLeadgenId
 * primeiro, sem notificação para contato existente, rota resolvida
 * UMA vez por formulário (preResolvedRoute).
 */
/** Busca UMA página de /leads com o mesmo timeout conservador do run. */
async function fetchLeadsPage(url: string): Promise<GraphLeadsResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GRAPH_API_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 200)}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function importSingleLead(
  lead: MetaLead,
  creatorId: string,
  queueId: string | undefined,
  quota: { remaining: number },
  adAccountId: string | null,
  accountName: string | null,
): Promise<{ leadgenId: string; imported: boolean; clientName?: string; reason?: string; assignedTo?: string }> {
  const outcome = await processMetaLead(ingestServices, {
    channel: 'polling',
    leadgenId: lead.id,
    fieldData: lead.field_data || [],
    createdTimeRaw: lead.created_time || null,
    rawAdName: lead.ad_name || null,
    rawAdId: lead.ad_id || null,
    campaignId: lead.campaign_id || null,
    campaignName: lead.campaign_name || null,
    formId: lead.form_id || null,
    formName: lead.form_name || null,
    adAccountDbId: adAccountId,
    adAccountName: accountName || adAccountId || 'conta',
    creatorId,
    preResolvedRoute: { queueId, routeSource: 'default' },
  });

  return {
    leadgenId: outcome.leadgenId,
    imported: outcome.imported,
    clientName: outcome.clientName,
    reason: outcome.reason,
    assignedTo: outcome.assignedTo,
  };
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  // 1. Autenticação
  if (!(await authenticate(request))) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  // 2. Concurrency guard — FASE 3: lease distribuído no Postgres com
  //    TTL, renovação e recuperação automática pós-crash (substitui o
  //    isRunning de memória, válido só por instância). Postgres
  //    indisponível/migration pendente → lock em memória (legado).
  let durablePolling = isMetaCursorV2Enabled();
  let lease: LeaseAcquisition | null = null;
  if (durablePolling) {
    try {
      lease = await acquirePollingLease(db, POLLING_LEASE_SCOPE, POLLING_LEASE_TTL_MS, MAX_LEADS_PER_RUN);
      if (!lease.acquired) {
        return NextResponse.json({ status: 'already_running', message: 'Polling já está em execução' });
      }
    } catch (leaseErr) {
      console.error('[Meta Polling] Lease indisponível — usando lock em memória:', leaseErr instanceof Error ? leaseErr.message : leaseErr);
      durablePolling = false;
      lease = null;
    }
  }
  if (!durablePolling) {
    if (isRunning) {
      return NextResponse.json({ status: 'already_running', message: 'Polling já está em execução' });
    }
    isRunning = true;
  }
  const runDeadline = startTime + POLLING_RUN_BUDGET_MS;

  try {
    // 3. Escopo por conta (?accountId=<id> — botão "Executar agora" do card)
    const accountIdFilter = new URL(request.url).searchParams.get('accountId');

    // 3b. Config técnica (watermarks/last_run — estado por formulário)
    const config = await getConfig();

    // 3c. MULTI-TOKEN (configuração EXCLUSIVAMENTE por conta): contas de
    //     anúncios habilitadas com o POLLING PRÓPRIO ativo + alvos por
    //     conta. Não existe polling global/formulários globais.
    const adAccounts = (await fetchEnabledAdAccounts('polling')).filter((a) =>
      accountIdFilter ? a.id === accountIdFilter : true,
    );
    if (accountIdFilter && adAccounts.length === 0) {
      return NextResponse.json({ status: 'error', message: 'Conta não encontrada, inativa ou com polling próprio desligado' }, { status: 404 });
    }

    const targets: PollTarget[] = [];
    const claimedForms = new Set<string>();
    for (const account of adAccounts) {
      const forms = parseJsonArray(account.formIds);
      if (forms.length === 0) {
        if (accountIdFilter) {
          return NextResponse.json({ status: 'idle', message: `A conta "${account.name}" não tem form IDs configurados — use o Sync Forms na aba Polling do card dela` });
        }
        continue;
      }
      if (!account.accessToken) {
        console.warn(`[Meta Polling] Conta "${account.name}" sem access token — ${forms.length} form(s) dela pulados`);
        continue;
      }
      for (const formId of forms) {
        if (claimedForms.has(formId)) continue;
        claimedForms.add(formId);
        targets.push({ formId, token: account.accessToken, adAccountId: account.id, accountName: account.name });
      }
    }

    if (targets.length === 0) {
      return NextResponse.json({ status: 'idle', message: 'Nenhuma conta de anúncios com polling ativo e form IDs configurados — cadastre contas em Contas de Anúncio e use o Sync Forms' });
    }
    if (targets.length > MAX_FORM_IDS) {
      return NextResponse.json({ status: 'error', message: `Máximo de ${MAX_FORM_IDS} formulários permitidos (somando as contas)` });
    }

    // 4. Janela de busca: watermark INDIVIDUAL por formulário.
    //    Fallback: last_run global (compatibilidade) ou 30 min.
    const globalFallback = config.lastRun ? new Date(config.lastRun).getTime() : Date.now() - 30 * 60 * 1000;
    const nowIso = new Date().toISOString();

    const accountCount = new Set(targets.map(t => t.accountName).filter(Boolean)).size;
    console.log(`[Meta Polling] Iniciando: alvos=${targets.length} (contas=${accountCount}${accountIdFilter ? ', escopo=1 conta' : ''}), watermarks=${Object.keys(config.formWatermarks).length || 'nenhum (usando last_run global)'}`);

    // 5. Buscar creator UMA vez
    const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
    let creatorId = admin?.id;
    if (!creatorId) { const any = await db.user.findFirst({ select: { id: true } }); creatorId = any?.id; }

    // Quota compartilhada entre todos os formulários paralelos
    const quota = { remaining: MAX_LEADS_PER_RUN };

    // Resultado por alvo (observabilidade)
    const perForm: Array<{ formId: string; account?: string | null; fetched: number; imported: number; deduped?: number; error?: string }> = [];
    const newWatermarks: Record<string, string> = { ...config.formWatermarks };
    const errors: string[] = [];

    // (b) Estado de autenticação por CONTA: sucesso/falha acumulado
    // durante o run e aplicado ao fim (1 write por conta, não por form).
    const okAccountIds = new Set<string>();
    const failedAccounts = new Map<string, { code: number | null; message: string }>();

    // 6. Processar alvos EM PARALELO (cada form é independente;
    //    cada conta usa o PRÓPRIO token — isolamento entre contas)
    await mapWithConcurrency(targets, FORM_CONCURRENCY, async (target) => {
      const { formId, token, adAccountId, accountName } = target;
      if (!creatorId || quota.remaining <= 0) {
        perForm.push({ formId, account: accountName, fetched: 0, imported: 0, error: 'pulando (sem usuário ou quota esgotada)' });
        return;
      }

      // Roteamento multi-anúncio/multi-conta: fila dedicada desta
      // campanha/formulário/conta (uma resolução por alvo — aplica-se
      // a todos os leads dele)
      const route = await resolveQueueForMetaLead({ formId, adAccountId: adAccountId || undefined });
      if (route.routeSource !== 'default') {
        console.log(`[Meta Polling] Form ${formId}${accountName ? ` (conta: ${accountName})` : ''} → fila "${route.queueName ?? route.queueId}" (${route.routeSource})`);
      }

      // Watermark individual — FASE 3: CURSOR PERSISTENTE por
      // (adAccountId, formId) com backfill do watermark legado na
      // primeira execução (idempotente). Flag legacy → watermark solta.
      const formWatermark = config.formWatermarks[formId];
      let cursor: CursorRow | null = null;
      let sinceMs = formWatermark ? new Date(formWatermark).getTime() : globalFallback;
      if (durablePolling && adAccountId) {
        try {
          cursor = await loadPollingCursor(db, adAccountId, formId, sinceMs);
          sinceMs = cursor.cursorTime.getTime();
        } catch (cursorErr) {
          console.error('[Meta Polling] Cursor indisponível — usando watermark legado:', cursorErr instanceof Error ? cursorErr.message : cursorErr);
          cursor = null;
        }
      }
      const since = new Date(sinceMs - 60 * 1000).toISOString();

      // Renovação do lease entre alvos (só o dono renova; falha não
      // aborta o run — o TTL de 90s cobre com folga)
      if (durablePolling && lease?.ownerToken) {
        await renewPollingLease(db, POLLING_LEASE_SCOPE, lease.ownerToken, POLLING_LEASE_TTL_MS).catch(() => {});
      }

      try {
        // FASE 3: PAGINAÇÃO COMPLETA da Graph API (paging.next), com
        // orçamento de tempo — o que não couber fica para o próximo run
        // (o cursor só avança até o último lead CONFIRMADO na inbox).
        const fetchResult = durablePolling
          ? await fetchAllLeadsPages(fetchLeadsPage, formId, token, since, { deadlineMs: runDeadline, maxPages: 10 })
          : null;
        const leads = fetchResult ? fetchResult.leads : await fetchRecentLeads(formId, token, since);
        // Token comprovadamente válido nesta conta (b)
        if (adAccountId) okAccountIds.add(adAccountId);
        console.log(`[Meta Polling] Form ${formId}${accountName ? ` (conta: ${accountName})` : ''}: ${leads.length} leads encontrados (since=${since})`);

        // Ordenar por created_time ASC
        leads.sort((a, b) => (a.created_time ? new Date(a.created_time).getTime() : 0) - (b.created_time ? new Date(b.created_time).getTime() : 0));

        let imported = 0;
        let deduped = 0;
        let cursorAdvanceMs: number | null = null;
        let deferredCount = 0;

        if (durablePolling && adAccountId && lease?.ownerToken) {
          // FASE 3 — separar buscar de processar: garante a inbox
          // idempotente PRIMEIRO (nenhum lead perdido), depois processa
          // com orçamento de tempo e reserva ATÔMICA de quota.
          const inboxDb = db;
          const confirmed: Array<{ item: MetaInboxRow; lead: MetaLeadLike }> = [];
          for (const lead of leads) {
            const inboxPayload: MetaInboxPayload = {
              leadgenId: lead.id,
              channel: 'polling',
              formId: lead.form_id || null,
              formName: lead.form_name || null,
              campaignId: lead.campaign_id || null,
              campaignName: lead.campaign_name || null,
              adId: lead.ad_id || null,
              adName: lead.ad_name || null,
              createdTimeRaw: lead.created_time || null,
              fieldData: lead.field_data || [],
              accountName,
              queueId: route.queueId,
              routeSource: route.routeSource,
            };
            const r = await ensureInboxItemInfallible(inboxDb, inboxPayload, adAccountId);
            if (!r.ok) throw new Error(`inbox indisponível (migration pendente?): ${r.error instanceof Error ? r.error.message : String(r.error)}`);
            confirmed.push({ item: r.item, lead });
          }

          // Cursor avança SOMENTE até o último lead CONFIRMADO na inbox
          for (let i = confirmed.length - 1; i >= 0; i--) {
            const c = confirmed[i];
            if (c.lead.created_time) {
              const ms = new Date(c.lead.created_time).getTime();
              if (await advancePollingCursor(db, adAccountId, formId, ms, c.lead.id)) {
                cursorAdvanceMs = ms;
              }
              break;
            }
          }

          // Worker com orçamento + quota atômica (reserve → import →
          // refund em dedup/falha — nunca decremento desprotegido)
          const drainResults = await drainInbox(
            inboxDb,
            ingestServices,
            {
              ids: confirmed.map((c) => c.item.id),
              budgetMs: Math.max(0, runDeadline - Date.now()),
              concurrency: LEAD_CONCURRENCY,
              creatorId,
              reserveQuotaSlot: () => reserveQuotaSlot(db, POLLING_LEASE_SCOPE, lease!.ownerToken!),
              refundQuotaSlot: () => refundQuotaSlot(db, POLLING_LEASE_SCOPE, lease!.ownerToken!),
            },
            resolveDrainPageToken,
          );
          for (const d of drainResults) {
            if (d.outcome?.imported) imported++;
            else if (d.outcome && !d.outcome.imported) deduped++;
            else if (d.deferredAs === 'retryable' || d.deferredAs === 'failed') {
              errors.push(`${formId}: ${d.error ?? 'erro de processamento (fila durável)'}`);
              deferredCount++;
            } else if (d.deferredAs === 'deferred' || d.deferredAs === 'quota_exhausted' || d.deferredAs === 'claim_lost') {
              deferredCount++;
            }
          }
          if (deferredCount > 0) {
            errors.push(`${deferredCount} lead(s) ficaram na fila durável (inbox) e serão importados automaticamente nos próximos runs/drain.`);
          }
        } else {
        // LEGADO — Leads do mesmo formulário em paralelo (concorrência limitada)
        const settledLeads = await mapWithConcurrency(leads, LEAD_CONCURRENCY, async (lead) => {
          if (quota.remaining <= 0) return { skipped: true, imported: false };
          const result = await importSingleLead(lead, creatorId, route.queueId, quota, adAccountId, accountName);
          if (result.imported) {
            quota.remaining--;
            imported++;
          } else if (result.reason === 'já_existente' || result.reason === 'cliente_existente_atualizado') {
            // Já estava no CRM (importado antes por webhook/polling) —
            // dedupe correto, não é erro (observabilidade na UI).
            deduped++;
          }
          return { skipped: false, imported: result.imported };
        });

        for (const s of settledLeads) {
          if (s.status === 'rejected') {
            const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
            errors.push(`${formId}: ${msg}`);
          }
        }
        }

        if (quota.remaining <= 0 && leads.length > imported) {
          errors.push(`Limite de ${MAX_LEADS_PER_RUN} leads atingido. Os demais serão importados na próxima execução.`);
        }

        perForm.push({ formId, account: accountName, fetched: leads.length, imported, deduped });

        // Sucesso na busca: avança o watermark DESTE formulário.
        // FASE 3: espelha o CURSOR no watermark legado (rollback seguro
        // para META_POLL_CURSOR_V2=legacy — sem refazer janelas antigas);
        // avança até o último lead CONFIRMADO, não até "agora".
        newWatermarks[formId] = cursorAdvanceMs !== null
          ? new Date(cursorAdvanceMs).toISOString()
          : (durablePolling && cursor ? new Date(Math.max(sinceMs, Date.now() - 60 * 1000)).toISOString() : nowIso);
      } catch (e) {
        if (durablePolling && cursor) recordCursorError(db, cursor, e instanceof Error ? e.message.slice(0, 300) : String(e));
        // Falha na busca do form: NÃO avança o watermark deste form —
        // a próxima execução repete a janela e nenhum lead é perdido
        const msg = `Form ${formId}${accountName ? ` (conta: ${accountName})` : ''}: ${e instanceof Error ? e.message : String(e)}`;
        console.error(`[Meta Polling] ${msg}`);
        errors.push(msg);
        perForm.push({ formId, account: accountName, fetched: 0, imported: 0, error: msg });
        // (b) 190/200/10 no corpo do erro Graph → marca a conta para
        // reconexão (transitórios são ignorados por registerAccountAuthFailure)
        if (adAccountId) {
          const graphCode = extractGraphErrorCode(e instanceof Error ? e.message : String(e));
          if (graphCode !== null) {
            const prev = failedAccounts.get(adAccountId);
            if (!prev) failedAccounts.set(adAccountId, { code: graphCode, message: msg.slice(0, 400) });
          }
        }
      }
    });

    // (b) Aplica o estado de autenticação — 1 write por conta afetada.
    // Falha vence sucesso (conta com 1 form OK e outro 190 continua
    // marcada — o próximo run limpa quando todos OK).
    for (const [accountId, failure] of failedAccounts) {
      await registerAccountAuthFailure(accountId, failure);
      okAccountIds.delete(accountId);
    }
    for (const accountId of okAccountIds) {
      await clearAccountAuthState(accountId);
    }

    // FASE 3 — safety net: consome o BACKLOG da inbox (itens de runs
    // anteriores/webhook estourados/retries vencidos) em lote pequeno
    // com o orçamento restante. O endpoint /api/cron/meta-inbox-drain
    // também consome este backlog entre runs.
    let inboxDrained = 0;
    if (durablePolling && lease?.ownerToken) {
      try {
        const backlog = await drainInbox(
          db,
          ingestServices,
          {
            limit: 5,
            budgetMs: Math.max(0, runDeadline - Date.now()),
            concurrency: 4,
            creatorId,
            reserveQuotaSlot: () => reserveQuotaSlot(db, POLLING_LEASE_SCOPE, lease!.ownerToken!),
            refundQuotaSlot: () => refundQuotaSlot(db, POLLING_LEASE_SCOPE, lease!.ownerToken!),
          },
          resolveDrainPageToken,
        );
        inboxDrained = backlog.filter((r) => r.outcome?.imported).length;
      } catch (backlogErr) {
        console.warn('[Meta Polling] Backlog da inbox indisponível:', backlogErr instanceof Error ? backlogErr.message : backlogErr);
      }
    }

    const totalFetched = perForm.reduce((acc, f) => acc + f.fetched, 0);
    const totalImported = perForm.reduce((acc, f) => acc + f.imported, 0);
    const totalDeduped = perForm.reduce((acc, f) => acc + (f.deduped || 0), 0);

    // 7. Atualizar last_run global (compatibilidade com a UI)
    await db.userSettings.upsert({
      where: { key: 'meta_polling_last_run' },
      update: { value: nowIso },
      create: { key: 'meta_polling_last_run', value: nowIso },
    }).catch(() => {});

    // 8. Persistir watermarks individuais por formulário
    await db.userSettings.upsert({
      where: { key: 'meta_polling_form_watermarks' },
      update: { value: JSON.stringify(newWatermarks) },
      create: { key: 'meta_polling_form_watermarks', value: JSON.stringify(newWatermarks) },
    }).catch(() => {});

    // Salvar resultado do último run (sem expor errors crusos no log)
    const lastResult = JSON.stringify({
      timestamp: nowIso, totalFetched, totalImported, totalDeduped, errorCount: errors.length,
      forms: targets.length, accounts: accountCount, elapsed: Date.now() - startTime, perForm,
    });
    await db.userSettings.upsert({
      where: { key: 'meta_polling_last_result' },
      update: { value: lastResult },
      create: { key: 'meta_polling_last_result', value: lastResult },
    }).catch(() => {});

    const elapsed = Date.now() - startTime;
    console.log(`[Meta Polling] Concluído em ${elapsed}ms: ${totalFetched} buscados, ${totalImported} importados, ${errors.length} erros`);

    return NextResponse.json({
      status: 'ok', elapsed: `${elapsed}ms`,
      scope: accountIdFilter ? 'single_account' : 'all_accounts',
      formsChecked: targets.length,
      accountsChecked: accountCount,
      totalFetched, totalImported, totalDeduped,
      perForm,
      inboxDrained,
      errors: errors.length > 0 ? errors : undefined,
    });
  } finally {
    // FASE 3: libera o lease (recuperação imediata por outro run);
    // flag legacy/liberação falha → TTL resolve sozinho.
    if (durablePolling && lease?.ownerToken) {
      await releasePollingLease(db, POLLING_LEASE_SCOPE, lease.ownerToken);
    } else {
      isRunning = false;
    }
  }
}
