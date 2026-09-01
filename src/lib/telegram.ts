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

// ── Core send functions ──────────────────────────────────────

/**
 * Sends a photo with caption via Telegram's sendPhoto API.
 * Falls back to sendMessage if the photo URL is invalid or the request fails.
 */
async function sendTelegramPhoto(
  chatId: string,
  photoUrl: string,
  caption: string,
): Promise<boolean> {
  if (!BOT_TOKEN || !chatId) return false;

  const finalCaption = caption.length > 1024
    ? caption.slice(0, 1000) + '...'
    : caption;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(`${TELEGRAM_API}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        chat_id: chatId,
        photo: photoUrl,
        caption: finalCaption,
        parse_mode: 'HTML',
      }),
    });

    clearTimeout(timeoutId);
    const data = await res.json();
    if (data.ok) return true;

    // Fallback to text message if sendPhoto fails
    console.warn(`[Telegram] sendPhoto failed (chatId=${chatId}): ${data.description} — falling back to sendMessage`);
    return sendTelegramMessage(chatId, caption);
  } catch (error) {
    console.warn('[Telegram] sendPhoto error, falling back to sendMessage:', error);
    return sendTelegramMessage(chatId, caption);
  }
}

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

  // Build caption text
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

  // If enterprise image is available, send as photo with caption
  if (data.enterpriseImageUrl) {
    return sendTelegramPhoto(telegramChatId, data.enterpriseImageUrl, text);
  }

  return sendTelegramMessage(telegramChatId, text);
}

/**
 * Sends a queue rotation notification to admins.
 * Called whenever the queue advances (lead form submission or WhatsApp click).
 *
 * @param data.source        - Raw source string (e.g. 'landing_form:slug', 'whatsapp_click:slug:hero')
 * @param data.assignedUserName - Name of the user who received the assignment
 * @param data.nextUserName     - Name of the user who is NEXT in line
 * @param data.leadName        - Lead name (for form submissions)
 * @param data.leadPhone       - Lead phone (for form submissions)
 * @param data.enterpriseName  - Enterprise name (if available)
 */
export interface QueueUpdateData {
  source: string;
  assignedUserName: string;
  nextUserName: string | null;
  leadName?: string | null;
  leadPhone?: string | null;
  enterpriseName?: string | null;
}

export async function notifyQueueUpdate(
  telegramChatId: string,
  data: QueueUpdateData,
): Promise<boolean> {
  // Parse source into readable type and detail
  const src = data.source || 'desconhecida';
  let sourceType: string;
  let sourceDetail: string;

  if (src.startsWith('whatsapp_click')) {
    sourceType = '💬 WhatsApp';
    // Format: whatsapp_click:slug:location
    const parts = src.split(':');
    sourceDetail = parts.length >= 3 ? parts.slice(2).join(':') : (parts[1] || '');
  } else if (src.startsWith('landing_form')) {
    sourceType = '📝 Cadastro';
    const parts = src.split(':');
    sourceDetail = parts[1] || '';
  } else if (src.startsWith('meta_ads')) {
    sourceType = '📢 Meta Ads';
    const parts = src.split(':');
    sourceDetail = parts.slice(1).join(':');
  } else if (src.startsWith('recovered_lost_lead')) {
    sourceType = '🔄 Lead recuperado';
    const parts = src.split(':');
    sourceDetail = parts[1] || '';
  } else {
    sourceType = '🔗 API';
    sourceDetail = src;
  }

  // Build the notification
  let text = `🔄 <b>Fila de Atualizada</b>\n\n`;

  // Source info
  text += `📋 <b>Fonte:</b> ${escapeHtml(sourceType)}`;
  if (sourceDetail) text += ` (${escapeHtml(sourceDetail)})`;
  text += '\n';

  // Who received the assignment
  text += `👤 <b>Atendimento atribuído a:</b> ${escapeHtml(data.assignedUserName)}\n`;

  // Who is next
  if (data.nextUserName) {
    text += `⏭️ <b>Próximo na fila:</b> ${escapeHtml(data.nextUserName)}\n`;
  }

  // Lead info (only for form submissions, not WhatsApp clicks)
  if (data.leadName) {
    text += `\n📊 <b>Lead:</b> ${escapeHtml(data.leadName)}`;
    if (data.leadPhone) text += ` — ${escapeHtml(data.leadPhone)}`;
    text += '\n';
  }

  // Enterprise
  if (data.enterpriseName) {
    text += `🏗️ <b>Empreendimento:</b> ${escapeHtml(data.enterpriseName)}\n`;
  }

  text += `\n⏰ ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;

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