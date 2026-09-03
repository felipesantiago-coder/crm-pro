/**
 * repair.test.ts — Validação estrita da saída do modelo com no máximo UMA
 * reparação controlada (prompt v1.0 §8.2 "reparação única" e §18.2).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { parseWithRepair } from '../../src/lib/ai/gateway.ts';
import { NexoError } from '../../src/lib/ai/errors.ts';

const schema = z.object({ name: z.string(), age: z.number().int() });

test('saída válida direta não chama reparação', async () => {
  let repairs = 0;
  const out = await parseWithRepair<{ name: string; age: number }>(
    JSON.stringify({ name: 'Ana', age: 30 }),
    schema,
    async () => { repairs++; return '{}'; },
  );
  assert.deepEqual(out, { name: 'Ana', age: 30 });
  assert.equal(repairs, 0);
});

test('JSON cercado de markdown é recuperado deterministicamente (sem modelo)', async () => {
  let repairs = 0;
  const out = await parseWithRepair<{ name: string; age: number }>(
    'Aqui está o JSON:\n```json\n{"name":"Bia","age":25}\n```\nfim',
    schema,
    async () => { repairs++; return ''; },
  );
  assert.deepEqual(out, { name: 'Bia', age: 25 });
  assert.equal(repairs, 0); // reparação local conta como determinística
});

test('saída inválida com reparação bem-sucedida: exatamente 1 chamada de reparo', async () => {
  let repairs = 0;
  const out = await parseWithRepair<{ name: string; age: number }>(
    'não é json',
    schema,
    async () => { repairs++; return '{"name":"Cris","age":40}'; },
  );
  assert.deepEqual(out, { name: 'Cris', age: 40 });
  assert.equal(repairs, 1);
});

test('saída inválida e reparação falha: NexoError invalid_output, nada persiste', async () => {
  let repairs = 0;
  await assert.rejects(
    parseWithRepair(
      'lixo total',
      schema,
      async () => { repairs++; return 'ainda lixo'; },
    ),
    (err: unknown) => err instanceof NexoError && err.code === 'invalid_output',
  );
  assert.equal(repairs, 1); // NUNCA segunda reparação
});

test('saída inválida sem reparação configurada: falha controlada', async () => {
  await assert.rejects(
    parseWithRepair('sem json', schema, null),
    (err: unknown) => err instanceof NexoError && err.code === 'invalid_output',
  );
});
