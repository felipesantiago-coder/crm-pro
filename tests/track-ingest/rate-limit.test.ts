/**
 * rate-limit.test.ts — contratos da Fase 6 (otimização Vercel):
 * rate limit DISTRIBUÍDO do /api/track (statement único pooler-safe
 * em tracking_rate_limit) com fallback in-memory por instância.
 *
 * O fake implementa a SEMÂNTICA REAL do upsert Postgres (INSERT ...
 * ON CONFLICT DO UPDATE com reset de janela via CASE + RETURNING),
 * permitindo provar o contrato completo sem banco (regra 2).
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeRateLimit,
  RATE_LIMIT_MAX,
  RATE_WINDOW_MS,
  __memoryRateStateForTests,
  __resetMemoryRateForTests,
  type RateLimitDb,
} from '../../src/lib/track-rate-limit.ts';

// ── Fake do Postgres com a semântica REAL do statement ──────────

/**
 * Reproduz o statement da lib:
 *   INSERT (key, windowStart=now, count=units) ON CONFLICT (key) DO
 *   UPDATE count = CASE window < now-WINDOW THEN units ELSE count+units END
 *   RETURNING count
 * Relógio injetável para provar o reset de janela.
 */
function makeDistributedDb(opts?: { failWith?: { code: string } }) {
  const rows = new Map<string, { windowStart: number; count: number }>();
  let now = 1_700_000_000_000;
  const calls: { statements: string[]; values: unknown[][] } = { statements: [], values: [] };

  const db = {
    async $queryRaw(segments: TemplateStringsArray, ...values: unknown[]) {
      const sql = segments.join('?');
      calls.statements.push(sql);
      calls.values.push(values);
      if (opts?.failWith) {
        const err = new Error('relation does not exist') as Error & { code?: string };
        err.code = opts.failWith.code;
        throw err;
      }
      if (sql.includes('INSERT INTO "tracking_rate_limit"')) {
        const key = String(values[0]);
        const units = Number(values[1]);
        const existing = rows.get(key);
        let count: number;
        if (!existing) {
          count = units;
          rows.set(key, { windowStart: now, count });
        } else if (now - existing.windowStart > RATE_WINDOW_MS) {
          // reset de janela (ramo THEN do CASE)
          count = units;
          rows.set(key, { windowStart: now, count });
        } else {
          // acumula (ramo ELSE do CASE)
          count = existing.count + units;
          rows.set(key, { ...existing, count });
        }
        return [{ count }];
      }
      if (sql.includes('DELETE FROM "tracking_rate_limit"')) {
        const deleted = [...rows.entries()].filter(
          ([, v]) => now - v.windowStart > 10 * 60_000,
        );
        for (const [k] of deleted) rows.delete(k);
        return [];
      }
      throw new Error(`statement inesperado no fake: ${sql.slice(0, 80)}`);
    },
    tick(ms: number) {
      now += ms;
    },
    size() {
      return rows.size;
    },
  } as unknown as RateLimitDb & { tick(ms: number): void; size(): number };

  return { db, calls };
}

describe('consumeRateLimit — distribuído (statement único pooler-safe)', () => {
  beforeEach(() => {
    __resetMemoryRateForTests();
    delete process.env.TRACK_RATE_LIMIT_V2;
  });

  test('primeiro request: count = units, não limitado, mode=distributed', async () => {
    const { db } = makeDistributedDb();
    const decision = await consumeRateLimit({ db }, '1.2.3.4', 1);
    assert.deepEqual(decision, { limited: false, count: 1, mode: 'distributed' });
  });

  test('lote consome units por evento (contrato do endpoint antigo)', async () => {
    const { db } = makeDistributedDb();
    const d1 = await consumeRateLimit({ db }, '1.2.3.4', 60);
    const d2 = await consumeRateLimit({ db }, '1.2.3.4', 40);
    assert.equal(d1.count, 60);
    assert.equal(d2.count, 100);
    assert.equal(d2.limited, false);
    const d3 = await consumeRateLimit({ db }, '1.2.3.4', 1);
    assert.equal(d3.count, 101);
    assert.equal(d3.limited, true); // > RATE_LIMIT_MAX
  });

  test('janelas diferentes por chave (ip independente)', async () => {
    const { db } = makeDistributedDb();
    await consumeRateLimit({ db }, '1.1.1.1', RATE_LIMIT_MAX);
    const d = await consumeRateLimit({ db }, '2.2.2.2', 1);
    assert.equal(d.limited, false);
    assert.equal(d.count, 1);
  });

  test('statement é ÚNICO e contém ON CONFLICT + CASE de reset + RETURNING (pooler-safe)', async () => {
    const { db, calls } = makeDistributedDb();
    await consumeRateLimit({ db }, '1.2.3.4', 1);
    assert.equal(calls.statements.length, 1);
    const sql = calls.statements[0];
    assert.ok(sql.includes('INSERT INTO "tracking_rate_limit"'), 'INSERT');
    assert.ok(sql.includes('ON CONFLICT ("key") DO UPDATE'), 'ON CONFLICT');
    assert.ok(sql.includes("now() - interval '60 seconds'"), 'reset de janela via CASE');
    assert.ok(sql.includes('RETURNING "count"'), 'RETURNING');
  });

  test('reset de janela: após RATE_WINDOW_MS o contador volta a zero (ramo THEN do CASE)', async () => {
    const { db } = makeDistributedDb();
    const clocked = db as unknown as { tick(ms: number): void };
    // preenche a janela
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      await consumeRateLimit({ db }, '9.9.9.9', 1);
    }
    const blocked = await consumeRateLimit({ db }, '9.9.9.9', 1);
    assert.equal(blocked.limited, true);
    assert.equal(blocked.count, RATE_LIMIT_MAX + 1);

    // avança o relógio além da janela → reset (THEN: count = units)
    clocked.tick(RATE_WINDOW_MS + 1);
    const afterWindow = await consumeRateLimit({ db }, '9.9.9.9', 5);
    assert.equal(afterWindow.limited, false);
    assert.equal(afterWindow.count, 5);
  });

  test('limpeza oportunista dispara DELETE com probabilidade (random < 0.05)', async () => {
    const { db, calls } = makeDistributedDb();
    await consumeRateLimit({ db }, '1.2.3.4', 1, { random: () => 0.01 });
    const deleteStatements = calls.statements.filter((s) => s.includes('DELETE FROM'));
    assert.equal(deleteStatements.length, 1);
    assert.ok(deleteStatements[0].includes("interval '600 seconds'"));
  });

  test('limpeza NÃO dispara quando random >= probabilidade (caminho crítico limpo)', async () => {
    const { db, calls } = makeDistributedDb();
    await consumeRateLimit({ db }, '1.2.3.4', 1, { random: () => 0.99 });
    assert.equal(calls.statements.length, 1); // só o upsert
    assert.ok(calls.statements[0].includes('INSERT'));
  });
});

describe('consumeRateLimit — fallback in-memory (tabela ausente/erro/flag)', () => {
  beforeEach(() => {
    __resetMemoryRateForTests();
    delete process.env.TRACK_RATE_LIMIT_V2;
  });

  test('P2021 (tabela ausente — deploy antes do SQL) → fallback memory com WARN', async () => {
    const { db } = makeDistributedDb({ failWith: { code: 'P2021' } });
    const d = await consumeRateLimit({ db }, '1.2.3.4', 1);
    assert.equal(d.mode, 'memory');
    assert.equal(d.limited, false);
    // acumula no fallback
    const d2 = await consumeRateLimit({ db }, '1.2.3.4', RATE_LIMIT_MAX);
    assert.equal(d2.mode, 'memory');
    assert.equal(d2.limited, true);
  });

  test('P2022 → fallback memory', async () => {
    const { db } = makeDistributedDb({ failWith: { code: 'P2022' } });
    const d = await consumeRateLimit({ db }, '1.2.3.4', 1);
    assert.equal(d.mode, 'memory');
  });

  test('erro genérico de banco → fallback memory (disponibilidade > rigor)', async () => {
    const { db } = makeDistributedDb({ failWith: { code: 'P9999' } });
    const d = await consumeRateLimit({ db }, '1.2.3.4', 1);
    assert.equal(d.mode, 'memory');
  });

  test('TRACK_RATE_LIMIT_V2=legacy → NEM toca o banco (rollback por env)', async () => {
    let called = false;
    const db = {
      async $queryRaw() {
        called = true;
        return [];
      },
    } as unknown as RateLimitDb;
    process.env.TRACK_RATE_LIMIT_V2 = 'legacy';
    const d = await consumeRateLimit({ db }, '1.2.3.4', 1);
    assert.equal(called, false);
    assert.equal(d.mode, 'memory');
  });
});

describe('fallback in-memory — janela e evicção', () => {
  beforeEach(() => {
    __resetMemoryRateForTests();
    delete process.env.TRACK_RATE_LIMIT_V2;
  });

  test('reset de janela após RATE_WINDOW_MS (contrato do limitador antigo preservado)', async () => {
    const { db } = makeDistributedDb({ failWith: { code: 'P2021' } });
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      const d = await consumeRateLimit({ db }, '7.7.7.7', 1);
      assert.equal(d.limited, false);
    }
    const blocked = await consumeRateLimit({ db }, '7.7.7.7', 1);
    assert.equal(blocked.limited, true);

    // simula passagem do tempo manipulando o estado (contrato do Map)
    const state = __memoryRateStateForTests();
    const entry = state.get('7.7.7.7')!;
    state.set('7.7.7.7', { ...entry, windowStart: entry.windowStart - (RATE_WINDOW_MS + 1) });

    const afterWindow = await consumeRateLimit({ db }, '7.7.7.7', 1);
    assert.equal(afterWindow.limited, false);
    assert.equal(afterWindow.count, 1); // resetou
  });

  test('lotes contam por evento no fallback (mesma semântica do distribuído)', async () => {
    const { db } = makeDistributedDb({ failWith: { code: 'P2021' } });
    await consumeRateLimit({ db }, '5.5.5.5', 90);
    const d = await consumeRateLimit({ db }, '5.5.5.5', 11); // 90 + 11 = 101
    assert.equal(d.limited, true);
    assert.equal(d.count, 101);
  });
});
