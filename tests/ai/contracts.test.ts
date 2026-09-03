/**
 * contracts.test.ts — Contratos estruturados do Nexo (prompt v1.0 §8.2/§9.2).
 * Validação no servidor com Zod — o tipo TS não é a garantia.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clientBriefSchema,
  buildNexoResultSchema,
  blockExtractionSchema,
  enterpriseInfoSchema,
  nexoActionSchema,
  nexoEvidenceSchema,
} from '../../src/lib/ai/contracts.ts';

const validBrief = {
  summary: 'Cliente no estágio Visita Agendada com histórico de 3 interações.',
  risks: [{ label: 'Visita sem retorno', evidence: 'Última interação há 12 dias' }],
  pendingItems: [{ label: 'Enviar tabela atualizada' }],
  suggestedQuestions: ['Como foi a visita?'],
  suggestedActions: [{
    label: 'Preparar rascunho de lembrete',
    actionType: 'DRAFT_REMINDER',
    rationale: 'Pendência registrada sem prazo',
    requiresConfirmation: true,
  }],
  limitations: ['Amostra das 15 últimas interações'],
};

test('clientBriefSchema aceita brief válido completo', () => {
  const parsed = clientBriefSchema.safeParse(validBrief);
  assert.equal(parsed.success, true);
});

test('clientBriefSchema aplica defaults e REJEITA mais de 3 ações (máx do contrato)', () => {
  const four = clientBriefSchema.safeParse({
    summary: 'ok',
    suggestedActions: [
      { label: 'a', actionType: 'OPEN_CHAT', rationale: 'r', requiresConfirmation: false },
      { label: 'b', actionType: 'OPEN_CHAT', rationale: 'r', requiresConfirmation: false },
      { label: 'c', actionType: 'OPEN_CHAT', rationale: 'r', requiresConfirmation: false },
      { label: 'd', actionType: 'OPEN_CHAT', rationale: 'r', requiresConfirmation: false },
    ],
  });
  assert.equal(four.success, false); // schema estrito rejeita, não corta

  const three = clientBriefSchema.safeParse({
    summary: 'ok',
    suggestedActions: [
      { label: 'a', actionType: 'OPEN_CHAT', rationale: 'r', requiresConfirmation: false },
      { label: 'b', actionType: 'OPEN_CHAT', rationale: 'r', requiresConfirmation: false },
      { label: 'c', actionType: 'OPEN_CHAT', rationale: 'r', requiresConfirmation: false },
    ],
  });
  if (!three.success) assert.fail('três ações deveriam validar');
  assert.equal(three.data.risks.length, 0); // default []
  assert.equal(three.data.suggestedActions.length, 3);
});

test('clientBriefSchema rejeita actionType desconhecido (política de ações)', () => {
  const parsed = clientBriefSchema.safeParse({
    summary: 'ok',
    suggestedActions: [{ label: 'x', actionType: 'SEND_WHATSAPP', rationale: 'r', requiresConfirmation: false }],
  });
  assert.equal(parsed.success, false);
});

test('clientBriefSchema rejeita summary vazio', () => {
  const parsed = clientBriefSchema.safeParse({ ...validBrief, summary: '' });
  assert.equal(parsed.success, false);
});

test('NexoResult envelope valida status canônicos e evidências', () => {
  const schema = buildNexoResultSchema(clientBriefSchema);
  const ok = schema.safeParse({
    status: 'partial',
    data: validBrief,
    evidence: [{ sourceType: 'crm_record', label: 'Cliente #1', excerpt: '...', page: 2 }],
    limitations: ['amostra'],
    generatedAt: new Date().toISOString(),
    dataVersion: 'abc',
    promptVersion: 'brief-v2',
    actions: [{ type: 'OPEN_CHAT', label: 'Abrir', requiresConfirmation: false }],
  });
  assert.equal(ok.success, true);

  const bad = schema.safeParse({
    status: 'alucinado',
    data: validBrief,
    limitations: [],
    generatedAt: new Date().toISOString(),
    dataVersion: 'abc',
    promptVersion: 'brief-v2',
    actions: [],
  });
  assert.equal(bad.success, false);
});

test('blockExtractionSchema: campos ausentes viram null/[] (nunca undefined)', () => {
  const parsed = blockExtractionSchema.safeParse({});
  if (!parsed.success) assert.fail('bloco vazio deveria validar (tudo null)');
  assert.equal(parsed.data.builder, null);
  assert.deepEqual(parsed.data.differentials, []);
  assert.deepEqual(parsed.data.location.address, null);
});

test('blockExtractionSchema rejeita status fora do enum do domínio', () => {
  const parsed = blockExtractionSchema.safeParse({ status: 'Pronto' });
  assert.equal(parsed.success, false);
});

test('enterpriseInfoSchema valida estrutura legada equivalente', () => {
  const info = {
    location: { address: 'SHS', neighborhood: null, city: 'Brasília', state: 'DF', region: null, additionalInfo: null },
    builder: 'Construtora X', architecture: null, landscaping: null,
    status: 'Lançamento', deliveryDate: 'Dezembro/2026', price: 'a partir de R$ 350.000',
    totalUnits: 200, floors: 20, parkingSpots: 300,
    differentials: ['Piscina', 'Academia'],
    apartmentTypes: [{ name: 'Tipo 1', area: '65m²', bedrooms: '2 quartos', description: null, price: 'R$ 350.000' }],
    summary: null,
  };
  assert.equal(enterpriseInfoSchema.safeParse(info).success, true);
});

test('evidence/action: campos obrigatórios e limites', () => {
  assert.equal(nexoEvidenceSchema.safeParse({ sourceType: 'document', label: 'doc.pdf' }).success, true);
  assert.equal(nexoEvidenceSchema.safeParse({ sourceType: 'document' }).success, false); // label obrigatório
  assert.equal(nexoActionSchema.safeParse({ type: 'NAVIGATE', label: 'Ir', requiresConfirmation: false }).success, true);
  assert.equal(nexoActionSchema.safeParse({ type: 'NAVIGATE', label: 'Ir', requiresConfirmation: 'sim' }).success, false);
});
