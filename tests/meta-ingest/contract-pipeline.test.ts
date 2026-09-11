/**
 * contract-pipeline.test.ts — CONTRATOS do processamento de leads Meta
 * (regra 10 do prompt de otimização: testar o comportamento ANTES de
 * alterá-lo). O pipeline foi extraído VERBATIM do webhook e do polling;
 * estes testes fixam o contrato observável de cada canal:
 *
 *   webhook: dedup telefone/email primeiro (cartão returning_lead),
 *            depois metaLeadgenId ('dedup'/'already_processed'); textos
 *            "[Meta Ads]"; LostLead sem token; create_failed não propaga;
 *            admin com fallback 'Desconhecido'; cartão SEM empreendimento.
 *   polling: dedup metaLeadgenId primeiro ('já_existente', sem interação),
 *            depois contato ('cliente_existente_atualizado', SEM fila e
 *            SEM notificação); textos "[Meta Polling]"; nota "Criado em";
 *            empreendimento resolvido com clientId; create PROPAGA erro;
 *            admin com fallback '?'.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  isValidSignature,
  processMetaLead,
  type MetaIngestDb,
  type MetaIngestServices,
  type MetaLeadPipelineInput,
  type ClientRecord,
} from '../../src/lib/meta-ingest/pipeline.ts';

// ── Fakes ────────────────────────────────────────────────────────

interface CreatedData {
  name: string;
  metaLeadgenId?: string;
  notes?: string;
  metaScore?: number;
  metaTemperature?: string;
  metaFormId?: string;
  phone?: string;
  email?: string;
}

interface FakeState {
  clients: Array<ClientRecord & { metaLeadgenId?: string }>;
  creates: CreatedData[];
  interactions: Array<{ clientId: string; description: string }>;
  lostLeads: Array<{ source: string; name: string; formData: unknown }>;
  formMappingUpserts: number;
  campaignBindings: Array<{ campaignId: string; adAccountId: string | null }>;
  updates: Array<{ id: string; data: Record<string, unknown> }>;
  enterpriseCalls: Array<{ clientId?: string | null; hasClientId: boolean }>;
  agentCards: Array<{ eventId: string; eventKind: string; ingestionMethod: string; hasEnterprise: boolean }>;
  adminNotices: Array<{ source: string; assignedUserName: string; nextUserName: string | null }>;
  graphFetches: string[];
}

function makeState(): FakeState {
  return {
    clients: [], creates: [], interactions: [], lostLeads: [], formMappingUpserts: 0,
    campaignBindings: [], updates: [], enterpriseCalls: [], agentCards: [], adminNotices: [], graphFetches: [],
  };
}

function makeDb(state: FakeState): MetaIngestDb {
  let idSeq = 0;
  const nextId = () => `c${++idSeq}`;
  return {
    client: {
      async findUnique(args) {
        const hit = state.clients.find((c) => c.metaLeadgenId === args.where.metaLeadgenId);
        return hit ? { id: hit.id, name: hit.name } : null;
      },
      async findFirst(args) {
        const w = args.where as { OR?: Array<{ phone?: string; email?: string }>; phone?: string; email?: string };
        const conds = w.OR ?? [w];
        const matches = state.clients.filter((c) =>
          conds.some((cond) => (cond.phone && c.phone === cond.phone) || (cond.email && c.email === cond.email)),
        );
        return matches[matches.length - 1] ?? null; // orderBy createdAt desc
      },
      async update(args) {
        state.updates.push({ id: args.where.id, data: args.data });
        return {};
      },
      async create(args) {
        state.creates.push(args.data);
        const rec: ClientRecord & { metaLeadgenId?: string } = {
          id: nextId(),
          name: args.data.name,
          phone: args.data.phone ?? null,
          email: args.data.email ?? null,
          metaLeadgenId: args.data.metaLeadgenId,
        };
        state.clients.push(rec);
        return rec;
      },
    },
    interaction: {
      async create(args) {
        state.interactions.push(args.data);
        return {};
      },
    },
    user: {
      async findUnique(args) {
        return args.where.id === 'user-2' ? { telegramChatId: 'chat-2', name: 'Corretor QA' } : null;
      },
      async findFirst() {
        return { telegramChatId: 'chat-admin' };
      },
    },
    metaCapConfig: {
      async findFirst() {
        return null;
      },
    },
    leadFormMapping: {
      async upsert() {
        state.formMappingUpserts++;
        return {};
      },
    },
    lostLead: {
      async create(args) {
        state.lostLeads.push(args.data);
        return {};
      },
    },
  };
}

function makeServices(state: FakeState, opts?: { graphFails?: boolean }): MetaIngestServices {
  const db = makeDb(state);
  return {
    db,
    async assignLead() {
      return { assigned: true, userId: 'user-2', userName: 'Corretor QA', queueId: 'queue-1' };
    },
    async peekNext() {
      return { userName: 'Próximo' };
    },
    async notifyAgent(input) {
      state.agentCards.push({
        eventId: input.eventId,
        eventKind: String(input.eventKind),
        ingestionMethod: input.source.ingestionMethod,
        hasEnterprise: input.resolvedEnterprise != null,
      });
      return { ok: true, status: 'sent', messages: [], attempts: 1 };
    },
    async notifyAdminQueue(_chatId, payload) {
      state.adminNotices.push({
        source: payload.source,
        assignedUserName: payload.assignedUserName,
        nextUserName: payload.nextUserName,
      });
      return true;
    },
    async resolveEnterprise(input) {
      state.enterpriseCalls.push({ clientId: input.clientId ?? null, hasClientId: input.clientId != null });
      return { name: 'Empreendimento X' };
    },
    async buildTemperature(formId) {
      return formId ? { metaFormId: formId, metaScore: 5, metaTemperature: 'MORNO' } : {};
    },
    async findCapConfig() {
      return null;
    },
    async resolveRoute() {
      return { queueId: 'queue-1', queueName: 'Fila QA', routeSource: 'campaign_binding' };
    },
    campaignBindingAuto(input) {
      state.campaignBindings.push({ campaignId: input.campaignId, adAccountId: input.adAccountId ?? null });
    },
    async fetchLeadData(leadgenId) {
      state.graphFetches.push(leadgenId);
      if (opts?.graphFails) return null;
      return [{ name: 'full_name', values: ['Lead Graph'] }];
    },
  };
}

/** Substitui client.create por uma falha (contratos de erro). */
function withCreateFailure(services: MetaIngestServices): MetaIngestServices {
  return {
    ...services,
    db: {
      ...services.db,
      client: {
        ...services.db.client,
        async create(): Promise<ClientRecord> {
          throw new Error('boom no create');
        },
      },
    },
  };
}

function webhookInput(extra?: Partial<MetaLeadPipelineInput>): MetaLeadPipelineInput {
  return {
    channel: 'webhook',
    leadgenId: 'LG-1',
    fieldData: [
      { name: 'full_name', values: ['Maria Silva'] },
      { name: 'email', values: ['maria@test.com'] },
      { name: 'phone_number', values: ['11999998888'] },
    ],
    createdTimeRaw: 1_700_000_000,
    rawAdName: 'Anúncio Vitta',
    campaignId: 'camp-1',
    campaignName: 'Campanha Vitta',
    formId: 'form-1',
    formName: 'Form Vitta',
    adAccountDbId: 'acc-1',
    adAccountName: 'Conta QA',
    pageToken: null,
    creatorId: 'user-1',
    reqId: 'r1',
    ...extra,
  };
}

function pollingInput(extra?: Partial<MetaLeadPipelineInput>): MetaLeadPipelineInput {
  return {
    channel: 'polling',
    leadgenId: 'LG-2',
    fieldData: [{ name: 'full_name', values: ['João Poll'] }],
    createdTimeRaw: '2026-09-11T10:00:00-03:00',
    rawAdName: 'Anúncio Poll',
    campaignId: 'camp-2',
    campaignName: 'Campanha Poll',
    formId: 'form-2',
    formName: 'Form Poll',
    adAccountDbId: 'acc-1',
    adAccountName: 'Conta QA',
    creatorId: 'user-1',
    preResolvedRoute: { queueId: 'queue-1', routeSource: 'form_mapping' },
    ...extra,
  };
}

// ── isValidSignature (movido verbatim do webhook) ────────────────

test('isValidSignature: assinatura HMAC-SHA256 válida do Meta é aceita', () => {
  const body = '{"object":"page","entry":[]}';
  const sig = 'sha256=' + crypto.createHmac('sha256', 'secret-x').update(body, 'utf8').digest('hex');
  assert.equal(isValidSignature(body, sig, 'secret-x'), true);
});

test('isValidSignature: corpo alterado, secret errado, header ausente → rejeitados', () => {
  const body = '{"object":"page"}';
  const sig = 'sha256=' + crypto.createHmac('sha256', 'secret-x').update(body + ' ', 'utf8').digest('hex');
  assert.equal(isValidSignature(body, sig, 'secret-x'), false);
  assert.equal(isValidSignature(body, 'sha256=deadbeef', 'secret-x'), false);
  assert.equal(isValidSignature(body, null, 'secret-x'), false);
  assert.equal(isValidSignature(body, sig, ''), false);
});

// ── WEBHOOK — lead novo ──────────────────────────────────────────

test('webhook lead novo: nota/interação exatas, fila meta_ads:..., cartão SEM empreendimento, mapping alimentado', async () => {
  const state = makeState();
  const out = await processMetaLead(makeServices(state), webhookInput());

  assert.equal(out.imported, true);
  assert.equal(out.success, true);
  assert.equal(out.clientName, 'Maria Silva');

  // Nota EXATA do webhook (com CAPI ausente, sem "Criado em")
  assert.equal(
    state.creates[0].notes,
    '[Meta Ads] Lead recebido automaticamente.\nAnúncio: Anúncio Vitta\nCampanha: Campanha Vitta\nFormulário: Form Vitta (ID: form-1)\nLead ID: LG-1',
  );
  // Temperatura gravada no cliente
  assert.equal(state.creates[0].metaScore, 5);
  assert.equal(state.creates[0].metaTemperature, 'MORNO');

  // Interação inicial EXATA
  assert.equal(state.interactions.length, 1);
  assert.equal(
    state.interactions[0].description,
    '[Meta Ads] Cliente criado automaticamente via lead do anúncio "Anúncio Vitta" (campanha: Campanha Vitta). Origem: Facebook/Instagram Lead Ads.',
  );

  // Fila: source com formato webhook + fallback 'Desconhecido' no admin
  assert.equal(state.adminNotices.length, 1);
  assert.equal(state.adminNotices[0].source, 'meta_ads:Campanha Vitta');
  assert.equal(state.adminNotices[0].assignedUserName, 'Corretor QA');

  // Cartão do agente: new_lead + ingestionMethod webhook + SEM empreendimento
  assert.equal(state.agentCards.length, 1);
  assert.equal(state.agentCards[0].eventKind, 'new_lead');
  assert.equal(state.agentCards[0].ingestionMethod, 'webhook');
  assert.equal(state.agentCards[0].hasEnterprise, false);

  // Upsert de LeadFormMapping (apenas webhook) + binding de campanha
  assert.equal(state.formMappingUpserts, 1);
  assert.deepEqual(state.campaignBindings, [{ campaignId: 'camp-1', adAccountId: 'acc-1' }]);

  // Empreendimento: lazy, somente admin, SEM clientId
  assert.equal(state.enterpriseCalls.length, 1);
  assert.equal(state.enterpriseCalls[0].hasClientId, false);
});

// ── WEBHOOK — dedups (ordem: contato → leadgen) ─────────────────

test('webhook contato existente: interação [Meta Ads] Novo lead + cartão returning_lead + duplicate_added_interaction', async () => {
  const state = makeState();
  state.clients.push({ id: 'c0', name: 'Maria Antiga', phone: '+5511999998888', email: 'maria@test.com' });
  const out = await processMetaLead(makeServices(state), webhookInput());

  assert.equal(out.success, true);
  assert.equal(out.deduped, true);
  assert.equal(out.reason, 'duplicate_added_interaction');
  assert.equal(out.clientName, 'Maria Antiga');

  assert.equal(state.interactions.length, 1);
  assert.match(
    state.interactions[0].description,
    /^\[Meta Ads\] Novo lead recebido via anúncio "Anúncio Vitta" \(campanha: Campanha Vitta\)\. Formulário: Form Vitta\. Dados: Email: maria@test\.com \| Telefone: \+55119999988888?/,
  );
  assert.equal(state.agentCards[0]?.eventKind, 'returning_lead');
  assert.equal(state.formMappingUpserts, 1);
});

test('webhook replay do mesmo leadgen: already_processed + clientName dedup, SEM interação nem cartão', async () => {
  const state = makeState();
  state.clients.push({ id: 'c0', name: 'Maria Silva', phone: null, email: null, metaLeadgenId: 'LG-1' });
  const out = await processMetaLead(makeServices(state), webhookInput());

  assert.equal(out.success, true);
  assert.equal(out.reason, 'already_processed');
  assert.equal(out.clientName, 'dedup');
  assert.equal(state.interactions.length, 0);
  assert.equal(state.agentCards.length, 0);
});

// ── WEBHOOK — token ausente / Graph falha ────────────────────────

test('webhook sem field_data e sem page token: LostLead salvo + no_account_token', async () => {
  const state = makeState();
  const out = await processMetaLead(makeServices(state), webhookInput({ fieldData: [], pageToken: null }));

  assert.equal(out.success, false);
  assert.equal(out.reason, 'no_account_token');
  assert.equal(state.lostLeads.length, 1);
  assert.equal(state.lostLeads[0].source, 'meta_webhook_no_account_token');
  assert.equal((state.lostLeads[0].formData as { reason: string }).reason, 'conta_sem_access_token');
  assert.equal(state.clients.length, 0);
});

test('webhook sem field_data com page token: busca na Graph; falha → cliente criado com dados mínimos', async () => {
  const state = makeState();
  const out = await processMetaLead(makeServices(state, { graphFails: true }), webhookInput({ fieldData: [], pageToken: 'PAGE_TOKEN' }));

  assert.deepEqual(state.graphFetches, ['LG-1']);
  assert.equal(out.imported, true);
  assert.equal(out.clientName, 'Lead Meta Ads');
});

// ── WEBHOOK — erros e simulação ──────────────────────────────────

test('webhook erro no create → create_failed (não propaga)', async () => {
  const state = makeState();
  const out = await processMetaLead(withCreateFailure(makeServices(state)), webhookInput());
  assert.equal(out.success, false);
  assert.equal(out.reason, 'create_failed');
});

test('webhook sem creatorId (após dedups) → no_user', async () => {
  const state = makeState();
  const out = await processMetaLead(makeServices(state), webhookInput({ creatorId: undefined }));
  assert.equal(out.success, false);
  assert.equal(out.reason, 'no_user');
});

test('webhook SIM_*: cartão com eventKind test e ingestionMethod simulation', async () => {
  const state = makeState();
  await processMetaLead(makeServices(state), webhookInput({ leadgenId: 'SIM_TESTE_001', fieldData: [{ name: 'full_name', values: ['Sim'] }] }));
  assert.equal(state.agentCards[0].eventKind, 'test');
  assert.equal(state.agentCards[0].ingestionMethod, 'simulation');
});

// ── POLLING — contratos ──────────────────────────────────────────

test('polling lead novo: interação [Meta Polling], cartão new_lead polling COM empreendimento (clientId), sem mapping', async () => {
  const state = makeState();
  const out = await processMetaLead(makeServices(state), pollingInput());

  assert.equal(out.imported, true);
  assert.equal(out.leadgenId, 'LG-2');
  assert.equal(state.interactions.length, 1);
  assert.equal(
    state.interactions[0].description,
    '[Meta Polling] Cliente criado via polling automático. Anúncio: Anúncio Poll.',
  );
  // Nota do polling tem "Criado em" (created_time ISO cru)
  assert.match(state.creates[0].notes || '', /\nCriado em: 2026-09-11T10:00:00-03:00/);
  assert.match(state.creates[0].notes || '', /^\[Meta Ads\] Lead importado por polling automático\./);

  assert.equal(state.agentCards.length, 1);
  assert.equal(state.agentCards[0].eventKind, 'new_lead');
  assert.equal(state.agentCards[0].ingestionMethod, 'polling');
  assert.equal(state.agentCards[0].hasEnterprise, true);

  // Sem LeadFormMapping no polling
  assert.equal(state.formMappingUpserts, 0);

  // Empreendimento resolvido COM clientId do cliente criado
  assert.equal(state.enterpriseCalls.length, 1);
  assert.equal(state.enterpriseCalls[0].hasClientId, true);

  // Admin notificado com prefixo polling
  assert.equal(state.adminNotices[0].source, 'meta_ads:polling:Campanha Poll');
});

test('polling replay do mesmo leadgen: já_existente SEM interação e SEM notificação', async () => {
  const state = makeState();
  state.clients.push({ id: 'c0', name: 'João Poll', phone: null, email: null, metaLeadgenId: 'LG-2' });
  const out = await processMetaLead(makeServices(state), pollingInput());

  assert.equal(out.imported, false);
  assert.equal(out.deduped, true);
  assert.equal(out.reason, 'já_existente');
  assert.equal(out.clientName, 'João Poll');
  assert.equal(state.interactions.length, 0);
  assert.equal(state.agentCards.length, 0);
  assert.equal(state.adminNotices.length, 0);
});

test('polling contato existente: cliente_existente_atualizado com interação, SEM fila e SEM cartão, metaLeadgenId atualizado', async () => {
  const state = makeState();
  state.clients.push({ id: 'c0', name: 'João Antigo', phone: null, email: 'joao@test.com' });
  const out = await processMetaLead(makeServices(state), pollingInput({
    fieldData: [
      { name: 'full_name', values: ['João Poll'] },
      { name: 'email', values: ['joao@test.com'] },
    ],
  }));

  assert.equal(out.imported, false);
  assert.equal(out.deduped, true);
  assert.equal(out.reason, 'cliente_existente_atualizado');
  assert.equal(state.interactions.length, 1);
  assert.equal(
    state.interactions[0].description,
    '[Meta Polling] Lead LG-2 detectado pelo polling. Dados: Email: joao@test.com.',
  );
  assert.equal(state.agentCards.length, 0);
  assert.equal(state.adminNotices.length, 0);
  assert.deepEqual(state.updates, [{ id: 'c0', data: { metaLeadgenId: 'LG-2', lastInteractionAt: state.updates[0]?.data.lastInteractionAt } }]);
});

test('polling erro no create PROPAGA (contrato atual — erro por lead no run)', async () => {
  const state = makeState();
  await assert.rejects(
    () => processMetaLead(withCreateFailure(makeServices(state)), pollingInput()),
    /boom no create/,
  );
});

test('polling sem creatorId → no_user', async () => {
  const state = makeState();
  const out = await processMetaLead(makeServices(state), pollingInput({ creatorId: undefined }));
  assert.equal(out.success, false);
  assert.equal(out.reason, 'no_user');
});
