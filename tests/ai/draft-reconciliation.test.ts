/**
 * draft-reconciliation.test.ts — Conciliação do rascunho com as decisões
 * humanas no publish (applyDecisionsToDraft).
 *
 * Regressão do relato "o botão de confirmar a edição não funciona": o publish
 * não registrava as decisões no rascunho; ao recarregar o diálogo (decisões
 * locais zeradas), todo crítico com valor aprovado divergente do candidato
 * voltava a "aguardando decisão" — loop infinito de redecisão, afetando os
 * 4 críticos (Preço, Previsão de entrega, Status, Tipologias) e também
 * decisões de rejeição (que preservam o valor anterior ≠ candidato).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDecisionsToDraft,
  criticalsPendingDecision,
  emptyEnterpriseInfo,
  type ExtractionDraft,
  type ExtractionCandidate,
} from '../../src/lib/ai/extraction-core.ts';

function candidate(partial: Partial<ExtractionCandidate>): ExtractionCandidate {
  return {
    field: 'price',
    value: null,
    status: 'found',
    method: 'rule',
    confidence: null,
    evidence: [],
    note: null,
    ...partial,
  };
}

function draftWith(fields: ExtractionCandidate[]): ExtractionDraft {
  return {
    runId: 'run-1',
    documentHash: 'hash-1',
    generatedAt: '2026-09-04T00:00:00.000Z',
    status: 'SUCCEEDED',
    blocksTotal: 1,
    blocksProcessed: 1,
    needsReview: true,
    promptVersion: 'test',
    modelId: 'test',
    fields,
    limitations: [],
  };
}

test('applyDecisionsToDraft: accept/edit/reject marcam o status do candidato decidido', () => {
  const draft = draftWith([
    candidate({ field: 'price', value: 'a partir de R$ 238.858' }),
    candidate({ field: 'deliveryDate', value: 'Abril/2029' }),
    candidate({ field: 'status', value: 'Lançamento' }),
  ]);
  const approved = emptyEnterpriseInfo();
  approved.price = 'R$ 250.000';
  approved.deliveryDate = '31/08/2029';
  approved.status = 'Lançamento';

  const reconciled = applyDecisionsToDraft(draft, [
    { field: 'price', action: 'edit', value: 'R$ 250.000' },
    { field: 'deliveryDate', action: 'edit', value: '31/08/2029' },
    { field: 'status', action: 'accept' },
  ], approved);

  assert.equal(reconciled.fields.find((f) => f.field === 'price')?.status, 'edited');
  assert.equal(reconciled.fields.find((f) => f.field === 'deliveryDate')?.status, 'edited');
  assert.equal(reconciled.fields.find((f) => f.field === 'status')?.status, 'accepted');
  // valores dos candidatos permanecem (rascunho é auditoria da extração)
  assert.equal(reconciled.fields.find((f) => f.field === 'price')?.value, 'a partir de R$ 238.858');
});

test('applyDecisionsToDraft: decisão sobre campo fora do rascunho é ignorada (draft antigo/parcial)', () => {
  const draft = draftWith([candidate({ field: 'price', value: 'R$ 1.000' })]);
  const reconciled = applyDecisionsToDraft(draft, [
    { field: 'deliveryDate', action: 'edit', value: 'Abril/2029' },
  ], null);
  assert.equal(reconciled.fields.length, 1);
  assert.equal(reconciled.fields[0].status, 'found');
});

test('REGRESSÃO do loop: após conciliar, críticos decididos NÃO voltam a exigir decisão (os 4 críticos)', () => {
  const draft = draftWith([
    candidate({ field: 'price', value: 'a partir de R$ 238.858' }),
    candidate({ field: 'deliveryDate', value: 'Abril/2029' }),
    candidate({ field: 'status', value: 'Em Construção' }),
    candidate({ field: 'apartmentTypes', value: [{ name: '1 Quarto', area: '32 m²', bedrooms: '1 quarto', price: 'R$ 238.858', description: null }] }),
  ]);

  // pré-condição do bug: sem decisão e divergente → pendente (mensagem do rodapé)
  const approved = emptyEnterpriseInfo();
  approved.price = 'R$ 250.000';
  approved.deliveryDate = '31/08/2029';
  approved.status = 'Entregue';
  approved.apartmentTypes = [{ name: '1 Quarto', area: '33 m²', bedrooms: '1 quarto', price: 'R$ 250.000', description: null }];
  assert.deepEqual(
    criticalsPendingDecision({ candidates: draft.fields, decisions: [], current: approved }),
    ['price', 'deliveryDate', 'status', 'apartmentTypes'],
    'pré-fix: todos os 4 críticos divergentes pendentes sem decisão',
  );

  // publish concilia: decisões registradas no rascunho → recarregamento do
  // diálogo (decisões locais zeradas) NÃO reexige decisão
  const reconciled = applyDecisionsToDraft(draft, [
    { field: 'price', action: 'edit', value: 'R$ 250.000' },
    { field: 'deliveryDate', action: 'edit', value: '31/08/2029' },
    { field: 'status', action: 'reject' },
    { field: 'apartmentTypes', action: 'edit', value: approved.apartmentTypes },
  ], approved);

  assert.deepEqual(
    criticalsPendingDecision({ candidates: reconciled.fields, decisions: [], current: approved }),
    [],
    'pós-fix: nenhum crítico decidido volta a pendente — fim do loop',
  );
  assert.equal(reconciled.needsReview, false, 'needsReview recalculado = nada pendente');
  // status rejeitado preserva o valor anterior (Entregue mantido) — mesmo assim
  // não reexige decisão
  assert.equal(reconciled.fields.find((f) => f.field === 'status')?.status, 'rejected');
});

test('applyDecisionsToDraft: crítico ainda não decidido mantém pendência no needsReview', () => {
  const draft = draftWith([
    candidate({ field: 'price', value: 'a partir de R$ 238.858' }),
    candidate({ field: 'deliveryDate', value: 'Abril/2029' }),
  ]);
  const approved = emptyEnterpriseInfo();
  approved.price = 'R$ 250.000'; // decisão editada
  // deliveryDate sem decisão e divergente → pendente

  const reconciled = applyDecisionsToDraft(draft, [
    { field: 'price', action: 'edit', value: 'R$ 250.000' },
  ], approved);

  assert.deepEqual(
    criticalsPendingDecision({ candidates: reconciled.fields, decisions: [], current: approved }),
    ['deliveryDate'],
  );
  assert.equal(reconciled.needsReview, true, 'deliveryDate ainda exige decisão');
});

test('applyDecisionsToDraft: draft vazio de decisões não altera statuses; needsReview recalcula', () => {
  const draft = draftWith([candidate({ field: 'totalUnits', value: 291 })]);
  const approved = emptyEnterpriseInfo();
  approved.totalUnits = 291;
  const reconciled = applyDecisionsToDraft(draft, [], approved);
  assert.equal(reconciled.fields[0].status, 'found');
  // totalUnits não é crítico → needsReview false mesmo com draft original true
  assert.equal(reconciled.needsReview, false);
  assert.equal(reconciled.runId, draft.runId, 'restante do draft preservado');
});
