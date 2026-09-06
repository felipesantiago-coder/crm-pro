/**
 * Telegram Bot Service — fachada de compatibilidade sobre o pipeline
 * `src/lib/lead-notify/` (contratos, humanização, composição, entrega).
 *
 * Novos códigos devem preferir `notifyAssignedMetaLead()` (serviço único);
 * estas funções permanecem para as chamadas antigas e usos simples:
 *   - notifyNewLead        → wrapper do cartão novo (dados legados)
 *   - notifyQueueUpdate    → mensagem administrativa da fila (§20)
 *   - sendLeadCardTest     → prévia real com dados fictícios (§19)
 *   - isTelegramConfigured / verifyChatId
 *
 * Env vars:
 *   TELEGRAM_BOT_TOKEN    — token do @BotFather (obrigatório para enviar)
 *   TELEGRAM_WEBHOOK_SECRET — segredo do webhook do bot (recomendado)
 */

import { randomBytes } from 'node:crypto';
import { notifyAssignedMetaLead } from './lead-notify/service';
import { isTelegramReady } from './lead-notify/delivery';
import { formatMetaPhone } from './meta-lead-utils';

export {
  notifyQueueUpdate,
  sendLeadCardTest,
  type QueueUpdateData,
} from './lead-notify/service';

// ── Compatibilidade: notificação de lead (contrato legado) ─────

export interface LeadNotificationData {
  leadName: string;
  leadPhone: string;
  leadEmail: string;
  enterpriseName?: string | null;
  enterpriseImageUrl?: string | null;
  utmCampaign?: string | null;
  utmSource?: string | null;
  slug?: string;
  assignedUserName?: string;
  customAnswers?: Record<string, string> | null;
}

/**
 * Wrapper de compatibilidade: converte o contrato legado no contrato
 * novo e delega ao serviço único. Cada chamada é um evento novo
 * (sem leadgenId não há chave de idempotência confiável).
 */
export async function notifyNewLead(
  telegramChatId: string,
  data: LeadNotificationData,
): Promise<boolean> {
  const rawAnswers = Object.entries(data.customAnswers || {}).map(([key, value]) => ({
    key,
    values: [value],
  }));

  const receivedAt = new Date();
  const result = await notifyAssignedMetaLead({
    eventId: `legacy:${receivedAt.getTime()}:${randomBytes(6).toString('hex')}`,
    eventKind: 'new_lead',
    clientId: null,
    recipientChatId: telegramChatId,
    recipientUserId: null,
    recipientFirstName: data.assignedUserName || null,
    leadName: data.leadName || null,
    leadPhoneE164: formatMetaPhone(data.leadPhone || null),
    leadEmail: data.leadEmail || null,
    leadRegion: null,
    resolvedEnterprise:
      data.enterpriseName || data.enterpriseImageUrl
        ? {
            name: data.enterpriseName || 'Empreendimento',
            imageUrl: data.enterpriseImageUrl || undefined,
            imageAlt: data.enterpriseName || 'Empreendimento',
            source: 'explicit',
            diagnostics: [],
          }
        : null,
    source: {
      campaignName: data.utmCampaign || null,
      ingestionMethod: data.slug ? 'landing' : 'webhook',
      formName: data.slug || null,
      submittedAt: null,
      receivedAt,
    },
    rawAnswers,
  });

  return result.ok && result.status !== 'skipped_duplicate';
}

// ── Utilidades ─────────────────────────────────────────────────

export function isTelegramConfigured(): boolean {
  return isTelegramReady();
}

/**
 * Verifica um Chat ID via getChat (prova leve de existência).
 * A prova de POSSE continua sendo o token de uso único (§18.1).
 */
export async function verifyChatId(chatId: string): Promise<{ ok: boolean; name?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!token || !chatId) return { ok: false };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(
      `https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`,
      { signal: controller.signal },
    );
    clearTimeout(timeoutId);

    const data = await res.json();
    if (data.ok) {
      return { ok: true, name: data.result?.first_name || data.result?.title };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}
