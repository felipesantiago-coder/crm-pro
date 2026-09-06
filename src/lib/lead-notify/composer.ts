/**
 * Compositor Telegram: transforma o modelo de apresentação em uma ou
 * mais partes dentro dos limites oficiais da Bot API. Função PURA —
 * nenhum fetch acontece aqui (§8.3).
 *
 * Variantes (§12):
 *   - compacta: foto + legenda única (quando tudo couber com margem);
 *   - encadeada: foto com cabeçalho curto + detalhes em mensagem(s)
 *     de texto encadeadas por reply_parameters;
 *   - sem imagem: texto único ou conjunto numerado de mensagens.
 *
 * Regras invioláveis:
 *   - nunca `slice` em HTML final;
 *   - pergunta e resposta nunca separadas (cada resposta é um bloco atômico);
 *   - tags balanceadas em TODAS as partes;
 *   - nenhuma resposta descartada silenciosamente (valores longos são
 *     exibidos parcialmente com "… (continua no CRM)" — decidido no
 *     humanizador/apresentador, nunca aqui).
 */

import type {
  TelegramInlineKeyboard,
  TelegramLeadPresentation,
  TelegramOutboundPart,
} from './types';
import { formatLeadTiming } from './humanize';

/**
 * Limites oficiais: legenda 1.024 chars, mensagem 4.096 chars (após o
 * processamento de entidades). Trabalhamos com margens seguras abaixo
 * do limite absoluto — nossa medição (string.length) já é conservadora,
 * pois entidades como `&amp;` contam mais aqui do que no Telegram.
 */
export const SAFE_PHOTO_CAPTION_LENGTH = 900;
export const SAFE_TEXT_MESSAGE_LENGTH = 3800;
/** Teto absoluto defensivo por parte (4096 - folha para marcadores). */
export const HARD_MAX_PART_LENGTH = 3990;

// ── Escape ─────────────────────────────────────────────────────

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Seções (cada uma é um bloco atômico) ───────────────────────

function renderHeader(p: TelegramLeadPresentation, withEnterpriseLine: boolean): string {
  const title = `🔔 <b>${escapeHtml(p.title)}</b>`;
  const enterpriseLine =
    withEnterpriseLine && p.enterprise
      ? `\n\n<b>${escapeHtml(p.enterprise.name)}</b>`
      : '';
  return `${title}${enterpriseLine}\n${escapeHtml(p.intro)}`;
}

function renderTemperature(p: TelegramLeadPresentation): string | null {
  if (!p.temperature) return null;
  const { score } = p.temperature;
  const scoreText =
    typeof score === 'number'
      ? score === 1
        ? ' · 1 pt'
        : ` · ${score} pts`
      : '';
  return `🌡️ <b>Temperatura:</b> ${p.temperature.emoji} ${escapeHtml(p.temperature.label)}${scoreText}`;
}

function renderContact(p: TelegramLeadPresentation): string {
  const lines: string[] = ['👤 <b>Contato</b>'];

  if (p.contact.name) lines.push(`<b>${escapeHtml(p.contact.name)}</b>`);
  if (p.contact.phoneE164 && p.contact.phoneDisplay) {
    lines.push(
      `Telefone: <a href="tel:${escapeHtml(p.contact.phoneE164)}">${escapeHtml(p.contact.phoneDisplay)}</a>`,
    );
  }
  if (p.contact.email) lines.push(`E-mail: ${escapeHtml(p.contact.email)}`);
  if (p.contact.region) lines.push(`Região: ${escapeHtml(p.contact.region)}`);

  if (!p.contact.hasAny) {
    lines.push('Contato ainda não disponível');
  }

  return lines.join('\n');
}

function renderAnswers(p: TelegramLeadPresentation): string | null {
  if (p.answers.length === 0) return null;

  const items = p.answers.map(
    (a) => `<b>${escapeHtml(a.label)}</b>\n${escapeHtml(a.displayValue)}`,
  );

  return `💬 <b>O que informou</b>\n\n${items.join('\n\n')}`;
}

function renderSource(p: TelegramLeadPresentation): string {
  const parts: string[] = [p.sourceSummary.channelLabel];
  const withPrefix = (prefix: string, value?: string) => {
    if (!value) return null;
    // Nomes vindos do Meta às vezes já trazem o prefixo ("Campanha X")
    if (value.toLowerCase().startsWith(`${prefix.toLowerCase()} `)) return value;
    return `${prefix} ${value}`;
  };
  const campaign = withPrefix('Campanha', p.sourceSummary.campaign);
  const ad = withPrefix('Anúncio', p.sourceSummary.ad);
  const form = withPrefix('Formulário', p.sourceSummary.form);
  if (campaign) parts.push(campaign);
  if (ad) parts.push(ad);
  if (form) parts.push(form);

  return `📣 <b>Origem</b>\n${parts.map(escapeHtml).join(' • ')}`;
}

function renderTime(p: TelegramLeadPresentation): string {
  return `🕒 ${escapeHtml(formatLeadTiming(p.submittedAt, p.receivedAt))}`;
}

// ── Botões ─────────────────────────────────────────────────────

export function buildActionKeyboard(p: TelegramLeadPresentation): TelegramInlineKeyboard | undefined {
  const row: Array<{ text: string; url: string }> = [];
  if (p.whatsappUrl) row.push({ text: 'Conversar no WhatsApp', url: p.whatsappUrl });
  if (p.crmUrl) row.push({ text: 'Abrir no CRM', url: p.crmUrl });
  if (row.length === 0) return undefined;
  return { rows: [row] };
}

// ── Particionamento ────────────────────────────────────────────

/**
 * Empacota seções atômicas em partes dentro do orçamento seguro.
 * Uma seção nunca é dividida; se uma seção sozinha exceder o teto
 * defensivo, ela vira uma parte isolada (com os truncamentos aplicados
 * na camada de apresentação isso não ocorre — defesa em profundidade).
 */
function packSections(sections: string[]): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const section of sections) {
    if (!section) continue;
    const candidate = current ? `${current}\n\n${section}` : section;

    if (candidate.length <= SAFE_TEXT_MESSAGE_LENGTH) {
      current = candidate;
      continue;
    }

    if (current) chunks.push(current);

    if (section.length > HARD_MAX_PART_LENGTH) {
      // Seção isolada acima do teto: única situação possível é um bloco
      // malformado upstream — envia sozinha e deixa a entrega reportar.
      chunks.push(section);
      current = '';
    } else {
      current = section;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

/** Marca discretamente as partes de continuação (§12.3). */
function withContinuationMarkers(chunks: string[]): string[] {
  if (chunks.length <= 1) return chunks;
  return chunks.map((chunk, i) =>
    i === 0
      ? chunk
      : `<i>Informações (parte ${i + 1} de ${chunks.length})</i>\n\n${chunk}`,
  );
}

// ── Composição principal ───────────────────────────────────────

export function composeLeadMessageParts(
  p: TelegramLeadPresentation,
): TelegramOutboundPart[] {
  const keyboard = buildActionKeyboard(p);

  const contactSection = renderContact(p);
  const temperatureSection = renderTemperature(p);
  const answersSection = renderAnswers(p);
  const sourceSection = renderSource(p);
  const timeSection = renderTime(p);

  const image = p.enterprise?.imageUrl;

  // ── Variante compacta: tudo na legenda da foto ──
  if (image) {
    const fullCaption = [
      renderHeader(p, true),
      temperatureSection,
      contactSection,
      answersSection,
      sourceSection,
      timeSection,
    ]
      .filter(Boolean)
      .join('\n\n');

    if (fullCaption.length <= SAFE_PHOTO_CAPTION_LENGTH) {
      return [
        {
          kind: 'photo',
          image: { kind: 'url', url: image },
          caption: fullCaption,
          parseMode: 'HTML',
          replyMarkup: keyboard,
        },
      ];
    }

    // ── Variante encadeada: foto curta + detalhes em texto ──
    const shortCaption = renderHeader(p, true);
    const bodyChunks = withContinuationMarkers(
      packSections(
        [temperatureSection, contactSection, answersSection, sourceSection, timeSection].filter(
          (s): s is string => !!s,
        ),
      ),
    );

    const parts: TelegramOutboundPart[] = [
      {
        kind: 'photo',
        image: { kind: 'url', url: image },
        caption: shortCaption,
        parseMode: 'HTML',
      },
    ];

    bodyChunks.forEach((text, i) => {
      const isLast = i === bodyChunks.length - 1;
      parts.push({
        kind: 'text',
        text,
        parseMode: 'HTML',
        replyToPrevious: true,
        replyMarkup: isLast ? keyboard : undefined,
      });
    });

    return parts;
  }

  // ── Sem imagem: texto único ou conjunto numerado ──
  const sections = [
    renderHeader(p, !!p.enterprise),
    temperatureSection,
    contactSection,
    answersSection,
    sourceSection,
    timeSection,
  ].filter((s): s is string => !!s);

  const chunks = withContinuationMarkers(packSections(sections));

  return chunks.map((text, i) => ({
    kind: 'text' as const,
    text,
    parseMode: 'HTML' as const,
    replyToPrevious: i > 0,
    replyMarkup: i === chunks.length - 1 ? keyboard : undefined,
  }));
}
