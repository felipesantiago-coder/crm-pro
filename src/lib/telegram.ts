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

/**
 * Sends a photo with optional HTML caption via Telegram.
 * Falls back to sendMessage if the photo URL is unavailable or sendPhoto fails.
 */
async function sendTelegramPhoto(
  chatId: string,
  photoUrl: string,
  caption: string,
  options?: {
    parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  },
): Promise<boolean> {
  if (!BOT_TOKEN) {
    console.warn('[Telegram] TELEGRAM_BOT_TOKEN not configured — skipping notification');
    return false;
  }

  try {
    const res = await fetch(`${TELEGRAM_API}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        photo: photoUrl,
        caption,
        parse_mode: options?.parseMode || 'HTML',
      }),
    });

    const data: TelegramMessageResponse = await res.json();
    if (!data.ok) {
      console.warn(`[Telegram] sendPhoto failed (${data.description}), falling back to sendMessage`, { chatId });
      return false; // caller will fallback to sendMessage
    }
    return true;
  } catch (error) {
    console.warn('[Telegram] Error sending photo, falling back to sendMessage:', error);
    return false; // caller will fallback to sendMessage
  }
}

// ── Notification Formatters ──────────────────────────────────

export interface LeadNotificationData {
  leadName: string;
  leadPhone: string;
  leadEmail: string;
  enterpriseName?: string | null;
  /** Cover image URL of the enterprise (sent as photo in Telegram) */
  enterpriseImageUrl?: string | null;
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
  const campaignLine = data.utmCampaign
    ? `\n📊 <b>Campanha:</b> ${escapeHtml(data.utmCampaign)}${data.utmSource ? ` (${escapeHtml(data.utmSource)})` : ''}`
    : '';

  const enterpriseLine = data.enterpriseName
    ? `\n🏗️ <b>Empreendimento:</b> ${escapeHtml(data.enterpriseName)}`
    : '';

  // Build custom answers block
  let answersBlock = '';
  if (data.customAnswers && Object.keys(data.customAnswers).length > 0) {
    const lines = Object.entries(data.customAnswers)
      .filter(([, v]) => v && String(v).trim() !== '')
      .map(([k, v]) => `  • <b>${escapeHtml(k)}:</b> ${escapeHtml(String(v))}`)
      .join('\n');
    if (lines) {
      answersBlock = `\n\n📋 <b>Respostas do formulário:</b>\n${lines}`;
    }
  }

  const text =
    `🚨 <b>Novo Lead Recebido!</b>\n\n` +
    `👤 <b>Nome:</b> ${escapeHtml(data.leadName)}\n` +
    `📞 <b>Telefone:</b> ${escapeHtml(data.leadPhone)}\n` +
    `📧 <b>E-mail:</b> ${escapeHtml(data.leadEmail)}` +
    enterpriseLine +
    campaignLine +
    answersBlock +
    `\n\n⏰ ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;

  // If we have an enterprise cover image, try sendPhoto first; fallback to sendMessage
  if (data.enterpriseImageUrl) {
    const photoSent = await sendTelegramPhoto(telegramChatId, data.enterpriseImageUrl, text);
    if (photoSent) return true;
    // Fallback: send as text-only message
    console.warn('[Telegram] sendPhoto failed, sending as text message instead');
  }

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