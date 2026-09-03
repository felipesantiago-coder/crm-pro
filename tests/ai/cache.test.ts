/**
 * cache.test.ts — Cache canônico com invalidação por evento e dedup
 * (prompt v1.0 §8.3).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDataHash,
  buildCacheKey,
  cacheGet,
  cacheSet,
  invalidateCapability,
  cachedRun,
  __clearCacheForTests,
} from '../../src/lib/ai/cache.ts';

test('computeDataHash é estável ante reordenação de chaves', () => {
  const a = computeDataHash({ b: 1, a: 'x' });
  const b = computeDataHash({ a: 'x', b: 1 });
  assert.equal(a, b);
});

test('computeDataHash muda quando dado relevante muda (invalidação por evento)', () => {
  const before = computeDataHash({ stage: 'LEAD', interactions: 3 });
  const after = computeDataHash({ stage: 'PROSPECT', interactions: 3 });
  assert.notEqual(before, after);
});

test('chaves isolam capacidade/escopo/prompt/modelo (sem vazamento cruzado)', () => {
  const k1 = buildCacheKey({ capability: 'client_brief', scopeId: 'c1', dataHash: 'h', promptVersion: 'p1', modelId: 'm' });
  const k2 = buildCacheKey({ capability: 'client_brief', scopeId: 'c2', dataHash: 'h', promptVersion: 'p1', modelId: 'm' });
  const k3 = buildCacheKey({ capability: 'client_brief', scopeId: 'c1', dataHash: 'h', promptVersion: 'p2', modelId: 'm' });
  assert.notEqual(k1, k2);
  assert.notEqual(k1, k3);
});

test('cacheSet/cacheGet + invalidação por capacidade e escopo', () => {
  __clearCacheForTests();
  cacheSet('client_brief:c1:h:p:m', { v: 1 });
  cacheSet('client_brief:c2:h:p:m', { v: 2 });
  cacheSet('enterprise_extraction:c1:h:p:m', { v: 3 });

  assert.deepEqual(cacheGet<{ v: number }>('client_brief:c1:h:p:m'), { v: 1 });
  invalidateCapability('client_brief', 'c1');
  assert.equal(cacheGet('client_brief:c1:h:p:m'), undefined);
  assert.deepEqual(cacheGet<{ v: number }>('client_brief:c2:h:p:m'), { v: 2 });

  invalidateCapability('client_brief');
  assert.equal(cacheGet('client_brief:c2:h:p:m'), undefined);
  assert.deepEqual(cacheGet<{ v: number }>('enterprise_extraction:c1:h:p:m'), { v: 3 }); // outra capacidade intacta
});

test('cachedRun: segunda chamada idêntica é cache hit (custo de IA evitado)', async () => {
  __clearCacheForTests();
  let calls = 0;
  const producer = async () => { calls++; return { n: 42 }; };
  const key = 'test:cap:scope:hash:p:m';

  const first = await cachedRun(key, 60_000, producer);
  const second = await cachedRun(key, 60_000, producer);

  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(calls, 1);
});

test('cachedRun: deduplicação de chamadas concorrentes', async () => {
  __clearCacheForTests();
  let calls = 0;
  const producer = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 20));
    return 'ok';
  };
  const key = 'test:cap:scope:hash2:p:m';
  const [a, b, c] = await Promise.all([
    cachedRun(key, 60_000, producer),
    cachedRun(key, 60_000, producer),
    cachedRun(key, 60_000, producer),
  ]);
  assert.equal(calls, 1);
  assert.equal(a.value, 'ok');
  assert.equal(b.deduplicated, true);
  assert.equal(c.deduplicated, true);
});

test('cachedRun: producer que falha não é cacheado (falha não persiste)', async () => {
  __clearCacheForTests();
  const key = 'test:cap:scope:hash3:p:m';
  await assert.rejects(
    cachedRun(key, 60_000, async () => { throw new Error('boom'); }),
    /boom/,
  );
  let calls = 0;
  const again = await cachedRun(key, 60_000, async () => { calls++; return 'recuperou'; });
  assert.equal(again.value, 'recuperou');
  assert.equal(calls, 1);
});
