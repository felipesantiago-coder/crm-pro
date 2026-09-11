/**
 * inbox.test.ts — contratos da ingestão durável (Fase 3):
 * idempotência por dedupKey, claim CAS, ciclo RETRYABLE→FAILED,
 * sanitização de erro (regra 6), orçamento de tempo do worker e
 * reserva atômica de quota (reserve/refund).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureInboxItem,
  ensureInboxItemInfallible,
  claimInboxItem,
  completeInboxItem,
  failInboxItem,
  drainInbox,
  sanitizeError,
  retryBackoffMs,
  buildDedupKey,
  type MetaInboxDbSlice,
  type MetaInboxRow,
  type MetaInboxPayload,
} from '../../src/lib/meta-ingest/inbox.ts';
import type { MetaIngestServices } from '../../src/lib/meta-ingest/pipeline.ts';

// ── Fake da inbox (semântica real de CAS/unique) ────────────────

function makeInboxDb() {
  const rows = new Map<string, MetaInboxRow>();
  let seq = 0;

  const db: MetaInboxDbSlice = {
    metaLeadInbox: {
      async create(args) {
        if ([...rows.values()].some((r) => r.dedupKey === args.data.dedupKey)) {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
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
        const now = new Date();
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
        const row = rows.get(args.where.id);
        if (!row) throw new Error('not found');
        const d = args.data;
        if (d.status !== undefined) row.status = d.status;
        if (d.nextAttemptAt !== undefined) row.nextAttemptAt = d.nextAttemptAt;
        if (d.lastError !== undefined) row.lastError = d.lastError;
        if (d.result !== undefined) row.result = d.result;
        if (d.processedAt !== undefined) row.processedAt = d.processedAt;
        return row;
      },
      async updateMany(args) {
        const row = rows.get(args.where.id);
        const w = args.where;
        const ok = !!row
          && w.status.in.includes(row.status)
          && row.nextAttemptAt <= w.nextAttemptAt.lte
          && row.attempts < w.attempts.lt;
        if (!ok) return { count: 0 };
        row.status = args.data.status;
        row.attempts += 1;
        return { count: 1 };
      },
      async deleteMany(args) {
        let count = 0;
        for (const id of args.where.id.in) {
          if (rows.delete(id)) count++;
        }
        return { count };
      },
    },
  };
  return { db, rows };
}

function payload(leadgenId: string, extra?: Partial<MetaInboxPayload>): MetaInboxPayload {
  return { leadgenId, channel: 'webhook', ...extra };
}

/** Services do pipeline (real) com fatia de db fake. */
function makePipelineDb(opts?: { createThrows?: Error; clientFindUniqueThrows?: Error }) {
  return {
    client: {
      async findUnique() {
        if (opts?.clientFindUniqueThrows) throw opts.clientFindUniqueThrows;
        return null;
      },
      async findFirst() { return null; },
      async update() { return {}; },
      async create() {
        if (opts?.createThrows) throw opts.createThrows;
        return { id: 'c1', name: 'Lead Teste', phone: null, email: null };
      },
    },
    interaction: { async create() { return {}; } },
    user: {
      async findUnique() { return { telegramChatId: 'chat-1', name: 'Agente' }; },
      async findFirst() { return { telegramChatId: 'chat-admin' }; },
    },
    metaCapConfig: { async findFirst() { return null; } },
    leadFormMapping: { async upsert() { return {}; } },
    lostLead: { async create() { return {}; } },
  };
}

function makePipelineServices(dbLike: unknown = makePipelineDb()): MetaIngestServices {
  return {
    db: dbLike as never,
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

// ── Idempotência ─────────────────────────────────────────────────

test('ensureInboxItem: cria uma vez; replay devolve a MESMA linha com created=false', async () => {
  const { db, rows } = makeInboxDb();
  const first = await ensureInboxItem(db, payload('LG-9'), 'acc-1');
  assert.equal(first.created, true);
  const replay = await ensureInboxItem(db, payload('LG-9'), 'acc-1');
  assert.equal(replay.created, false);
  assert.equal(replay.item.id, first.item.id);
  assert.equal(rows.size, 1);
  assert.equal(buildDedupKey('LG-9'), 'leadgen:LG-9');
});

test('ensureInboxItem: corrida entre instâncias — create duplo lança P2002 (chave única)', async () => {
  const { db } = makeInboxDb();
  await ensureInboxItem(db, payload('LG-RACE'), null);
  await assert.rejects(
    () => db.metaLeadInbox.create({ data: { dedupKey: 'leadgen:LG-RACE', leadgenId: 'LG-RACE', channel: 'webhook', payload: payload('LG-RACE') } }),
    (err: unknown) => (err as { code?: string }).code === 'P2002',
  );
});

test('ensureInboxItemInfallible: erro de schema vira { ok: false } (degradação segura)', async () => {
  const broken = {
    metaLeadInbox: {
      create: async () => { throw Object.assign(new Error('no such table'), { code: 'P2021' }); },
      findUnique: async () => null,
    },
  } as unknown as MetaInboxDbSlice;
  const r = await ensureInboxItemInfallible(broken, payload('LG-X'), null);
  assert.equal(r.ok, false);
});

// ── Claim CAS + ciclo de vida ────────────────────────────────────

test('claimInboxItem: primeira instância vence (CAS), segunda perde', async () => {
  const { db } = makeInboxDb();
  const { item } = await ensureInboxItem(db, payload('LG-CAS'), null);

  assert.equal(await claimInboxItem(db, item, new Date()), true);
  const reread = await db.metaLeadInbox.findUnique({ where: { dedupKey: item.dedupKey } });
  assert.equal(await claimInboxItem(db, reread as MetaInboxRow, new Date()), false);
});

test('failInboxItem: antes do max → RETRYABLE com backoff; depois → FAILED', async () => {
  const { db, rows } = makeInboxDb();
  const { item } = await ensureInboxItem(db, payload('LG-RETRY'), null);
  item.status = 'PROCESSING';
  item.attempts = 1;
  const status1 = await failInboxItem(db, item, new Error('graph timeout'));
  assert.equal(status1, 'RETRYABLE');
  const row1 = rows.get(item.id)!;
  assert.equal(row1.status, 'RETRYABLE');
  assert.ok(row1.nextAttemptAt.getTime() >= Date.now() + retryBackoffMs(2) - 1000);

  row1.attempts = row1.maxAttempts; // esgotou
  const status2 = await failInboxItem(db, row1, new Error('ainda quebrado'));
  assert.equal(status2, 'FAILED');
  const row2 = rows.get(item.id)!;
  assert.equal(row2.status, 'FAILED');
  assert.ok(row2.processedAt instanceof Date);
});

test('completeInboxItem: SUCCEEDED com resultado e processedAt', async () => {
  const { db, rows } = makeInboxDb();
  const { item } = await ensureInboxItem(db, payload('LG-OK'), null);
  await completeInboxItem(db, item.id, { leadgenId: 'LG-OK', imported: true, deduped: false, success: true, clientName: 'Fulano' });
  const row = rows.get(item.id)!;
  assert.equal(row.status, 'SUCCEEDED');
  assert.equal((row.result as { clientName?: string }).clientName, 'Fulano');
});

// ── Sanitização (regra 6) ────────────────────────────────────────

test('sanitizeError: remove access_token/Bearer, mascara email/telefone, trunca 500', () => {
  const raw = 'GET https://graph.facebook.com/v26.0/x?access_token=EAAGabc.def123 falhou para joao@empresa.com.br tel 5511999998888 Bearer AAAABBBBCCCC1';
  const clean = sanitizeError(raw);
  assert.ok(!clean.includes('EAAGabc'), 'token removido');
  assert.ok(clean.includes('access_token=***'));
  assert.ok(!clean.includes('joao@empresa.com.br'));
  assert.ok(clean.includes('[email]'));
  assert.ok(!clean.includes('5511999998888'));
  assert.ok(!clean.includes('AAAABBBBCCCC1'));
  assert.ok(sanitizeError('x'.repeat(900)).length <= 500);
});

// ── Drain: orçamento, quota e exceções ───────────────────────────

test('drainInbox: orçamento zero → deferred, item permanece RECEIVED (nada perdido)', async () => {
  const { db, rows } = makeInboxDb();
  const { item } = await ensureInboxItem(db, payload('LG-DEF'), null);

  const results = await drainInbox(db, makePipelineServices(), { ids: [item.id], budgetMs: 0 }, () => null);
  assert.equal(results[0].deferredAs, 'deferred');
  assert.equal(rows.get(item.id)!.status, 'RECEIVED');
});

test('drainInbox: import real consome o slot; dedup devolve; exceção devolve e vira RETRYABLE sanitizado', async () => {
  const { db, rows } = makeInboxDb();

  // (a) import real: polling com field_data + creatorId → outcome.imported=true
  const a = (await ensureInboxItem(db, payload('LG-IMP', {
    channel: 'polling',
    fieldData: [{ name: 'full_name', values: ['Lead Teste'] }],
    queueId: undefined,
  }), null)).item;

  let slots = 5;
  let refunds = 0;
  const reserve = async () => { slots--; return true; };
  const refund = async () => { refunds++; slots++; };

  const resultsA = await drainInbox(
    db,
    makePipelineServices(),
    { ids: [a.id], budgetMs: 5_000, creatorId: 'creator-1', reserveQuotaSlot: reserve, refundQuotaSlot: refund },
    () => null,
  );
  assert.equal(resultsA[0].outcome?.imported, true);
  assert.equal(refunds, 0, 'import real consome o slot');
  assert.equal(rows.get(a.id)!.status, 'SUCCEEDED');

  // (b) exceção no processamento: slot devolvido + RETRYABLE + erro sanitizado
  const b = (await ensureInboxItem(db, payload('LG-ERR', {
    channel: 'polling',
    fieldData: [{ name: 'full_name', values: ['X'] }],
  }), null)).item;

  const servicesThrow = makePipelineServices(makePipelineDb({ clientFindUniqueThrows: new Error('DB down access_token=EAAGsecret') }));
  const resultsB = await drainInbox(
    db,
    servicesThrow,
    { ids: [b.id], budgetMs: 5_000, creatorId: 'creator-1', reserveQuotaSlot: reserve, refundQuotaSlot: refund },
    () => null,
  );
  assert.equal(resultsB[0].deferredAs, 'retryable');
  const rowB = rows.get(b.id)!;
  assert.equal(rowB.status, 'RETRYABLE');
  assert.ok(rowB.lastError!.includes('access_token=***'));
  assert.ok(!rowB.lastError!.includes('EAAGsecret'));
  assert.equal(refunds, 1, 'exceção devolve o slot');
});

test('drainInbox: sem slot de quota → quota_exhausted SEM claim (status intacto)', async () => {
  const { db, rows } = makeInboxDb();
  const b = (await ensureInboxItem(db, payload('LG-Q2'), null)).item;

  const results = await drainInbox(db, makePipelineServices(), {
    ids: [b.id],
    budgetMs: 5_000,
    reserveQuotaSlot: async () => false,
    refundQuotaSlot: async () => {},
  }, () => null);

  assert.equal(results[0].deferredAs, 'quota_exhausted');
  assert.equal(rows.get(b.id)!.status, 'RECEIVED');
});

test('drainInbox: modo fila (sem ids) processa pendentes ordenadas por nextAttemptAt', async () => {
  const { db } = makeInboxDb();
  await ensureInboxItem(db, payload('LG-F2'), null);
  await ensureInboxItem(db, payload('LG-F1'), null);

  const results = await drainInbox(
    db,
    makePipelineServices(),
    { limit: 10, budgetMs: 5_000, creatorId: 'creator-1' },
    () => null,
  );
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.outcome !== undefined));
});
