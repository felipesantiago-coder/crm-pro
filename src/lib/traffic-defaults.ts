// ============================================================
// TRAFFIC DEFAULTS — amarração REAL das deps de tráfego ao Prisma
// ============================================================
// Padrão meta-ingest/defaults.ts: este é o ÚNICO ponto que amarra
// as deps de tráfego aos módulos com efeitos reais (Prisma, contas
// Meta). As rotas usam as factories; os testes passam fakes direto
// para as funções de src/lib/traffic-insights.ts.
// ============================================================

import { db as prisma } from '@/lib/db';
import { fetchEnabledAdAccounts } from '@/lib/meta-ad-accounts';
import {
  defaultFetchLike,
  truncateError,
  type AccountRefForSync,
  type EntityStateRecord,
  type InsightLevel,
  type TrafficEntityStateRow,
  type TrafficInsightRow,
  type TrafficReadDb,
  type TrafficSyncDeps,
} from './traffic-insights';

/** Contas habilitadas (canal 'all') no formato mínimo do sync. */
export async function listSyncableAccounts(): Promise<AccountRefForSync[]> {
  const accounts = await fetchEnabledAdAccounts('all');
  return accounts.map((account) => ({
    id: account.id,
    name: account.name,
    adAccountId: account.adAccountId,
    accessToken: account.accessToken,
  }));
}

/** Mapa adAccountId → nome de exibição (best-effort; vazio se falhar). */
export async function listAccountNames(): Promise<Map<string, string>> {
  try {
    const rows = await prisma.metaAdAccount.findMany({
      select: { adAccountId: true, name: true },
    });
    return new Map(rows.map((row) => [row.adAccountId, row.name]));
  } catch {
    return new Map();
  }
}

/** Mapeia código Graph → authStatus do MetaAdAccount (saúde do token). */
function authStatusFromCode(code: number | null): string | null {
  if (code === 190) return 'expired';
  if (code === 200 || code === 10) return 'permission_denied';
  return null;
}

export function createTrafficSyncDeps(): TrafficSyncDeps {
  return {
    listAccounts: listSyncableAccounts,
    fetchFn: defaultFetchLike,
    replaceWindowRows: async (adAccountId, level: InsightLevel, since, rows: TrafficInsightRow[]) => {
      await prisma.$transaction([
        prisma.metaAdInsightDaily.deleteMany({
          where: { adAccountId, level, date: { gte: since } },
        }),
        prisma.metaAdInsightDaily.createMany({ data: rows }),
      ]);
    },
    upsertSyncState: async (adAccountId, patch) => {
      await prisma.metaAdsSyncState.upsert({
        where: { adAccountId },
        create: {
          adAccountId,
          lastStatus: patch.lastStatus,
          lastWindowDays: patch.lastWindowDays,
          lastError: patch.lastError,
          lastSyncedAt: patch.lastSyncedAt,
        },
        update: {
          lastStatus: patch.lastStatus,
          lastWindowDays: patch.lastWindowDays,
          lastError: patch.lastError,
          lastSyncedAt: patch.lastSyncedAt,
        },
      });
    },
    markAccountAuthError: async (accountRecordId, lastError, code) => {
      const authStatus = authStatusFromCode(code);
      if (!authStatus) return;
      await prisma.metaAdAccount.update({
        where: { id: accountRecordId },
        data: {
          authStatus,
          lastAuthError: truncateError(lastError),
          lastAuthErrorAt: new Date(),
        },
      });
    },
    /** Fase 8.2: snapshot-replace do estado de entrega/orçamento da conta. */
    replaceEntityStates: async (adAccountId, rows: TrafficEntityStateRow[]) => {
      await prisma.$transaction([
        prisma.metaAdEntityState.deleteMany({ where: { adAccountId } }),
        prisma.metaAdEntityState.createMany({ data: rows }),
      ]);
    },
    now: () => new Date(),
  };
}

/** Leitura SEM PII: nenhum método seleciona name/phone/email de cliente. */
export function createTrafficReadDb(): TrafficReadDb {
  return {
    insightRowsSince: async (since) => {
      const rows = await prisma.metaAdInsightDaily.findMany({
        where: { date: { gte: since } },
        select: {
          level: true,
          entityId: true,
          entityName: true,
          campaignId: true,
          campaignName: true,
          date: true,
          spend: true,
          impressions: true,
          clicks: true,
          reach: true,
          leadsMeta: true,
        },
        orderBy: [{ date: 'asc' }, { entityId: 'asc' }],
      });
      return rows;
    },
    inboxLeadsSince: async (since) => {
      const rows = await prisma.metaLeadInbox.findMany({
        where: {
          campaignId: { not: null },
          status: 'SUCCEEDED',
          createdAt: { gte: since },
        },
        select: { campaignId: true, leadgenId: true },
      });
      return rows;
    },
    clientsByLeadgenIds: async (ids) => {
      if (ids.length === 0) return [];
      const rows = await prisma.client.findMany({
        where: { metaLeadgenId: { in: ids } },
        select: { metaLeadgenId: true, stage: true, metaTemperature: true },
      });
      return rows;
    },
    metaClientsSince: async (since) => {
      const rows = await prisma.client.findMany({
        where: { notes: { contains: '[Meta Ads]' }, createdAt: { gte: since } },
        select: { metaLeadgenId: true, stage: true, metaTemperature: true, notes: true },
      });
      return rows;
    },
    campaignBindings: async () => {
      const rows = await prisma.metaCampaignBinding.findMany({
        select: { campaignId: true, campaignName: true },
        orderBy: { campaignId: 'asc' },
      });
      return rows;
    },
    syncStates: async () => {
      const rows = await prisma.metaAdsSyncState.findMany({
        select: { adAccountId: true, lastStatus: true, lastSyncedAt: true, lastError: true },
        orderBy: { adAccountId: 'asc' },
      });
      return rows;
    },
    /** Fase 8.2: estado de entrega/orçamento (tabela meta_ad_entity_state). */
    entityStates: async (): Promise<EntityStateRecord[]> => {
      const rows = await prisma.metaAdEntityState.findMany({
        select: {
          adAccountId: true,
          level: true,
          entityId: true,
          entityName: true,
          campaignId: true,
          dailyBudgetMinor: true,
          lifetimeBudgetMinor: true,
          status: true,
          effectiveStatus: true,
          learningStage: true,
          fetchedAt: true,
        },
        orderBy: [{ adAccountId: 'asc' }, { level: 'asc' }, { entityName: 'asc' }],
      });
      return rows;
    },
  };
}
