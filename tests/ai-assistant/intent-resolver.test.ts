/**
 * intent-resolver.test.ts — Detecção de intenção (prompt v2.0 §7.4/§28).
 *
 * Cobre o bug crítico de regex com flag `g` + .test(): chamadas consecutivas
 * com a MESMA entrada devem produzir SEMPRE o mesmo resultado.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveIntent, INTENT_LOADING_KEY, isFunnelStage } from '../../src/lib/ai-assistant/intent-resolver.ts';

test('regex idempotente: 50 chamadas consecutivas iguais (bug lastIndex)', () => {
  const inputs = [
    'Quais lembretes estão pendentes?',
    'Resuma este cliente',
    'Quais são os meus agendamentos de hoje?',
    'Explique as etapas do funil',
    'Resuma este empreendimento',
    'Resuma os indicadores do período',
  ];
  for (const input of inputs) {
    const expected = resolveIntent(input);
    for (let i = 0; i < 50; i++) {
      assert.equal(resolveIntent(input), expected, `chamada ${i} divergiu para "${input}"`);
    }
  }
});

test('mapa de intents', () => {
  assert.equal(resolveIntent('Quais lembretes estão vencidos?'), 'reminders');
  assert.equal(resolveIntent('Tenho agendamentos hoje?'), 'today_schedule');
  assert.equal(resolveIntent('Resuma este cliente'), 'client_summary');
  assert.equal(resolveIntent('Como funciona o funil?'), 'funnel_help');
  assert.equal(resolveIntent('Quais diferenciais deste empreendimento?'), 'enterprise_summary');
  assert.equal(resolveIntent('Compare ganhos e perdas do período'), 'report_summary');
  assert.equal(resolveIntent('Como conectar o Google Calendar?'), 'feature_help');
});

test('entrada vazia → feature_help (seguro)', () => {
  assert.equal(resolveIntent(''), 'feature_help');
  assert.equal(resolveIntent('   '), 'feature_help');
});

test('loading por intent (§7.8) — nada genérico', () => {
  assert.equal(INTENT_LOADING_KEY.client_summary, 'clients');
  assert.equal(INTENT_LOADING_KEY.today_schedule, 'schedules');
  assert.equal(INTENT_LOADING_KEY.reminders, 'reminders');
  assert.equal(INTENT_LOADING_KEY.enterprise_summary, 'enterprise');
  assert.equal(INTENT_LOADING_KEY.report_summary, 'reports');
  assert.equal(INTENT_LOADING_KEY.feature_help, 'help');
  assert.equal(INTENT_LOADING_KEY.funnel_help, 'help');
});

test('isFunnelStage valida apenas estágios reais', () => {
  assert.equal(isFunnelStage('LEAD'), true);
  assert.equal(isFunnelStage('FECHADO_GANHO'), true);
  assert.equal(isFunnelStage('INVENTADO'), false);
  assert.equal(isFunnelStage(''), false);
});
