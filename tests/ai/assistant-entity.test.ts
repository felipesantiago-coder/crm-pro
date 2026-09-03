/**
 * assistant-entity.test.ts — Regressão do bug de produção (2026-09):
 * a bridge de contexto fazia `JSON.parse("enterprise:<id>")`, lançando
 * `SyntaxError: Unexpected token 'e', "enterprise"…` e derrubando a árvore
 * React ao abrir as informações de um empreendimento ou a ficha do cliente.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { serializeEntity, entityFromSerialized } = await import('../../src/components/ai-assistant/assistant-entity.ts');

test('entityFromSerialized reconstrói entidade enterprise sem lançar', () => {
  const serialized = 'enterprise:cmi1a2b3c4d5e6f7g8h9';
  // Garante o formato que quebrava antes: começa com "enterprise" e não é JSON
  assert.ok(serialized.startsWith('enterprise'));
  assert.throws(() => JSON.parse(serialized), SyntaxError);

  const entity = entityFromSerialized(serialized);
  assert.deepEqual(entity, { type: 'enterprise', id: 'cmi1a2b3c4d5e6f7g8h9' });
});

test('entityFromSerialized reconstrói entidade client (ficha)', () => {
  const entity = entityFromSerialized('client:abc123');
  assert.deepEqual(entity, { type: 'client', id: 'abc123' });
});

test('entityFromSerialized rejeita tipos desconhecidos e strings malformadas', () => {
  assert.equal(entityFromSerialized('lead:abc'), undefined);
  assert.equal(entityFromSerialized('enterprise'), undefined);
  assert.equal(entityFromSerialized(''), undefined);
  assert.equal(entityFromSerialized(':sem-tipo'), undefined);
  assert.equal(entityFromSerialized('client:'), undefined);
});

test('serializeEntity produz chave estável type:id e ciclo completo é fiel', () => {
  assert.equal(serializeEntity({ type: 'enterprise', id: 'x1' }), 'enterprise:x1');
  assert.equal(serializeEntity({ type: 'client', id: 'y2' }), 'client:y2');
  assert.equal(serializeEntity(undefined), '');
  assert.equal(serializeEntity({ type: 'client', id: '' }), 'client:');
  // id com ":" interno — reconstrução mantém o restante intacto
  assert.deepEqual(entityFromSerialized(serializeEntity({ type: 'client', id: 'a:b:c' })), { type: 'client', id: 'a:b:c' });
});
