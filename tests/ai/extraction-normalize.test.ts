/**
 * extraction-normalize.test.ts — Regressão da falha de produção (2026-09):
 * base de 30k chars → TODOS os blocos falhavam → 502 "nenhum bloco pôde ser
 * processado". Causas: schema Zod estrito derrubava bloco inteiro em
 * near-miss (status "Em obras", inteiro como string, >10 diferenciais,
 * >12 tipologias, strings acima do limite); JSON truncado (finish_reason=
 * length) sem reparo; retries do callAI ignoravam o orçamento de parede.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBlockOutput,
  repairTruncatedJson,
  attemptPlan,
  BLOCK_TIMEOUT_MS,
  MIN_SLICE_MS,
} from '../../src/lib/ai/extraction-core.ts';
import { blockExtractionSchema } from '../../src/lib/ai/contracts.ts';

// ── normalizeBlockOutput × schema (a falha de produção) ─────────────────────

function nearMissRawOutput() {
  return {
    location: {
      // 146 chars — dentro do limite; endereço longo abaixo passa de 300
      address: 'R. das Flores, 123 — Jardim Botânico, Curitiba/PR, CEP 81590-000, próximo ao Parque Barigui, fácil acesso à BR-277 e Av. das Nações, região em franca valorização imobiliária no setor sul da cidade, ao lado de completo polo de serviços, educação e lazer com praças, ciclovias e comércio diversificado a poucos minutos do empreendimento',
      neighborhood: 'Jardim Botânico',
      city: 'Curitiba',
      state: 'Paraná',
      region: 'Região Sul',
      additionalInfo: null,
    },
    builder: 'Construtora Exemplo',
    status: 'Em obras', // fora do enum canônico → derrubava o bloco
    deliveryDate: 'Dezembro/2027',
    price: 'a partir de R$ 450.000',
    totalUnits: '540 unidades', // inteiro como string → derrubava o bloco
    floors: '27',
    parkingSpots: null,
    differentials: Array.from({ length: 14 }, (_, i) => `Diferencial ${i + 1}`), // 14 > 10
    apartmentTypes: Array.from({ length: 13 }, (_, i) => ({
      name: `Tipo ${i + 1}`,
      area: `${45 + i} m²`,
      bedrooms: `${(i % 4) + 1} dormitórios`,
      description: `Descrição da planta ${i + 1}`,
      price: `R$ ${450 + i}.000`,
    })), // 13 > 12
    summary: 'x'.repeat(320), // > 300
  };
}

test('normalizeBlockOutput: near-miss denso normaliza e PASSA no schema (bug de produção)', () => {
  const parsed = blockExtractionSchema.safeParse(normalizeBlockOutput(nearMissRawOutput()));
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.status, 'Em Construção');
    assert.equal(parsed.data.totalUnits, 540);
    assert.equal(parsed.data.floors, 27);
    assert.equal(parsed.data.differentials.length, 10);
    assert.equal(parsed.data.apartmentTypes.length, 12);
    assert.ok(parsed.data.summary!.length <= 300);
    assert.ok(parsed.data.location.address.length <= 300);
  }
});

test('normalizeBlockOutput: valores válidos permanecem VERBATIM', () => {
  const raw = {
    status: 'Entregue',
    price: 'a partir de R$ 350.000',
    deliveryDate: '2º semestre de 2027',
    differentials: ['Piscina aquecida', 'Coworking'],
    apartmentTypes: [{ name: 'Studio', area: '28-34 m²', bedrooms: null, description: null, price: null }],
    summary: 'Empreendimento pronto para morar.',
  };
  const out = normalizeBlockOutput(raw) as Record<string, unknown>;
  assert.equal(out.status, 'Entregue');
  assert.equal(out.price, 'a partir de R$ 350.000');
  assert.equal(out.deliveryDate, '2º semestre de 2027');
  assert.deepEqual(out.differentials, ['Piscina aquecida', 'Coworking']);
  assert.deepEqual(out.apartmentTypes, [{ name: 'Studio', area: '28-34 m²', bedrooms: null, description: null, price: null }]);
  assert.equal(out.summary, 'Empreendimento pronto para morar.');
});

test('normalizeBlockOutput: sinônimos de status → enum canônico', () => {
  const cases: Array<[string, string | null]> = [
    ['Em obras', 'Em Construção'],
    ['em construção', 'Em Construção'],
    ['Em Construção', 'Em Construção'], // canônico intacto
    ['Obras iniciadas', 'Em Construção'],
    ['Pré-Lançamento', 'Lançamento'],
    ['na planta', 'Lançamento'],
    ['Entregue', 'Entregue'],
    ['pronto para morar', 'Entregue'],
    ['Habite-se emitido', 'Entregue'],
    ['Fase futura indefinida', null],
    ['', null],
  ];
  for (const [input, expected] of cases) {
    const out = normalizeBlockOutput({ status: input }) as Record<string, unknown>;
    assert.equal(out.status, expected, `status "${input}" → ${expected}`);
  }
});

test('normalizeBlockOutput: inteiro inválido → null (nunca inventa)', () => {
  const out = normalizeBlockOutput({ totalUnits: 'não informado', floors: null, parkingSpots: -5 }) as Record<string, unknown>;
  assert.equal(out.totalUnits, null);
  assert.equal(out.floors, null);
  assert.equal(out.parkingSpots, 0); // -5 → floor(0) — não negativo
});

test('normalizeBlockOutput: tipologias sem nome são descartadas; strings cortadas ao limite', () => {
  const out = normalizeBlockOutput({
    apartmentTypes: [
      { name: '   ', area: '40 m²' },                    // sem nome → descartada
      { name: 'Tipo Válido', area: 'x'.repeat(50), price: 'y'.repeat(200) },
      { description: 'z'.repeat(500), name: 'Outro' },
    ],
    builder: 'b'.repeat(250),
    deliveryDate: 'd'.repeat(150),
  }) as Record<string, unknown>;
  const types = out.apartmentTypes as Array<Record<string, unknown>>;
  assert.equal(types.length, 2);
  assert.equal(types[0].name, 'Tipo Válido');
  assert.ok((types[0].area as string).length <= 40);
  assert.ok((types[0].price as string).length <= 160);
  assert.ok((types[1].description as string).length <= 400);
  assert.equal((out.builder as string).length, 200);
  assert.equal((out.deliveryDate as string).length, 120);
});

test('normalizeBlockOutput: entrada não-objeto permanece inválida para o schema', () => {
  for (const garbage of [null, 'texto livre', ['array'], 42]) {
    const out = normalizeBlockOutput(garbage);
    assert.equal(blockExtractionSchema.safeParse(out).success, false, `entrada ${JSON.stringify(garbage)} deve falhar`);
  }
});

// ── repairTruncatedJson (finish_reason=length) ──────────────────────────────

test('repairTruncatedJson: JSON válido parseia sem alteração', () => {
  assert.deepEqual(repairTruncatedJson('{"a": 1, "b": ["x"]}'), { a: 1, b: ['x'] });
});

test('repairTruncatedJson: JSON truncado no fim do array é fechado', () => {
  const out = repairTruncatedJson('{"status":"Em Construção","differentials":["A","B"');
  assert.deepEqual(out, { status: 'Em Construção', differentials: ['A', 'B'] });
});

test('repairTruncatedJson: JSON truncado no meio de string é fechado', () => {
  const out = repairTruncatedJson('{"summary":"Apartamentos amplos com varanda gourmet');
  assert.deepEqual(out, { summary: 'Apartamentos amplos com varanda gourmet' });
});

test('repairTruncatedJson: vírgula pendente é descartada', () => {
  const out = repairTruncatedJson('{"a":1,}');
  assert.deepEqual(out, { a: 1 });
});

test('repairTruncatedJson: lixo irrecuperável → null (bloco conta como falha, nunca "válido vazio")', () => {
  assert.equal(repairTruncatedJson('texto livre sem json algum'), null);
  assert.equal(repairTruncatedJson(''), null);
});

// ── attemptPlan (orçamento de parede × retries) ─────────────────────────────

test('attemptPlan: orçamento de request cheio reserva 2 tentativas com timeout cheio (30+1+30=61s ≤ 100s)', () => {
  const plan = attemptPlan(100_000);
  assert.equal(plan.timeoutMs, BLOCK_TIMEOUT_MS);
  assert.equal(plan.retries, 2); // respostas vazias transientes recuperadas na 2ª tentativa
});

test('attemptPlan: orçamento antigo de 48s divide o tempo em 2 tentativas de 23,5s', () => {
  const plan = attemptPlan(48_000);
  assert.deepEqual(plan, { timeoutMs: 23_500, retries: 2 }); // (48000-1000)/2 — nunca estoura o prazo
});

test('attemptPlan: orçamento estendido mantém o teto de timeout', () => {
  const plan = attemptPlan(65_000);
  assert.equal(plan.timeoutMs, BLOCK_TIMEOUT_MS);
  assert.equal(plan.retries, 2);
});

test('attemptPlan: fatia média divide o tempo em 2 tentativas', () => {
  const plan = attemptPlan(30_000);
  assert.deepEqual(plan, { timeoutMs: 14_500, retries: 2 }); // (30000-1000)/2
});

test('attemptPlan: fatia curta demais para 2 tentativas úteis → 1 tentativa com o restante', () => {
  const plan = attemptPlan(12_000);
  assert.deepEqual(plan, { timeoutMs: 12_000, retries: 1 });
});

test('attemptPlan: abaixo do mínimo não inicia bloco', () => {
  const plan = attemptPlan(MIN_SLICE_MS - 1);
  assert.deepEqual(plan, { timeoutMs: 0, retries: 0 });
});
