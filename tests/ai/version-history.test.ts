/**
 * tests/ai/version-history.test.ts — Gestão do histórico pelo administrador:
 * plano de exclusão de versões antigas (bases anteriores).
 *
 * Invariante central: a versão ATIVA (publishedVersion) nunca entra no
 * conjunto apagável — é a âncora da numeração e a referência do conteúdo
 * no ar. Sem publicação (0), o histórico inteiro é órfão e pode ser limpo.
 *
 * Executar: npm test  (usa --import ./tests/ai/register.mjs para os hooks @/)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planVersionDeletion } from '../../src/lib/ai/extraction-core.ts';

test('versão ativa é preservada; anteriores são apagáveis', () => {
  const plan = planVersionDeletion([{ version: 5 }, { version: 4 }, { version: 3 }], 5);
  assert.equal(plan.active, 5);
  assert.deepEqual(plan.deletable, [4, 3]);
});

test('publishedVersion = 0 (nada publicado) → histórico inteiro é apagável', () => {
  const plan = planVersionDeletion([{ version: 3 }, { version: 2 }], 0);
  assert.equal(plan.active, null);
  assert.deepEqual(plan.deletable, [3, 2]);
});

test('histórico vazio → plano vazio, sem erro', () => {
  const plan = planVersionDeletion([], 7);
  assert.equal(plan.active, 7);
  assert.deepEqual(plan.deletable, []);
});

test('ativa ausente da lista (já apagada/órfã) não entra em deletable', () => {
  const plan = planVersionDeletion([{ version: 2 }, { version: 1 }], 9);
  assert.equal(plan.active, 9);
  assert.deepEqual(plan.deletable, [2, 1]);
});

test('única versão = ativa → nada apagável (limpeza em lote remove 0)', () => {
  const plan = planVersionDeletion([{ version: 1 }], 1);
  assert.deepEqual(plan.deletable, []);
});
