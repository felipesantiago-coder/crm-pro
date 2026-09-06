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

test('present: leadTemperature/leadScore viram bloco de temperatura pronto p/ exibição', () => {
  const p = buildLeadPresentation(baseInput({ leadScore: 17, leadTemperature: 'QUENTE' }), null);
  assert.deepEqual(p.temperature, {
    classification: 'QUENTE',
    label: 'Quente',
    emoji: '🔥',
    score: 17,
  });
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
