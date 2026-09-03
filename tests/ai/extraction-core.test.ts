/**
 * extraction-core.test.ts — Núcleo puro da extração revisável
 * (prompt v1.0 §10.3/§10.5/§10.6 e matriz §18.1/§18.3).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chunkDocument,
  rankBlocks,
  consolidateBlocks,
  buildInfoFromDecisions,
  sanitizeEnterpriseInfo,
  emptyEnterpriseInfo,
  computeDocumentHash,
  type DocumentBlock,
} from '../../src/lib/ai/extraction-core.ts';
import type { BlockExtraction } from '../../src/lib/ai/contracts.ts';

function block(partial: Partial<BlockExtraction>): BlockExtraction {
  return blockExtraction(partial);
}

function blockExtraction(partial: Partial<BlockExtraction>): BlockExtraction {
  return {
    location: {
      address: null, neighborhood: null, city: null, state: null, region: null, additionalInfo: null,
      ...(partial.location ?? {}),
    },
    builder: partial.builder ?? null,
    architecture: partial.architecture ?? null,
    landscaping: partial.landscaping ?? null,
    status: partial.status ?? null,
    deliveryDate: partial.deliveryDate ?? null,
    price: partial.price ?? null,
    totalUnits: partial.totalUnits ?? null,
    floors: partial.floors ?? null,
    parkingSpots: partial.parkingSpots ?? null,
    differentials: partial.differentials ?? [],
    apartmentTypes: partial.apartmentTypes ?? [],
    summary: partial.summary ?? null,
  };
}

function meta(n: number, page: number | null = 1): DocumentBlock {
  return { index: n, text: `bloco ${n}`, firstPage: page, lastPage: page, offset: n * 9000 };
}

// ── Chunking ────────────────────────────────────────────────────────────────

test('chunkDocument: documento curto gera 1 bloco', () => {
  const blocks = chunkDocument('conteúdo curto do empreendimento '.repeat(50));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].index, 0);
});

test('chunkDocument: documento longo gera vários blocos com overlap (fim do corte 30k)', () => {
  const long = ('linha de conteúdo imobiliário preço R$ 350.000\n').repeat(1500); // ~60k chars
  const blocks = chunkDocument(long);
  assert.ok(blocks.length >= 2, 'esperava >= 2 blocos');
  assert.ok(blocks.length <= 20);
  // overlap: o início do bloco 2 repete o fim do bloco 1
  const tail = blocks[0].text.slice(-200);
  assert.ok(blocks[1].text.includes(tail.slice(0, 50)));
});

test('chunkDocument: marcadores de página atribuem páginas às evidências', () => {
  const content = 'A\n[--- Página 1 ---]\nB\n\n[--- Página 3 ---]\nC'.repeat(400);
  const blocks = chunkDocument(content);
  assert.ok(blocks.length >= 1);
  assert.equal(blocks[0].firstPage, 1);
});

test('chunkDocument: vazio gera zero blocos', () => {
  assert.deepEqual(chunkDocument(''), []);
  assert.deepEqual(chunkDocument('   \n  '), []);
});

test('rankBlocks prioriza blocos com termos dos campos e blocos finais', () => {
  const early: DocumentBlock = { index: 0, text: 'texto sem nada relevante aqui', firstPage: 1, lastPage: 1, offset: 0 };
  const priceBlock: DocumentBlock = { index: 1, text: 'tabela de preço R$ 500.000 valor venda', firstPage: 5, lastPage: 5, offset: 60_000 };
  const ranked = rankBlocks([early, priceBlock]);
  assert.equal(ranked[0].index, 1);
});

// ── Consolidação ────────────────────────────────────────────────────────────

test('consolidação: valor único → found com evidência do bloco', () => {
  const { fields } = consolidateBlocks(
    [block({ builder: 'Construtora Alfa' }), block({ builder: 'Construtora Alfa' })],
    [meta(0), meta(1, 2)],
    null,
  );
  const builder = fields.find((f) => f.field === 'builder');
  assert.equal(builder?.status, 'found');
  assert.equal(builder?.value, 'Construtora Alfa');
  assert.equal(builder?.evidence.length, 2);
});

test('consolidação: valores divergentes → conflicting, NUNCA resolvidos em silêncio', () => {
  const { fields, needsReview } = consolidateBlocks(
    [block({ price: 'R$ 350.000' }), block({ price: 'R$ 420.000' })],
    [meta(0), meta(1)],
    null,
  );
  const price = fields.find((f) => f.field === 'price');
  assert.equal(price?.status, 'conflicting');
  assert.match(price?.note ?? '', /350\.000/);
  assert.match(price?.note ?? '', /420\.000/);
  assert.equal(needsReview, true);
});

test('consolidação: campo ausente em todos os blocos → missing (sem invenção)', () => {
  const { fields } = consolidateBlocks([block({}), block({})], [meta(0), meta(1)], null);
  const floors = fields.find((f) => f.field === 'floors');
  assert.equal(floors?.status, 'missing');
  assert.equal(floors?.value, null);
});

test('consolidação: região ausente no documento usa fallback do CRM com method=rule', () => {
  const { fields } = consolidateBlocks([block({})], [meta(0)], 'Lago Sul');
  const region = fields.find((f) => f.field === 'location.region');
  assert.equal(region?.status, 'found');
  assert.equal(region?.method, 'rule');
  assert.equal(region?.value, 'Lago Sul');
  assert.match(region?.note ?? '', /cadastro/);
});

test('consolidação: diferenciais unem blocos sem duplicar e limitam a 10', () => {
  const b1 = block({ differentials: ['Piscina', 'Academia', 'Piscina'] });
  const b2 = block({ differentials: ['Academia', 'Coworking', 'Pet Place', 'Salão', 'Churrasqueira', 'Sauna', 'Playground', 'Bicicletário'] });
  const { fields } = consolidateBlocks([b1, b2], [meta(0), meta(1)], null);
  const diff = fields.find((f) => f.field === 'differentials');
  assert.equal(diff?.status, 'found');
  const list = diff?.value as string[];
  assert.equal(new Set(list.map((x) => x.toLowerCase())).size, list.length);
  assert.ok(list.length <= 10);
});

test('consolidação: tipologias com preço divergente para o mesmo nome → needs_review', () => {
  const b1 = block({ apartmentTypes: [{ name: 'Tipo 1', area: '65m²', bedrooms: '2', description: null, price: 'R$ 350.000' }] });
  const b2 = block({ apartmentTypes: [{ name: 'tipo 1', area: '65m²', bedrooms: '2', description: null, price: 'R$ 390.000' }] });
  const { fields, needsReview } = consolidateBlocks([b1, b2], [meta(0), meta(1)], null);
  const types = fields.find((f) => f.field === 'apartmentTypes');
  assert.equal(types?.status, 'needs_review');
  assert.equal(needsReview, true);
  const list = types?.value as Array<{ name: string }>;
  assert.equal(list.length, 1); // merge por nome normalizado
});

// ── Decisões humanas ────────────────────────────────────────────────────────

const draftFields = (overrides: Partial<Record<string, unknown>> = {}) => {
  const base = consolidateBlocks([block({
    builder: 'Nova Construtora', price: 'R$ 400.000', deliveryDate: 'Dez/2027',
    status: 'Lançamento', totalUnits: 100,
    differentials: ['Piscina'],
    apartmentTypes: [{ name: 'Tipo 1', area: '65m²', bedrooms: '2 quartos', description: null, price: 'R$ 400.000' }],
  })], [meta(0)], null);
  return base.fields.map((f) => ({ ...f, ...(overrides[f.field] as object | undefined) }));
};

test('buildInfoFromDecisions: rejeitar mantém valor verificado anterior (§10.5)', () => {
  const current = emptyEnterpriseInfo();
  current.builder = 'Construtora Antiga';
  const out = buildInfoFromDecisions({
    current,
    candidates: draftFields(),
    decisions: [{ field: 'builder', action: 'reject' }],
  });
  assert.equal(out.builder, 'Construtora Antiga');
});

test('buildInfoFromDecisions: edit aplica valor humano; accept aplica sugerido', () => {
  const out = buildInfoFromDecisions({
    current: null,
    candidates: draftFields(),
    decisions: [
      { field: 'builder', action: 'edit', value: 'Editada à mão' },
      { field: 'price', action: 'accept' },
    ],
  });
  assert.equal(out.builder, 'Editada à mão');
  assert.equal(out.price, 'R$ 400.000');
});

test('buildInfoFromDecisions: crítico sem decisão NUNCA é aplicado automaticamente', () => {
  const out = buildInfoFromDecisions({ current: null, candidates: draftFields(), decisions: [] });
  assert.equal(out.price, null);          // crítico
  assert.equal(out.deliveryDate, null);   // crítico
  assert.equal(out.status, null);         // crítico
  assert.equal(out.apartmentTypes.length, 0); // crítico
  assert.equal(out.totalUnits, 100);      // baixo risco found com base vazia
  assert.equal(out.builder, 'Nova Construtora'); // baixo risco
});

test('buildInfoFromDecisions: ausência (missing) não sobrescreve verificado anterior', () => {
  const current = emptyEnterpriseInfo();
  current.deliveryDate = 'Dezembro/2026';
  const candidates = consolidateBlocks([block({ price: 'R$ 1.000.000' })], [meta(0)], null).fields;
  const out = buildInfoFromDecisions({
    current,
    candidates,
    decisions: [{ field: 'deliveryDate', action: 'accept' }], // candidato é missing
  });
  assert.equal(out.deliveryDate, 'Dezembro/2026');
});

test('buildInfoFromDecisions: campo desconhecido é ignorado (política segura)', () => {
  const out = buildInfoFromDecisions({
    current: null,
    candidates: draftFields(),
    decisions: [{ field: 'campoMalicioso', action: 'edit', value: 'injeção' }],
  });
  assert.equal((out as unknown as Record<string, unknown>)['campoMalicioso'], undefined);
});

test('buildInfoFromDecisions: location.* escreve subcampos corretamente', () => {
  const candidates = consolidateBlocks(
    [block({ location: { city: 'Brasília', state: 'DF' } })],
    [meta(0)],
    null,
  ).fields;
  const out = buildInfoFromDecisions({
    current: null,
    candidates,
    decisions: [
      { field: 'location.city', action: 'accept' },
      { field: 'location.state', action: 'edit', value: 'DF' },
    ],
  });
  assert.equal(out.location.city, 'Brasília');
  assert.equal(out.location.state, 'DF');
});

// ── Sanitização ─────────────────────────────────────────────────────────────

test('sanitizeEnterpriseInfo: coerções seguras e descarte de lixo', () => {
  const out = sanitizeEnterpriseInfo({
    location: { city: '  São Paulo ', state: '' },
    totalUnits: '150',
    floors: 12.7,
    price: 12345, // número no lugar de string → descartado
    differentials: ['Piscina', '', 42],
    apartmentTypes: [{ name: 'Tipo', area: 65 }, 'lixo'],
    unknownField: 'descartado',
  });
  assert.equal(out.location.city, 'São Paulo');
  assert.equal(out.location.state, null);
  assert.equal(out.totalUnits, 150);
  assert.equal(out.floors, 12);
  assert.equal(out.price, null);
  assert.deepEqual(out.differentials, ['Piscina']);
  assert.equal(out.apartmentTypes.length, 1);
  assert.equal(out.apartmentTypes[0].area, null); // número não é string → null
  assert.equal((out as unknown as Record<string, unknown>)['unknownField'], undefined);
});

test('sanitizeEnterpriseInfo: entrada nula/corrompida → estrutura vazia válida', () => {
  const out = sanitizeEnterpriseInfo(null);
  assert.equal(out.builder, null);
  assert.deepEqual(out.differentials, []);
});

// ── Hash ────────────────────────────────────────────────────────────────────

test('computeDocumentHash: estável e sensível ao conteúdo', async () => {
  const a = await computeDocumentHash('documento X');
  const b = await computeDocumentHash('documento X');
  const c = await computeDocumentHash('documento Y');
  assert.equal(a, b);
  assert.notEqual(a, c);
});
