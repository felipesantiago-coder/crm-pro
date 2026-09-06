/**
 * lead-notify-composer.test.ts — Composição do cartão de lead:
 * variantes compacta/encadeada/texto, limites seguros do Telegram,
 * atomicidade pergunta+resposta, tags balanceadas e botões de ação.
 *
 * Referência: §12, §13 e §21.2 do redesign. Funções PURAS — nada de rede.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  composeLeadMessageParts,
  buildActionKeyboard,
  escapeHtml,
  SAFE_PHOTO_CAPTION_LENGTH,
  SAFE_TEXT_MESSAGE_LENGTH,
} from '../../src/lib/lead-notify/composer.ts';
import type {
  HumanizedAnswer,
  TelegramLeadPresentation,
} from '../../src/lib/lead-notify/types.ts';

// ── Fábrica de apresentação ────────────────────────────────────

function answer(label: string, value: string, order = 0): HumanizedAnswer {
  return { key: label.toLowerCase().replace(/\s+/g, '_'), label, displayValue: value, order };
}

const BASE: TelegramLeadPresentation = {
  title: 'Novo interesse para você',
  intro: 'João, Mariana acabou de pedir informações sobre Villa Bianco. Este atendimento está com você.',
  eventLabel: 'new_lead',
  contact: {
    name: 'Mariana Alves',
    phoneDisplay: '(61) 99999-0000',
    phoneE164: '+5561999990000',
    email: 'mariana.exemplo@email.com',
    region: 'Águas Claras',
    hasAny: true,
  },
  enterprise: {
    id: 'ent-1',
    name: 'Villa Bianco',
    imageUrl: 'https://exemplo.com/villa.jpg',
    imageAlt: 'Villa Bianco',
  },
  answers: [answer('Faixa de renda mensal', 'Entre R$ 8 mil e R$ 12 mil', 0)],
  sourceSummary: {
    channelLabel: 'Meta Ads',
    campaign: 'Campanha Villa Bianco',
    ad: 'Anúncio Apartamentos Park Sul',
    form: 'Formulário Interesse Park Sul',
  },
  submittedAt: new Date('2026-09-06T14:32:00-03:00'),
  receivedAt: new Date('2026-09-06T14:32:05-03:00'),
  crmUrl: 'https://crm.exemplo.com/',
  whatsappUrl: 'https://wa.me/5561999990000?text=Ol%C3%A1',
  limitations: [],
};

/** Conta tags <b>/</b>, <i>/</i> e <a ...>/</a> — deve fechar em cada parte. */
function tagBalance(html: string): { open: number; close: number } {
  const openB = (html.match(/<b>/g) || []).length;
  const closeB = (html.match(/<\/b>/g) || []).length;
  const openI = (html.match(/<i>/g) || []).length;
  const closeI = (html.match(/<\/i>/g) || []).length;
  const openA = (html.match(/<a /g) || []).length;
  const closeA = (html.match(/<\/a>/g) || []).length;
  return { open: openB + openI + openA, close: closeB + closeI + closeA };
}

// ── Variante compacta ──────────────────────────────────────────

test('compacta: com imagem e legenda curta → UMA parte de foto com botões', () => {
  const parts = composeLeadMessageParts(BASE);
  assert.equal(parts.length, 1);
  const photo = parts[0];
  assert.equal(photo.kind, 'photo');
  if (photo.kind !== 'photo') return;
  assert.equal(photo.image.url, 'https://exemplo.com/villa.jpg');
  assert.equal(photo.parseMode, 'HTML');
  assert.ok(photo.caption.includes('🔔 <b>Novo interesse para você</b>'));
  assert.ok(photo.caption.includes('<b>Villa Bianco</b>'));
  assert.ok(photo.caption.includes('👤 <b>Contato</b>'));
  assert.ok(photo.caption.includes('💬 <b>O que informou</b>'));
  assert.ok(photo.caption.includes('📣 <b>Origem</b>'));
  assert.ok(photo.caption.includes('🕒'));
  assert.ok(photo.replyMarkup, 'botões presentes na foto compacta');
  assert.ok(photo.caption.length <= SAFE_PHOTO_CAPTION_LENGTH);
});

test('origem: canal, campanha, anúncio e formulário como contexto secundário (§11)', () => {
  const parts = composeLeadMessageParts(BASE);
  const caption = parts[0].kind === 'photo' ? parts[0].caption : '';
  assert.ok(
    caption.includes(
      'Meta Ads • Campanha Villa Bianco • Anúncio Apartamentos Park Sul • Formulário Interesse Park Sul',
    ),
    caption,
  );
  // nome que já traz o prefixo não é duplicado
  const dup: TelegramLeadPresentation = {
    ...BASE,
    sourceSummary: { ...BASE.sourceSummary, campaign: 'Campanha X' },
  };
  const text2 = composeLeadMessageParts(noImageOnly(dup))
    .map((p) => (p.kind === 'text' ? p.text : ''))
    .join('\n');
  assert.ok(text2.includes('Campanha X •'), 'prefixo "Campanha" não deve dobrar');
});

// ── Variante encadeada ─────────────────────────────────────────

test('encadeada: legenda longa → foto curta + texto com TODO o conteúdo', () => {
  const long: TelegramLeadPresentation = {
    ...BASE,
    answers: Array.from({ length: 12 }, (_, i) =>
      answer(`Pergunta número ${i + 1}`, `Resposta detalhada de tamanho razoável ${i + 1}`, i),
    ),
  };
  const parts = composeLeadMessageParts(long);
  assert.ok(parts.length >= 2);
  const photo = parts[0];
  assert.equal(photo.kind, 'photo');
  if (photo.kind === 'photo') {
    assert.ok(photo.caption.length <= SAFE_PHOTO_CAPTION_LENGTH);
    // cabeçalho curto: título + empreendimento + intro — sem respostas
    assert.ok(photo.caption.includes('<b>Villa Bianco</b>'));
    assert.ok(!photo.caption.includes('O que informou'));
  }
  const allText = parts
    .map((p) => (p.kind === 'text' ? p.text : p.kind === 'photo' ? p.caption : ''))
    .join('\n');
  // nada foi perdido: contato, TODAS as respostas, origem e tempo
  assert.ok(allText.includes('👤 <b>Contato</b>'));
  for (let i = 0; i < 12; i++) {
    assert.ok(allText.includes(`Pergunta número ${i + 1}`));
    assert.ok(allText.includes(`Resposta detalhada de tamanho razoável ${i + 1}`));
  }
  assert.ok(allText.includes('📣 <b>Origem</b>'));
  assert.ok(allText.includes('🕒'));
});

test('encadeada: pergunta e resposta NUNCA separadas entre partes', () => {
  const long: TelegramLeadPresentation = {
    ...BASE,
    answers: Array.from({ length: 30 }, (_, i) =>
      answer(`Pergunta ${i + 1}`, `Valor da pergunta ${i + 1} com conteúdo suficiente`, i),
    ),
  };
  const parts = composeLeadMessageParts(long);
  // verificação direta: dentro de cada parte, todo rótulo tem seu valor em seguida
  for (const p of parts) {
    const t = p.kind === 'text' ? p.text : p.kind === 'photo' ? p.caption : '';
    for (const m of t.matchAll(/<b>(Pergunta \d+)<\/b>\n/g)) {
      const label = m[1];
      assert.ok(
        t.includes(`<b>${label}</b>\nValor da pergunta`),
        `par atômico quebrado na parte: ${label}`,
      );
    }
  }
});

test('encadeada: tags HTML balanceadas em TODAS as partes (nunca slice)', () => {
  const long: TelegramLeadPresentation = {
    ...BASE,
    answers: Array.from({ length: 40 }, (_, i) =>
      answer(`Campo ${i + 1}`, `Valor ${i + 1} <b>com HTML</b> que deve ser escapado`, i),
    ),
  };
  const parts = composeLeadMessageParts(long);
  for (const part of parts) {
    const text = part.kind === 'text' ? part.text : part.kind === 'photo' ? part.caption : '';
    const balance = tagBalance(text);
    assert.equal(balance.open, balance.close, `parte desbalanceada: ${text.slice(0, 120)}`);
    assert.ok(text.length <= 4096, 'parte acima do limite absoluto do Telegram');
    // HTML do lead foi escapado (não vira tag real)
    const textPart = part.kind === 'text' ? part.text : '';
    assert.ok(!textPart.includes('<b>com HTML</b> que deve'), 'HTML do lead deve ser escapado');
  }
});

test('encadeada: partes de continuação numeradas e botões só na ÚLTIMA parte', () => {
  const filler = 'Conteúdo suficientemente longo para forçar a quebra em múltiplas partes. '.repeat(3);
  const long: TelegramLeadPresentation = {
    ...BASE,
    answers: Array.from({ length: 40 }, (_, i) =>
      answer(`Campo ${i + 1}`, `${filler} (${i + 1})`, i),
    ),
  };
  const parts = composeLeadMessageParts(long);
  const textParts = parts.filter((p) => p.kind === 'text');
  assert.ok(textParts.length >= 2, `esperava ≥2 partes de texto, veio ${textParts.length}`);
  const continuation = textParts[1];
  if (continuation.kind === 'text') {
    assert.ok(continuation.text.includes('Informações (parte 2 de'));
    assert.ok(continuation.replyToPrevious === true);
    assert.ok(!continuation.replyMarkup, 'nenhuma parte intermediária com botões');
  }
  const last = parts[parts.length - 1];
  assert.ok(last.replyMarkup, 'botões na última parte');
  if (last.kind === 'text') assert.ok(last.replyToPrevious === true);
});

// ── Sem imagem ─────────────────────────────────────────────────

test('sem imagem: texto único contendo tudo + botões', () => {
  const noImage: TelegramLeadPresentation = {
    ...BASE,
    enterprise: { ...BASE.enterprise!, imageUrl: undefined },
  };
  const parts = composeLeadMessageParts(noImage);
  assert.equal(parts.length, 1);
  const text = parts[0];
  assert.equal(text.kind, 'text');
  if (text.kind !== 'text') return;
  assert.ok(text.text.includes('🔔 <b>Novo interesse para você</b>'));
  assert.ok(text.text.includes('<b>Villa Bianco</b>'));
  assert.ok(text.text.includes('👤 <b>Contato</b>'));
  assert.ok(text.text.includes('🕒'));
  assert.ok(text.replyMarkup);
  assert.ok(text.replyToPrevious === false);
  assert.ok(text.text.length <= SAFE_TEXT_MESSAGE_LENGTH);
});

// ── Campos ausentes (§10.5) ────────────────────────────────────

test('sem contato nenhum → "Contato ainda não disponível" (nada de rótulos vazios)', () => {
  const noContact: TelegramLeadPresentation = {
    ...BASE,
    contact: { hasAny: false },
  };
  const parts = composeLeadMessageParts(noImageOnly(noContact));
  const text = parts.map((p) => (p.kind === 'text' ? p.text : p.kind === 'photo' ? p.caption : '')).join('\n');
  assert.ok(text.includes('Contato ainda não disponível'));
  assert.ok(!text.includes('Telefone:'));
  assert.ok(!text.includes('E-mail:'));
  assert.ok(!text.includes('Região:'));
});

test('sem respostas → seção "O que informou" omitida inteira', () => {
  const noAnswers: TelegramLeadPresentation = { ...BASE, answers: [] };
  const parts = composeLeadMessageParts(noImageOnly(noAnswers));
  const text = parts.map((p) => (p.kind === 'text' ? p.text : '')).join('\n');
  assert.ok(!text.includes('O que informou'));
});

test('sem empreendimento → sem nome de empreendimento e sem foto (nunca inventa)', () => {
  const noEnt: TelegramLeadPresentation = {
    ...BASE,
    intro: 'João, Mariana acabou de pedir informações pelo anúncio. Este atendimento está com você.',
    enterprise: null,
    sourceSummary: {
      channelLabel: 'Meta Ads',
      campaign: 'Campanha Sem Nome de Empreendimento',
    },
  };
  const parts = composeLeadMessageParts(noEnt);
  const text = parts.map((p) => (p.kind === 'text' ? p.text : p.kind === 'photo' ? p.caption : '')).join('\n');
  assert.ok(!text.includes('Villa Bianco'));
  assert.ok(parts.every((p) => p.kind === 'text'));
});

// ── Eventos (§15) ──────────────────────────────────────────────

test('títulos por tipo de evento: novo, recorrente, recuperado, importado e teste', () => {
  const cases: Array<[string, string]> = [
    ['new_lead', 'Novo interesse para você'],
    ['returning_lead', 'Novo interesse de um contato existente'],
    ['recovered_lead', 'Contato recuperado e atribuído'],
    ['imported_lead', 'Contato importado e atribuído'],
    ['test', 'Prévia de notificação — dados fictícios'],
  ];
  for (const [kind, title] of cases) {
    const parts = composeLeadMessageParts({ ...noImageOnly(BASE), eventLabel: kind, title });
    const text = parts[0].kind === 'text' ? parts[0].text : parts[0].kind === 'photo' ? parts[0].caption : '';
    assert.ok(text.includes(`🔔 <b>${title}</b>`), `título ausente para ${kind}`);
  }
});

// ── Botões (§14) ───────────────────────────────────────────────

test('buildActionKeyboard: WhatsApp e CRM; omite quando não aplicável', () => {
  const keyboard = buildActionKeyboard(BASE);
  assert.ok(keyboard);
  assert.deepEqual(keyboard.rows, [
    [
      { text: 'Conversar no WhatsApp', url: BASE.whatsappUrl! },
      { text: 'Abrir no CRM', url: BASE.crmUrl! },
    ],
  ]);

  assert.equal(buildActionKeyboard({ ...BASE, whatsappUrl: undefined, crmUrl: undefined }), undefined);
});

// ── Escape ─────────────────────────────────────────────────────

test('escapeHtml: neutraliza HTML/hostilidade no conteúdo do lead', () => {
  assert.equal(escapeHtml('<b>oi</b>'), '&lt;b&gt;oi&lt;/b&gt;');
  assert.equal(escapeHtml('a & b "c"'), 'a &amp; b &quot;c&quot;');
  const hostile: TelegramLeadPresentation = {
    ...noImageOnly(BASE),
    answers: [answer('Nome', '<script>alert(1)</script>')],
  };
  const parts = composeLeadMessageParts(hostile);
  const text = parts.map((p) => (p.kind === 'text' ? p.text : '')).join('\n');
  assert.ok(text.includes('&lt;script&gt;'));
  assert.ok(!text.includes('<script>'));
});

// ── Utilidades de teste ────────────────────────────────────────

/** Força variante sem foto (mantém nome do empreendimento). */
function noImageOnly(p: TelegramLeadPresentation): TelegramLeadPresentation {
  return { ...p, enterprise: p.enterprise ? { ...p.enterprise, imageUrl: undefined } : null };
}
