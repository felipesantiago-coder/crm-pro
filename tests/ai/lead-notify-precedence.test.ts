/**
 * lead-notify-precedence.test.ts — Precedência OBRIGATÓRIA do vínculo
 * anúncio/formulário/campanha → empreendimento (§9.1 e §21.3) e o
 * modelo de apresentação construído a partir do contrato de entrada.
 *
 * A seleção é PURA (testada aqui); o resolver busca no DB e delega.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// A apresentação lê NEXTAUTH_URL no carregamento — define antes do import dinâmico
process.env.NEXTAUTH_URL = 'https://crm.exemplo.com';

const { selectEnterpriseByPrecedence } = await import(
  '../../src/lib/lead-notify/precedence.ts'
);
const { buildLeadPresentation, MAX_ANSWER_VALUE_LENGTH } = await import(
  '../../src/lib/lead-notify/present.ts'
);
const { extractRawAnswers } = await import('../../src/lib/meta-lead-utils.ts');

// ── Precedência (§9.1) ─────────────────────────────────────────

test('precedência: explicit (landing/recuperação/teste) vence tudo', () => {
  const out = selectEnterpriseByPrecedence({
    explicit: { enterpriseId: 'ent-explicit', name: 'Villa Bianco' },
    adBinding: { enterpriseId: 'ent-ad' },
    campaignBinding: { enterpriseId: 'ent-campaign' },
    clientEnterpriseId: 'ent-client',
  });
  assert.equal(out.enterpriseId, 'ent-explicit');
  assert.equal(out.source, 'explicit');
  assert.equal(out.ambiguous, false);
});

test('precedência: anúncio > form+campanha > campanha > formulário > cliente', () => {
  const full = selectEnterpriseByPrecedence({
    adBinding: { enterpriseId: 'ent-ad' },
    formCampaignMapping: { enterpriseId: 'ent-fc' },
    campaignBinding: { enterpriseId: 'ent-c' },
    formMappingEnterpriseIds: ['ent-f'],
    clientEnterpriseId: 'ent-client',
  });
  assert.equal(full.enterpriseId, 'ent-ad');
  assert.equal(full.source, 'ad_binding');

  const noAd = selectEnterpriseByPrecedence({
    formCampaignMapping: { enterpriseId: 'ent-fc' },
    campaignBinding: { enterpriseId: 'ent-c' },
    formMappingEnterpriseIds: ['ent-f'],
    clientEnterpriseId: 'ent-client',
  });
  assert.equal(noAd.enterpriseId, 'ent-fc');
  assert.equal(noAd.source, 'form_campaign_mapping');

  const noFormCampaign = selectEnterpriseByPrecedence({
    campaignBinding: { enterpriseId: 'ent-c' },
    formMappingEnterpriseIds: ['ent-f'],
    clientEnterpriseId: 'ent-client',
  });
  assert.equal(noFormCampaign.source, 'campaign_binding');

  const noCampaign = selectEnterpriseByPrecedence({
    formMappingEnterpriseIds: ['ent-f'],
    clientEnterpriseId: 'ent-client',
  });
  assert.equal(noCampaign.source, 'form_mapping');

  const clientOnly = selectEnterpriseByPrecedence({
    clientEnterpriseId: 'ent-client',
  });
  assert.equal(clientOnly.source, 'client');
});

test('precedência: vínculo por formulário AMBÍGUO não escolhe silenciosamente (§9.1)', () => {
  const ambiguous = selectEnterpriseByPrecedence({
    formMappingEnterpriseIds: ['ent-a', 'ent-b'],
    clientEnterpriseId: 'ent-client',
  });
  // cai para o nível seguinte (cliente) com diagnóstico
  assert.equal(ambiguous.source, 'client');
  assert.equal(ambiguous.ambiguous, true);
  assert.ok(ambiguous.diagnostics.includes('enterprise_binding_ambiguous:form'));

  const ambiguousNoClient = selectEnterpriseByPrecedence({
    formMappingEnterpriseIds: ['ent-a', 'ent-b'],
  });
  assert.equal(ambiguousNoClient.enterpriseId, null);
  assert.equal(ambiguousNoClient.source, 'none');
  assert.equal(ambiguousNoClient.ambiguous, true);
});

test('precedência: vínculos com enterpriseId nulo são ignorados (não travam)', () => {
  const out = selectEnterpriseByPrecedence({
    adBinding: { enterpriseId: null },
    formCampaignMapping: { enterpriseId: null },
    campaignBinding: { enterpriseId: null },
    clientEnterpriseId: 'ent-client',
  });
  assert.equal(out.source, 'client');
  assert.equal(out.enterpriseId, 'ent-client');
});

test('precedência: nada vinculado → none (mensagem sem imagem, nunca errada)', () => {
  const out = selectEnterpriseByPrecedence({});
  assert.equal(out.enterpriseId, null);
  assert.equal(out.source, 'none');
  assert.equal(out.ambiguous, false);
});

// ── Extração de respostas (todos os valores, ordem original) ───

test('extractRawAnswers: múltipla escolha preserva values 2..n e ordem do formulário', () => {
  const raw = extractRawAnswers([
    { name: 'full_name', values: ['Mariana Alves'] }, // padrão — fora
    { name: 'tipo_de_imovel', values: ['Casa', 'Apartamento', 'Lote'] },
    { name: 'phone_number', values: ['61999990000'] }, // padrão — fora
    { name: 'quando_pretende_comprar', values: ['Nos próximos 3 meses'] },
    { name: 'vazio', values: [''] }, // sem valores úteis — fora
  ]);
  assert.deepEqual(
    raw.map((r) => r.key),
    ['tipo_de_imovel', 'quando_pretende_comprar'],
  );
  assert.deepEqual(raw[0].values, ['Casa', 'Apartamento', 'Lote']);
});

// ── Apresentação (modelo do cartão) ────────────────────────────

function input(overrides: Record<string, unknown> = {}) {
  const receivedAt = new Date('2026-09-06T14:32:00-03:00');
  return {
    eventId: 'leadgen-123',
    eventKind: 'new_lead',
    clientId: 'client-1',
    recipientChatId: '12345',
    recipientUserId: 'user-1',
    recipientFirstName: 'João Silva',
    leadName: 'Mariana Alves',
    leadPhoneE164: '+5561999990000',
    leadEmail: 'mariana.exemplo@email.com',
    leadRegion: 'Águas Claras',
    source: {
      campaignName: 'Campanha Villa Bianco',
      adId: 'ad-1',
      formId: 'form-1',
      leadgenId: 'leadgen-123',
      ingestionMethod: 'webhook',
      submittedAt: receivedAt,
      receivedAt,
    },
    rawAnswers: [{ key: 'qual_sua_faixa_de_renda_mensal', values: ['entre_8000_e_12000'] }],
    ...overrides,
  };
}

test('apresentação: intro humana com atendente e lead, sem nomes técnicos (§11.1)', () => {
  const p = buildLeadPresentation(input() as never, {
    enterpriseId: 'ent-1',
    name: 'Villa Bianco',
    imageUrl: 'https://img/villa.jpg',
    imageAlt: 'Villa Bianco',
    source: 'campaign_binding',
    diagnostics: [],
  });
  assert.equal(p.title, 'Novo interesse para você');
  assert.ok(p.intro.startsWith('João, Mariana acabou de pedir informações sobre Villa Bianco.'));
  assert.ok(!p.intro.includes('meta_ads'));
  assert.ok(!p.intro.includes('Lead Meta Ads'));
  // nunca sirene nem urgência automática
  assert.ok(!p.title.includes('🚨'));
  // humanização: rótulo pelo dicionário
  assert.equal(p.answers[0].label, 'Faixa de renda mensal');
  // URLs: CRM autenticado + WhatsApp com saudação
  assert.equal(p.crmUrl, 'https://crm.exemplo.com/');
  assert.ok(p.whatsappUrl!.startsWith('https://wa.me/5561999990000?text='));
  assert.ok(decodeURIComponent(p.whatsappUrl!).includes('Olá, Mariana!'));
  assert.ok(decodeURIComponent(p.whatsappUrl!).includes('Sou João'));
  // saudação NÃO contém renda nem outras respostas sensíveis (§14.2)
  assert.ok(!decodeURIComponent(p.whatsappUrl!).includes('renda'));
});

test('apresentação: nome técnico "Lead Meta Ads" vira "um novo contato" (§10.5)', () => {
  const p = buildLeadPresentation(
    input({ leadName: 'Lead Meta Ads' }) as never,
    null,
  );
  assert.equal(p.contact.name, undefined);
  assert.ok(p.intro.includes('um novo contato'));
  assert.ok(!p.intro.includes('Lead Meta Ads'));
});

test('apresentação: campos ausentes são omitidos; sem contato → disponível=false', () => {
  const p = buildLeadPresentation(
    input({
      leadName: null,
      leadPhoneE164: null,
      leadEmail: null,
      leadRegion: null,
    }) as never,
    null,
  );
  assert.equal(p.contact.name, undefined);
  assert.equal(p.contact.phoneE164, undefined);
  assert.equal(p.contact.email, undefined);
  assert.equal(p.contact.hasAny, false);
  assert.equal(p.whatsappUrl, undefined);
});

test('apresentação: respostas longas são cortadas COM indicação (nunca silenciosamente, §6.4)', () => {
  const longValue = 'X'.repeat(MAX_ANSWER_VALUE_LENGTH + 500);
  const p = buildLeadPresentation(
    input({
      rawAnswers: [{ key: 'observacoes', values: [longValue] }],
    }) as never,
    null,
  );
  assert.equal(p.answers[0].truncated, true);
  assert.ok(p.answers[0].displayValue.endsWith('… (continua no CRM)'));
  assert.ok(p.limitations.some((l: string) => l.startsWith('answer_truncated:')));
  assert.ok(p.answers[0].displayValue.length < longValue.length);
});

test('apresentação: tipos de evento mudam título e intro sem "acabou de" para antigos (§15)', () => {
  const recovered = buildLeadPresentation(
    input({ eventKind: 'recovered_lead' }) as never,
    { name: 'Villa Bianco', imageAlt: '', source: 'explicit', diagnostics: [] },
  );
  assert.equal(recovered.title, 'Contato recuperado e atribuído');
  assert.ok(!recovered.intro.includes('acabou de'));

  const imported = buildLeadPresentation(
    input({ eventKind: 'imported_lead' }) as never,
    null,
  );
  assert.equal(imported.title, 'Contato importado e atribuído');

  const test = buildLeadPresentation(
    input({ eventKind: 'test' }) as never,
    { name: 'Empreendimento Exemplo', imageAlt: '', source: 'explicit', diagnostics: [] },
  );
  assert.equal(test.title, 'Prévia de notificação — dados fictícios');
  assert.ok(test.intro.includes('Nenhum lead real foi criado'));
});

test('apresentação: origem por canal de ingestão em linguagem humana', () => {
  const cases: Array<[string, string]> = [
    ['webhook', 'Meta Ads'],
    ['polling', 'Meta Ads'],
    ['import_by_form', 'Meta Ads · importação por formulário'],
    ['manual', 'Meta Ads · importação manual'],
    ['landing', 'Landing page'],
    ['recovery', 'Recuperação de lead'],
    ['test', 'Prévia'],
  ];
  for (const [method, expected] of cases) {
    const p = buildLeadPresentation(
      input({ source: { ingestionMethod: method, receivedAt: new Date() } }) as never,
      null,
    );
    assert.equal(p.sourceSummary.channelLabel, expected, method);
  }
});
