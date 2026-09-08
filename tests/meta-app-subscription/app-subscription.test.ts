/**
 * app-subscription.test.ts — Avaliação pura da assinatura de webhook no
 * NÍVEL DO APP (GET /{app-id}/subscriptions): o elo que o diagnóstico
 * clássico não cobria. Cenários cobrem o sintoma "polling funciona,
 * webhook mudo com tudo verde": app sem webhook Page/leadgen, callback
 * apontando para outro sistema, assinatura inativa, campo ausente e o
 * App Secret errado (só detectável contra a Graph API).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAppAccessToken,
  pickPageSubscription,
  isCallbackHostMatch,
  evaluateAppSubscription,
  type AppSubscriptionFetchOutcome,
} from '../../src/lib/meta-app-subscription.ts';

const URL_OK = 'https://crm.example.com/api/webhooks/meta-leads';

// ── buildAppAccessToken ─────────────────────────────────────────

test('buildAppAccessToken: formato clássico app_id|app_secret', () => {
  assert.equal(buildAppAccessToken('858296646928219', 's3cr3t'), '858296646928219|s3cr3t');
});

// ── pickPageSubscription ────────────────────────────────────────

test('pickPageSubscription: encontra o objeto page entre várias assinaturas', () => {
  const data = {
    data: [
      { object: 'user', callback_url: 'https://x/y', fields: ['feed'], active: true },
      { object: 'page', callback_url: URL_OK, fields: ['leadgen'], active: true },
    ],
  };
  const page = pickPageSubscription(data);
  assert.equal(page?.object, 'page');
  assert.equal(page?.callback_url, URL_OK);
});

test('pickPageSubscription: null sem assinatura page ou formato inesperado', () => {
  assert.equal(pickPageSubscription({ data: [{ object: 'user' }] }), null);
  assert.equal(pickPageSubscription({}), null);
  assert.equal(pickPageSubscription(null), null);
});

// ── isCallbackHostMatch ─────────────────────────────────────────

test('isCallbackHostMatch: compara apenas o host entre callback e URL esperada', () => {
  assert.equal(isCallbackHostMatch('https://crm.example.com/api/webhooks/meta-leads', 'http://crm.example.com/outro'), true);
  assert.equal(isCallbackHostMatch('https://outro.example.com/hook', URL_OK), false);
});

test('isCallbackHostMatch: subdomínio diferente é outro host', () => {
  assert.equal(isCallbackHostMatch('https://www.example.com/hook', 'https://api.example.com/hook'), false);
});

test('isCallbackHostMatch: URL vazia ou inválida → false (nunca falso-positivo)', () => {
  assert.equal(isCallbackHostMatch('', URL_OK), false);
  assert.equal(isCallbackHostMatch(URL_OK, ''), false);
  assert.equal(isCallbackHostMatch('não é url', URL_OK), false);
});

// ── evaluateAppSubscription ─────────────────────────────────────

function evaluate(outcome: AppSubscriptionFetchOutcome, overrides: Partial<Parameters<typeof evaluateAppSubscription>[0]> = {}) {
  return evaluateAppSubscription({
    appId: '858296646928219',
    appSecret: 's3cr3t',
    expectedWebhookUrl: URL_OK,
    fetchOutcome: outcome,
    ...overrides,
  });
}

test('sem App Secret → skip (nada a verificar)', () => {
  const r = evaluate({ kind: 'ok', subscriptions: [] }, { appSecret: null });
  assert.equal(r.status, 'skip');
});

test('sem app id (debug_token falhou) → warn com instrução manual', () => {
  const r = evaluate({ kind: 'no_app_id' });
  assert.equal(r.status, 'warn');
  assert.match(r.details, /app id/);
});

test('falha de rede → warn (não acusa segredo errado)', () => {
  const r = evaluate({ kind: 'network_error', error: 'fetch failed' });
  assert.equal(r.status, 'warn');
  assert.match(r.details, /rede|fetch failed/);
});

test('Graph rejeita app access token (code 190) → erro de App Secret errado, o elo auto-consistente do self-test HMAC', () => {
  const r = evaluate({ kind: 'graph_error', status: 400, code: 190, message: 'Invalid OAuth access token' });
  assert.equal(r.status, 'error');
  assert.match(r.details, /App Secret salvo NÃO confere/);
  assert.match(r.details, /MESMO secret errado/);
  assert.match(r.fix ?? '', /Configurações → Básico/);
});

test('Graph erro 400 com mensagem de token inválido → também trata como secret inválido', () => {
  const r = evaluate({ kind: 'graph_error', status: 400, code: null, message: 'Error validating access token: invalid app access token' });
  assert.equal(r.status, 'error');
  assert.match(r.details, /NÃO confere/);
});

test('Graph erro outro → warn com a mensagem', () => {
  const r = evaluate({ kind: 'graph_error', status: 500, code: 1, message: 'Please retry later' });
  assert.equal(r.status, 'warn');
  assert.match(r.details, /Please retry later/);
});

test('APP SEM webhook Page → o ÚLTIMO elo quebrado: Meta sem para onde entregar (sintoma exato do relato)', () => {
  const r = evaluate({ kind: 'ok', subscriptions: [] });
  assert.equal(r.status, 'error');
  assert.match(r.details, /NÃO TEM webhook do objeto Page/);
  assert.match(r.details, /NÃO TEM PARA ONDE entregar/);
  assert.match(r.fix ?? '', /leadgen/);
  assert.match(r.fix ?? '', new RegExp(URL_OK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(r.fix ?? '', /Assinar webhook do app/);
});

test('webhook Page existe mas SEM campo leadgen → erro apontando campos atuais', () => {
  const r = evaluate({
    kind: 'ok',
    subscriptions: [{ object: 'page', callback_url: URL_OK, fields: ['feed', 'comments'], active: true }],
  });
  assert.equal(r.status, 'error');
  assert.match(r.details, /SEM o campo leadgen/);
  assert.match(r.details, /feed, comments/);
});

test('assinatura page/leadgen INATIVA → erro (Meta retém entregas)', () => {
  const r = evaluate({
    kind: 'ok',
    subscriptions: [{ object: 'page', callback_url: URL_OK, fields: ['leadgen'], active: false }],
  });
  assert.equal(r.status, 'error');
  assert.match(r.details, /INATIVO/);
});

test('callback apontando para OUTRO host → entregas indo para outro sistema', () => {
  const r = evaluate({
    kind: 'ok',
    subscriptions: [{ object: 'page', callback_url: 'https://sistema-antigo.example.com/webhook', fields: ['leadgen'], active: true }],
  });
  assert.equal(r.status, 'error');
  assert.match(r.details, /OUTRO host/);
  assert.match(r.details, /sistema-antigo\.example\.com/);
  assert.match(r.fix ?? '', new RegExp(URL_OK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('cadeia completa confirmada → ok com App Secret confirmado na Graph API', () => {
  const r = evaluate({
    kind: 'ok',
    subscriptions: [{ object: 'page', callback_url: URL_OK, fields: ['leadgen', 'feed'], active: true }],
  });
  assert.equal(r.status, 'ok');
  assert.match(r.details, /ATIVO/);
  assert.match(r.details, /App Secret foi CONFIRMADO/);
  assert.equal(r.fix, undefined);
});

test('sem expectedWebhookUrl → não acusa host errado; exibe callback para conferência manual', () => {
  const r = evaluate(
    { kind: 'ok', subscriptions: [{ object: 'page', callback_url: 'https://qualquer.example.com/hook', fields: ['leadgen'], active: true }] },
    { expectedWebhookUrl: '' },
  );
  assert.equal(r.status, 'ok');
  assert.match(r.details, /qualquer\.example\.com/);
});
