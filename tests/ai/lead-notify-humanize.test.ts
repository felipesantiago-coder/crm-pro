/**
 * lead-notify-humanize.test.ts — Humanização determinística de rótulos,
 * valores, telefones, nomes e tempo do cartão de lead no Telegram.
 *
 * Garantia central: MESMA entrada → MESMA saída, sem rede, sem LLM,
 * sem interpretação do dado do lead (§10 e §21.1 do redesign).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  humanizeAnswerLabel,
  humanizeAnswerValue,
  joinAnswerValues,
  normalizeAnswerKey,
  sentenceCase,
  formatPhoneDisplay,
  isValidE164,
  phoneDigits,
  firstName,
  isTechnicalLeadName,
  formatDateTimeBr,
  formatLeadTiming,
  buildWhatsAppGreeting,
} from '../../src/lib/lead-notify/humanize.ts';

// ── Rótulos ────────────────────────────────────────────────────

test('humanizeAnswerLabel: exemplos obrigatórios do dicionário de aliases (§10.2)', () => {
  assert.equal(humanizeAnswerLabel('qual_sua_faixa_de_renda_mensal'), 'Faixa de renda mensal');
  assert.equal(humanizeAnswerLabel('quando_pretende_comprar'), 'Quando pretende comprar');
  assert.equal(humanizeAnswerLabel('possui_fgts'), 'Possui FGTS');
  assert.equal(humanizeAnswerLabel('melhor_horario_para_contato'), 'Melhor horário para contato');
  assert.equal(humanizeAnswerLabel('tipo_de_imovel_de_interesse'), 'Imóvel de interesse');
});

test('humanizeAnswerLabel: alias tem prioridade sobre a chave bruta', () => {
  assert.equal(humanizeAnswerLabel('renda', 'Faixa de renda configurada'), 'Faixa de renda configurada');
  assert.equal(humanizeAnswerLabel('qual_sua_faixa_de_renda_mensal', '  Renda mensal  '), 'Renda mensal');
  // alias vazio/nulo → cai no dicionário
  assert.equal(humanizeAnswerLabel('possui_fgts', ''), 'Possui FGTS');
  assert.equal(humanizeAnswerLabel('possui_fgts', null), 'Possui FGTS');
});

test('humanizeAnswerLabel: fallback determinístico (sem alias)', () => {
  assert.equal(humanizeAnswerLabel('quando_pretende_visitar'), 'Quando pretende visitar');
  // stopwords interrogativas iniciais são descartadas ("quando" não é)
  assert.equal(humanizeAnswerLabel('qual_preco_do_imovel'), 'Preco do imovel');
  assert.equal(humanizeAnswerLabel('sua_idade'), 'Idade');
  // separadores técnicos viram espaço
  assert.equal(humanizeAnswerLabel('melhor-horario-para-visita'), 'Melhor horario para visita');
  assert.equal(humanizeAnswerLabel('melhor horario'), 'Melhor horario');
});

test('humanizeAnswerLabel: acentos preservados e siglas em maiúsculo', () => {
  assert.equal(humanizeAnswerLabel('pretende_usar_financiamento'), 'Pretende usar financiamento');
  assert.equal(humanizeAnswerLabel('fgts_disponivel'), 'FGTS disponivel');
  assert.equal(humanizeAnswerLabel('cep_de_entrega'), 'CEP de entrega');
});

test('humanizeAnswerLabel: entradas degeneradas não quebram', () => {
  assert.equal(humanizeAnswerLabel(''), 'Resposta');
  assert.equal(humanizeAnswerLabel('___'), 'Resposta');
  assert.equal(humanizeAnswerLabel('  '), 'Resposta');
});

test('normalizeAnswerKey: underscores, hífens, espaços e caixa convergem', () => {
  assert.equal(normalizeAnswerKey('Qual Sua Faixa'), 'qual_sua_faixa');
  assert.equal(normalizeAnswerKey('qual-sua-faixa'), 'qual_sua_faixa');
  assert.equal(normalizeAnswerKey('  QUAL__sua  faixa '), 'qual_sua_faixa');
});

test('sentenceCase: primeira letra maiúscula, resto preservado', () => {
  assert.equal(sentenceCase('faixa de renda'), 'Faixa de renda');
  assert.equal(sentenceCase('águas claras'), 'Águas claras');
  assert.equal(sentenceCase('já tem FGTS'), 'Já tem FGTS');
  assert.equal(sentenceCase(''), '');
  assert.equal(sentenceCase('123 início'), '123 início');
});

// ── Valores ────────────────────────────────────────────────────

test('humanizeAnswerValue: sim/não convertidos; conteúdo preservado', () => {
  assert.equal(humanizeAnswerValue('sim'), 'Sim');
  assert.equal(humanizeAnswerValue('SIM'), 'Sim');
  assert.equal(humanizeAnswerValue('nao'), 'Não');
  assert.equal(humanizeAnswerValue('não'), 'Não');
  assert.equal(humanizeAnswerValue('  Nos próximos 3 meses  '), 'Nos próximos 3 meses');
  assert.equal(humanizeAnswerValue('entre_8000_e_12000'), 'entre_8000_e_12000'); // sem adivinhação
  assert.equal(humanizeAnswerValue('   '), '');
});

test('joinAnswerValues: TODOS os valores preservados com vírgula e "e"', () => {
  assert.equal(joinAnswerValues([]), '');
  assert.equal(joinAnswerValues(['Apartamento']), 'Apartamento');
  assert.equal(joinAnswerValues(['Casa', 'Apartamento']), 'Casa e Apartamento');
  assert.equal(
    joinAnswerValues(['Casa', 'Apartamento', 'Lote']),
    'Casa, Apartamento e Lote',
  );
  // múltipla escolha do Meta (values 2..n) nunca é descartada
  assert.equal(
    joinAnswerValues(['sim', 'nao', 'talvez']).includes('Não'),
    true,
  );
  // valores vazios são removidos sem criar " e " órfão
  assert.equal(joinAnswerValues(['', 'Casa', '  ']), 'Casa');
});

// ── Telefone ───────────────────────────────────────────────────

test('formatPhoneDisplay: números brasileiros (+55) ficam legíveis', () => {
  assert.equal(formatPhoneDisplay('+5561999990000'), '(61) 99999-0000');
  assert.equal(formatPhoneDisplay('+556133330000'), '(61) 3333-0000');
  assert.equal(formatPhoneDisplay('+5511987654321'), '(11) 98765-4321');
});

test('formatPhoneDisplay: internacionais mantêm E.164', () => {
  assert.equal(formatPhoneDisplay('+12125551234'), '+12125551234');
  assert.equal(formatPhoneDisplay('+447911123456'), '+447911123456');
});

test('isValidE164: portão do botão WhatsApp', () => {
  assert.equal(isValidE164('+5561999990000'), true);
  assert.equal(isValidE164('61999990000'), false);
  assert.equal(isValidE164('+5561'), false);
  assert.equal(isValidE164(null), false);
  assert.equal(isValidE164(undefined), false);
  assert.equal(isValidE164('+012345678'), false); // zero inicial não é E.164
});

test('phoneDigits: wa.me não aceita "+"', () => {
  assert.equal(phoneDigits('+5561999990000'), '5561999990000');
});

// ── Nomes ──────────────────────────────────────────────────────

test('nomes técnicos de fallback nunca são exibidos como pessoa (§10.5)', () => {
  assert.equal(isTechnicalLeadName('Lead Meta Ads'), true);
  assert.equal(isTechnicalLeadName('Lead Meta Ads (importado)'), true);
  assert.equal(isTechnicalLeadName('lead meta ads'), true);
  assert.equal(isTechnicalLeadName('Mariana Alves'), false);
  assert.equal(isTechnicalLeadName(null), false);
  assert.equal(isTechnicalLeadName(''), false);
});

test('firstName: primeiro nome útil; vazio para técnico', () => {
  assert.equal(firstName('Mariana Alves'), 'Mariana');
  assert.equal(firstName('Mariana'), 'Mariana');
  assert.equal(firstName('Lead Meta Ads'), '');
  assert.equal(firstName(''), '');
  assert.equal(firstName(null), '');
  assert.equal(firstName(undefined), '');
});

// ── Tempo (§15) ────────────────────────────────────────────────

test('formatDateTimeBr: fuso America/Sao_Paulo, formato dd/mm/aaaa às hh:mm', () => {
  assert.equal(formatDateTimeBr(new Date('2026-09-06T14:32:00-03:00')), '06/09/2026 às 14:32');
  assert.equal(formatDateTimeBr(new Date('2026-01-01T00:05:00-03:00')), '01/01/2026 às 00:05');
});

test('formatLeadTiming: lead de agora não parece antigo', () => {
  const now = new Date();
  const text = formatLeadTiming(now, new Date(now.getTime() + 2_000));
  assert.ok(text.startsWith('Enviado há poucos segundos'), text);
  assert.ok(text.includes('às '));
});

test('formatLeadTiming: atraso em minutos e horas é explícito', () => {
  const received = new Date('2026-09-06T14:32:00-03:00');
  assert.ok(
    formatLeadTiming(new Date('2026-09-06T14:26:00-03:00'), received).startsWith('Enviado há 6 min'),
  );
  assert.ok(
    formatLeadTiming(new Date('2026-09-06T11:32:00-03:00'), received).startsWith('Enviado há 3 h'),
  );
});

test('formatLeadTiming: lead ANTIGO nunca é chamado de recente', () => {
  const received = new Date('2026-09-06T14:32:00-03:00');
  const text = formatLeadTiming(new Date('2026-09-01T09:00:00-03:00'), received);
  assert.ok(text.startsWith('Cadastro enviado em'), text);
  assert.ok(!text.includes('Enviado há'));
});

test('formatLeadTiming: sem horário do Meta → "Recebido em" (não inventa)', () => {
  const received = new Date('2026-09-06T14:32:00-03:00');
  assert.ok(formatLeadTiming(null, received).startsWith('Recebido em'));
  assert.ok(formatLeadTiming(undefined, received).startsWith('Recebido em'));
});

test('formatLeadTiming: relógio de origem à frente não gera "há X min" negativo', () => {
  const received = new Date('2026-09-06T14:32:00-03:00');
  const text = formatLeadTiming(new Date('2026-09-06T15:32:00-03:00'), received);
  assert.ok(text.startsWith('Cadastro enviado em'), text);
});

// ── Saudação do WhatsApp (§14.2) ───────────────────────────────

test('buildWhatsAppGreeting: primeiro nome, sem dados sensíveis, sem afirmar conversa', () => {
  const greeting = buildWhatsAppGreeting({
    agentFirstName: 'João',
    leadFirstName: 'Mariana',
    enterpriseName: 'Villa Bianco',
  });
  assert.ok(greeting.startsWith('Olá, Mariana! Sou João, da equipe responsável por Villa Bianco.'), greeting);
  assert.ok(!greeting.includes('renda'));
  assert.ok(!greeting.includes('conversamos'));
  assert.ok(greeting.includes('Podemos conversar por aqui?'));
});

test('buildWhatsAppGreeting: sem empreendimento usa texto neutro', () => {
  const greeting = buildWhatsAppGreeting({
    agentFirstName: 'João',
    leadFirstName: 'Mariana',
    enterpriseName: null,
  });
  assert.equal(greeting, 'Olá, Mariana! Sou João. Recebi seu pedido de informações e estou à disposição. Podemos conversar por aqui?');
});

test('buildWhatsAppGreeting: sem nome do lead e sem atendente não quebra', () => {
  const noLead = buildWhatsAppGreeting({ agentFirstName: 'João', leadFirstName: '', enterpriseName: null });
  assert.ok(noLead.startsWith('Olá!'));
  const nobody = buildWhatsAppGreeting({ agentFirstName: '', leadFirstName: '', enterpriseName: null });
  assert.ok(nobody.length > 0);
  assert.ok(!nobody.includes('Sou .'));
});
