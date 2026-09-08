/**
 * app-secret-validation.test.ts — Validação do App Secret NO ATO DE
 * SALVAR: o elo auto-consistente fechado na entrada. Um secret errado
 * passa no self-test HMAC local e só mata as entregas REAIS do Meta —
 * a validação prova o secret contra a Graph API (app access token
 * app_id|secret) e só BLOQUEIA no erro determinístico (190 / signature).
 * Indisponibilidade transitória → 'unverifiable' (salva com aviso).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateAppSecretValidation,
  type GraphCallOutcome,
} from '../../src/lib/app-secret-validation.ts';

const APP_ID = '858296646928219';

function debugOk(): GraphCallOutcome {
  return { ok: true, data: { data: { app_id: APP_ID, is_valid: true } } };
}

// ── veredito ok ─────────────────────────────────────────────────

test('app access token aceito → ok com o app id', () => {
  const r = evaluateAppSecretValidation({ debugToken: debugOk(), appCheck: { ok: true, data: { id: APP_ID, name: 'App' } } });
  assert.equal(r.verdict, 'ok');
  assert.equal(r.verdict === 'ok' && r.appId, APP_ID);
});

// ── veredito invalid (BLOQUEIA o save) ──────────────────────────

test('code 190 → invalid: secret NÃO confere, com o sintoma e a correção exata', () => {
  const r = evaluateAppSecretValidation({
    debugToken: debugOk(),
    appCheck: { ok: false, status: 400, code: 190, error: 'Invalid OAuth access token signature.' },
  });
  assert.equal(r.verdict, 'invalid');
  assert.equal(r.verdict === 'invalid' && r.appId, APP_ID);
  assert.match(r.verdict === 'invalid' ? r.details : '', /NÃO confere com o app 858296646928219/);
  assert.match(r.verdict === 'invalid' ? r.details : '', /MESMO secret errado/);
  assert.match(r.verdict === 'invalid' ? r.details : '', /NÃO foi salvo/);
  assert.match(r.verdict === 'invalid' ? r.fix : '', /Configurações → Básico/);
  assert.match(r.verdict === 'invalid' ? r.fix : '', /sem espaços ou quebras de linha/);
});

test('400 com mensagem de token/oauth (sem code) → invalid', () => {
  const r = evaluateAppSecretValidation({
    debugToken: debugOk(),
    appCheck: { ok: false, status: 400, code: null, error: 'Error validating access token: invalid app access token' },
  });
  assert.equal(r.verdict, 'invalid');
});

test('mensagem "signature" em 400 → invalid (defesa em profundidade)', () => {
  const r = evaluateAppSecretValidation({
    debugToken: debugOk(),
    appCheck: { ok: false, status: 400, error: 'Bad signature' },
  });
  assert.equal(r.verdict, 'invalid');
});

// ── veredito unverifiable (salva com aviso, NÃO bloqueia) ───────

test('erro transitório da Graph (500) → unverifiable com aviso', () => {
  const r = evaluateAppSecretValidation({
    debugToken: debugOk(),
    appCheck: { ok: false, status: 500, code: 1, error: 'Please retry later' },
  });
  assert.equal(r.verdict, 'unverifiable');
  assert.match(r.verdict === 'unverifiable' ? r.reason : '', /SEM validação/);
  assert.match(r.verdict === 'unverifiable' ? r.reason : '', /Please retry later/);
});

test('debug_token falhou → unverifiable (não acusa secret errado)', () => {
  const r = evaluateAppSecretValidation({
    debugToken: { ok: false, error: 'fetch failed' },
    appCheck: null,
  });
  assert.equal(r.verdict, 'unverifiable');
  assert.match(r.verdict === 'unverifiable' ? r.reason : '', /debug_token falhou: fetch failed/);
});

test('debug_token ok mas resposta sem app_id → unverifiable', () => {
  const r = evaluateAppSecretValidation({
    debugToken: { ok: true, data: { data: {} } },
    appCheck: null,
  });
  assert.equal(r.verdict, 'unverifiable');
  assert.match(r.verdict === 'unverifiable' ? r.reason : '', /resposta sem app_id/);
});

test('appCheck null com debug ok (fluxo defensivo) → unverifiable, nunca crasha', () => {
  const r = evaluateAppSecretValidation({ debugToken: debugOk(), appCheck: null });
  assert.equal(r.verdict, 'unverifiable');
});

test('appCheck ok=false sem status nem error → unverifiable com HTTP ?', () => {
  const r = evaluateAppSecretValidation({ debugToken: debugOk(), appCheck: { ok: false } });
  assert.equal(r.verdict, 'unverifiable');
  assert.match(r.verdict === 'unverifiable' ? r.reason : '', /HTTP \?/);
});
