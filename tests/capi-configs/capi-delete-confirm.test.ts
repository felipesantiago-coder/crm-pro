/**
 * capi-delete-confirm.test.ts — Mensagem de confirmação de exclusão
 * PERMANENTE de um config CAPI (MetaCapConfig). A mensagem é usada nos
 * dois pontos de exclusão (aba CAPI do card da conta e painel global) e
 * precisa explicar o impacto real: SetNull nos clientes/vínculos de
 * formulários e cadeia de fallback (padrão → legado → nada), com aviso
 * reforçado quando o config excluído é o PADRÃO.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCapiDeleteConfirmMessage } from '../../src/lib/capi-delete-confirm.ts';

test('mensagem base: nome do config, pergunta e aviso de irreversibilidade', () => {
  const msg = buildCapiDeleteConfirmMessage({ name: 'Felipe - Pixel' });
  assert.match(msg, /Excluir o config CAPI "Felipe - Pixel" permanentemente\?/);
  assert.match(msg, /Esta ação não pode ser desfeita\./);
});

test('sem contagem de leads → texto genérico de fallback (se houver)', () => {
  const msg = buildCapiDeleteConfirmMessage({ name: 'X' });
  assert.match(msg, /Leads vinculados \(se houver\) perderão a associação/);
  assert.match(msg, /voltarão a usar o config CAPI padrão ou o token legado da conta/);
});

test('clientsCount 0 → texto genérico (mesmo comportamento de undefined)', () => {
  const msg = buildCapiDeleteConfirmMessage({ name: 'X', clientsCount: 0 });
  assert.match(msg, /Leads vinculados \(se houver\)/);
  assert.doesNotMatch(msg, /0 leads/);
});

test('clientsCount 1 → singular', () => {
  const msg = buildCapiDeleteConfirmMessage({ name: 'X', clientsCount: 1 });
  assert.match(msg, /1 lead vinculado perderá a associação e voltará a usar/);
  assert.doesNotMatch(msg, /leads vinculados/);
});

test('clientsCount 5 → plural com contagem', () => {
  const msg = buildCapiDeleteConfirmMessage({ name: 'X', clientsCount: 5 });
  assert.match(msg, /5 leads vinculados perderão a associação e voltarão a usar/);
});

test('isDefault → aviso ATENÇÃO de fallback global sem reposição automática', () => {
  const msg = buildCapiDeleteConfirmMessage({ name: 'X', isDefault: true });
  assert.match(msg, /ATENÇÃO: este é o config PADRÃO \(fallback global\)/);
  assert.match(msg, /ficarão sem envio CAPI até que outro config seja marcado como padrão/);
});

test('não-padrão → sem aviso ATENÇÃO', () => {
  const msg = buildCapiDeleteConfirmMessage({ name: 'X', isDefault: false });
  assert.doesNotMatch(msg, /ATENÇÃO/);
});

test('mensagem completa cobre todos os impactos na ordem esperada', () => {
  const msg = buildCapiDeleteConfirmMessage({
    name: 'Cliente X - Offline Dataset',
    clientsCount: 12,
    isDefault: true,
  });
  const idxQuestion = msg.indexOf('Excluir o config CAPI');
  const idxLeads = msg.indexOf('12 leads vinculados');
  const idxAttention = msg.indexOf('ATENÇÃO');
  const idxForms = msg.indexOf('Vínculos de formulários');
  const idxUndo = msg.indexOf('Esta ação não pode ser desfeita');
  assert.ok(idxQuestion > -1 && idxLeads > -1 && idxAttention > -1 && idxForms > -1 && idxUndo > -1);
  assert.ok(idxQuestion < idxLeads && idxLeads < idxAttention && idxAttention < idxForms && idxForms < idxUndo);
  assert.match(msg, /Vínculos de formulários com este config também serão removidos\./);
});
