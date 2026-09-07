/**
 * Testes do filtro "SOMENTE PERGUNTAS pontuam" da temperatura de leads.
 * Dados de contato do Meta (nome, e-mail, telefone, cidade, CEP, estado,
 * data de nascimento, gênero, compliance...) NUNCA são perguntas:
 *   - extração (extractRawAnswers / extractCustomAnswers) os descarta;
 *   - backfill (parseNotesAnswers) não os recupera das notes antigas;
 *   - config (parseScoringConfig) descarta perguntas que são contato;
 *   - pontuação (computeLeadScoreFromConfig) os ignora MESMO configurados.
 *
 * Rodar: npm test (ou: node --test --import ./tests/ai/register.mjs tests/lead-temperature/contact-fields.test.ts)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractRawAnswers,
  extractCustomAnswers,
  isMetaContactField,
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
// isMetaContactField
// ─────────────────────────────────────────────

describe('isMetaContactField', () => {
  test('reconhece as chaves canônicas do field_data do Meta', () => {
    const canonical = [
      'full_name', 'first_name', 'last_name',
      'email', 'work_email',
      'phone_number', 'work_phone_number',
      'street_address', 'city', 'state', 'zip_code', 'country',
      'dob', 'gender', 'marital_status', 'military_status', 'education',
      'company_name', 'job_name', 'job_role',
      'custom_disclaimer', 'calendar_event', 'store_code',
    ];
    for (const key of canonical) {
      assert.equal(isMetaContactField(key), true, `esperava contato: ${key}`);
    }
  });

  test('reconhece variantes PT-BR e normaliza caixa/espaço/underscore/hífen', () => {
    assert.equal(isMetaContactField('Nome'), true);
    assert.equal(isMetaContactField('NOME_COMPLETO'), true);
    assert.equal(isMetaContactField('  E-Mail '), true);
    assert.equal(isMetaContactField('TELEFONE'), true);
    assert.equal(isMetaContactField('Celular'), true);
    assert.equal(isMetaContactField('CIDADE'), true);
    assert.equal(isMetaContactField('Estado'), true);
    assert.equal(isMetaContactField('CEP'), true);
    assert.equal(isMetaContactField('endereço'), true);
    assert.equal(isMetaContactField('Data_de-Nascimento'), true);
    assert.equal(isMetaContactField('Gênero'), true);
    assert.equal(isMetaContactField('Empresa'), true);
    assert.equal(isMetaContactField('CARGO'), true);
    assert.equal(isMetaContactField('Custom Disclaimer'), true);
  });

  test('perguntas legítimas do formulário NÃO são contato', () => {
    const questions = [
      'Qual é o seu orçamento?',
      'Quando pretende comprar?',
      'Possui corretor de confiança?',
      'Bairro de interesse',
      'Qual o seu WhatsApp?',
      'Quantos quartos deseja?',
      'tipo_de_imovel',
      'Faixa de idade do titular',
    ];
    for (const key of questions) {
      assert.equal(isMetaContactField(key), false, `esperava PERGUNTA: ${key}`);
    }
    assert.equal(isMetaContactField(''), false);
  });
});

// ─────────────────────────────────────────────
// Extração (field_data → respostas/notes)
// ─────────────────────────────────────────────

describe('extração descarta dados de contato', () => {
  // field_data típico de formulário com seção de contato obrigatória
  // (nome, e-mail, telefone, cidade, CEP, estado, nascimento, gênero,
  // termo de aceite) + perguntas de qualificação
  const FIELD_DATA = [
    { name: 'full_name', values: ['Mariana Alves'] },
    { name: 'first_name', values: ['Mariana'] },
    { name: 'last_name', values: ['Alves'] },
    { name: 'email', values: ['mariana@example.com'] },
    { name: 'phone_number', values: ['61999990000'] },
    { name: 'city', values: ['Brasília'] },
    { name: 'zip_code', values: ['71215-200'] },
    { name: 'state', values: ['DF'] },
    { name: 'street_address', values: ['SQN 114 Bloco B'] },
    { name: 'dob', values: ['1990-04-12'] },
    { name: 'gender', values: ['Feminino'] },
    { name: 'custom_disclaimer', values: ['1'] },
    { name: 'Qual é o seu orçamento?', values: ['Acima de R$ 800 mil'] },
    { name: 'tipo_de_imovel', values: ['Casa', 'Apartamento'] },
  ];

  test('extractRawAnswers devolve apenas perguntas (todos os valores)', () => {
    const raw = extractRawAnswers(FIELD_DATA);
    assert.deepEqual(
      raw.map((r) => r.key),
      ['Qual é o seu orçamento?', 'tipo_de_imovel'],
    );
    assert.deepEqual(raw[1].values, ['Casa', 'Apartamento']);
  });

  test('extractCustomAnswers devolve apenas perguntas', () => {
    const custom = extractCustomAnswers(FIELD_DATA);
    assert.deepEqual(Object.keys(custom), ['Qual é o seu orçamento?', 'tipo_de_imovel']);
  });
});

// ─────────────────────────────────────────────
// Backfill (notes antigas → perguntas)
// ─────────────────────────────────────────────

describe('parseNotesAnswers descarta contato do bloco antigo', () => {
  const NOTES = [
    '[Meta Ads] Lead importado por formulário e período.',
    'Form ID: 123456789',
    'Lead ID: 987654321',
    '',
    'Respostas do formulário:',
    '  • Nome: Mariana Alves',
    '  • email: mariana@example.com',
    '  • Telefone: 61999990000',
    '  • CEP: 71215-200',
    '  • Estado: DF',
    '  • Data_de_Nascimento: 1990-04-12',
    '  • Gênero: Feminino',
    '  • custom_disclaimer: 1',
    '  • Qual é o seu orçamento?: Acima de R$ 800 mil',
    '  • Quando pretende comprar?: Em 3 meses',
  ].join('\n');

  test('recupera somente as perguntas, mesmo com contato no bloco', () => {
    const parsed = parseNotesAnswers(NOTES);
    assert.deepEqual(
      parsed.map((p) => p.key),
      ['Qual é o seu orçamento?', 'Quando pretende comprar?'],
    );
  });
});

// ─────────────────────────────────────────────
// Config + pontuação (somente perguntas pontuam)
// ─────────────────────────────────────────────

describe('config e pontuação ignoram campos de contato', () => {
  // Config salva ANTES do filtro: contém contato com notas e até
  // questionScore — nada disso pode valer pontos
  const CONFIG_JSON = JSON.stringify({
    questions: [
      {
        key: 'zip_code',
        questionScore: 3, // nem nota fixa por resposta recebida pode valer
        answers: [{ text: '71215-200', score: 5 }],
      },
      {
        key: 'gender',
        answers: [{ text: 'Feminino', score: 2 }],
      },
      {
        key: 'Quando pretende comprar?',
        answers: [{ text: 'Neste mês', score: 8 }],
      },
    ],
  });

  const SCORING = {
    enabled: true,
    warmMin: 6,
    hotMin: 12,
    config: parseScoringConfig(CONFIG_JSON),
  };

  test('parseScoringConfig descarta perguntas que são dados de contato', () => {
    assert.ok(SCORING.config);
    assert.deepEqual(
      SCORING.config.questions.map((q) => q.key),
      ['Quando pretende comprar?'],
    );
  });

  test('respostas de contato não pontuam nem entram no detalhamento', () => {
    const result = computeLeadScoreFromConfig(
      answers([
        ['zip_code', ['71215-200']],      // configurada com 5 pts — ignorada
        ['gender', ['Feminino']],          // configurada com 2 pts — ignorada
        ['full_name', ['Mariana Alves']],  // contato sem config — ignorada
        ['Quando pretende comprar?', ['Neste mês']],
      ]),
      SCORING,
    );
    assert.equal(result.score, 8);
    assert.equal(result.temperature, 'MORNO');
    assert.deepEqual(
      result.breakdown.map((b) => b.key),
      ['Quando pretende comprar?'],
    );
  });

  test('contato configurado como dissertativa não recebe questionScore', () => {
    // zip_code tinha questionScore: 3 — lead com CEP preenchido NÃO pontua
    const result = computeLeadScoreFromConfig(
      answers([['zip_code', ['01310-000']]]),
      SCORING,
    );
    assert.equal(result.score, 0);
    assert.deepEqual(result.breakdown, []);
  });

  test('pergunta legítima com contato no meio da lista pontua normalmente', () => {
    const parsed = parseScoringConfig(JSON.stringify({
      questions: [
        { key: 'email', answers: [{ text: 'x', score: 10 }] },   // descartada
        { key: 'Possui corretor?', answers: [{ text: 'Sim', score: 4 }] },
        { key: 'Cidade', answers: [{ text: 'São Paulo', score: 7 }] }, // descartada
      ],
    }));
    assert.ok(parsed);
    assert.equal(parsed.questions.length, 1);
    const result = computeLeadScoreFromConfig(
      answers([['Possui corretor?', ['Sim']]]),
      { enabled: true, warmMin: 3, hotMin: 9, config: parsed },
    );
    assert.equal(result.score, 4);
    assert.equal(result.temperature, 'MORNO');
  });
});
