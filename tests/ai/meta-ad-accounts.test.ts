/**
 * meta-ad-accounts.test.ts — Helpers puros da integração multi-conta
 * Meta Ads (evolução §13-v2): tokens por página/conta na captação e
 * normalização de contas. Sem IA e sem banco — funções determinísticas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseJsonArray,
  normalizeAdAccountId,
  resolveAccountByPageId,
  buildWebhookSecretCandidates,
  resolvePageToken,
} from '../../src/lib/meta-ad-accounts.ts';

// ── parseJsonArray ─────────────────────────────────────────────

test('parseJsonArray: array JSON válido de page/form ids', () => {
  assert.deepEqual(parseJsonArray('["111","222"]'), ['111', '222']);
});

test('parseJsonArray: converte números para string e filtra vazios', () => {
  assert.deepEqual(parseJsonArray('[111, "", "222"]'), ['111', '222']);
});

test('parseJsonArray: defesivo — null, vazio, JSON inválido e não-array → []', () => {
  assert.deepEqual(parseJsonArray(null), []);
  assert.deepEqual(parseJsonArray(undefined), []);
  assert.deepEqual(parseJsonArray(''), []);
  assert.deepEqual(parseJsonArray('{inválido'), []);
  assert.deepEqual(parseJsonArray('{"a":1}'), []);
});

// ── normalizeAdAccountId ───────────────────────────────────────

test('normalizeAdAccountId: adiciona prefixo act_ quando falta', () => {
  assert.equal(normalizeAdAccountId('123456789'), 'act_123456789');
});

test('normalizeAdAccountId: mantém prefixo existente e remove espaços', () => {
  assert.equal(normalizeAdAccountId('act_123456789'), 'act_123456789');
  assert.equal(normalizeAdAccountId('  123456789  '), 'act_123456789');
});

test('normalizeAdAccountId: vazio → vazio (sem inventar act_)', () => {
  assert.equal(normalizeAdAccountId(''), '');
  assert.equal(normalizeAdAccountId('   '), '');
});

// ── resolveAccountByPageId ─────────────────────────────────────

function acc(id: string, pageIds: string | null) {
  return {
    id,
    name: `Conta ${id}`,
    adAccountId: `act_${id}`,
    accessToken: `token-${id}`,
    pageIds,
  };
}

test('resolveAccountByPageId: encontra a conta dona da página (entry.id do webhook)', () => {
  const accounts = [
    acc('a1', '["111","222"]'),
    acc('a2', '["333"]'),
  ];
  const resolved = resolveAccountByPageId(accounts, '333');
  assert.equal(resolved?.id, 'a2');
});

test('resolveAccountByPageId: primeira página da lista também resolve', () => {
  const accounts = [acc('a1', '["111","222"]')];
  assert.equal(resolveAccountByPageId(accounts, '111')?.id, 'a1');
});

test('resolveAccountByPageId: sem match → null (cai no token global)', () => {
  const accounts = [acc('a1', '["111"]')];
  assert.equal(resolveAccountByPageId(accounts, '999'), null);
});

test('resolveAccountByPageId: conta sem pageIds e pageId vazio → null', () => {
  assert.equal(resolveAccountByPageId([acc('a1', null)], '111'), null);
  assert.equal(resolveAccountByPageId([acc('a1', '["111"]')], null), null);
  assert.equal(resolveAccountByPageId([acc('a1', '["111"]')], undefined), null);
});

// ── buildWebhookSecretCandidates ───────────────────────────────

test('buildWebhookSecretCandidates: global primeiro, depois secrets das contas, sem duplicatas', () => {
  const candidates = buildWebhookSecretCandidates('global-secret', [
    { appSecret: 'secret-a', enabled: true },
    { appSecret: 'global-secret', enabled: true },
    { appSecret: 'secret-b', enabled: true },
  ]);
  assert.deepEqual(candidates, ['global-secret', 'secret-a', 'secret-b']);
});

test('buildWebhookSecretCandidates: contas desativadas não entram', () => {
  const candidates = buildWebhookSecretCandidates(null, [
    { appSecret: 'secret-off', enabled: false },
    { appSecret: 'secret-on', enabled: true },
  ]);
  assert.deepEqual(candidates, ['secret-on']);
});

test('buildWebhookSecretCandidates: nenhum secret → lista vazia (403 no webhook)', () => {
  assert.deepEqual(buildWebhookSecretCandidates(null, [{ appSecret: null, enabled: true }]), []);
  assert.deepEqual(buildWebhookSecretCandidates(undefined, []), []);
});

// ── resolvePageToken ────────────────────────────────────────────

test('resolvePageToken: token da conta resolvida tem prioridade sobre o global', () => {
  const account = { accessToken: 'token-conta' };
  assert.equal(resolvePageToken(account, 'token-global'), 'token-conta');
});

test('resolvePageToken: sem conta ou sem token → cai no global (comportamento legado)', () => {
  assert.equal(resolvePageToken(null, 'token-global'), 'token-global');
  assert.equal(resolvePageToken({ accessToken: '' }, 'token-global'), 'token-global');
  assert.equal(resolvePageToken({ accessToken: 't' }, null), 't');
  assert.equal(resolvePageToken(null, null), null);
});
