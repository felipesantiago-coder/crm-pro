// ============================================================
// META POLLING DURÁVEL — cursor, lease e quota (Fase 3)
// ============================================================
// Substituições (prompt Fase 3 — Polling):
//
//   since+limit=100 (1 página)      → cursor persistente por
//     (adAccountId, formId) + PAGINAÇÃO COMPLETA da Graph API
//     (paging.next), com janela de sobreposição preservada e
//     duplicação eliminada pela chave idempotente da inbox;
//   isRunning em memória            → lease distribuído no Postgres
//     com TTL, renovação e recuperação automática pós-crash;
//   quota decrementada sem proteção → reserva ATÔMICA por slot
//     (UPDATE condicional quotaRemaining > 0 decrement 1) antes de
//     cada import; dedup/falha devolvem o slot.
//
// "Separar buscar de processar": o polling busca leads → garante a
// inbox (idempotente) → processa com orçamento de tempo. O cursor
// avança SOMENTE até o último lead confirmado na inbox — o que não
// couber fica para o próximo run/drain (hoje ele era PERDIDO quando
// a quota estourava, pois o watermark avançava mesmo assim).
//
// Backfill: cursor inicializado a partir de meta_polling_form_watermarks
// (UserSettings) na primeira execução — idempotente.
// ============================================================

import crypto from 'crypto';

// ── Tipos de lead Graph (fatia usada pelo polling) ──────────────

export interface MetaLeadLike {
  id: string;
  field_data?: Array<{ name: string; values: string[] }>;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id?: string;
  form_name?: string;
  created_time?: string;
}

export interface GraphLeadsResponse {
  data?: MetaLeadLike[];
  paging?: { next?: string; cursors?: { after?: string } };
}

// ── Fatia estrutural do PrismaClient (cursor + lease) ───────────

export interface CursorRow {
  id: string;
  adAccountId: string;
  formId: string;
  cursorTime: Date;
  lastConfirmedLeadgenId: string | null;
}

export interface LeaseRow {
  id: string;
  scope: string;
  ownerToken: string;
  quotaRemaining: number;
  expiresAt: Date;
}

export interface MetaPollingDbSlice {
  metaPollingCursor: {
    findUnique(args: {
      where: { adAccountId_formId: { adAccountId: string; formId: string } };
    }): Promise<CursorRow | null>;
    create(args: {
      data: {
        adAccountId: string;
        formId: string;
        cursorTime: Date;
        lastConfirmedLeadgenId?: string | null;
      };
    }): Promise<CursorRow>;
    update(args: {
      where: { id: string };
      data: {
        cursorTime?: Date;
        lastConfirmedLeadgenId?: string | null;
        lastRunAt?: Date;
        lastError?: string | null;
      };
    }): Promise<unknown>;
    updateMany(args: {
      where: {
        id: string;
        cursorTime?: { lt: Date };
      };
      data: {
        cursorTime?: Date;
        lastConfirmedLeadgenId?: string | null;
        lastError?: string | null;
      };
    }): Promise<{ count: number }>;
  };
  metaPollingLease: {
    findUnique(args: { where: { scope: string } }): Promise<LeaseRow | null>;
    create(args: {
      data: { scope: string; ownerToken: string; quotaRemaining: number; expiresAt: Date; renewedAt: Date };
    }): Promise<LeaseRow>;
    update(args: {
      where: { id: string };
      data: {
        ownerToken?: string;
        quotaRemaining?: number;
        expiresAt?: Date;
        renewedAt?: Date;
      };
    }): Promise<unknown>;
    updateMany(args: {
      where: {
        scope: string;
        ownerToken?: string;
        expiresAt?: { lt: Date } | { gt: Date };
        quotaRemaining?: { gt: number };
      };
      data: {
        ownerToken?: string;
        quotaRemaining?: number | { decrement: number } | { increment: number };
        expiresAt?: Date;
        renewedAt?: Date;
      };
    }): Promise<{ count: number }>;
  };
}

// ── Lease distribuído (TTL + renovação + recuperação de crash) ──

export interface LeaseAcquisition {
  acquired: boolean;
  ownerToken: string | null;
  /** true se assumimos um lease EXPIRADO (crash de outra instância). */
  recovered?: boolean;
}

/**
 * Adquire o lease do escopo. Corridas entre instâncias são
 * resolvidas atomicamente: create (primeira) ou takeover condicional
 * do lease expirado (UPDATE ... WHERE expiresAt < now) — só UMA
 * instância vence. Lease ativo de outra instância → acquired=false
 * (mesmo comportamento de already_running do isRunning).
 */
export async function acquirePollingLease(
  db: MetaPollingDbSlice,
  scope: string,
  ttlMs: number,
  quota: number,
): Promise<LeaseAcquisition> {
  const now = new Date();
  const ownerToken = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + ttlMs);

  try {
    await db.metaPollingLease.create({
      data: { scope, ownerToken, quotaRemaining: quota, expiresAt, renewedAt: now },
    });
    return { acquired: true, ownerToken };
  } catch (err) {
    const code = typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: string }).code : undefined;
    if (code !== 'P2002') throw err;
  }

  // Já existe linha: assumir SOMENTE se expirada (crash/_ttl vencido)
  const taken = await db.metaPollingLease.updateMany({
    where: { scope, expiresAt: { lt: now } },
    data: { ownerToken, quotaRemaining: quota, expiresAt, renewedAt: now },
  });
  if (taken.count === 1) {
    return { acquired: true, ownerToken, recovered: true };
  }
  return { acquired: false, ownerToken: null };
}

/** Renova o lease (só o dono, e só enquanto não expirou). */
export async function renewPollingLease(
  db: MetaPollingDbSlice,
  scope: string,
  ownerToken: string,
  ttlMs: number,
): Promise<boolean> {
  const now = new Date();
  const r = await db.metaPollingLease.updateMany({
    where: { scope, ownerToken, expiresAt: { gt: now } },
    data: { expiresAt: new Date(now.getTime() + ttlMs), renewedAt: now },
  });
  return r.count === 1;
}

/** Libera o lease no fim do run (recuperação imediata por outra instância). */
export async function releasePollingLease(
  db: MetaPollingDbSlice,
  scope: string,
  ownerToken: string,
): Promise<void> {
  const now = new Date();
  await db.metaPollingLease.updateMany({
    where: { scope, ownerToken },
    data: { quotaRemaining: 0, expiresAt: new Date(now.getTime() - 1_000), renewedAt: now },
  }).catch(() => {});
}

// ── Quota atômica do run ────────────────────────────────────────

/** Reserva 1 slot ATOMICAMENTE (WHERE quotaRemaining > 0 decrement). */
export async function reserveQuotaSlot(
  db: MetaPollingDbSlice,
  scope: string,
  ownerToken: string,
): Promise<boolean> {
  const r = await db.metaPollingLease.updateMany({
    where: { scope, ownerToken, quotaRemaining: { gt: 0 } },
    data: { quotaRemaining: { decrement: 1 } },
  });
  return r.count === 1;
}

/** Devolve um slot (dedup/falha não consomem quota — contrato atual). */
export async function refundQuotaSlot(
  db: MetaPollingDbSlice,
  scope: string,
  ownerToken: string,
): Promise<void> {
  await db.metaPollingLease.updateMany({
    where: { scope, ownerToken },
    data: { quotaRemaining: { increment: 1 } },
  }).catch(() => {});
}

// ── Cursor por (adAccountId, formId) com backfill legado ────────

/**
 * Carrega o cursor do alvo; se inexistente, inicializa a partir do
 * watermark legado (UserSettings meta_polling_form_watermarks) ou do
 * fallback global — idempotente (corrida → re-leitura).
 */
export async function loadPollingCursor(
  db: MetaPollingDbSlice,
  adAccountId: string,
  formId: string,
  legacyWatermarkMs: number,
): Promise<CursorRow> {
  const existing = await db.metaPollingCursor.findUnique({
    where: { adAccountId_formId: { adAccountId, formId } },
  });
  if (existing) return existing;

  try {
    return await db.metaPollingCursor.create({
      data: {
        adAccountId,
        formId,
        cursorTime: new Date(legacyWatermarkMs),
      },
    });
  } catch (err) {
    const code = typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: string }).code : undefined;
    if (code !== 'P2002') throw err;
    const raced = await db.metaPollingCursor.findUnique({
      where: { adAccountId_formId: { adAccountId, formId } },
    });
    if (!raced) throw err;
    return raced;
  }
}

/**
 * Avança o cursor até o created_time do último lead CONFIRMADO na
 * inbox. NUNCA retrocede (updateMany condicional cursorTime < novo).
 */
export async function advancePollingCursor(
  db: MetaPollingDbSlice,
  adAccountId: string,
  formId: string,
  newCursorTimeMs: number,
  lastConfirmedLeadgenId: string | null,
): Promise<boolean> {
  const existing = await db.metaPollingCursor.findUnique({
    where: { adAccountId_formId: { adAccountId, formId } },
  });
  if (!existing) return false;
  const newTime = new Date(newCursorTimeMs);
  if (existing.cursorTime >= newTime) return false;
  const r = await db.metaPollingCursor.updateMany({
    where: { id: existing.id, cursorTime: { lt: newTime } },
    data: { cursorTime: newTime, lastConfirmedLeadgenId },
  });
  return r.count === 1;
}

export function recordCursorError(
  db: MetaPollingDbSlice,
  row: CursorRow,
  sanitizedError: string | null,
): void {
  db.metaPollingCursor.update({
    where: { id: row.id },
    data: { lastRunAt: new Date(), lastError: sanitizedError },
  }).catch(() => {});
}

export function recordCursorRun(db: MetaPollingDbSlice, row: CursorRow): void {
  db.metaPollingCursor.update({
    where: { id: row.id },
    data: { lastRunAt: new Date(), lastError: null },
  }).catch(() => {});
}

// ── Paginação completa da Graph API ─────────────────────────────

export interface FetchPagesResult {
  leads: MetaLeadLike[];
  pages: number;
  /** true se a paginação parou por orçamento (restante no próximo run). */
  stoppedByBudget: boolean;
}

/**
 * Busca TODAS as páginas de /{formId}/leads desde `sinceIso`,
 * seguindo paging.next, com orçamento de tempo e teto de segurança.
 * Cada página usa o mesmo timeout da busca atual (fetchPage injetado
 * pela rota — AbortController + GRAPH_API_TIMEOUT_MS).
 */
export async function fetchAllLeadsPages(
  fetchPage: (url: string) => Promise<GraphLeadsResponse>,
  formId: string,
  token: string,
  sinceIso: string,
  opts: { deadlineMs: number; maxPages?: number; now?: () => number },
): Promise<FetchPagesResult> {
  const now = opts.now ?? (() => Date.now());
  const maxPages = opts.maxPages ?? 10;
  const leads: MetaLeadLike[] = [];
  let pages = 0;
  let stoppedByBudget = false;

  const FIELDS = 'field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,form_name,created_time';
  let url: string | null =
    `https://graph.facebook.com/v26.0/${formId}/leads?fields=${FIELDS}&limit=100&since=${encodeURIComponent(sinceIso)}&access_token=${encodeURIComponent(token)}`;

  while (url && pages < maxPages) {
    if (now() >= opts.deadlineMs) {
      stoppedByBudget = true;
      break;
    }
    const page = await fetchPage(url);
    pages++;
    if (Array.isArray(page?.data)) {
      leads.push(...page.data);
    }
    // paging.next já vem com token/after — basta seguir
    url = page?.paging?.next ?? null;
  }

  return { leads, pages, stoppedByBudget };
}

// ── Sincronização legada (rollback seguro) ──────────────────────

/**
 * Espelha os valores dos cursors nos watermarks legados
 * (meta_polling_form_watermarks) durante o canário: se a flag voltar
 * para legacy, o polling legado continua de onde o cursor parou —
 * sem refazer janelas antigas.
 */
export function mergeLegacyWatermarks(
  current: Record<string, string>,
  updates: Array<{ formId: string; cursorTimeMs: number }>,
): Record<string, string> {
  const merged = { ...current };
  for (const { formId, cursorTimeMs } of updates) {
    const prev = merged[formId] ? new Date(merged[formId]).getTime() : 0;
    if (cursorTimeMs > prev) {
      merged[formId] = new Date(cursorTimeMs).toISOString();
    }
  }
  return merged;
}
