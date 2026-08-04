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

// Telegram message size limit
const MAX_MESSAGE_LENGTH = 4096;

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

  if (!chatId) {
    console.warn('[Telegram] Empty chatId — skipping notification');
    return false;
  }

  // Truncate message if it exceeds Telegram's limit
  const finalText = text.length > MAX_MESSAGE_LENGTH
    ? text.slice(0, MAX_MESSAGE_LENGTH - 50) + '\n\n⚠️ [Mensagem truncada]'
    : text;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        chat_id: chatId,
        text: finalText,
        parse_mode: options?.parseMode || 'HTML',
        disable_web_page_preview: options?.disableWebPagePreview ?? true,
      }),
    });

    clearTimeout(timeoutId);

    const data: TelegramMessageResponse = await res.json();
    if (!data.ok) {
      console.error(`[Telegram] sendMessage failed (chatId=${chatId}): ${data.description}`);
      return false;
    }
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.error(`[Telegram] sendMessage timed out (chatId=${chatId})`);
    } else {
      console.error('[Telegram] Error sending message:', error);
    }
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
  customAnswers?: Record<string, string> | null;
}

/**
 * Sends a "new lead" notification to a specific user.
 */
export async function notifyNewLead(
  telegramChatId: string,
  data: LeadNotificationData,
): Promise<boolean> {
  // Assigned agent line
  const assignedLine = data.assignedUserName
    ? `\n👤 <b>Para:</b> ${escapeHtml(data.assignedUserName)}`
    : '';

  // Source/slug line
  const sourceLine = data.slug
    ? `\n🔗 <b>Origem:</b> Landing ${escapeHtml(data.slug)}`
    : data.utmSource
      ? `\n📡 <b>Fonte:</b> ${escapeHtml(data.utmSource)}`
      : '';

  const campaignLine = data.utmCampaign
    ? `\n📊 <b>Campanha:</b> ${escapeHtml(data.utmCampaign)}`
    : '';

  const enterpriseLine = data.enterpriseName
    ? `\n🏗️ <b>Empreendimento:</b> ${escapeHtml(data.enterpriseName)}`
    : '';

  // Build custom answers block (limit to prevent overflow)
  let answersBlock = '';
  if (data.customAnswers && Object.keys(data.customAnswers).length > 0) {
    const lines = Object.entries(data.customAnswers)
      .filter(([, v]) => v && String(v).trim() !== '')
      .slice(0, 10) // Max 10 custom fields in notification
      .map(([k, v]) => `  • <b>${escapeHtml(k.slice(0, 50))}:</b> ${escapeHtml(String(v).slice(0, 200))}`)
      .join('\n');
    if (lines) {
      answersBlock = '\n\n📋 <b>Respostas do formulário:</b>\n' + lines;
    }
  }

  const text =
    `🚨 <b>Novo Lead Recebido!</b>${assignedLine}\n\n` +
    `👤 <b>Nome:</b> ${escapeHtml(data.leadName)}\n` +
    `📞 <b>Telefone:</b> <a href="tel:${escapeHtml(data.leadPhone)}">${escapeHtml(data.leadPhone)}</a>\n` +
    `📧 <b>E-mail:</b> ${escapeHtml(data.leadEmail)}` +
    enterpriseLine +
    sourceLine +
    campaignLine +
    answersBlock +
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(`${TELEGRAM_API}/getChat?chat_id=${encodeURIComponent(chatId)}`, {
      signal: controller.signal,
    });
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

// ── Helpers ──────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}