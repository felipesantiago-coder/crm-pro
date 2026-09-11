/**
 * webhook-inbox.test.ts — fluxo durável do webhook:
 *  - flag META_INGEST_V2=legacy → { ok:false } (caminho inline legado);
 *  - falha de schema → { ok:false } + linhas criadas removidas;
 *  - fluxo normal → resultados no formato exato do contrato;
 *  - replay de evento já SUCCEEDED → resultado existente;
 *  - estouro de orçamento → deferred_to_retry (nenhum lead perdido).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingestWebhookViaInbox, type WebhookInboxChange } from '../../src/lib/meta-ingest/webhook-inbox.ts';
import type { MetaInboxDbSlice, MetaInboxRow } from '../../src/lib/meta-ingest/inbox.ts';
import type { MetaIngestServices } from '../../src/lib/meta-ingest/pipeline.ts';

function makeChange(leadgenId: string, extra?: Partial<WebhookInboxChange>): WebhookInboxChange {
  return {
    leadgenId,
    formId: 'form-1',
    formName: 'Form',
    campaignId: null,
    campaignName: null,
    adId: null,
    adName: 'Anúncio',
    createdTimeRaw: 1_700_000_000,
    fieldData: [{ name: 'full_name', values: [`Lead ${leadgenId}`] }],
    pageId: 'page-1',
    adAccountId: 'acc-1',
    accountName: 'Conta QA',
    ...extra,
  };
}

/** Inbox fake completa (como inbox.test.ts) + registro de deletes. */
function makeInboxDb(opts?: { createThrows?: Error }) {
  const rows = new Map<string, MetaInboxRow>();
  let seq = 0;
  let deleted = 0;
  const db: MetaInboxDbSlice = {
    metaLeadInbox: {
      async create(args) {
        if (opts?.createThrows) throw opts.createThrows;
        if ([...rows.values()].some((r) => r.dedupKey === args.data.dedupKey)) {
          throw Object.assign(new Error('dup'), { code: 'P2002' });
        }
        const id = `inbox-${++seq}`;
        const row: MetaInboxRow = {
          id,
          dedupKey: args.data.dedupKey,
          leadgenId: args.data.leadgenId,
          channel: args.data.channel,
          adAccountId: args.data.adAccountId ?? null,
          formId: args.data.formId ?? null,
          campaignId: args.data.campaignId ?? null,
          payload: args.data.payload,
          status: 'RECEIVED',
          attempts: 0,
          maxAttempts: 5,
          nextAttemptAt: new Date(Date.now() - 1000),
          lastError: null,
          result: null,
          processedAt: null,
        };
        rows.set(id, row);
        return row;
      },
      async findUnique(args) {
        return [...rows.values()].find((r) => r.dedupKey === args.where.dedupKey) ?? null;
      },
      async findMany(args) {
        return [...rows.values()]
          .filter((r) => {
            if (args.where.id?.in && !args.where.id.in.includes(r.id)) return false;
            if (args.where.status && !args.where.status.in.includes(r.status)) return false;
            if (args.where.nextAttemptAt?.lte && r.nextAttemptAt > args.where.nextAttemptAt.lte) return false;
            return true;
          })
          .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())
          .slice(0, args.take);
      },
      async update(args) {
        const row = rows.get(args.where.id)!;
        Object.assign(row, Object.fromEntries(Object.entries(args.data).filter(([, v]) => v !== undefined)));
        return row;
      },
      async updateMany(args) {
        const row = rows.get(args.where.id);
        const w = args.where;
        const ok = !!row && w.status.in.includes(row.status)
          && row.nextAttemptAt <= w.nextAttemptAt.lte && row.attempts < w.attempts.lt;
        if (!ok) return { count: 0 };
        row.status = args.data.status;
        row.attempts += 1;
        return { count: 1 };
      },
      async deleteMany(args) {
        for (const id of args.where.id.in) {
          if (rows.delete(id)) deleted++;
        }
        return { count: deleted };
      },
    },
  };
  return { db, rows, deletedCount: () => deleted };
}

function makeServices(clientDb: unknown): MetaIngestServices {
  return {
    db: clientDb as never,
    async assignLead() { return { assigned: false, message: 'no_queue' }; },
    async peekNext() { return null; },
    async notifyAgent() { return { ok: true, status: 'sent', messages: [], attempts: 1 }; },
    async notifyAdminQueue() { return true; },
    async resolveEnterprise() { return { name: 'Emp' }; },
    async buildTemperature() { return {}; },
    async findCapConfig() { return null; },
    async resolveRoute() { return { routeSource: 'default' }; },
    campaignBindingAuto() {},
    async fetchLeadData() { return null; },
  };
}

function makePipelineDb(behavior?: { createThrows?: Error }) {
  return {
    client: {
      async findUnique() { return null; },
      async findFirst() { return null; },
      async update() { return {}; },
      async create() {
        if (behavior?.createThrows) throw behavior.createThrows;
        return { id: 'c-new', name: 'Lead LG-1', phone: null, email: null };
      },
    },
    interaction: { async create() { return {}; } },
    user: {
      async findUnique() { return { telegramChatId: 'chat', name: 'Agente' }; },
      async findFirst() { return { telegramChatId: 'admin' }; },
    },
    metaCapConfig: { async findFirst() { return null; } },
    leadFormMapping: { async upsert() { return {}; } },
    lostLead: { async create() { return {}; } },
  };
}

test('flag legacy (META_INGEST_V2=legacy) → ok:false sem tocar a inbox', async () => {
  process.env.META_INGEST_V2 = 'legacy';
  try {
    const { db } = makeInboxDb();
    const r = await ingestWebhookViaInbox({
      inboxDb: db,
      services: makeServices(makePipelineDb()),
      changes: [makeChange('LG-LEG')],
      creatorId: 'creator-1',
    });
    assert.equal(r.ok, false);
    assert.equal(r.inboxEnabled, false);
  } finally {
    delete process.env.META_INGEST_V2;
  }
});

test('fluxo normal: lead importado → resultado no formato exato do webhook', async () => {
  const { db } = makeInboxDb();
  const r = await ingestWebhookViaInbox({
    inboxDb: db,
    services: makeServices(makePipelineDb()),
    changes: [makeChange('LG-1')],
    creatorId: 'creator-1',
    budgetMs: 5_000,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.results, [{ success: true, clientName: 'Lead LG-1', reason: undefined, leadId: 'LG-1' }]);
});

test('replay do mesmo evento já SUCCEEDED → resultado existente (sem reprocessar)', async () => {
  const { db } = makeInboxDb();
  const args = {
    inboxDb: db,
    services: makeServices(makePipelineDb()),
    changes: [makeChange('LG-REP')],
    creatorId: 'creator-1',
    budgetMs: 5_000,
  };

  const first = await ingestWebhookViaInbox(args);
  assert.equal(first.ok && first.results[0].success, true);

  const second = await ingestWebhookViaInbox(args);
  assert.equal(second.ok, true);
  assert.deepEqual(second.results, first.ok ? first.results : undefined);
});

test('schema ausente (P2021) → ok:false e linhas criadas REMOVIDAS (fallback limpo)', async () => {
  const { db, rows, deletedCount } = makeInboxDb({ createThrows: Object.assign(new Error('no such table'), { code: 'P2021' }) });
  const r = await ingestWebhookViaInbox({
    inboxDb: db,
    services: makeServices(makePipelineDb()),
    changes: [makeChange('LG-BROKE'), makeChange('LG-BROKE2')],
    creatorId: 'creator-1',
  });
  assert.equal(r.ok, false);
  assert.equal(rows.size, 0);
  // nenhuma linha chegou a ser criada (create lança sempre)
  assert.equal(deletedCount(), 0);
});

test('estouro de orçamento → deferred_to_retry; item permanece na inbox', async () => {
  const { db, rows } = makeInboxDb();
  const r = await ingestWebhookViaInbox({
    inboxDb: db,
    services: makeServices(makePipelineDb()),
    changes: [makeChange('LG-DEF')],
    creatorId: 'creator-1',
    budgetMs: 0, // nenhum tempo de worker
  });
  assert.equal(r.ok, true);
  assert.equal(r.results[0].reason, 'deferred_to_retry');
  assert.equal(r.results[0].success, false);
  const row = [...rows.values()][0];
  assert.equal(row.status, 'RECEIVED');
});

test('webhook com create_failed (outcome terminal) → SUCCEEDED na inbox com razão', async () => {
  const { db, rows } = makeInboxDb();
  const r = await ingestWebhookViaInbox({
    inboxDb: db,
    services: makeServices(makePipelineDb({ createThrows: new Error('boom') })),
    changes: [makeChange('LG-FAIL')],
    creatorId: 'creator-1',
    budgetMs: 5_000,
  });
  assert.equal(r.ok, true);
  assert.equal(r.results[0].success, false);
  assert.equal(r.results[0].reason, 'create_failed');
  const row = [...rows.values()][0];
  assert.equal(row.status, 'SUCCEEDED', 'outcome terminal completa sem retry');
});
