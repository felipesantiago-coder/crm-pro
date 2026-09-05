/**
 * meta-ad-accounts.test.ts — Helpers puros da integração multi-conta
 * Meta Ads (evolução §13-v2 + configuração EXCLUSIVAMENTE por conta):
 * tokens por página/conta na captação, normalização de contas e
 * checklist de conexão. Sem IA e sem banco — funções determinísticas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseJsonArray,
  normalizeAdAccountId,
  resolveAccountByPageId,
  buildWebhookSecretCandidates,
  resolveAccountByVerifyToken,
  resolvePageToken,
  evaluateAccountConnection,
  filterAccountsByChannel,
  type AdAccountRef,
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

test('resolveAccountByPageId: sem match → null (lead vai para LostLeads)', () => {
  const accounts = [acc('a1', '["111"]')];
  assert.equal(resolveAccountByPageId(accounts, '999'), null);
});

test('resolveAccountByPageId: conta sem pageIds e pageId vazio → null', () => {
  assert.equal(resolveAccountByPageId([acc('a1', null)], '111'), null);
  assert.equal(resolveAccountByPageId([acc('a1', '["111"]')], null), null);
  assert.equal(resolveAccountByPageId([acc('a1', '["111"]')], undefined), null);
});

// ── buildWebhookSecretCandidates (somente por conta) ───────────

test('buildWebhookSecretCandidates: secrets das contas, sem duplicatas (sem global)', () => {
  const candidates = buildWebhookSecretCandidates([
    { appSecret: 'secret-a', enabled: true },
    { appSecret: 'secret-a', enabled: true },
    { appSecret: 'secret-b', enabled: true },
  ]);
  assert.deepEqual(candidates, ['secret-a', 'secret-b']);
});

test('buildWebhookSecretCandidates: contas desativadas não entram', () => {
  const candidates = buildWebhookSecretCandidates([
    { appSecret: 'secret-off', enabled: false },
    { appSecret: 'secret-on', enabled: true },
  ]);
  assert.deepEqual(candidates, ['secret-on']);
});

test('buildWebhookSecretCandidates: nenhum secret → lista vazia (403 no webhook)', () => {
  assert.deepEqual(buildWebhookSecretCandidates([{ appSecret: null, enabled: true }]), []);
  assert.deepEqual(buildWebhookSecretCandidates([]), []);
});

test('buildWebhookSecretCandidates: contas com webhook próprio desligado não entram (settings por conta)', () => {
  const candidates = buildWebhookSecretCandidates([
    { appSecret: 'secret-webhook-off', enabled: true, webhookEnabled: false },
    { appSecret: 'secret-webhook-on', enabled: true, webhookEnabled: true },
    { appSecret: 'secret-legado', enabled: true }, // sem toggle = ligado (compat)
  ]);
  assert.deepEqual(candidates, ['secret-webhook-on', 'secret-legado']);
});

// ── resolveAccountByVerifyToken ────────────────────────────────

test('resolveAccountByVerifyToken: encontra a conta dona do verify token', () => {
  const accounts = [
    { ...acc('a1', '["111"]'), verifyToken: 'vt-a1' },
    { ...acc('a2', '["222"]'), verifyToken: 'vt-a2' },
  ];
  assert.equal(resolveAccountByVerifyToken(accounts, 'vt-a2')?.id, 'a2');
});

test('resolveAccountByVerifyToken: token nulo/desconhecido → null', () => {
  const accounts = [{ ...acc('a1', '["111"]'), verifyToken: 'vt-a1' }];
  assert.equal(resolveAccountByVerifyToken(accounts, 'outra'), null);
  assert.equal(resolveAccountByVerifyToken(accounts, null), null);
  assert.equal(resolveAccountByVerifyToken(accounts, undefined), null);
});

test('resolveAccountByVerifyToken: conta sem verify token próprio nunca casa', () => {
  const accounts = [acc('a1', '["111"]')]; // sem verifyToken
  assert.equal(resolveAccountByVerifyToken(accounts, 'qualquer'), null);
});

// ── filterAccountsByChannel (settings agrupadas por conta) ─────

function channelAcc(overrides: Partial<AdAccountRef>): AdAccountRef {
  return {
    id: 'x',
    name: 'Conta X',
    adAccountId: 'act_x',
    accessToken: 'token-x',
    ...overrides,
  };
}

test('filterAccountsByChannel: canal webhook exclui contas com webhookEnabled=false', () => {
  const accounts = [
    channelAcc({ id: 'a', webhookEnabled: true }),
    channelAcc({ id: 'b', webhookEnabled: false }),
    channelAcc({ id: 'c' }), // sem toggle = ligado (compat legado)
  ];
  const ids = filterAccountsByChannel(accounts, 'webhook').map((a) => a.id);
  assert.deepEqual(ids, ['a', 'c']);
});

test('filterAccountsByChannel: canal polling exclui contas com pollingEnabled=false', () => {
  const accounts = [
    channelAcc({ id: 'a', pollingEnabled: false }),
    channelAcc({ id: 'b', pollingEnabled: true }),
    channelAcc({ id: 'c' }),
  ];
  const ids = filterAccountsByChannel(accounts, 'polling').map((a) => a.id);
  assert.deepEqual(ids, ['b', 'c']);
});

test('filterAccountsByChannel: canal all mantém todas (toggles não filtram)', () => {
  const accounts = [
    channelAcc({ id: 'a', webhookEnabled: false, pollingEnabled: false }),
    channelAcc({ id: 'b' }),
  ];
  assert.equal(filterAccountsByChannel(accounts, 'all').length, 2);
});

// ── resolvePageToken (exclusivamente por conta) ────────────────

test('resolvePageToken: retorna o token da conta resolvida', () => {
  assert.equal(resolvePageToken({ accessToken: 'token-conta' }), 'token-conta');
  assert.equal(resolvePageToken(null), null);
  assert.equal(resolvePageToken({ accessToken: '' }), null);
});

// ── evaluateAccountConnection (checklist por conta) ────────────

test('evaluateAccountConnection: conta completa → webhook e polling prontos', () => {
  const account = {
    ...acc('a1', '["111","222"]'),
    verifyToken: 'vt',
    appSecret: 'sec',
    formIds: '["333"]',
    webhookEnabled: true,
    pollingEnabled: true,
  };
  const evaluation = evaluateAccountConnection(account);
  assert.equal(evaluation.webhookReady, true);
  assert.equal(evaluation.pollingReady, true);
  assert.equal(evaluation.pageCount, 2);
  assert.ok(evaluation.checks.every((c) => c.ok));
});

test('evaluateAccountConnection: sem verify/pages → webhook NÃO pronto (não existe global)', () => {
  const account = { ...acc('a1', null), formIds: '["333"]' };
  const evaluation = evaluateAccountConnection(account);
  assert.equal(evaluation.webhookReady, false);
  assert.equal(evaluation.pollingReady, true);
  const missing = evaluation.checks.filter((c) => c.required && !c.ok).map((c) => c.key);
  assert.deepEqual(missing, ['verifyToken', 'appSecret', 'pageIds']);
});

test('evaluateAccountConnection: canais desligados derrubam o readiness correspondente', () => {
  const account = {
    ...acc('a1', '["111"]'),
    verifyToken: 'vt',
    appSecret: 'sec',
    formIds: '["333"]',
    webhookEnabled: false,
    pollingEnabled: false,
  };
  const evaluation = evaluateAccountConnection(account);
  assert.equal(evaluation.webhookReady, false);
  assert.equal(evaluation.pollingReady, false);
  assert.equal(evaluation.checks.find((c) => c.key === 'webhookEnabled')?.ok, false);
  assert.equal(evaluation.checks.find((c) => c.key === 'pollingEnabled')?.ok, false);
});
