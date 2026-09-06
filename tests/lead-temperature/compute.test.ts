/**
 * Testes do motor de temperatura de leads (src/lib/lead-temperature.ts).
 * Cobrem as funções PURAS (sem banco): parseScoringConfig,
 * classifyScore, computeLeadScoreFromConfig e normalizeQuestionKey.
 *
 * Rodar: npm test (ou: node --test --import ./tests/ai/register.mjs tests/lead-temperature/*.test.ts)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyScore,
  computeLeadScoreFromConfig,
  normalizeQuestionKey,
  parseScoringConfig,
} from '@/lib/lead-temperature';
import type { RawLeadAnswer } from '@/lib/meta-lead-utils';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const CONFIG_JSON = JSON.stringify({
  questions: [
    {
      key: 'Qual é o seu orçamento?',
      answers: [
        { text: 'Até R$ 500 mil', score: 2 },
        { text: 'R$ 500 mil a R$ 800 mil', score: 5 },
        { text: 'Acima de R$ 800 mil', score: 9 },
      ],
    },
    {
      key: 'Quando pretende comprar?',
      answers: [
        { text: 'Neste mês', score: 8 },
        { text: 'Em 3 meses', score: 4 },
        { text: 'Só estou pesquisando', score: -2 },
      ],
    },
    {
      key: 'Possui corretor de confiança?',
      answers: [{ text: 'Não', score: 3 }],
      questionScore: 1, // dissertativa com fallback
    },
  ],
});

const SCORING = {
  enabled: true,
  warmMin: 6,
  hotMin: 12,
  config: parseScoringConfig(CONFIG_JSON),
};

function answers(entries: Array<[string, string[]]>): RawLeadAnswer[] {
  return entries.map(([key, values]) => ({ key, values }));
}

// ─────────────────────────────────────────────
// normalizeQuestionKey
// ─────────────────────────────────────────────

describe('normalizeQuestionKey', () => {
  test('normaliza caixa, espaços, underscores e hífens', () => {
    assert.equal(normalizeQuestionKey('Qual_é o-orçamento?'), 'qualéoorçamento?');
    assert.equal(normalizeQuestionKey('  ORÇAMENTO  '), 'orçamento');
  });
});

// ─────────────────────────────────────────────
// parseScoringConfig
// ─────────────────────────────────────────────

describe('parseScoringConfig', () => {
  test('faz o parse de config válida', () => {
    const parsed = parseScoringConfig(CONFIG_JSON);
    assert.ok(parsed);
    assert.equal(parsed.questions.length, 3);
    assert.equal(parsed.questions[0].answers.length, 3);
    assert.equal(parsed.questions[0].answers[2].score, 9);
  });

  test('retorna null para JSON inválido ou sem questions', () => {
    assert.equal(parseScoringConfig('não é json'), null);
    assert.equal(parseScoringConfig('{"foo": 1}'), null);
    assert.equal(parseScoringConfig(null), null);
    assert.equal(parseScoringConfig(''), null);
  });

  test('descarta respostas inválidas e trunca notas não inteiras', () => {
    const parsed = parseScoringConfig(JSON.stringify({
      questions: [
        {
          key: 'P1',
          answers: [
            { text: 'ok', score: 2.9 },
            { text: '', score: 5 },
            { text: 'sem score' },
          ],
        },
      ],
    }));
    assert.ok(parsed);
    const answers = parsed.questions[0].answers;
    // '' é descartada; 'sem score' entra com nota 0 (Math.trunc(Number(undefined)||0))
    assert.equal(answers.length, 2);
    assert.equal(answers.find((a) => a.text === 'ok')?.score, 2); // 2.9 truncado
  });
});

// ─────────────────────────────────────────────
// classifyScore
// ─────────────────────────────────────────────

describe('classifyScore', () => {
  test('limiares FRIO/MORNO/QUENTE com fronteiras inclusivas', () => {
    assert.equal(classifyScore(0, 6, 12), 'FRIO');
    assert.equal(classifyScore(5, 6, 12), 'FRIO');
    assert.equal(classifyScore(6, 6, 12), 'MORNO'); // >= warmMin
    assert.equal(classifyScore(11, 6, 12), 'MORNO');
    assert.equal(classifyScore(12, 6, 12), 'QUENTE'); // >= hotMin
    assert.equal(classifyScore(50, 6, 12), 'QUENTE');
  });
});

// ─────────────────────────────────────────────
// computeLeadScoreFromConfig
// ─────────────────────────────────────────────

describe('computeLeadScoreFromConfig', () => {
  test('soma as notas das respostas dadas (múltipla escolha)', () => {
    const result = computeLeadScoreFromConfig(
      answers([
        ['Qual é o seu orçamento?', ['Acima de R$ 800 mil']],
        ['Quando pretende comprar?', ['Neste mês']],
      ]),
      SCORING,
    );
    assert.equal(result.score, 17);
    assert.equal(result.temperature, 'QUENTE');
    assert.equal(result.configured, true);
    assert.equal(result.breakdown.length, 2);
    assert.ok(result.breakdown.every((b) => b.matched));
  });

  test('classifica MORNO e FRIO pela soma', () => {
    const morno = computeLeadScoreFromConfig(
      answers([
        ['Qual é o seu orçamento?', ['R$ 500 mil a R$ 800 mil']],
        ['Quando pretende comprar?', ['Em 3 meses']],
      ]),
      SCORING,
    );
    assert.equal(morno.score, 9); // 5 + 4
    assert.equal(morno.temperature, 'MORNO');

    const frio = computeLeadScoreFromConfig(
      answers([['Quando pretende comprar?', ['Só estou pesquisando']]]),
      SCORING,
    );
    assert.equal(frio.score, -2);
    assert.equal(frio.temperature, 'FRIO');
  });

  test('match é case-insensitive e tolera espaços nas bordas', () => {
    const result = computeLeadScoreFromConfig(
      answers([['Quando pretende comprar?', ['  NESTE MÊS ']]]),
      SCORING,
    );
    assert.equal(result.score, 8);
  });

  test('normaliza a chave da pergunta (caixa, espaço, underscore, hífen)', () => {
    const result = computeLeadScoreFromConfig(
      answers([['qual_é_o_seu-orçamento?', ['Até R$ 500 mil']]]),
      SCORING,
    );
    assert.equal(result.score, 2);
    assert.ok(result.breakdown[0].matched);
  });

  test('múltipla escolha: TODOS os valores selecionados somam', () => {
    const result = computeLeadScoreFromConfig(
      answers([['Qual é o seu orçamento?', ['Até R$ 500 mil', 'Acima de R$ 800 mil']]]),
      SCORING,
    );
    assert.equal(result.score, 11); // 2 + 9
    assert.equal(result.breakdown[0].answer, 'Até R$ 500 mil, Acima de R$ 800 mil');
  });

  test('pergunta desconhecida e resposta não configurada pontuam 0 (matched=false)', () => {
    const result = computeLeadScoreFromConfig(
      answers([
        ['Pergunta fora do formulário', ['qualquer coisa']],
        ['Quando pretende comprar?', ['Resposta inédita nunca vista']],
      ]),
      SCORING,
    );
    assert.equal(result.score, 0);
    assert.equal(result.temperature, 'FRIO');
    assert.ok(result.breakdown.every((b) => !b.matched));
  });

  test('pergunta dissertativa: nota fixa aplica quando nenhuma resposta casa', () => {
    const result = computeLeadScoreFromConfig(
      answers([['Possui corretor de confiança?', ['Tenho um corretor de confiança muito bom']]]),
      SCORING,
    );
    assert.equal(result.score, 1); // questionScore
    assert.ok(result.breakdown[0].matched);
  });

  test('resposta configurada vence a nota fixa (sem pontuação dupla)', () => {
    const result = computeLeadScoreFromConfig(
      answers([['Possui corretor de confiança?', ['Não']]]),
      SCORING,
    );
    assert.equal(result.score, 3); // nota da resposta, NÃO 3 + 1
  });

  test('config desativada ou ausente → sem temperatura', () => {
    const disabled = computeLeadScoreFromConfig(
      answers([['Qual é o seu orçamento?', ['Até R$ 500 mil']]]),
      { ...SCORING, enabled: false },
    );
    assert.equal(disabled.configured, false);
    assert.equal(disabled.temperature, null);
    assert.equal(disabled.score, 0);

    const noConfig = computeLeadScoreFromConfig(
      answers([['Qual é o seu orçamento?', ['Até R$ 500 mil']]]),
      { ...SCORING, config: null },
    );
    assert.equal(noConfig.configured, false);
    assert.equal(noConfig.temperature, null);
  });
});
