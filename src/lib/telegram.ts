/**
 * Telegram Bot Service
 *
 * Sends notifications to CRM users via Telegram.
 * Uses long-polling style (sendMessage API calls) — no webhook needed for sending.
 *
 * Env vars:
 *   TELEGRAM_BOT_TOKEN  — Token from @BotFather (required to send)
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ── Types ─────────────────────────────────────────────────────

interface TelegramMessageResponse {
  ok: boolean;
  result?: {
    message_id: number;
    chat: { id: number };
  };
  description?: string;
}

// ── Core send function ───────────────────────────────────────

async function sendTelegramMessage(
  chatId: string,
  text: string,
  options?: {
    parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
    disableWebPagePreview?: boolean;
  },
): Promise<boolean> {
  if (!BOT_TOKEN) {
    console.warn('[Telegram] TELEGRAM_BOT_TOKEN not configured — skipping notification');
    return false;
  }

  try {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: options?.parseMode || 'HTML',
        disable_web_page_preview: options?.disableWebPagePreview ?? true,
      }),
    });

    const data: TelegramMessageResponse = await res.json();
    if (!data.ok) {
      console.error(`[Telegram] sendMessage failed: ${data.description}`, { chatId });
      return false;
    }
    return true;
  } catch (error) {
    console.error('[Telegram] Error sending message:', error);
    return false;
  }
}

// ── Notification Formatters ──────────────────────────────────

export interface LeadNotificationData {
  leadName: string;
  leadPhone: string;
  leadEmail: string;
  enterpriseName?: string | null;
  utmCampaign?: string | null;
  utmSource?: string | null;
  slug?: string;
  assignedUserName?: string;
}

/**
 * Sends a "new lead" notification to a specific user.
 */
export async function notifyNewLead(
  telegramChatId: string,
  data: LeadNotificationData,
): Promise<boolean> {
  const campaignLine = data.utmCampaign
    ? `\n📊 <b>Campanha:</b> ${escapeHtml(data.utmCampaign)}${data.utmSource ? ` (${escapeHtml(data.utmSource)})` : ''}`
    : '';

  const enterpriseLine = data.enterpriseName
    ? `\n🏗️ <b>Empreendimento:</b> ${escapeHtml(data.enterpriseName)}`
    : '';

  const text =
    `🚨 <b>Novo Lead Recebido!</b>\n\n` +
    `👤 <b>Nome:</b> ${escapeHtml(data.leadName)}\n` +
    `📞 <b>Telefone:</b> ${escapeHtml(data.leadPhone)}\n` +
    `📧 <b>E-mail:</b> ${escapeHtml(data.leadEmail)}` +
    enterpriseLine +
    campaignLine +
    `\n\n⏰ ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;

  return sendTelegramMessage(telegramChatId, text);
}

/**
 * Sends a test notification (for the settings page).
 */
export async function sendTestNotification(
  telegramChatId: string,
  userName: string,
): Promise<boolean> {
  const text =
    `✅ <b>Notificações do Telegram ativas!</b>\n\n` +
    `Olá, ${escapeHtml(userName)}! 🔔\n\n` +
    `Você receberá notificações aqui sempre que um novo lead for cadastrado via landing page.\n\n` +
    `⏰ ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;

  return sendTelegramMessage(telegramChatId, text);
}

/**
 * Checks if the Telegram bot token is configured.
 */
export function isTelegramConfigured(): boolean {
  return !!BOT_TOKEN;
}

/**
 * Verifies a chat ID by sending a minimal getChat request.
 */
export async function verifyChatId(chatId: string): Promise<{ ok: boolean; name?: string }> {
  if (!BOT_TOKEN) return { ok: false };

  try {
    const res = await fetch(`${TELEGRAM_API}/getChat?chat_id=${encodeURIComponent(chatId)}`);
    const data = await res.json();
    if (data.ok) {
      return { ok: true, name: data.result?.first_name || data.result?.title };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

// ── Helpers ──────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}