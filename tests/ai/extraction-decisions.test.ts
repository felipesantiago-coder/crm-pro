/**
 * tests/ai/extraction-decisions.test.ts — Regressão do bug "editar não salva":
 * decisão { action: 'edit' } SEM valor (value perdido no JSON / blur não
 * commitado / cliente antigo) NUNCA pode apagar o campo — mantém o valor
 * verificado anterior. `null` explícito continua limpando.
 *
 * Executar: npm test  (usa --import ./tests/ai/register.mjs para os hooks @/)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInfoFromDecisions, emptyEnterpriseInfo } from '../../src/lib/ai/extraction-core.ts';

const CURRENT = {
  location: { address: 'SQPS 103', neighborhood: 'Park Sul', city: 'Brasília', state: 'DF', region: null, additionalInfo: null },
  builder: 'HC Construtora', architecture: null, landscaping: null,
  status: 'Em Construção', deliveryDate: 'Outubro/2027', price: 'a partir de R$ 1.530.142,72',
  totalUnits: 123, floors: 8, parkingSpots: 2,
  differentials: ['Piscina aquecida'],
  apartmentTypes: [
    { name: 'Tipo 2 Quartos', area: '85 m² privativos', bedrooms: '2 dormitórios (2 suítes)', description: null, price: 'a partir de R$ 1.530.142,72' },
  ],
  summary: 'Resumo canônico.',
};

test('edit sem valor (undefined) mantém o preço verificado — nunca grava null', () => {
  const out = buildInfoFromDecisions({ current: structuredClone(CURRENT), candidates: [], decisions: [{ field: 'price', action: 'edit' }] });
  assert.equal(out.price, CURRENT.price);
});

test('edit sem valor (undefined) mantém as tipologias verificadas — nunca grava []', () => {
  const out = buildInfoFromDecisions({ current: structuredClone(CURRENT), candidates: [], decisions: [{ field: 'apartmentTypes', action: 'edit' }] });
  assert.equal(out.apartmentTypes.length, 1);
  assert.equal(out.apartmentTypes[0].name, 'Tipo 2 Quartos');
});

test('edit sem valor mantém arrays e escalares de baixo risco (differentials, totalUnits)', () => {
  const out = buildInfoFromDecisions({ current: structuredClone(CURRENT), candidates: [], decisions: [
    { field: 'differentials', action: 'edit' },
    { field: 'totalUnits', action: 'edit' },
  ] });
  assert.deepEqual(out.differentials, CURRENT.differentials);
  assert.equal(out.totalUnits, 123);
});

test('edit com null explícito limpa o campo (intenção declarada do revisor)', () => {
  const out = buildInfoFromDecisions({ current: structuredClone(CURRENT), candidates: [], decisions: [{ field: 'price', action: 'edit', value: null }] });
  assert.equal(out.price, null);
});

test('edit com novo valor aplica o valor enviado (tipado)', () => {
  const out = buildInfoFromDecisions({ current: structuredClone(CURRENT), candidates: [], decisions: [
    { field: 'price', action: 'edit', value: 'a partir de R$ 1.600.000,00' },
    { field: 'apartmentTypes', action: 'edit', value: [{ name: 'Cobertura', area: '295 m² privativos', bedrooms: '4 dormitórios', description: null, price: 'a partir de R$ 5.450.028,21' }] },
    { field: 'totalUnits', action: 'edit', value: 120 },
  ] });
  assert.equal(out.price, 'a partir de R$ 1.600.000,00');
  assert.equal(out.apartmentTypes.length, 1);
  assert.equal(out.apartmentTypes[0].name, 'Cobertura');
  assert.equal(out.totalUnits, 120);
});

test('base vazia + edit sem valor continua vazia (sem erro, sem lixo)', () => {
  const out = buildInfoFromDecisions({ current: null, candidates: [], decisions: [{ field: 'price', action: 'edit' }, { field: 'apartmentTypes', action: 'edit' }] });
  assert.deepEqual(out, emptyEnterpriseInfo());
});
