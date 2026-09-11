// ============================================================
// META LEAD INBOX — ingestão durável e idempotente (Fase 3)
// ============================================================
// Tabela de jobs que desacopla "receber" de "processar":
//
//   1. Webhook/polling persistem o evento AQUI (ensureInboxItem,
//      idempotente por dedupKey = leadgen:{leadgenId}) e respondem
//      rápido;
//   2. O worker (drainInbox) processa com orçamento de tempo e
//      concorrência limitada — mesmo leadgen que chegue por webhook
//      E polling cai na MESMA linha e é processado UMA vez;
//   3. Falhas viram RETRYABLE com backoff exponencial; após
//      maxAttempts, FAILED. Erro sempre sanitizado (regra 6:
//      sem tokens, secrets, PII ou payload completo em logs).
//
// Replay: o mesmo evento retorna o resultado existente e nunca
// cria outro cliente (UNIQUE clients.metaLeadgenId), outra
// atribuição (idempotência de 2 camadas no assignLeadToUser) ou
// outra mensagem Telegram (delivery-slot por dedupKey no serviço
// de notificação).
//
// Degradação graciosa: se as tabelas ainda não existirem
// (migration pendente), ensureInboxItemInfallible sinaliza { ok:
// false } e o chamador usa o caminho legado — deploy seguro antes
// do db:release.
// ============================================================

import type { MetaFieldData, MetaIngestServices, MetaLeadOutcome, MetaLeadPipelineInput } from './pipeline';
import { processMetaLead } from './pipeline';

/** Fontes de roteamento válidas (espelham ResolvedLeadRoute sem import runtime). */
const ROUTE_SOURCES = ['campaign_binding', 'form_mapping', 'ad_account', 'capi_config', 'capi_config_by_form', 'default'] as const;
type RouteSource = (typeof ROUTE_SOURCES)[number];

function parseRouteSource(raw: string | null | undefined): RouteSource {
  return (ROUTE_SOURCES as readonly string[]).includes(raw ?? '') ? (raw as RouteSource) : 'default';
}

// ── Tipos ───────────────────────────────────────────────────────

export type MetaInboxStatus = 'RECEIVED' | 'PROCESSING' | 'SUCCEEDED' | 'RETRYABLE' | 'FAILED';

/** Payload mínimo persistido na inbox (sem PII além do field_data
 *  necessário ao processamento — a fonte original já o contém).
 *  TYPE ALIAS (não interface): o Prisma exige index signature
 *  implícita para InputJsonValue (payload Json). */
export type MetaInboxPayload = {
  leadgenId: string;
  channel: 'webhook' | 'polling';
  formId?: string | null;
  formName?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  adId?: string | null;
  adName?: string | null;
  /** Webhook: unix (segundos). Polling: ISO string. */
  createdTimeRaw?: number | string | null;
  /** field_data quando a origem já o trouxe (polling sempre; webhook às vezes). */
  fieldData?: MetaFieldData;
  /** Page id da entry (webhook) — resolve o PAGE TOKEN no processamento. */
  pageId?: string | null;
  /** Nome da conta (logs/LostLead quando a conta sumiu). */
  accountName?: string | null;
  /** Polling: fila pré-resolvida por alvo. */
  queueId?: string;
  routeSource?: string;
};

/** Linha da inbox (fatia do retorno Prisma). */
export interface MetaInboxRow {
  id: string;
  dedupKey: string;
  leadgenId: string;
  channel: string;
  adAccountId: string | null;
  formId: string | null;
  campaignId: string | null;
  payload: unknown;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  result: unknown;
  processedAt: Date | null;
}

/** Fatia estrutural do PrismaClient para a inbox (método = bivariância). */
export interface MetaInboxDbSlice {
  metaLeadInbox: {
    create(args: {
      data: {
        dedupKey: string;
        leadgenId: string;
        channel: string;
        adAccountId?: string | null;
        formId?: string | null;
        campaignId?: string | null;
        payload: MetaInboxPayload;
      };
    }): Promise<MetaInboxRow>;
    findUnique(args: { where: { dedupKey: string } }): Promise<MetaInboxRow | null>;
    findMany(args: {
      where: {
        id?: { in: string[] };
        status?: { in: string[] };
        nextAttemptAt?: { lte: Date };
      };
      orderBy: { nextAttemptAt: 'asc' };
      take: number;
    }): Promise<MetaInboxRow[]>;
    update(args: {
      where: { id: string };
      data: {
        status?: string;
        attempts?: { increment: number };
        nextAttemptAt?: Date;
        lastError?: string | null;
        result?: MetaLeadOutcome;
        processedAt?: Date | null;
      };
    }): Promise<unknown>;
    updateMany(args: {
      where: {
        id: string;
        status: { in: string[] };
        nextAttemptAt: { lte: Date };
        attempts: { lt: number };
      };
      data: { status: string; attempts: { increment: number } };
    }): Promise<{ count: number }>;
    deleteMany(args: { where: { id: { in: string[] } } }): Promise<{ count: number }>;
  };
}

// ── Erros Prisma conhecidos (sem importar @prisma/client runtime) ─

function prismaErrorCode(err: unknown): string | null {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}

/** Erro é "tabela/coluna não existe" (migration pendente)? */
export function isSchemaMissingError(err: unknown): boolean {
  const code = prismaErrorCode(err);
  return code === 'P2021' || code === 'P2022';
}

// ── Chave idempotente e sanitização ─────────────────────────────

export function buildDedupKey(leadgenId: string): string {
  return `leadgen:${leadgenId}`;
}

/**
 * Sanitiza um erro para persistência/log (regra 6 do prompt):
 * remove access_token/credenciais, e-mails, telefones E.164 e
 * trunca em 500 caracteres.
 */
export function sanitizeError(raw: unknown): string {
  let text = raw instanceof Error ? `${raw.name}: ${raw.message}` : String(raw);
  text = text
    .replace(/access_token=[^&\s"']+/gi, 'access_token=***')
    .replace(/client_secret=[^&\s"']+/gi, 'client_secret=***')
    .replace(/Bearer\s+[\w.-]{10,}/gi, 'Bearer ***')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\b55?\d{10,13}\b/g, '[phone]');
  return text.slice(0, 500);
}

/** Backoff exponencial com teto: 1, 2, 4, 8, 15min (máx 15min). */
export function retryBackoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 15 * 60_000);
}

// ── Persistência idempotente ────────────────────────────────────

export interface EnsureInboxResult {
  item: MetaInboxRow;
  /** true = evento novo persistido; false = replay (linha existente). */
  created: boolean;
}

/**
 * Garante a linha da inbox para o evento (idempotente). O replay do
 * MESMO leadgen reencontra a linha existente — nunca cria nada novo
 * no CRM. Corrida entre instâncias: P2002 cai no re-fetch.
 */
export async function ensureInboxItem(
  db: MetaInboxDbSlice,
  payload: MetaInboxPayload,
  adAccountId: string | null,
): Promise<EnsureInboxResult> {
  const dedupKey = buildDedupKey(payload.leadgenId);

  const existing = await db.metaLeadInbox.findUnique({ where: { dedupKey } });
  if (existing) return { item: existing, created: false };

  try {
    const item = await db.metaLeadInbox.create({
      data: {
        dedupKey,
        leadgenId: payload.leadgenId,
        channel: payload.channel,
        adAccountId,
        formId: payload.formId ?? null,
        campaignId: payload.campaignId ?? null,
        payload,
      },
    });
    return { item, created: true };
  } catch (err) {
    if (prismaErrorCode(err) === 'P2002') {
      // Outra instância venceu a corrida — resultado existente é o contrato
      const item = await db.metaLeadInbox.findUnique({ where: { dedupKey } });
      if (item) return { item, created: false };
    }
    throw err;
  }
}

/**
 * ensureInboxItem à prova de falhas: erro de schema/migration ou
 * indisponibilidade devolve { ok: false } para o chamador cair no
 * caminho legado (deploy seguro antes do db:release).
 */
export async function ensureInboxItemInfallible(
  db: MetaInboxDbSlice,
  payload: MetaInboxPayload,
  adAccountId: string | null,
): Promise<{ ok: true } & EnsureInboxResult | { ok: false; error: unknown }> {
  try {
    const r = await ensureInboxItem(db, payload, adAccountId);
    return { ok: true, ...r };
  } catch (error) {
    return { ok: false, error };
  }
}

// ── Worker (claim → processar → completar/retentar) ────────────

/**
 * Reivindica a linha de forma atômica (CAS): só UMA instância vence.
 * RECEIVED/RETRYABLE com nextAttemptAt vencido e attempts < max.
 */
export async function claimInboxItem(db: MetaInboxDbSlice, item: MetaInboxRow, now: Date): Promise<boolean> {
  const r = await db.metaLeadInbox.updateMany({
    where: {
      id: item.id,
      status: { in: ['RECEIVED', 'RETRYABLE'] },
      nextAttemptAt: { lte: now },
      attempts: { lt: item.maxAttempts },
    },
    data: { status: 'PROCESSING', attempts: { increment: 1 } },
  });
  return r.count === 1;
}

export async function completeInboxItem(
  db: MetaInboxDbSlice,
  id: string,
  outcome: MetaLeadOutcome,
): Promise<void> {
  await db.metaLeadInbox.update({
    where: { id },
    data: {
      status: 'SUCCEEDED',
      result: outcome,
      processedAt: new Date(),
      lastError: null,
    },
  });
}

export async function failInboxItem(
  db: MetaInboxDbSlice,
  item: MetaInboxRow,
  rawError: unknown,
): Promise<MetaInboxStatus> {
  const attempts = item.attempts + 1; // claim já incrementou
  const lastError = sanitizeError(rawError);
  if (attempts < item.maxAttempts) {
    const nextAttemptAt = new Date(Date.now() + retryBackoffMs(attempts));
    await db.metaLeadInbox.update({
      where: { id: item.id },
      data: { status: 'RETRYABLE', nextAttemptAt, lastError },
    });
    return 'RETRYABLE';
  }
  await db.metaLeadInbox.update({
    where: { id: item.id },
    data: { status: 'FAILED', lastError, processedAt: new Date() },
  });
  return 'FAILED';
}

// ── Drain (worker com orçamento de tempo) ───────────────────────

/** Resultado de um item drenado, na ordem dos itens de entrada. */
export interface DrainItemResult {
  item: MetaInboxRow;
  /** Outcome do pipeline quando o item foi processado neste drain. */
  outcome?: MetaLeadOutcome;
  /** 'deferred' = orçamento estourou (fica na inbox para retry);
   *  'claim_lost' = outra instância processando;
   *  'quota_exhausted' = quota do run esgotada;
   *  'retryable' | 'failed' = exceção com backoff/agotada. */
  deferredAs?: 'deferred' | 'claim_lost' | 'quota_exhausted' | 'retryable' | 'failed';
  error?: string;
}

/** Referência mínima de conta para o worker (compatível com AdAccountRef). */
export interface DrainAccountRef {
  name: string;
  accessToken: string;
  pageTokens?: string | null;
}

export interface DrainAccountResolver {
  (adAccountId: string): Promise<DrainAccountRef | null>;
}

/** Resolve o page token de processamento (implementação real em defaults.ts). */
export type PageTokenResolver = (account: DrainAccountRef | null, pageId: string | null) => string | null;

export interface DrainOptions {
  /** IDs específicos (webhook: linhas acabadas de garantir). */
  ids?: string[];
  /** Modo fila: busca pendentes/RETRYABLE vencidos (drain endpoint). */
  limit?: number;
  /** Orçamento de tempo do worker (serverless-safe). */
  budgetMs: number;
  concurrency?: number;
  /** Canal preferido para itens novos (default: o channel da linha). */
  creatorId?: string;
  /** Resolvedora de conta (page tokens) — default em defaults.ts. */
  accountResolver?: DrainAccountResolver;
  /** Polling: reserva/refund atômicos de quota do run. */
  reserveQuotaSlot?: () => Promise<boolean>;
  refundQuotaSlot?: () => Promise<void> | void;
  /** Simulação/observabilidade: horário base para claims. */
  now?: () => Date;
}

function buildPipelineInput(
  item: MetaInboxRow,
  payload: MetaInboxPayload,
  account: DrainAccountRef | null,
  creatorId: string | undefined,
  resolvePageToken: PageTokenResolver,
): MetaLeadPipelineInput {
  const channel = item.channel === 'polling' ? 'polling' : 'webhook';
  return {
    channel,
    leadgenId: item.leadgenId,
    fieldData: payload.fieldData ?? [],
    createdTimeRaw: payload.createdTimeRaw ?? null,
    rawAdName: payload.adName ?? null,
    rawAdId: payload.adId ?? null,
    campaignId: payload.campaignId ?? null,
    campaignName: payload.campaignName ?? null,
    formId: payload.formId ?? null,
    formName: payload.formName ?? null,
    adAccountDbId: item.adAccountId,
    adAccountName: account?.name ?? payload.accountName ?? 'conta',
    pageToken: channel === 'webhook' ? resolvePageToken(account, payload.pageId ?? null) : null,
    creatorId,
    preResolvedRoute: channel === 'polling'
      ? { queueId: payload.queueId, routeSource: parseRouteSource(payload.routeSource) }
      : undefined,
  };
}

/**
 * Processa itens da inbox com orçamento de tempo e concorrência
 * limitada. Itens NÃO processados (orçamento/quota) permanecem
 * RECEIVED/RETRYABLE — nenhum lead é perdido: o próximo drain
 * (polling, endpoint ou webhook) retoma de onde parou.
 */
export async function drainInbox(
  db: MetaInboxDbSlice,
  services: MetaIngestServices,
  options: DrainOptions,
  resolvePageToken: PageTokenResolver,
): Promise<DrainItemResult[]> {
  const now = options.now ?? (() => new Date());
  const deadline = Date.now() + options.budgetMs;
  const concurrency = options.concurrency ?? 4;
  const limit = options.limit ?? options.ids?.length ?? 10;

  const candidates = await db.metaLeadInbox.findMany({
    where: {
      ...(options.ids && options.ids.length > 0 ? { id: { in: options.ids } } : {}),
      status: { in: ['RECEIVED', 'RETRYABLE'] },
      nextAttemptAt: { lte: now() },
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
  });

  const results: DrainItemResult[] = new Array(candidates.length);
  let nextIndex = 0;

  const processOne = async (item: MetaInboxRow, index: number): Promise<void> => {
    // Orçamento: item fica para o próximo drain (nunca é perdido)
    if (Date.now() >= deadline) {
      results[index] = { item, deferredAs: 'deferred' };
      return;
    }
    // Quota (polling): reserva atômica ANTES do claim — sem decremento
    // desprotegido; se não há slot, o item fica para o próximo run.
    let reserved = false;
    if (options.reserveQuotaSlot) {
      if (!(await options.reserveQuotaSlot())) {
        results[index] = { item, deferredAs: 'quota_exhausted' };
        return;
      }
      reserved = true;
    }

    // Controle de quota: só consumo o slot com import REAL (comportamento
    // atual — dedup e falha não consomem); tudo diferente disso devolve.
    let imported = false;
    try {
      const claimed = await claimInboxItem(db, item, now());
      if (!claimed) {
        results[index] = { item, deferredAs: 'claim_lost' };
        return;
      }

      const payload = (item.payload ?? {}) as MetaInboxPayload;
      const account = item.adAccountId && options.accountResolver
        ? await options.accountResolver(item.adAccountId)
        : null;
      const input = buildPipelineInput(item, payload, account, options.creatorId, resolvePageToken);

      const outcome = await processMetaLead(services, input);
      // Outcome ≠ exceção: o processamento COMPLETOU (inclusive
      // resultados de negócio como no_account_token/create_failed —
      // terminais, idênticos ao comportamento atual).
      await completeInboxItem(db, item.id, outcome);
      imported = outcome.imported;
      results[index] = { item, outcome };
    } catch (error) {
      // Exceção → backoff controlado (RETRYABLE) ou FAILED
      const status = await failInboxItem(db, item, error).catch(() => 'FAILED' as const);
      results[index] = { item, deferredAs: status === 'RETRYABLE' ? 'retryable' : 'failed', error: sanitizeError(error) };
    } finally {
      if (reserved && !imported) {
        await options.refundQuotaSlot?.();
      }
    }
  };

  // Fila simples de concorrência sem pular o orçamento entre itens
  const workers: Array<Promise<void>> = [];
  const runWorker = async (): Promise<void> => {
    for (;;) {
      const idx = nextIndex++;
      if (idx >= candidates.length) return;
      await processOne(candidates[idx], idx);
    }
  };
  for (let i = 0; i < Math.min(concurrency, Math.max(1, candidates.length)); i++) {
    workers.push(runWorker());
  }
  await Promise.all(workers);

  return results;
}
