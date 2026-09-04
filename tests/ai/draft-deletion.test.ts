/**
 * tests/ai/draft-deletion.test.ts — Guarda de exclusão do rascunho de
 * extração: RUN em andamento bloqueia; qualquer outro estado permite.
 * A base documental (pdfContent/documentHash) e os dados publicados vivem
 * em campos separados e nunca são afetados pela exclusão do rascunho.
 *
 * Executar: npm test  (usa --import ./tests/ai/register.mjs para os hooks @/)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDeleteDraft } from '../../src/lib/ai/extraction-core.ts';

test('run RUNNING bloqueia a exclusão com motivo claro', () => {
  const guard = canDeleteDraft('RUNNING');
  assert.equal(guard.allowed, false);
  assert.match(guard.reason ?? '', /Extração em andamento/);
});

test('run concluída permite a exclusão', () => {
  assert.equal(canDeleteDraft('COMPLETED').allowed, true);
  assert.equal(canDeleteDraft('COMPLETED').reason, null);
});

test('run falhada permite a exclusão (rascunho morto é apagável)', () => {
  assert.equal(canDeleteDraft('FAILED').allowed, true);
});

test('sem run registrada permite a exclusão', () => {
  assert.equal(canDeleteDraft(null).allowed, true);
  assert.equal(canDeleteDraft(undefined).allowed, true);
});
