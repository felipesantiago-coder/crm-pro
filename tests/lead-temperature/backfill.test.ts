/**
 * lead-temperature-backfill.test.ts — Recuperação de perguntas/respostas
 * de formulários importados ANTES do recurso de temperatura:
 * parsers puros do texto de Client.notes (formId, formName e o bloco
 * "Respostas do formulário:") e do fallback utmCampaign.
 *
 * Os samples reproduzem EXATAMENTE os formatos gravados por
 * import-by-form, import-manual e webhook (meta-lead-utils.formatCustomAnswersText).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNotesFormId,
  parseNotesFormName,
  parseNotesAnswers,
  notesMatchForm,
} from '../../src/lib/lead-temperature-backfill.ts';

// ── Samples reais das rotas de ingestão ────────────────────────

const NOTES_IMPORT = `[Meta Ads] Lead importado por formulário e período.
Lead ID: 1009887766
Form ID: 987654321012345
Campaign ID: 5544332211
Criado em: 2026-08-01T10:00:00-0300

Respostas do formulário:
  • qual_seu_orcamento: Até R$ 500k
  • qual_regiao_de_interesse: Zona Sul
  • quando_pretende_comprar: Nos próximos 3 meses`;

const NOTES_WEBHOOK = `[Meta Ads] Lead recebido automaticamente.
Anúncio: Apartamento Park Sul
Campanha: Campanha Verão 2026
Formulário: Interesse Park Sul (ID: 987654321012345)
Lead ID: 1009887766
CAPI Config: cfg_01

Respostas do formulário:
  • Qual seu orçamento?: Entre R$ 300 e R$ 500 mil
  • Observações: Quero 2 quartos: próximo ao metrô
  • Quando pretende comprar?: Nos próximos 3 meses`;

const NOTES_SEM_FORM = `[Meta Ads] Lead importado manualmente.
Lead ID: 1009887766
Criado em: 2026-08-01T10:00:00-0300`;

// ── parseNotesFormId ────────────────────────────────────────────

test('formId: padrão "Form ID:" da importação por formulário/manual', () => {
  assert.equal(parseNotesFormId(NOTES_IMPORT), '987654321012345');
});

test('formId: padrão "Formulário: Nome (ID: N)" do webhook', () => {
  assert.equal(parseNotesFormId(NOTES_WEBHOOK), '987654321012345');
});

test('formId: notes sem referência, vazias ou null → null', () => {
  assert.equal(parseNotesFormId(NOTES_SEM_FORM), null);
  assert.equal(parseNotesFormId(''), null);
  assert.equal(parseNotesFormId(null), null);
  assert.equal(parseNotesFormId(undefined), null);
});

test('formId: padrão explícito vence o inline quando ambos existem', () => {
  const notes = `${NOTES_WEBHOOK}\nForm ID: 111`;
  assert.equal(parseNotesFormId(notes), '111');
});

// ── parseNotesFormName ─────────────────────────────────────────

test('formName: nome do formulário no padrão do webhook', () => {
  assert.equal(parseNotesFormName(NOTES_WEBHOOK), 'Interesse Park Sul');
});

test('formName: null quando não há padrão "Formulário: Nome (ID)"', () => {
  assert.equal(parseNotesFormName(NOTES_IMPORT), null);
  assert.equal(parseNotesFormName(null), null);
});

// ── parseNotesAnswers ──────────────────────────────────────────

test('respostas: extrai todas as linhas "• pergunta: resposta" do bloco', () => {
  const answers = parseNotesAnswers(NOTES_IMPORT);
  assert.deepEqual(answers, [
    { key: 'qual_seu_orcamento', values: ['Até R$ 500k'] },
    { key: 'qual_regiao_de_interesse', values: ['Zona Sul'] },
    { key: 'quando_pretende_comprar', values: ['Nos próximos 3 meses'] },
  ]);
});

test('respostas: valor com ":" é preservado inteiro (divide só no primeiro)', () => {
  const answers = parseNotesAnswers(NOTES_WEBHOOK);
  const obs = answers.find((a) => a.key === 'Observações');
  assert.deepEqual(obs, { key: 'Observações', values: ['Quero 2 quartos: próximo ao metrô'] });
});

test('respostas: para no fim do bloco (não engola o resto das notes)', () => {
  const notes = `${NOTES_IMPORT}

── Registro interno ──
  • isto_nao_e_resposta: 123`;
  const answers = parseNotesAnswers(notes);
  assert.equal(answers.some((a) => a.key === 'isto_nao_e_resposta'), false);
  assert.equal(answers.length, 3);
});

test('respostas: chaves repetidas acumulam valores sem duplicar', () => {
  const notes = `Respostas do formulário:
  • interesse: Apartamento
  • interesse: Casa`;
  assert.deepEqual(parseNotesAnswers(notes), [
    { key: 'interesse', values: ['Apartamento', 'Casa'] },
  ]);
});

test('respostas: sem bloco ou sem linhas válidas → array vazio', () => {
  assert.deepEqual(parseNotesAnswers(NOTES_SEM_FORM), []);
  assert.deepEqual(parseNotesAnswers(null), []);
  assert.deepEqual(parseNotesAnswers('Respostas do formulário:\n\nPróxima seção'), []);
});

// ── notesMatchForm ─────────────────────────────────────────────

test('match: formId igual nas notes → true; diferente → false', () => {
  assert.ok(notesMatchForm(NOTES_IMPORT, null, '987654321012345'));
  assert.ok(!notesMatchForm(NOTES_IMPORT, null, '999'));
});

test('match: fallback utmCampaign "import_by_form:{formId}" quando notes não citam form', () => {
  assert.ok(notesMatchForm(NOTES_SEM_FORM, 'import_by_form:987654321012345', '987654321012345'));
  assert.ok(!notesMatchForm(NOTES_SEM_FORM, 'import_by_form:999', '987654321012345'));
  assert.ok(!notesMatchForm(NOTES_SEM_FORM, 'meta_ads:Campanha', '987654321012345'));
});

test('match: notes com formId diferente da utm — notes vencem (sem falso positivo)', () => {
  // formId correto vindo da notes: casa (mesmo com utm divergente)
  assert.ok(notesMatchForm(NOTES_IMPORT, 'import_by_form:000', '987654321012345'));
  // notes apontam para outro formulário: utm não deve forçar o match
  assert.ok(!notesMatchForm(NOTES_IMPORT, 'import_by_form:987654321012345', '555'));
});
