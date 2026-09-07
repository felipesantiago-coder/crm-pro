/**
 * Testes do casamento de respostas entre fontes diferentes (normalização
 * normalizeAnswerText em meta-lead-utils) — o bug real: o arquivo markdown
 * de regras configura "Agendar uma visita nesta semana" (40 pts), mas o
 * field_data do Meta envia "agendar_uma_visita_nesta_semana" (snake_case).
 * Com a comparação exata antiga (trim+lowercase) o lead recebia 0 pontos,
 * o painel mostrava a nota importada como vazia e o preview acusava
 * "resposta não observada". A cadeia inteira (motor, parser, preview,
 * painel) deve casar pela MESMA chave normalizada.
 *
 * Rodar: npm test (ou: node --test --import ./tests/ai/register.mjs tests/lead-temperature/*.test.ts)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAnswerText } from '@/lib/meta-lead-utils';
import { computeLeadScoreFromConfig, parseScoringConfig } from '@/lib/lead-temperature';
import { parseScoringMarkdown } from '@/lib/scoring-markdown-parser';
import type { RawLeadAnswer } from '@/lib/meta-lead-utils';

// ─────────────────────────────────────────────
// normalizeAnswerText — casos do bug real
// ─────────────────────────────────────────────

describe('normalizeAnswerText', () => {
  test('markdown (espaços) e field_data (snake_case) produzem a MESMA chave', () => {
    assert.equal(
      normalizeAnswerText('Agendar uma visita nesta semana'),
      normalizeAnswerText('agendar_uma_visita_nesta_semana'),
    );
    assert.equal(normalizeAnswerText('agendar_uma_visita_nesta_semana'), 'agendar uma visita nesta semana');
  });

  test('hífen, acentos e pontuação são equivalentes', () => {
    assert.equal(normalizeAnswerText('À vista'), normalizeAnswerText('a vista'));
    assert.equal(normalizeAnswerText('À vista'), 'a vista');
    assert.equal(
      normalizeAnswerText('Receber uma simulação pelo WhatsApp'),
      normalizeAnswerText('receber-uma-simulacao-pelo-whatsapp'),
    );
    assert.equal(normalizeAnswerText('R$ 15 mil'), normalizeAnswerText('R$15 mil'));
    assert.equal(normalizeAnswerText('  Várias   opções  ')[0] !== '_', true);
  });

  test('respostas diferentes continuam distintas', () => {
    assert.notEqual(normalizeAnswerText('1 quarto'), normalizeAnswerText('2 quartos'));
    assert.notEqual(
      normalizeAnswerText('Agendar uma visita nesta semana'),
      normalizeAnswerText('Agendar uma visita neste final de semana'),
    );
  });
});

// ─────────────────────────────────────────────
// Motor de pontuação — o caso do relato
// ─────────────────────────────────────────────

/** Pergunta/respostas EXATAMENTE como o markdown do Vitta configura. */
const VITTA_CONFIG = JSON.stringify({
  questions: [
    {
      key: 'proximo_passo_desejado',
      answers: [
        { text: 'Agendar uma visita nesta semana', score: 40 },
        { text: 'Agendar uma visita neste final de semana', score: 38 },
        { text: 'Receber uma simulação pelo WhatsApp', score: 35 },
        { text: 'Falar com um especialista', score: 32 },
        { text: 'Receber primeiro a tabela atualizada', score: 20 },
        { text: 'Ainda estou pesquisando', score: 10 },
      ],
    },
    {
      key: 'forma_aquisicao',
      answers: [
        { text: 'À vista', score: 0 },
        { text: 'Financiamento', score: 0 },
      ],
    },
  ],
});

describe('computeLeadScoreFromConfig — respostas do Meta em snake_case', () => {
  const scoring = {
    enabled: true,
    warmMin: 55,
    hotMin: 80,
    config: parseScoringConfig(VITTA_CONFIG),
  };

  test('lead com field_data snake_case recebe a nota configurada no markdown (40)', () => {
    const lead: RawLeadAnswer[] = [
      { key: 'proximo_passo_desejado', values: ['agendar_uma_visita_nesta_semana'] },
    ];
    const result = computeLeadScoreFromConfig(lead, scoring);
    assert.equal(result.score, 40);
    assert.equal(result.breakdown[0].matched, true);
    assert.equal(result.breakdown[0].score, 40);
    // score 40 < warmMin 55 → FRIO (antes da correção o lead também era
    // FRIO, mas com 0 ponto e breakdown matched=false)
    assert.equal(result.temperature, 'FRIO');
  });

  test('todas as variantes do mesmo texto casam (caixa, acento, hífen, espaço)', () => {
    const variants = [
      'Agendar uma visita nesta semana',
      'agendar uma visita nesta semana',
      'agendar_uma_visita_nesta_semana',
      'AGENDAR-UMA-VISITA-NESTA-SEMANA',
      'Agendar uma visita nesta  semana',
    ];
    for (const variant of variants) {
      const result = computeLeadScoreFromConfig(
        [{ key: 'proximo_passo_desejado', values: [variant] }],
        scoring,
      );
      assert.equal(result.score, 40, `variante "${variant}" deveria pontuar 40`);
    }
  });

  test('"À vista" configurado casa com "a vista" do field_data', () => {
    const result = computeLeadScoreFromConfig(
      [{ key: 'forma_aquisicao', values: ['a vista'] }],
      scoring,
    );
    assert.equal(result.breakdown[0].matched, true);
    assert.equal(result.breakdown[0].score, 0);
  });

  test('resposta realmente inexistente segue sem nota (matched=false)', () => {
    const result = computeLeadScoreFromConfig(
      [{ key: 'proximo_passo_desejado', values: ['quero um desconto especial'] }],
      scoring,
    );
    assert.equal(result.score, 0);
    assert.equal(result.breakdown[0].matched, false);
  });
});

// ─────────────────────────────────────────────
// Parser markdown — dedup na MESMA chave do motor
// ─────────────────────────────────────────────

describe('parseScoringMarkdown — dedup e casamento normalizados', () => {
  test('resposta duplicada por variante (espaços vs. underscore) é ERRO', () => {
    const md = [
      '# Formulário: Vitta_CRM_Otimizado',
      '',
      '## proximo_passo_desejado',
      '',
      '| Resposta | Pontos |',
      '|---|---|',
      '| Agendar uma visita nesta semana | 40 |',
      '| agendar_uma_visita_nesta_semana | 9 |',
      '',
    ].join('\n');
    const result = parseScoringMarkdown(md);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.severity === 'error' && i.message.includes('duplicada')));
    // apenas a PRIMEIRA ocorrência fica na config
    assert.equal(result.forms[0].questions[0].answers.length, 1);
    assert.equal(result.forms[0].questions[0].answers[0].score, 40);
  });

  test('arquivo no formato Vitta: todas as respostas com suas notas', () => {
    const md = [
      '# Formulário: Vitta_CRM_Otimizado',
      '',
      'Limiar morno: 55',
      'Limiar quente: 80',
      '',
      '## objetivo_aquisicao',
      '',
      '| Resposta | Pontos |',
      '|---|---|',
      '| Morar | 0 |',
      '| Investir | 0 |',
      '',
      '## proximo_passo_desejado',
      '',
      '| Resposta | Pontos |',
      '|---|---|',
      '| Agendar uma visita nesta semana | 40 |',
      '| Agendar uma visita neste final de semana | 38 |',
      '| Receber uma simulação pelo WhatsApp | 35 |',
      '| Falar com um especialista | 32 |',
      '| Receber primeiro a tabela atualizada | 20 |',
      '| Ainda estou pesquisando | 10 |',
      '',
      '## forma_aquisicao',
      '',
      '| Resposta | Pontos |',
      '|---|---|',
      '| À vista | 0 |',
      '| Financiamento | 0 |',
      '',
    ].join('\n');

    const result = parseScoringMarkdown(md);
    assert.equal(result.ok, true);
    assert.equal(result.issues.length, 0);
    const question = result.forms[0].questions.find((q) => q.key === 'proximo_passo_desejado');
    assert.ok(question);
    assert.equal(question.answers.length, 6);
    assert.deepEqual(
      question.answers.map((a) => a.score),
      [40, 38, 35, 32, 20, 10],
    );
  });
});
