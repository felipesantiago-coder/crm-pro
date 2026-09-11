// ============================================================
// WEBHOOK VIA INBOX — fluxo durável do POST /api/webhooks/meta-leads
// ============================================================
// Sequência (prompt Fase 3 — Webhook):
//   1. assinatura/schema validados (ficam na rota — HMAC intocado);
//   2. CADA change com leadgen_id é persistida na inbox idempotente
//      por dedupKey (webhook e polling compartilham o espaço —
//      replay e cruzamento de canais nunca duplicam);
//   3. a rota responde rápido APÓS a persistência;
//   4. o worker (drainInbox) processa Graph API/cliente/interação/
//      temperatura/fila/notificações com orçamento de tempo;
//      estouro vai para RETRY/drain — nenhum lead é perdido;
//   5. status RECEIVED → PROCESSING → SUCCEEDED/RETRYABLE/FAILED
//      com erro sanitizado.
//
// Degradação: sem migration aplicada (tabela ausente) devolve
// { ok: false } e a rota usa o processamento inline legado — deploy
// seguro antes do db:release. Linhas garantidas antes de uma falha
// são removidas (best effort) para não duplicar o processamento.
// ============================================================

import type { MetaInboxDbSlice, DrainItemResult, MetaInboxPayload, MetaInboxRow } from './inbox';
import { ensureInboxItemInfallible, drainInbox } from './inbox';
import type { MetaIngestServices } from './pipeline';
import type { DrainAccountResolver, PageTokenResolver } from './inbox';
import { isMetaInboxV2Enabled } from './flags';

/** Resultado por lead no formato EXATO da resposta atual do webhook. */
export interface WebhookResultItem {
  success: boolean;
  clientName?: string;
  reason?: string;
  leadId?: string;
}

/** Change normalizado que a rota entrega (sem acoplar aos tipos locais). */
export interface WebhookInboxChange {
  leadgenId: string;
  formId: string | null;
  formName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  adId: string | null;
  adName: string | null;
  /** unix (segundos) quando presente no payload do Meta. */
  createdTimeRaw: number | null;
  fieldData: Array<{ name: string; values: string[] }> | null;
  pageId: string | null;
  adAccountId: string | null;
  accountName: string;
}

export interface WebhookInboxArgs {
  inboxDb: MetaInboxDbSlice;
  services: MetaIngestServices;
  changes: WebhookInboxChange[];
  creatorId?: string;
  /** Orçamento do worker inline (maxDuration 30 → ~20s úteis). */
  budgetMs?: number;
  concurrency?: number;
  accountResolver?: DrainAccountResolver;
  pageTokenResolver?: PageTokenResolver;
}

export type WebhookInboxOutcome =
  | { ok: true; results: WebhookResultItem[]; inboxEnabled: true }
  | { ok: false; inboxEnabled: false };

function payloadFromChange(change: WebhookInboxChange): MetaInboxPayload {
  return {
    leadgenId: change.leadgenId,
    channel: 'webhook',
    formId: change.formId,
    formName: change.formName,
    campaignId: change.campaignId,
    campaignName: change.campaignName,
    adId: change.adId,
    adName: change.adName,
    createdTimeRaw: change.createdTimeRaw,
    fieldData: change.fieldData ?? undefined,
    pageId: change.pageId,
    accountName: change.accountName,
  };
}

function resultFromDrain(d: DrainItemResult | undefined, leadId: string, ensuredItem?: MetaInboxRow): WebhookResultItem {
  // Processado neste drain → formato legado exato
  if (d?.outcome) {
    return {
      success: d.outcome.success,
      clientName: d.outcome.clientName,
      reason: d.outcome.reason,
      leadId,
    };
  }

  // Replay já resolvido anteriormente → resultado existente (contrato:
  // "O replay do mesmo evento deve retornar o resultado existente")
  const row = d?.item ?? ensuredItem;
  const stored = (row?.result ?? null) as { success?: boolean; clientName?: string; reason?: string } | null | undefined;
  if (row?.status === 'SUCCEEDED' && stored) {
    return { success: !!stored.success, clientName: stored.clientName, reason: stored.reason, leadId };
  }

  // Deferred/quota/claim-lost/retryable/failed
  const reasonByState: Record<string, string> = {
    deferred: 'deferred_to_retry',
    quota_exhausted: 'deferred_to_retry',
    claim_lost: 'processing_in_progress',
    retryable: 'retry_scheduled',
    failed: 'processing_error',
  };
  const reason = (d?.deferredAs && reasonByState[d.deferredAs])
    || (row?.status === 'PROCESSING' ? 'processing_in_progress' : 'processing_error');
  return { success: false, reason, leadId };
}

/**
 * Ingestão durável do webhook. Retorna { ok: false } para a rota
 * cair no caminho inline legado quando: flag desligada, tabela da
 * inbox ausente (migration pendente) ou falha de persistência.
 */
export async function ingestWebhookViaInbox(args: WebhookInboxArgs): Promise<WebhookInboxOutcome> {
  if (!isMetaInboxV2Enabled()) return { ok: false, inboxEnabled: false };

  const { inboxDb, services, changes, creatorId } = args;

  // (2) persistir inbox mínima idempotente — TODOS os leads primeiro
  const ensured: Array<{ change: WebhookInboxChange; id: string; item: MetaInboxRow }> = [];
  try {
    for (const change of changes) {
      const r = await ensureInboxItemInfallible(inboxDb, payloadFromChange(change), change.adAccountId);
      if (!r.ok) throw r.error;
      ensured.push({ change, id: r.item.id, item: r.item });
    }
  } catch (ensureError) {
    // Schema ausente/indisponível → limpa o que criou e cai no legado
    if (ensured.length > 0) {
      await inboxDb.metaLeadInbox
        .deleteMany({ where: { id: { in: ensured.map((e) => e.id) } } })
        .catch(() => {});
    }
    console.error('[Meta Webhook] Inbox indisponível — usando processamento inline legado:', ensureError instanceof Error ? ensureError.message : ensureError);
    return { ok: false, inboxEnabled: false };
  }

  // (3+4) worker inline com orçamento — estouro fica para retry/drain
  const drainResults = await drainInbox(
    inboxDb,
    services,
    {
      ids: ensured.map((e) => e.id),
      budgetMs: args.budgetMs ?? 20_000,
      concurrency: args.concurrency ?? 4,
      creatorId,
      accountResolver: args.accountResolver,
    },
    args.pageTokenResolver ?? (() => null),
  );

  // (5) resposta no formato exato do contrato atual
  const byId = new Map<string, DrainItemResult>();
  for (const d of drainResults) byId.set(d.item.id, d);

  const results = ensured.map((e) => resultFromDrain(byId.get(e.id), e.change.leadgenId, e.item));
  return { ok: true, results, inboxEnabled: true };
}
