/**
 * polling.test.ts — contratos do polling durável (Fase 3):
 *   - paginação COMPLETA da Graph: 0/1/100/101/250 leads, várias
 *     páginas, parada por orçamento e propagação de erro (190/200);
 *   - lease distribuído: corrida entre 2 runs, TTL/expiração com
 *     recuperação pós-crash, renovação só pelo dono, liberação;
 *   - quota atômica: reserva até esgotar, refund devolve slot;
 *   - cursor: backfill do watermark legado, avanço MONOTÔNICO só
 *     até o último lead confirmado, nunca retrocede;
 *   - webhook+polling do mesmo lead → MESMA linha da inbox.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acquirePollingLease,
  renewPollingLease,
  releasePollingLease,
  reserveQuotaSlot,
  refundQuotaSlot,
  loadPollingCursor,
  advancePollingCursor,
  fetchAllLeadsPages,
  mergeLegacyWatermarks,
  type MetaPollingDbSlice,
  type MetaLeadLike,
  type GraphLeadsResponse,
} from '../../src/lib/meta-ingest/polling.ts';
import { ensureInboxItem, type MetaInboxDbSlice } from '../../src/lib/meta-ingest/inbox.ts';

// ── Fakes ────────────────────────────────────────────────────────

function makePollingDb() {
  const cursors = new Map<string, { id: string; adAccountId: string; formId: string; cursorTime: Date; lastConfirmedLeadgenId: string | null }>();
  const leases = new Map<string, { id: string; scope: string; ownerToken: string; quotaRemaining: number; expiresAt: Date }>();
  let seq = 0;
  let clock = Date.now();

  const db: MetaPollingDbSlice = {
    metaPollingCursor: {
      async findUnique(args) {
        const k = `${args.where.adAccountId_formId.adAccountId}|${args.where.adAccountId_formId.formId}`;
        return cursors.get(k) ?? null;
      },
      async create(args) {
        const k = `${args.data.adAccountId}|${args.data.formId}`;
        if (cursors.has(k)) throw Object.assign(new Error('dup'), { code: 'P2002' });
        const row = { id: `cur-${++seq}`, adAccountId: args.data.adAccountId, formId: args.data.formId, cursorTime: args.data.cursorTime, lastConfirmedLeadgenId: args.data.lastConfirmedLeadgenId ?? null };
        cursors.set(k, row);
        return row;
      },
      async update(args) {
        for (const row of cursors.values()) {
          if (row.id === args.where.id) {
            if (args.data.cursorTime !== undefined) row.cursorTime = args.data.cursorTime;
            if (args.data.lastConfirmedLeadgenId !== undefined) row.lastConfirmedLeadgenId = args.data.lastConfirmedLeadgenId;
            return row;
          }
        }
        throw new Error('not found');
      },
      async updateMany(args) {
        for (const row of cursors.values()) {
          if (row.id === args.where.id) {
            if (args.where.cursorTime && !(row.cursorTime < args.where.cursorTime.lt)) return { count: 0 };
            if (args.data.cursorTime !== undefined) row.cursorTime = args.data.cursorTime;
            if (args.data.lastConfirmedLeadgenId !== undefined) row.lastConfirmedLeadgenId = args.data.lastConfirmedLeadgenId;
            return { count: 1 };
          }
        }
        return { count: 0 };
      },
    },
    metaPollingLease: {
      async findUnique(args) {
        return leases.get(args.where.scope) ?? null;
      },
      async create(args) {
        if (leases.has(args.data.scope)) throw Object.assign(new Error('dup'), { code: 'P2002' });
        const row = { id: `lease-${++seq}`, scope: args.data.scope, ownerToken: args.data.ownerToken, quotaRemaining: args.data.quotaRemaining, expiresAt: args.data.expiresAt };
        leases.set(args.data.scope, row);
        return row;
      },
      async update(args) {
        const row = leases.get(args.where.scope);
        if (!row || row.id !== args.where.id) throw new Error('not found');
        if (args.data.ownerToken !== undefined) row.ownerToken = args.data.ownerToken;
        if (typeof args.data.quotaRemaining === 'number') row.quotaRemaining = args.data.quotaRemaining;
        if (args.data.expiresAt !== undefined) row.expiresAt = args.data.expiresAt;
        return row;
      },
      async updateMany(args) {
        const row = leases.get(args.where.scope);
        if (!row) return { count: 0 };
        if (args.where.ownerToken !== undefined && row.ownerToken !== args.where.ownerToken) return { count: 0 };
        if (args.where.expiresAt) {
          if ('lt' in args.where.expiresAt && !(row.expiresAt < args.where.expiresAt.lt)) return { count: 0 };
          if ('gt' in args.where.expiresAt && !(row.expiresAt > args.where.expiresAt.gt)) return { count: 0 };
        }
        if (args.where.quotaRemaining && !(row.quotaRemaining > args.where.quotaRemaining.gt)) return { count: 0 };
        const d = args.data;
        if (typeof d.quotaRemaining === 'number') row.quotaRemaining = d.quotaRemaining;
        else if (d.quotaRemaining && typeof d.quotaRemaining === 'object') {
          if ('decrement' in d.quotaRemaining) row.quotaRemaining -= d.quotaRemaining.decrement;
          if ('increment' in d.quotaRemaining) row.quotaRemaining += d.quotaRemaining.increment;
        }
        if (d.ownerToken !== undefined) row.ownerToken = d.ownerToken;
        if (d.expiresAt !== undefined) row.expiresAt = d.expiresAt;
        return { count: 1 };
      },
    },
  };
  return { db, cursors, leases, setClock: (ms: number) => { clock = ms; }, getClock: () => clock };
}

function makeInboxDb(): MetaInboxDbSlice {
  const rows = new Map<string, { dedupKey: string; id: string; leadgenId: string; channel: string }>();
  let seq = 0;
  return {
    metaLeadInbox: {
      async create(args) {
        if ([...rows.values()].some((r) => r.dedupKey === args.data.dedupKey)) {
          throw Object.assign(new Error('dup'), { code: 'P2002' });
        }
        const row = { id: `inbox-${++seq}`, dedupKey: args.data.dedupKey, leadgenId: args.data.leadgenId, channel: args.data.channel };
        rows.set(row.id, row);
        return row as never;
      },
      async findUnique(args) {
        return ([...rows.values()].find((r) => r.dedupKey === args.where.dedupKey) as never) ?? null;
      },
      async findMany() { return []; },
      async update() { return {}; },
      async updateMany() { return { count: 0 }; },
      async deleteMany() { return { count: 0 }; },
    },
  };
}

// ── Paginação completa ───────────────────────────────────────────

function graphWithPages(pages: MetaLeadLike[][]): { fetchPage: (url: string) => Promise<GraphLeadsResponse>; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetchPage: async (url) => {
      urls.push(url);
      const idx = urls.length - 1;
      const data = pages[idx] ?? [];
      const next = idx + 1 < pages.length ? `https://graph.facebook.com/v26.0/F/leads?after=PAGE${idx + 2}` : undefined;
      return { data, paging: next ? { next } : undefined };
    },
  };
}

function lead(id: string): MetaLeadLike {
  return { id, field_data: [{ name: 'full_name', values: [`L${id}`] }], created_time: '2026-09-11T10:00:00-03:00', form_id: 'F' };
}

test('paginação: 0 lead (nenhuma página vazia), 1 lead, 100, 101 e 250 leads em várias páginas', async () => {
  // 0 leads
  const g0 = graphWithPages([[]]);
  const r0 = await fetchAllLeadsPages(g0.fetchPage, 'F', 'tok', '2026-09-11T00:00:00Z', { deadlineMs: Date.now() + 10_000 });
  assert.equal(r0.leads.length, 0);
  assert.equal(r0.pages, 1);
  assert.equal(r0.stoppedByBudget, false);

  // 1 lead
  const g1 = graphWithPages([[lead('1')]]);
  const r1 = await fetchAllLeadsPages(g1.fetchPage, 'F', 'tok', 'x', { deadlineMs: Date.now() + 10_000 });
  assert.equal(r1.leads.length, 1);

  // 100 (1 página) e 101 (2 páginas)
  const p100 = Array.from({ length: 100 }, (_, i) => lead(`a${i}`));
  const g100 = graphWithPages([p100]);
  const r100 = await fetchAllLeadsPages(g100.fetchPage, 'F', 'tok', 'x', { deadlineMs: Date.now() + 10_000 });
  assert.equal(r100.leads.length, 100);
  assert.equal(r100.pages, 1);

  const g101 = graphWithPages([p100, [lead('b0')]]);
  const r101 = await fetchAllLeadsPages(g101.fetchPage, 'F', 'tok', 'x', { deadlineMs: Date.now() + 10_000 });
  assert.equal(r101.leads.length, 101);
  assert.equal(r101.pages, 2);

  // 250 → 3 páginas (100+100+50)
  const p250 = [p100, p100, Array.from({ length: 50 }, (_, i) => lead(`c${i}`))];
  const g250 = graphWithPages(p250);
  const r250 = await fetchAllLeadsPages(g250.fetchPage, 'F', 'tok', 'x', { deadlineMs: Date.now() + 10_000 });
  assert.equal(r250.leads.length, 250);
  assert.equal(r250.pages, 3);
});

test('paginação: orçamento estoura → stoppedByBudget com o que deu para buscar', async () => {
  const p100 = Array.from({ length: 100 }, (_, i) => lead(`a${i}`));
  const g = graphWithPages([p100, p100, p100]);
  let calls = 0;
  const fetchPage = async (url: string) => {
    calls++;
    if (calls === 1) return g.fetchPage(url); // primeira página normal
    // segunda página: orçamento já estourou — a lib deve checar ANTES de chamar
    return g.fetchPage(url);
  };
  const r = await fetchAllLeadsPages(fetchPage, 'F', 'tok', 'x', { deadlineMs: Date.now() + 5, maxPages: 10, now: () => (calls >= 1 ? Date.now() + 60_000 : Date.now()) });
  assert.equal(r.stoppedByBudget, true);
  assert.equal(r.leads.length, 100);
});

test('paginação: erro da Graph (timeout/HTTP) PROPAGA para o chamador (contrato do catch atual 190/200)', async () => {
  const fetchPage = async () => {
    throw new Error('HTTP 400: {"error":{"code":190,"message":"Token expirado"}}');
  };
  await assert.rejects(
    () => fetchAllLeadsPages(fetchPage, 'F', 'tok', 'x', { deadlineMs: Date.now() + 10_000 }),
    /HTTP 400/,
  );
});

// ── Lease distribuído (2 runs simultâneos + crash recovery) ─────

test('lease: run A adquire; run B simultâneo é RECUSADO; após liberação B adquire', async () => {
  const { db } = makePollingDb();
  const a = await acquirePollingLease(db, 'polling', 90_000, 50);
  assert.equal(a.acquired, true);

  const b = await acquirePollingLease(db, 'polling', 90_000, 50);
  assert.equal(b.acquired, false);

  await releasePollingLease(db, 'polling', a.ownerToken!);
  const c = await acquirePollingLease(db, 'polling', 90_000, 50);
  assert.equal(c.acquired, true);
});

test('lease: crash do dono → TTL expira → outro run assume (recovered)', async () => {
  const { db, leases } = makePollingDb();
  const a = await acquirePollingLease(db, 'polling', 1_000, 50);
  assert.equal(a.acquired, true);

  // simula passagem do TTL (crash sem release)
  const row = leases.get('polling')!;
  row.expiresAt = new Date(Date.now() - 10);

  const b = await acquirePollingLease(db, 'polling', 90_000, 50);
  assert.equal(b.acquired, true);
  assert.equal(b.recovered, true);
  assert.notEqual(b.ownerToken, a.ownerToken);
});

test('lease: renovação só pelo dono e só antes de expirar', async () => {
  const { db, leases } = makePollingDb();
  const a = await acquirePollingLease(db, 'polling', 90_000, 50);
  assert.equal(await renewPollingLease(db, 'polling', a.ownerToken!, 90_000), true);
  assert.equal(await renewPollingLease(db, 'polling', 'token-falso', 90_000), false);

  const row = leases.get('polling')!;
  row.expiresAt = new Date(Date.now() - 10);
  assert.equal(await renewPollingLease(db, 'polling', a.ownerToken!, 90_000), false, 'expirado não renova');
});

// ── Quota atômica ────────────────────────────────────────────────

test('quota: reserva esgota em 2 slots; sem slot → false; refund devolve', async () => {
  const { db } = makePollingDb();
  const lease = await acquirePollingLease(db, 'polling', 90_000, 2);
  const token = lease.ownerToken!;

  assert.equal(await reserveQuotaSlot(db, 'polling', token), true);
  assert.equal(await reserveQuotaSlot(db, 'polling', token), true);
  assert.equal(await reserveQuotaSlot(db, 'polling', token), false, 'quota esgotada — sem decremento desprotegido');

  await refundQuotaSlot(db, 'polling', token);
  assert.equal(await reserveQuotaSlot(db, 'polling', token), true);

  // dono inválido não reserva (ondeadorToken é exigido)
  assert.equal(await reserveQuotaSlot(db, 'polling', 'outro'), false);
});

// ── Cursor (backfill + monotonicidade) ───────────────────────────

test('cursor: backfill a partir do watermark legado na 1ª execução (idempotente)', async () => {
  const { db } = makePollingDb();
  const legacyMs = Date.now() - 5 * 60_000;
  const c1 = await loadPollingCursor(db, 'acc-1', 'form-1', legacyMs);
  assert.equal(c1.cursorTime.getTime(), legacyMs);
  const c2 = await loadPollingCursor(db, 'acc-1', 'form-1', Date.now());
  assert.equal(c2.id, c1.id, 'segunda leitura não recria');
  assert.equal(c2.cursorTime.getTime(), legacyMs, 'backfill não reescreve cursor existente');
});

test('cursor: avança até o ÚLTIMO lead confirmado e NUNCA retrocede', async () => {
  const { db } = makePollingDb();
  await loadPollingCursor(db, 'acc-1', 'form-1', Date.now() - 60 * 60_000);

  const t1 = Date.now() - 10 * 60_000;
  const t2 = Date.now() - 5 * 60_000;
  assert.equal(await advancePollingCursor(db, 'acc-1', 'form-1', t1, 'lead-t1'), true);
  // lead 3 falhou → tentativa de avançar para t0 mais antigo é RECUSADA
  assert.equal(await advancePollingCursor(db, 'acc-1', 'form-1', t1 - 60_000, 'lead-antigo'), false);
  // lead 3 confirmado → avança
  assert.equal(await advancePollingCursor(db, 'acc-1', 'form-1', t2, 'lead-t2'), true);
  // mesmo horário de novo (overlap) → sem mudança
  assert.equal(await advancePollingCursor(db, 'acc-1', 'form-1', t2, 'lead-t2'), false);
});

test('cursor: contrato "só avança até o último CONFIRMADO" — falha no lead 3 mantém cursor no lead 2', async () => {
  const { db } = makePollingDb();
  await loadPollingCursor(db, 'acc-1', 'form-1', Date.now() - 60 * 60_000);

  // replicação do mini-loop da rota: 5 leads, ensure falha no 3º
  const leadTimes = [1, 2, 3, 4, 5].map((n) => Date.now() - (10 - n) * 60_000);
  const ensured: Array<number> = [];
  let advancedTo: number | null = null;
  for (let i = 0; i < 5; i++) {
    if (i === 2) break; // ensure do lead 3 falhou (DB/Graph)
    ensured.push(i);
  }
  if (ensured.length > 0) {
    const lastIdx = ensured[ensured.length - 1];
    advancedTo = leadTimes[lastIdx];
    await advancePollingCursor(db, 'acc-1', 'form-1', advancedTo, `lead-${lastIdx}`);
  }

  const cursor = await db.metaPollingCursor.findUnique({ where: { adAccountId_formId: { adAccountId: 'acc-1', formId: 'form-1' } } });
  assert.equal(cursor!.cursorTime.getTime(), leadTimes[1], 'cursor parou no lead 2 — leads 3-5 refetch no próximo run');
});

// ── Webhook + polling do MESMO lead ──────────────────────────────

test('mesmo leadgen por webhook E polling → MESMA linha da inbox (idempotência entre canais)', async () => {
  const db = makeInboxDb();
  const viaWebhook = await ensureInboxItem(db, { leadgenId: 'LG-DUP', channel: 'webhook', formId: 'F' }, 'acc-1');
  const viaPolling = await ensureInboxItem(db, { leadgenId: 'LG-DUP', channel: 'polling', formId: 'F' }, 'acc-1');
  assert.equal(viaWebhook.created, true);
  assert.equal(viaPolling.created, false, 'polling reencontra o evento do webhook');
  assert.equal(viaPolling.item.id, viaWebhook.item.id);
});

// ── Espelho legado (rollback) ────────────────────────────────────

test('mergeLegacyWatermarks: espelha cursor no watermark legado sem regredir', () => {
  const current = { 'form-1': '2026-09-11T09:00:00.000Z' };
  const merged = mergeLegacyWatermarks(current, [
    { formId: 'form-1', cursorTimeMs: Date.parse('2026-09-11T08:00:00Z') }, // mais antigo → mantém
    { formId: 'form-2', cursorTimeMs: Date.parse('2026-09-11T10:00:00Z') }, // novo → cria
  ]);
  assert.equal(merged['form-1'], '2026-09-11T09:00:00.000Z');
  assert.equal(merged['form-2'], '2026-09-11T10:00:00.000Z');
});
