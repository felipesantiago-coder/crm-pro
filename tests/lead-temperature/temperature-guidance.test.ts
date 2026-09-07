/**
 * temperature-guidance.test.ts — Fonte única da classificação do lead:
 * rótulos, emojis, orientação de tratativa (PT-BR) e formatação de
 * pontuação. Garante paridade entre o cartão Telegram e o perfil do CRM.
 *
 * Funções PURAS — nada de rede, nada de DB.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatLeadScoreLabel,
  getLeadTemperatureGuidance,
} from '../../src/lib/lead-temperature-guidance.ts';

test('três classificações válidas, cada uma com rótulo, emoji, headline e 3 passos', () => {
  const hot = getLeadTemperatureGuidance('QUENTE');
  const warm = getLeadTemperatureGuidance('MORNO');
  const cold = getLeadTemperatureGuidance('FRIO');

  for (const g of [hot, warm, cold]) {
    assert.ok(g, 'classificação válida retorna orientação');
    assert.equal(g!.steps.length, 3, 'três passos de tratativa');
    assert.ok(g!.label.length > 0);
    assert.ok(g!.emoji.length > 0);
    assert.ok(g!.headline.endsWith('.'), 'headline termina com ponto');
    assert.ok(g!.description.length > 40, 'descrição com contexto suficiente');
  }

  assert.equal(hot!.label, 'Quente');
  assert.equal(warm!.label, 'Morno');
  assert.equal(cold!.label, 'Frio');
  assert.equal(hot!.emoji, '🔥');
  assert.equal(warm!.emoji, '🌤️');
  assert.equal(cold!.emoji, '❄️');
});

test('case-insensitive e tolerante a espaços ("quente", " Quente ")', () => {
  assert.equal(getLeadTemperatureGuidance('quente')?.classification, 'QUENTE');
  assert.equal(getLeadTemperatureGuidance(' Frio ')?.classification, 'FRIO');
  assert.equal(getLeadTemperatureGuidance('morNo')?.classification, 'MORNO');
});

test('inválido/ausente → null (nunca inventa classificação)', () => {
  assert.equal(getLeadTemperatureGuidance(null), null);
  assert.equal(getLeadTemperatureGuidance(undefined), null);
  assert.equal(getLeadTemperatureGuidance(''), null);
  assert.equal(getLeadTemperatureGuidance('TEPIDO'), null);
  assert.equal(getLeadTemperatureGuidance('hot'), null);
});

test('headlines distintos por classificação (orientação realmente difere)', () => {
  const set = new Set(
    ['QUENTE', 'MORNO', 'FRIO'].map((t) => getLeadTemperatureGuidance(t)!.headline),
  );
  assert.equal(set.size, 3);
});

test('PT-BR: sem espaços duplos, sem inglês residual e com acentuação correta', () => {
  for (const key of ['QUENTE', 'MORNO', 'FRIO'] as const) {
    const g = getLeadTemperatureGuidance(key)!;
    const all = [g.headline, g.description, ...g.steps];
    for (const text of all) {
      assert.ok(!/ {2,}/.test(text), `espaço duplo em "${text}"`);
      assert.ok(!/\bthe\b|\band\b|\byou\b/i.test(text), `resíduo de inglês em "${text}"`);
    }
  }
  // regência/crase revisadas nos textos fixos
  assert.ok(
    getLeadTemperatureGuidance('FRIO')!.steps[0].startsWith('Responda à solicitação'),
    'crase em "Responda à solicitação"',
  );
  assert.ok(
    getLeadTemperatureGuidance('QUENTE')!.steps[1].includes('empreendimento'),
  );
});

test('formatLeadScoreLabel: singular, plural, negativo e inválido', () => {
  assert.equal(formatLeadScoreLabel(1), '1 pt');
  assert.equal(formatLeadScoreLabel(17), '17 pts');
  assert.equal(formatLeadScoreLabel(-2), '-2 pts');
  assert.equal(formatLeadScoreLabel(0), '0 pts');
  assert.equal(formatLeadScoreLabel(3.7), '3 pts', 'pontuação truncada (motor é inteiro)');
  assert.equal(formatLeadScoreLabel(null), null);
  assert.equal(formatLeadScoreLabel(undefined), null);
  assert.equal(formatLeadScoreLabel(Number.NaN), null);
});
