/**
 * lead-notify-temperature.test.ts — Temperatura do lead no cartão Telegram:
 * mapeamento input → apresentação (present.ts) e renderização da seção
 * em TODAS as variantes do compositor (compacta, encadeada, sem imagem).
 *
 * Funções PURAS — nada de rede, nada de DB.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeLeadMessageParts } from '../../src/lib/lead-notify/composer.ts';
import { buildLeadPresentation } from '../../src/lib/lead-notify/present.ts';
import type {
  TelegramLeadNotificationInput,
  TelegramLeadPresentation,
} from '../../src/lib/lead-notify/types.ts';

// ── Fábricas ───────────────────────────────────────────────────

function baseInput(
  extra: Partial<TelegramLeadNotificationInput> = {},
): TelegramLeadNotificationInput {
  return {
    eventId: 'tg-test-1',
    eventKind: 'new_lead',
    clientId: 'client-1',
    recipientChatId: '123',
    recipientFirstName: 'João',
    leadName: 'Mariana Alves',
    source: {
      ingestionMethod: 'webhook',
      receivedAt: new Date('2026-09-06T14:32:05-03:00'),
    },
    rawAnswers: [{ key: 'renda', values: ['entre_8000_e_12000'] }],
    ...extra,
  };
}

const WITH_TEMP: TelegramLeadPresentation = {
  ...buildLeadPresentation(baseInput({ leadScore: 17, leadTemperature: 'QUENTE' }), null),
  enterprise: {
    id: 'ent-1',
    name: 'Villa Bianco',
    imageUrl: 'https://exemplo.com/villa.jpg',
    imageAlt: 'Villa Bianco',
  },
};

const ALL_TEXT = (parts: ReturnType<typeof composeLeadMessageParts>): string =>
  parts
    .map((p) => (p.kind === 'text' ? p.text : p.kind === 'photo' ? p.caption : ''))
    .join('\n');

// ── present: input → apresentação ──────────────────────────────

test('present: leadTemperature/leadScore viram bloco de temperatura + tratativa prontos p/ exibição', () => {
  const p = buildLeadPresentation(baseInput({ leadScore: 17, leadTemperature: 'QUENTE' }), null);
  assert.deepEqual(p.temperature, {
    classification: 'QUENTE',
    label: 'Quente',
    emoji: '🔥',
    headline: 'Prioridade máxima: fale com o lead o quanto antes.',
    description:
      'Este lead demonstrou alto interesse e tem grandes chances de conversão. O primeiro contato em poucos minutos faz toda a diferença.',
    steps: [
      'Ligue para o lead ou inicie a conversa no WhatsApp agora.',
      'Apresente as opções do empreendimento e convide o lead para uma visita.',
      'Registre cada interação no CRM e atualize a etapa no mesmo dia.',
    ],
    score: 17,
  });
});

test('present: tratativa difere POR classificação (o atendente lê a orientação certa)', () => {
  const hot = buildLeadPresentation(baseInput({ leadTemperature: 'QUENTE' }), null);
  const warm = buildLeadPresentation(baseInput({ leadTemperature: 'MORNO' }), null);
  const cold = buildLeadPresentation(baseInput({ leadTemperature: 'FRIO' }), null);
  const headlines = new Set([
    hot.temperature!.headline,
    warm.temperature!.headline,
    cold.temperature!.headline,
  ]);
  assert.equal(hot.temperature!.emoji, '🔥');
  assert.equal(warm.temperature!.emoji, '🌤️');
  assert.equal(cold.temperature!.emoji, '❄️');
  assert.equal(hot.temperature!.steps?.length, 3);
  assert.equal(warm.temperature!.steps?.length, 3);
  assert.equal(cold.temperature!.steps?.length, 3);
  assert.equal(headlines.size, 3, 'cada classificação tem headline própria');
});

test('present: case-insensitive e sem score definido (score omitido, não zero)', () => {
  const p = buildLeadPresentation(baseInput({ leadTemperature: 'frio' }), null);
  assert.ok(p.temperature);
  assert.equal(p.temperature!.classification, 'FRIO');
  assert.equal(p.temperature!.emoji, '❄️');
  assert.equal(p.temperature!.score, undefined);
  assert.ok(!('score' in p.temperature!), 'chave score não deve existir sem pontuação');
});

test('present: valor inválido/ausente → sem temperatura (seção some, nunca inventa)', () => {
  assert.equal(buildLeadPresentation(baseInput(), null).temperature, null);
  assert.equal(
    buildLeadPresentation(baseInput({ leadTemperature: 'TEPIDO', leadScore: 5 }), null).temperature,
    null,
  );
});

// ── composer: renderização em todas as variantes ──────────────

test('compacta: seção Temperatura na legenda da foto, antes do Contato', () => {
  const parts = composeLeadMessageParts(WITH_TEMP);
  assert.equal(parts.length, 1);
  const photo = parts[0];
  if (photo.kind !== 'photo') return assert.fail('esperava foto');
  const caption = photo.caption;
  assert.ok(caption.includes('🌡️ <b>Temperatura:</b> 🔥 Quente · 17 pts'), caption);
  assert.ok(caption.indexOf('Temperatura') < caption.indexOf('👤 <b>Contato</b>'));
});

test('sem imagem: Temperatura no texto único, entre intro e Contato', () => {
  const parts = composeLeadMessageParts({
    ...WITH_TEMP,
    enterprise: { ...WITH_TEMP.enterprise!, imageUrl: undefined },
  });
  const text = ALL_TEXT(parts);
  assert.ok(text.includes('🌡️ <b>Temperatura:</b> 🔥 Quente · 17 pts'));
  assert.ok(text.indexOf('Temperatura') < text.indexOf('👤 <b>Contato</b>'));
});

test('encadeada: Temperatura vai na primeira parte de texto (nunca perdida)', () => {
  const long: TelegramLeadPresentation = {
    ...WITH_TEMP,
    enterprise: { ...WITH_TEMP.enterprise!, imageUrl: undefined },
    answers: Array.from({ length: 40 }, (_, i) => ({
      key: `campo_${i + 1}`,
      label: `Campo ${i + 1}`,
      displayValue: `Valor ${i + 1} — conteúdo suficientemente longo para forçar a quebra em múltiplas partes dentro do orçamento seguro do Telegram.`,
      order: i,
    })),
  };
  const parts = composeLeadMessageParts(long);
  assert.ok(parts.length >= 2);
  const text = ALL_TEXT(parts);
  assert.ok(text.includes('🌡️ <b>Temperatura:</b> 🔥 Quente · 17 pts'));
});

test('formatação da pontuação: plural, singular e negativo', () => {
  const render = (score: number | undefined) =>
    ALL_TEXT(
      composeLeadMessageParts({
        ...WITH_TEMP,
        temperature: WITH_TEMP.temperature
          ? { ...WITH_TEMP.temperature, score }
          : null,
      }),
    );
  assert.ok(render(1).includes('· 1 pt\n') || render(1).includes('· 1 pt'));
  assert.ok(!render(1).includes('1 pts'));
  assert.ok(render(17).includes('· 17 pts'));
  assert.ok(render(-2).includes('· -2 pts'));
  assert.ok(!render(undefined).includes(' pts'), 'sem score → linha sem pontuação');
  assert.ok(render(undefined).includes('🔥 Quente'));
});

test('sem temperatura → seção inteira omitida (leads de formulário sem config)', () => {
  const parts = composeLeadMessageParts({ ...WITH_TEMP, temperature: null });
  assert.ok(!ALL_TEXT(parts).includes('Temperatura'));
});

// ── composer: seção "Tratativa sugerida" ──────────────────────

test('compacta: Tratativa sugerida logo após a Temperatura e antes do Contato', () => {
  const parts = composeLeadMessageParts(WITH_TEMP);
  const caption = parts[0].kind === 'photo' ? parts[0].caption : assert.fail('esperava foto');
  assert.ok(caption.includes('🎯 <b>Tratativa sugerida</b>'), caption);
  assert.ok(
    caption.indexOf('🌡️ <b>Temperatura:</b>') <
      caption.indexOf('🎯 <b>Tratativa sugerida</b>') &&
      caption.indexOf('🎯 <b>Tratativa sugerida</b>') <
      caption.indexOf('👤 <b>Contato</b>'),
    'ordem: Temperatura → Tratativa → Contato',
  );
  // título, explicação e passos numerados — todos presentes
  assert.ok(caption.includes('<i>Prioridade máxima: fale com o lead o quanto antes.</i>'));
  assert.ok(caption.includes('Este lead demonstrou alto interesse'));
  assert.ok(caption.includes('1. Ligue para o lead ou inicie a conversa no WhatsApp agora.'));
  assert.ok(caption.includes('2. Apresente as opções do empreendimento'));
  assert.ok(caption.includes('3. Registre cada interação no CRM'));
});

test('sem imagem: Tratativa presente no texto único (mesma fonte, mesmos textos)', () => {
  const parts = composeLeadMessageParts({
    ...WITH_TEMP,
    enterprise: { ...WITH_TEMP.enterprise!, imageUrl: undefined },
  });
  const text = ALL_TEXT(parts);
  assert.ok(text.includes('🎯 <b>Tratativa sugerida</b>'));
  assert.ok(text.includes('1. Ligue para o lead'));
  assert.ok(text.indexOf('🎯 <b>Tratativa sugerida</b>') < text.indexOf('👤 <b>Contato</b>'));
});

test('encadeada: Tratativa nunca se perde entre as partes', () => {
  const long: TelegramLeadPresentation = {
    ...WITH_TEMP,
    enterprise: { ...WITH_TEMP.enterprise!, imageUrl: undefined },
    answers: Array.from({ length: 40 }, (_, i) => ({
      key: `campo_${i + 1}`,
      label: `Campo ${i + 1}`,
      displayValue: `Valor ${i + 1} — conteúdo suficientemente longo para forçar a quebra em múltiplas partes dentro do orçamento seguro do Telegram.`,
      order: i,
    })),
  };
  const parts = composeLeadMessageParts(long);
  const text = ALL_TEXT(parts);
  assert.ok(text.includes('🎯 <b>Tratativa sugerida</b>'));
  assert.ok(text.includes('3. Registre cada interação no CRM'));
});

test('temperatura SEM steps (modelo antigo) → só a linha de temperatura, sem seção vazia', () => {
  const legacy: TelegramLeadPresentation = {
    ...WITH_TEMP,
    temperature: { classification: 'QUENTE', label: 'Quente', emoji: '🔥', score: 9 },
  };
  const parts = composeLeadMessageParts(legacy);
  const text = ALL_TEXT(parts);
  assert.ok(text.includes('🌡️ <b>Temperatura:</b> 🔥 Quente · 9 pts'));
  assert.ok(!text.includes('Tratativa sugerida'), 'não exibe bloco vazio');
});

test('tratativa renderizada é a mesma nos três níveis (conteúdo distinto por classificação)', () => {
  const render = (t: 'QUENTE' | 'MORNO' | 'FRIO') =>
    ALL_TEXT(composeLeadMessageParts({ ...WITH_TEMP, temperature: buildLeadPresentation(baseInput({ leadTemperature: t }), null).temperature }));
  assert.ok(render('MORNO').includes('Qualifique o lead ainda no primeiro contato.'));
  assert.ok(render('FRIO').includes('Cultive o relacionamento com paciência.'));
  assert.ok(!render('QUENTE').includes('Cultive o relacionamento'));
});
