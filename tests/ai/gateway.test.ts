/**
 * gateway.test.ts — Gateway comum: kill switch, rate limit, cache/dedup,
 * circuit breaker e erro normalizado (prompt v1.0 §8).
 *
 * O transporte é injetável — nenhum teste toca a rede.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

// Telemetria usa db (lazy proxy) — URL placeholder evita erro de construtor
// na primeira telemetria; a gravação é fire-and-forget com catch.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';

const { runCapability, checkUserRateLimit, isCircuitOpen, __resetGatewayStateForTests } = await import('../../src/lib/ai/gateway.ts');
const { NexoError } = await import('../../src/lib/ai/errors.ts');
const { isAiKillSwitchActive } = await import('../../src/lib/ai/flags.ts');
const { __clearCacheForTests } = await import('../../src/lib/ai/cache.ts');

const schema = z.object({ ok: z.boolean() });

const baseParams = () => ({
  capability: 'client_brief' as const,
  promptVersion: 'test-v1',
  relevantData: { x: 1 },
  scopeId: 'test-scope',
  userId: 'user-1',
  systemPrompt: 's',
  buildUserContent: () => 'u',
  schema,
  maxTokens: 10,
});

beforeEach(() => {
  process.env.NEXO_AI_KILL_SWITCH = '';
  __resetGatewayStateForTests();
  __clearCacheForTests();
});

test('kill switch global desativa capacidades com erro seguro', async () => {
  process.env.NEXO_AI_KILL_SWITCH = '1';
  assert.equal(isAiKillSwitchActive(), true);
  await assert.rejects(
    runCapability({ ...baseParams(), transport: async () => ({ reply: '{"ok":true}', modelId: 'm' }) }),
    (err: unknown) => err instanceof NexoError && err.code === 'capability_disabled',
  );
});

test('dados insuficientes não chamam o modelo (custo consciente §17)', async () => {
  let calls = 0;
  await assert.rejects(
    runCapability({
      ...baseParams(),
      insufficientDataReason: 'sem interações',
      transport: async () => { calls++; return { reply: '{"ok":true}', modelId: 'm' }; },
    }),
    (err: unknown) => err instanceof NexoError && err.code === 'insufficient_data',
  );
  assert.equal(calls, 0);
});

test('cache: chamada repetida com mesmos dados é cache hit (transport 1x)', async () => {
  let calls = 0;
  const transport = async () => { calls++; return { reply: '{"ok":true}', modelId: 'm' }; };

  const first = await runCapability({ ...baseParams(), transport });
  const second = await runCapability({ ...baseParams(), transport });

  assert.equal(calls, 1);
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
});

test('deduplicação: chamadas concorrentes idênticas executam 1x', async () => {
  let calls = 0;
  const transport = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 25));
    return { reply: '{"ok":true}', modelId: 'm' };
  };
  const [a, b] = await Promise.all([
    runCapability({ ...baseParams(), transport }),
    runCapability({ ...baseParams(), transport }),
  ]);
  assert.equal(calls, 1);
  assert.ok(a.cacheHit === false);
  assert.ok(b.cacheHit || b.deduplicated);
});

test('dados diferentes mudam a chave: não reutiliza cache indevidamente', async () => {
  let calls = 0;
  const transport = async () => { calls++; return { reply: '{"ok":true}', modelId: 'm' }; };
  await runCapability({ ...baseParams(), relevantData: { x: 1 }, transport });
  await runCapability({ ...baseParams(), relevantData: { x: 2 }, transport });
  assert.equal(calls, 2);
});

test('saída inválida após reparo único → NexoError invalid_output', async () => {
  let calls = 0;
  const transport = async (_s: string, content: string) => {
    calls++;
    return { reply: calls === 1 ? 'resposta lixo' : 'ainda lixo', modelId: 'm' };
  };
  await assert.rejects(
    runCapability({ ...baseParams(), transport }),
    (err: unknown) => err instanceof NexoError && err.code === 'invalid_output',
  );
  assert.equal(calls, 2); // 1 original + 1 reparo — nunca mais
});

test('transport lançando timeout → código estável timeout', async () => {
  const transport = async () => { throw new Error('DeepSeek timeout after 30000ms'); };
  await assert.rejects(
    runCapability({ ...baseParams(), transport }),
    (err: unknown) => err instanceof NexoError && err.code === 'timeout',
  );
});

test('rate limit por usuário+capacidade', () => {
  assert.equal(checkUserRateLimit('u-rate', 'client_brief', 2), true);
  assert.equal(checkUserRateLimit('u-rate', 'client_brief', 2), true);
  assert.equal(checkUserRateLimit('u-rate', 'client_brief', 2), false);
  assert.equal(checkUserRateLimit('outro', 'client_brief', 2), true); // usuário distinto
  assert.equal(checkUserRateLimit('u-rate', 'enterprise_extraction', 2), true); // capacidade distinta
});

test('circuit breaker abre após falhas consecutivas e registra erro estável', async () => {
  const transport = async () => { throw new Error('boom 503 indisponível'); };
  for (let i = 0; i < 5; i++) {
    await assert.rejects(runCapability({ ...baseParams(), transport }), NexoError);
  }
  assert.equal(isCircuitOpen('client_brief'), true);
  await assert.rejects(
    runCapability({ ...baseParams(), transport: async () => ({ reply: '{"ok":true}', modelId: 'm' }) }),
    (err: unknown) => err instanceof NexoError && err.code === 'provider_unavailable',
  );
});
