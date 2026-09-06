/**
 * Serviço único de notificação de leads no Telegram (§16 do prompt mestre).
 *
 * Webhook, polling, importação por formulário, importação manual,
 * landing pages, recuperação e teste/simulação chamam ESTE serviço —
 * cada fluxo apenas coordena a ingestão e fornece o contexto disponível.
 * Nenhuma rota monta mensagem de lead manualmente.
 *
 * Fluxo: idempotência → resolução de contexto → apresentação →
 * composição → entrega → auditoria (sem PII).
 */

import { randomBytes } from 'node:crypto';
import type {
  TelegramDeliveryResult,
  TelegramLeadNotificationInput,
} from './types';
import { buildLeadPresentation } from './present';
import { composeLeadMessageParts } from './composer';
import { deliverParts, isTelegramReady, sendTextMessage, skippedDelivery } from './delivery';
import { acquireDeliverySlot, finalizeDelivery } from './idempotency';
import { resolveLeadEnterprise } from './resolver';
import { escapeHtml } from './composer';
import { db } from '@/lib/db';

// ── Temperatura do lead (exibida no cartão) ───────────────

const VALID_TEMPERATURES = new Set(['QUENTE', 'MORNO', 'FRIO']);

interface ResolvedLeadTemperature {
  score: number | null;
  temperature: string | null;
}

/**
 * Temperatura a exibir no cartão. Prioridade: valor informado pelo
 * chamador → metaScore/metaTemperature do Client (via clientId).
 * QUALQUER falha de leitura é silenciosa — a notificação nunca
 * depende da temperatura (§6.15).
 */
async function resolveLeadTemperature(
  input: TelegramLeadNotificationInput,
): Promise<ResolvedLeadTemperature> {
  const provided = String(input.leadTemperature || '').toUpperCase();
  if (VALID_TEMPERATURES.has(provided)) {
    return {
      score:
        typeof input.leadScore === 'number' && Number.isFinite(input.leadScore)
          ? Math.trunc(input.leadScore)
          : null,
      temperature: provided,
    };
  }

  if (!input.clientId) return { score: null, temperature: null };

  try {
    const client = await db.client.findUnique({
      where: { id: input.clientId },
      select: { metaScore: true, metaTemperature: true },
    });
    const temperature = client?.metaTemperature
      ? String(client.metaTemperature).toUpperCase()
      : null;
    if (temperature && VALID_TEMPERATURES.has(temperature)) {
      return {
        score: typeof client?.metaScore === 'number' ? client.metaScore : null,
        temperature,
      };
    }
  } catch {
    // sem temperatura no cartão — segue a notificação normalmente
  }

  return { score: null, temperature: null };
}

// ── Serviço principal ──────────────────────────────────────────

export async function notifyAssignedMetaLead(
  input: TelegramLeadNotificationInput,
): Promise<TelegramDeliveryResult> {
  const startedAt = Date.now();

  if (!input.recipientChatId) {
    return skippedDelivery('no_chat');
  }
  if (!isTelegramReady()) {
    return skippedDelivery('bot_not_configured');
  }

  const dedupKey = `${input.eventKind}:${input.source.ingestionMethod}:${input.eventId}:${input.recipientUserId || input.recipientChatId}`;

  try {
    const slot = await acquireDeliverySlot({
      dedupKey,
      kind: input.eventKind,
      ingestionMethod: input.source.ingestionMethod,
      recipientUserId: input.recipientUserId,
      clientId: input.clientId,
    });

    if (slot === 'duplicate') {
      return {
        ok: false,
        status: 'skipped_duplicate',
        messages: [],
        attempts: 0,
      };
    }

    // Resolução de contexto (empreendimento/imagem) — teste já vem resolvido
    const resolved =
      input.resolvedEnterprise ??
      (await resolveLeadEnterprise({
        adId: input.source.adId,
        formId: input.source.formId,
        campaignId: input.source.campaignId,
        clientId: input.clientId,
      }));

    // Temperatura do lead (config por formulário) — falha nunca bloqueia o cartão
    const leadTemperature = await resolveLeadTemperature(input);

    const presentation = buildLeadPresentation(
      {
        ...input,
        leadScore: leadTemperature.score,
        leadTemperature: leadTemperature.temperature,
      },
      resolved,
    );
    const parts = composeLeadMessageParts(presentation);
    const result = await deliverParts(input.recipientChatId, parts);

    await finalizeDelivery(dedupKey, result, Date.now() - startedAt);

    // Auditoria operacional — ids e códigos apenas, NUNCA PII (§17.1)
    console.info(
      `[Lead Notify] entrega=${result.status} evento=${input.eventKind}:${input.source.ingestionMethod}` +
        ` empreendimento=${resolved?.source || 'none'} imagem=${resolved?.imageUrl ? 'ok' : 'ausente'}` +
        ` partes=${result.messages.length} tentativas=${result.attempts}` +
        (resolved?.diagnostics.length ? ` diag=${resolved.diagnostics.join(',')}` : '') +
        ` latenciaMs=${Date.now() - startedAt}`,
    );

    return result;
  } catch (err) {
    // Falha do Telegram NUNCA desfaz o lead nem a atribuição (§6.15)
    console.error(
      '[Lead Notify] Falha inesperada na notificação:',
      err instanceof Error ? err.message : err,
    );
    return {
      ok: false,
      status: 'failed',
      messages: [{ kind: 'text', delivered: false, errorCode: 'unexpected_error' }],
      attempts: 0,
    };
  }
}

// ── Prévia/teste — mesmo compositor, dados explicitamente fictícios ──

export const FICTIONAL_TEST_ENTERPRISE = 'Empreendimento Exemplo';

export function buildTestNotificationInput(
  chatId: string,
  recipientUserId: string | null,
  userName: string,
): TelegramLeadNotificationInput {
  const receivedAt = new Date();
  return {
    eventId: `test:${receivedAt.getTime()}:${randomBytes(4).toString('hex')}`,
    eventKind: 'test',
    clientId: null,
    recipientChatId: chatId,
    recipientUserId,
    recipientFirstName: userName || 'Equipe',
    leadName: 'Mariana Alves',
    leadPhoneE164: '+5561999990000',
    leadEmail: 'mariana.exemplo@email.com',
    leadRegion: 'Águas Claras',
    // Prévia ilustrativa da classificação por formulário (dados fictícios)
    leadScore: 12,
    leadTemperature: 'QUENTE',
    resolvedEnterprise: {
      name: FICTIONAL_TEST_ENTERPRISE,
      imageAlt: FICTIONAL_TEST_ENTERPRISE,
      source: 'explicit',
      diagnostics: [],
    },
    source: {
      campaignName: 'Campanha Exemplo',
      adName: 'Anúncio Exemplo',
      formName: 'Formulário Exemplo',
      ingestionMethod: 'test',
      submittedAt: null,
      receivedAt,
    },
    rawAnswers: [
      { key: 'qual_sua_faixa_de_renda_mensal', values: ['entre_8000_e_12000'] },
      { key: 'tipo_de_imovel_de_interesse', values: ['apartamento_2_quartos'] },
      { key: 'quando_pretende_comprar', values: ['Nos próximos 3 meses'] },
    ],
  };
}

/**
 * Envia a prévia real ao chat do usuário: mesmo compositor e mesmo
 * cliente de entrega da produção, com eventKind 'test' e dados fictícios.
 */
export async function sendLeadCardTest(
  chatId: string,
  recipientUserId: string | null,
  userName: string,
): Promise<TelegramDeliveryResult> {
  return notifyAssignedMetaLead(
    buildTestNotificationInput(chatId, recipientUserId, userName),
  );
}

// ── Notificação administrativa da fila (§20) ───────────────────

export interface QueueUpdateData {
  /** String de origem legada (ex.: 'meta_ads:Campanha', 'landing_form:slug'). */
  source: string;
  assignedUserName: string;
  nextUserName: string | null;
  leadName?: string | null;
  /** Mantido por compatibilidade — NÃO é mais exibido ao administrador. */
  leadPhone?: string | null;
  enterpriseName?: string | null;
}

interface ParsedSource {
  type: string;
  detail: string;
}

function parseQueueSource(raw: string): ParsedSource {
  const src = raw || '';
  if (src.startsWith('whatsapp_click')) {
    const parts = src.split(':');
    return { type: 'Clique no WhatsApp', detail: parts.length >= 3 ? parts.slice(2).join(':') : parts[1] || '' };
  }
  if (src.startsWith('landing_form')) {
    const parts = src.split(':');
    return { type: 'Cadastro em landing page', detail: parts[1] || '' };
  }
  if (src.startsWith('meta_ads')) {
    const parts = src.split(':');
    return { type: 'Meta Ads', detail: parts.slice(1).join(':') };
  }
  if (src.startsWith('recovered_lost_lead')) {
    const parts = src.split(':');
    return { type: 'Lead recuperado', detail: parts[1] || '' };
  }
  return { type: src || 'Origem não informada', detail: '' };
}

/**
 * Mensagem operacional distinta do cartão do lead: sem PII desnecessária
 * (telefone omitido), gramática corrigida e entrega pelo mesmo cliente
 * com resultado estruturado. Retorna boolean por compatibilidade.
 */
export async function notifyQueueUpdate(
  telegramChatId: string,
  data: QueueUpdateData,
): Promise<boolean> {
  if (!telegramChatId || !isTelegramReady()) return false;

  const parsed = parseQueueSource(data.source || '');

  let text = `🔄 <b>Fila atualizada</b>\n\n`;
  text += `📋 <b>Origem:</b> ${escapeHtml(parsed.type)}`;
  if (parsed.detail) text += ` (${escapeHtml(parsed.detail)})`;
  text += '\n';
  text += `👤 <b>Atendimento atribuído a:</b> ${escapeHtml(data.assignedUserName || 'Desconhecido')}\n`;
  if (data.nextUserName) {
    text += `⏭️ <b>Próximo na fila:</b> ${escapeHtml(data.nextUserName)}\n`;
  }
  if (data.leadName) {
    text += `\n📊 <b>Lead:</b> ${escapeHtml(data.leadName)}\n`;
  }
  if (data.enterpriseName) {
    text += `🏗️ <b>Empreendimento:</b> ${escapeHtml(data.enterpriseName)}\n`;
  }
  text += `\n🕒 ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;

  const result = await sendTextMessage(telegramChatId, text);

  console.info(
    `[Lead Notify] fila=${result.status} tentativas=${result.attempts}` +
      (result.messages[0]?.errorCode ? ` erro=${result.messages[0].errorCode}` : ''),
  );

  return result.ok;
}
