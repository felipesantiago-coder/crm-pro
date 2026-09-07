/**
 * Testes dos campos de RASTREAMENTO (utm_*, placement...) e dos PARÂMETROS
 * DINÂMICOS não resolvidos pelo Meta ("{{campaign.name}}" etc.).
 *
 * Cenário real: formulários Meta com campos ocultos pré-preenchidos
 * (utm_source, utm_medium, utm_campaign, utm_adset, utm_ad, placement)
 * chegam no field_data; quando o app Meta não expande os placeholders
 * dinâmicos, o texto literal "{{campaign.name}}" é submetido. Esses
 * valores não têm informação e não devem ser armazenados/exibidos;
 * campos de rastreamento nunca são perguntas e não pontuam na temperatura.
 *
 * Rodar: npm test (ou: node --test --import ./tests/ai/register.mjs tests/lead-temperature/tracking-placeholders.test.ts)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractRawAnswers,
  extractCustomAnswers,
  isMetaTrackingField,
  isUnresolvedMetaParam,
} from '@/lib/meta-lead-utils';
import { parseNotesAnswers } from '@/lib/lead-temperature-backfill';
import {
  parseScoringConfig,
  computeLeadScoreFromConfig,
} from '@/lib/lead-temperature';
import type { RawLeadAnswer } from '@/lib/meta-lead-utils';

function answers(entries: Array<[string, string[]]>): RawLeadAnswer[] {
  return entries.map(([key, values]) => ({ key, values }));
}

// ─────────────────────────────────────────────
// isMetaTrackingField
// ─────────────────────────────────────────────

describe('isMetaTrackingField', () => {
  test('reconhece campos de rastreamento (inclui os do exemplo real)', () => {
    const tracking = [
      'utm_source', 'utm_medium', 'utm_campaign',
      'utm_adset', 'utm_ad', 'utm_content', 'utm_term', 'utm_id',
      'placement', 'campaign_id', 'adset_id', 'ad_id',
      'campaign_name', 'adset_name', 'ad_name', 'page_name', 'form_name',
    ];
    for (const key of tracking) {
      assert.equal(isMetaTrackingField(key), true, `esperava rastreamento: ${key}`);
    }
    assert.equal(isMetaTrackingField('UTM_SOURCE'), true);
    assert.equal(isMetaTrackingField('PlACEMENT'), true);
  });

  test('perguntas legítimas do formulário NÃO são rastreamento', () => {
    const questions = [
      'objetivo_da_aquisição',
      'forma_de_aquisição',
      'tipologia_buscada',
      'faixa_de_renda_familiar',
      'quando_pode_realizar_uma_visita?',
      'Qual é o seu orçamento?',
      'Bairro de interesse',
    ];
    for (const key of questions) {
      assert.equal(isMetaTrackingField(key), false, `esperava PERGUNTA: ${key}`);
    }
    assert.equal(isMetaTrackingField(''), false);
  });
});

// ─────────────────────────────────────────────
// isUnresolvedMetaParam
// ─────────────────────────────────────────────

describe('isUnresolvedMetaParam', () => {
  test('detecta placeholders dinâmicos do Meta não resolvidos', () => {
    assert.equal(isUnresolvedMetaParam('{{campaign.name}}'), true);
    assert.equal(isUnresolvedMetaParam('{{adset.name}}'), true);
    assert.equal(isUnresolvedMetaParam('{{ad.name}}'), true);
    assert.equal(isUnresolvedMetaParam('{{placement}}'), true);
    assert.equal(isUnresolvedMetaParam('  {{campaign.name}}  '), true);
    // placeholder embutido em texto também não tem informação útil
    assert.equal(isUnresolvedMetaParam('Campanha {{campaign.name}}'), true);
  });

  test('valores reais não são placeholders', () => {
    assert.equal(isUnresolvedMetaParam('meta_ads'), false);
    assert.equal(isUnresolvedMetaParam('lead_form'), false);
    assert.equal(isUnresolvedMetaParam('Campanha Villa Bianco'), false);
    assert.equal(isUnresolvedMetaParam('2_quartos'), false);
    assert.equal(isUnresolvedMetaParam(''), false);
    // chaves soltas sem "{{...}}" não são placeholders
    assert.equal(isUnresolvedMetaParam('{campanha}'), false);
  });
});

// ─────────────────────────────────────────────
// Extração (field_data → cartão/notes)
// ─────────────────────────────────────────────

describe('extração descarta placeholders não resolvidos', () => {
  // field_data real do formulário do usuário: campos ocultos de
  // rastreamento + perguntas de qualificação
  const FIELD_DATA = [
    { name: 'utm_source', values: ['meta_ads'] },
    { name: 'utm_medium', values: ['lead_form'] },
    { name: 'utm_campaign', values: ['{{campaign.name}}'] },
    { name: 'utm_adset', values: ['{{adset.name}}'] },
    { name: 'utm_ad', values: ['{{ad.name}}'] },
    { name: 'placement', values: ['{{placement}}'] },
    { name: 'objetivo_da_aquisição', values: ['investir'] },
    { name: 'tipologia_buscada', values: ['2_quartos'] },
    { name: 'faixa_de_renda_familiar', values: ['acima_de_r$_9_mil'] },
    { name: 'quando_pode_realizar_uma_visita?', values: ['na_próxima_semana'] },
  ];

  test('extractRawAnswers: placeholders somem, valores reais e perguntas ficam', () => {
    const raw = extractRawAnswers(FIELD_DATA);
    const byKey = new Map(raw.map((r) => [r.key, r.values]));

    // placeholders não resolvidos: campo some completamente
    assert.equal(byKey.has('utm_campaign'), false);
    assert.equal(byKey.has('utm_adset'), false);
    assert.equal(byKey.has('utm_ad'), false);
    assert.equal(byKey.has('placement'), false);

    // valores fixos reais dos campos ocultos: permanecem (rastreamento válido)
    assert.deepEqual(byKey.get('utm_source'), ['meta_ads']);
    assert.deepEqual(byKey.get('utm_medium'), ['lead_form']);

    // perguntas de qualificação: intactas
    assert.deepEqual(byKey.get('objetivo_da_aquisição'), ['investir']);
    assert.deepEqual(byKey.get('tipologia_buscada'), ['2_quartos']);
    assert.equal(raw.length, 6);
  });

  test('extractRawAnswers: valor misto mantém só o valor real', () => {
    const raw = extractRawAnswers([
      { name: 'utm_campaign', values: ['{{campaign.name}}', 'Villa Bianco'] },
    ]);
    assert.equal(raw.length, 1);
    assert.deepEqual(raw[0].values, ['Villa Bianco']);
  });

  test('extractCustomAnswers: placeholders somem das respostas do formulário', () => {
    const custom = extractCustomAnswers(FIELD_DATA);
    assert.equal('utm_campaign' in custom, false);
    assert.equal('placement' in custom, false);
    assert.equal(custom['utm_source'], 'meta_ads');
    assert.equal(custom['objetivo_da_aquisição'], 'investir');
  });
});

// ─────────────────────────────────────────────
// Backfill (notes antigas com placeholders)
// ─────────────────────────────────────────────

describe('parseNotesAnswers descarta placeholders do bloco antigo', () => {
  // notes reais coladas pelo usuário no relato do problema
  const NOTES = [
    '[Meta Ads] Lead recebido automaticamente.',
    'Formulário: Investimento (ID: 123456789)',
    'Lead ID: 987654321',
    '',
    'Respostas do formulário:',
    '  • utm_source: meta_ads',
    '  • utm_medium: lead_form',
    '  • utm_campaign: {{campaign.name}}',
    '  • utm_adset: {{adset.name}}',
    '  • utm_ad: {{ad.name}}',
    '  • placement: {{placement}}',
    '  • objetivo_da_aquisição: investir',
    '  • forma_de_aquisição: financiamento',
    '  • tipologia_buscada: 2_quartos',
    '  • faixa_de_renda_familiar: acima_de_r$_9_mil',
    '  • quando_pode_realizar_uma_visita?: na_próxima_semana',
  ].join('\n');

  test('recupera perguntas e rastreamento real; placeholders somem', () => {
    const parsed = parseNotesAnswers(NOTES);
    const keys = parsed.map((p) => p.key);
    // placeholders não resolvidos: fora (não têm informação nenhuma)
    assert.equal(keys.includes('utm_campaign'), false);
    assert.equal(keys.includes('utm_adset'), false);
    assert.equal(keys.includes('utm_ad'), false);
    assert.equal(keys.includes('placement'), false);
    // rastreamento com valor fixo real: fica (nunca pontua — é filtrado
    // na pontuação/painel; aqui é só recuperação de dados)
    assert.deepEqual(parsed.find((p) => p.key === 'utm_source')?.values, ['meta_ads']);
    assert.deepEqual(parsed.find((p) => p.key === 'utm_medium')?.values, ['lead_form']);
    // perguntas de qualificação: intactas
    assert.deepEqual(
      keys.filter((k) => !['utm_source', 'utm_medium'].includes(k)),
      [
        'objetivo_da_aquisição',
        'forma_de_aquisição',
        'tipologia_buscada',
        'faixa_de_renda_familiar',
        'quando_pode_realizar_uma_visita?',
      ],
    );
  });
});

// ─────────────────────────────────────────────
// Config + pontuação (rastreamento e placeholders não pontuam)
// ─────────────────────────────────────────────

describe('temperatura ignora rastreamento e placeholders', () => {
  const CONFIG_JSON = JSON.stringify({
    questions: [
      {
        key: 'utm_campaign', // config antiga com rastreamento — descartada
        questionScore: 4,
        answers: [{ text: '{{campaign.name}}', score: 7 }],
      },
      {
        key: 'tipologia_buscada',
        answers: [
          { text: '2_quartos', score: 5 },
          { text: '{{adset.name}}', score: 9 }, // lixo pontuado por engano — descartado
        ],
      },
      {
        key: 'faixa_de_renda_familiar',
        answers: [{ text: 'acima_de_r$_9_mil', score: 6 }],
      },
    ],
  });

  const SCORING = {
    enabled: true,
    warmMin: 6,
    hotMin: 11,
    config: parseScoringConfig(CONFIG_JSON),
  };

  test('parseScoringConfig descarta rastreamento e respostas-placeholder', () => {
    assert.ok(SCORING.config);
    assert.deepEqual(
      SCORING.config.questions.map((q) => q.key),
      ['tipologia_buscada', 'faixa_de_renda_familiar'],
    );
    assert.deepEqual(
      SCORING.config.questions[0].answers.map((a) => a.text),
      ['2_quartos'],
    );
  });

  test('lead do exemplo real: só as perguntas pontuam', () => {
    const result = computeLeadScoreFromConfig(
      answers([
        ['utm_source', ['meta_ads']],
        ['utm_medium', ['lead_form']],
        ['utm_campaign', ['{{campaign.name}}']],
        ['placement', ['{{placement}}']],
        ['tipologia_buscada', ['2_quartos']],
        ['faixa_de_renda_familiar', ['acima_de_r$_9_mil']],
      ]),
      SCORING,
    );
    assert.equal(result.score, 11); // 5 + 6
    assert.equal(result.temperature, 'QUENTE');
    assert.deepEqual(
      result.breakdown.map((b) => b.key),
      ['tipologia_buscada', 'faixa_de_renda_familiar'],
    );
  });

  test('resposta só com placeholder não pontua nem recebe questionScore', () => {
    const result = computeLeadScoreFromConfig(
      answers([['tipologia_buscada', ['{{adset.name}}']]]),
      SCORING,
    );
    assert.equal(result.score, 0);
    assert.deepEqual(result.breakdown, []);
  });

  test('valor misto: placeholder ignorado, valor real pontua', () => {
    const result = computeLeadScoreFromConfig(
      answers([['tipologia_buscada', ['{{adset.name}}', '2_quartos']]]),
      SCORING,
    );
    assert.equal(result.score, 5);
  });
});
