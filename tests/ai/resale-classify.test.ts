/**
 * resale-classify.test.ts — Classificação determinística do importador de
 * revenda (prompt v1.0 §13.2/§13.3). Sem IA — comparação campo a campo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRecords,
  summarizeClassification,
  type ResaleRecord,
} from '../../src/lib/ai/resale-classify.ts';

function rec(code: string, overrides: Partial<ResaleRecord> = {}): ResaleRecord {
  return { code, name: `Imóvel ${code}`, region: 'Asa Sul', category: 'Apartamento', price: 350_000, ...overrides };
}

test('registro sem código → erro (não é possível importar com segurança)', () => {
  const out = classifyRecords([{ ...rec('X1'), code: ' ' }], new Map());
  assert.equal(out[0].status, 'erro');
  assert.ok(out[0].reason);
});

test('código inexistente no banco → novo', () => {
  const out = classifyRecords([rec('ABC123')], new Map());
  assert.equal(out[0].status, 'novo');
  assert.deepEqual(out[0].diff, []);
});

test('código idêntico e campos idênticos → inalterado', () => {
  const existing = new Map([['ABC123', rec('ABC123')]]);
  const out = classifyRecords([rec('ABC123')], existing);
  assert.equal(out[0].status, 'inalterado');
});

test('código existente com preço diferente → alterado com diff campo a campo', () => {
  const existing = new Map([['ABC123', rec('ABC123', { price: 320_000, name: 'Nome antigo' })]]);
  const out = classifyRecords([rec('ABC123', { price: 350_000 })], existing);
  assert.equal(out[0].status, 'alterado');
  const fields = out[0].diff.map((d) => d.field);
  assert.ok(fields.includes('price'));
  assert.ok(fields.includes('name'));
  const priceDiff = out[0].diff.find((d) => d.field === 'price');
  assert.equal(priceDiff?.from, '320000');
  assert.equal(priceDiff?.to, '350000');
});

test('mesmo código duas vezes no arquivo → primeira prevalece, demais duplicado', () => {
  const out = classifyRecords([rec('DUP1'), rec('DUP1', { price: 999_999 })], new Map());
  assert.equal(out[0].status, 'novo');
  assert.equal(out[1].status, 'duplicado');
  assert.ok(out[1].reason?.includes('DUP1'));
});

test('trim não gera falso "alterado" (normalização mínima: espaços)', () => {
  const existing = new Map([['N1', rec('N1', { region: 'Asa Sul' })]]);
  const out = classifyRecords([rec('N1', { region: ' Asa Sul ' })], existing);
  assert.equal(out[0].status, 'inalterado');
});

test('resumo do impacto cobre os cinco status (§13.2)', () => {
  const existing = new Map([['ALT', rec('ALT', { price: 1 })], ['IGUAL', rec('IGUAL')]]);
  const out = classifyRecords(
    [rec('NOVO'), rec('ALT'), rec('IGUAL'), rec('DUP'), rec('DUP'), { ...rec(''), code: '' }],
    existing,
  );
  const summary = summarizeClassification(out);
  // "DUP" 1ª ocorrência é importável (novo), 2ª é duplicado
  assert.equal(summary.novo, 2);
  assert.equal(summary.alterado, 1);
  assert.equal(summary.inalterado, 1);
  assert.equal(summary.duplicado, 1);
  assert.equal(summary.erro, 1);
  assert.equal(summary.total, 6);
});
