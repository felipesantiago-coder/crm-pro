/**
 * capi-event-log.test.ts — helpers puros do log de auditoria dos envios
 * CAPI (capi_event_logs). Garante que a mensagem de erro é truncada, que
 * o resumo de sucesso é legível e que o tempo relativo em pt-BR está
 * correto — tudo o que o painel exibe ao admin.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCapiLogErrorMessage,
  parseCapiSendOutcome,
  timeAgoPt,
  CAPI_LOG_TEXT_MAX,
} from '../../src/lib/capi-event-log.ts';

// ── buildCapiLogErrorMessage ──

test('erro HTTP compõe "HTTP <status>: <corpo>"', () => {
  const msg = buildCapiLogErrorMessage(400, '{"error":{"message":"Campo em inválido"}}');
  assert.match(msg, /^HTTP 400: /);
  assert.match(msg, /Campo em inválido/);
});

test('corpo vazio → só o status, sem dois-pontos solto', () => {
  assert.equal(buildCapiLogErrorMessage(500, ''), 'HTTP 500');
  assert.equal(buildCapiLogErrorMessage(503, null), 'HTTP 503');
});

test('corpo objeto é serializado', () => {
  const msg = buildCapiLogErrorMessage(400, { error: 'x' });
  assert.match(msg, /{"error":"x"}/);
});

test('corpo gigante é truncado para CAPI_LOG_TEXT_MAX + reticências', () => {
  const big = 'a'.repeat(CAPI_LOG_TEXT_MAX + 500);
  const msg = buildCapiLogErrorMessage(400, big);
  assert.equal(msg.length, 'HTTP 400: '.length + CAPI_LOG_TEXT_MAX + '…'.length);
  assert.ok(msg.endsWith('…'));
});

// ── parseCapiSendOutcome ──

test('sucesso: 1 evento, sem avisos', () => {
  const out = parseCapiSendOutcome({ events_received: 1 });
  assert.equal(out, '1 evento recebido pela Meta');
});

test('sucesso: plural para vários eventos', () => {
  const out = parseCapiSendOutcome({ events_received: 3 });
  assert.equal(out, '3 eventos recebidos pela Meta');
});

test('sucesso com warnings da Meta são anexados', () => {
  const out = parseCapiSendOutcome({
    events_received: 1,
    messages: [
      { type: 'warning', message: 'Field ph is deprecated' },
      { type: 'info', message: 'ignorado' },
    ],
  });
  assert.match(out, /1 evento recebido pela Meta; avisos: Field ph is deprecated/);
});

test('resposta sem events_received → texto de fallback (sem crash)', () => {
  assert.equal(parseCapiSendOutcome({}), 'Resposta sem events_received');
  assert.equal(parseCapiSendOutcome(null), 'Resposta sem events_received');
});

// ── timeAgoPt ──

const NOW = new Date('2026-09-09T12:00:00Z');

test('timeAgoPt: agora mesmo (<60s)', () => {
  assert.equal(timeAgoPt('2026-09-09T11:59:30Z', NOW), 'agora mesmo');
});

test('timeAgoPt: minutos e horas', () => {
  assert.equal(timeAgoPt('2026-09-09T11:45:00Z', NOW), 'há 15 min');
  assert.equal(timeAgoPt('2026-09-09T09:00:00Z', NOW), 'há 3 h');
});

test('timeAgoPt: dias', () => {
  assert.equal(timeAgoPt('2026-09-06T12:00:00Z', NOW), 'há 3 d');
});

test('timeAgoPt: data inválida → string vazia (não crasha)', () => {
  assert.equal(timeAgoPt('não é data', NOW), '');
});
