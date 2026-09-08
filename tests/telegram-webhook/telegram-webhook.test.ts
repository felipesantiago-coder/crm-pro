/**
 * telegram-webhook.test.ts — Lógica pura de registro/diagnóstico do
 * webhook do bot do Telegram. Cenários cobrem o incidente real "bot mudo":
 * webhook nunca registrado (setWebhook manual que nunca aconteceu), URL
 * divergente, secret divergente (401 nas entregas), allowed_updates sem
 * 'message', divergência entre TELEGRAM_BOT_USERNAME e o bot real do
 * token, e a ausência da TELEGRAM_WEBHOOK_SECRET.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTelegramWebhookUrl,
  normalizeWebhookUrl,
  resolveWebhookBaseUrl,
  classifyTelegramWebhook,
  statusLabel,
} from '../../src/lib/telegram-webhook.ts';

const EXPECTED = 'https://www.crm-pro.site/api/telegram/webhook';

// ── buildTelegramWebhookUrl ─────────────────────────────────────

test('buildTelegramWebhookUrl: base com barra final é normalizada', () => {
  assert.equal(
    buildTelegramWebhookUrl('https://www.crm-pro.site/'),
    EXPECTED,
  );
  assert.equal(
    buildTelegramWebhookUrl('https://www.crm-pro.site///'),
    EXPECTED,
  );
});

// ── normalizeWebhookUrl ─────────────────────────────────────────

test('normalizeWebhookUrl: host case-insensitive, sem barra e sem query', () => {
  assert.equal(
    normalizeWebhookUrl('HTTPS://WWW.CRM-PRO.SITE/api/telegram/webhook/'),
    EXPECTED,
  );
  assert.equal(
    normalizeWebhookUrl('https://www.crm-pro.site/api/telegram/webhook?token=x'),
    EXPECTED,
  );
});

test('normalizeWebhookUrl: URL inválida não lança', () => {
  assert.equal(normalizeWebhookUrl('nao-e-url'), 'nao-e-url');
});

// ── resolveWebhookBaseUrl ───────────────────────────────────────

test('resolveWebhookBaseUrl: prioridade TELEGRAM_WEBHOOK_URL > NEXTAUTH_URL > NEXT_PUBLIC_APP_URL', () => {
  assert.equal(
    resolveWebhookBaseUrl({
      TELEGRAM_WEBHOOK_URL: 'https://override.site',
      NEXTAUTH_URL: 'https://nextauth.site',
      NEXT_PUBLIC_APP_URL: 'https://public.site',
    }),
    'https://override.site',
  );
  assert.equal(
    resolveWebhookBaseUrl({
      NEXTAUTH_URL: 'https://nextauth.site',
      NEXT_PUBLIC_APP_URL: 'https://public.site',
    }),
    'https://nextauth.site',
  );
  assert.equal(
    resolveWebhookBaseUrl({ NEXT_PUBLIC_APP_URL: 'https://public.site/' }),
    'https://public.site',
  );
});

test('resolveWebhookBaseUrl: ignora valores não-http e retorna null se nada válido', () => {
  assert.equal(
    resolveWebhookBaseUrl({ NEXTAUTH_URL: 'file:/home/z/db.db' }),
    null,
  );
  assert.equal(resolveWebhookBaseUrl({}), null);
  assert.equal(resolveWebhookBaseUrl({ NEXTAUTH_URL: undefined }), null);
});

// ── classifyTelegramWebhook ─────────────────────────────────────

const BASE_INPUT = {
  webhookInfo: { url: EXPECTED, pending_update_count: 0 } as const,
  getMeOk: true,
  expectedUrl: EXPECTED,
  hasWebhookSecret: true,
  envBotUsername: null,
  botUsername: null,
};

test('classify: webhook nunca registrado — o sintoma "bot mudo para tudo"', () => {
  const d = classifyTelegramWebhook({ ...BASE_INPUT, webhookInfo: { url: '' } });
  assert.equal(d.status, 'unregistered');
  assert.match(d.verdict, /NUNCA foi registrado/i);
  assert.equal(d.problems.length, 1);
  assert.match(d.hints[0], /Registro esperado em: https:\/\/www\.crm-pro\.site/);
});

test('classify: tudo saudável — ok, sem problemas', () => {
  const d = classifyTelegramWebhook(BASE_INPUT);
  assert.equal(d.status, 'ok');
  assert.equal(d.problems.length, 0);
  assert.equal(d.hints.length, 0);
});

test('classify: URL divergente — updates indo para outro lugar', () => {
  const d = classifyTelegramWebhook({
    ...BASE_INPUT,
    webhookInfo: { url: 'https://outro-sistema.vercel.app/api/telegram/webhook' },
  });
  assert.equal(d.status, 'url_mismatch');
  assert.match(d.verdict, /DIFERENTE/i);
  assert.match(d.problems[0], /outro-sistema\.vercel\.app/);
});

test('classify: entregas com 401 — secret_token divergente da env', () => {
  const d = classifyTelegramWebhook({
    ...BASE_INPUT,
    webhookInfo: {
      url: EXPECTED,
      last_error_message: 'Wrong response from the webhook: 401 Unauthorized',
      last_error_date: 1757300000,
    },
  });
  assert.equal(d.status, 'secret_mismatch_hint');
  assert.match(d.verdict, /401/);
  assert.match(d.verdict, /TELEGRAM_WEBHOOK_SECRET/);
});

test('classify: erro 502 na última entrega degrada mas mantém status ok', () => {
  const d = classifyTelegramWebhook({
    ...BASE_INPUT,
    webhookInfo: {
      url: EXPECTED,
      last_error_message: 'Wrong response from the webhook: 502 Bad Gateway',
    },
  });
  assert.equal(d.status, 'ok');
  assert.match(d.problems[0], /502 Bad Gateway/);
});

test("classify: allowed_updates sem 'message' — comandos nunca chegam", () => {
  const d = classifyTelegramWebhook({
    ...BASE_INPUT,
    webhookInfo: { url: EXPECTED, allowed_updates: ['channel_post'] },
  });
  assert.equal(d.status, 'no_message_updates');
  assert.match(d.verdict, /allowed_updates/i);
});

test('classify: getMe falhou — token do bot rejeitado vem antes de tudo', () => {
  const d = classifyTelegramWebhook({ ...BASE_INPUT, getMeOk: false, webhookInfo: null });
  assert.equal(d.status, 'bot_error');
  assert.match(d.verdict, /TELEGRAM_BOT_TOKEN/);
});

test('classify: TELEGRAM_BOT_USERNAME aponta para outro bot — problema sinalizado', () => {
  const d = classifyTelegramWebhook({
    ...BASE_INPUT,
    envBotUsername: 'crm_outro_bot',
    botUsername: 'crm_pro_bot',
  });
  assert.equal(d.status, 'ok');
  assert.equal(d.problems.length, 1);
  assert.match(d.problems[0], /@crm_outro_bot/);
  assert.match(d.problems[0], /@crm_pro_bot/);
});

test('classify: @ no env é tolerado na comparação de usernames', () => {
  const d = classifyTelegramWebhook({
    ...BASE_INPUT,
    envBotUsername: '@Crm_Pro_Bot',
    botUsername: 'crm_pro_bot',
  });
  assert.equal(d.status, 'ok');
  assert.equal(d.problems.length, 0);
});

test('classify: sem TELEGRAM_WEBHOOK_SECRET — dica de segurança, não bloqueio', () => {
  const d = classifyTelegramWebhook({ ...BASE_INPUT, hasWebhookSecret: false });
  assert.equal(d.status, 'ok');
  assert.match(d.hints[0], /TELEGRAM_WEBHOOK_SECRET não definida/);
});

test('classify: fila pendente aparece como dica informativa', () => {
  const d = classifyTelegramWebhook({
    ...BASE_INPUT,
    webhookInfo: { url: EXPECTED, pending_update_count: 7 },
  });
  assert.equal(d.status, 'ok');
  assert.match(d.hints.join(' '), /7 update\(s\)/);
});

test('statusLabel: rótulos existem para todos os status', () => {
  for (const s of [
    'ok',
    'unregistered',
    'url_mismatch',
    'secret_mismatch_hint',
    'no_message_updates',
    'bot_error',
    'unknown',
  ] as const) {
    assert.equal(typeof statusLabel(s), 'string');
    assert.ok(statusLabel(s).length > 5);
  }
});
