/**
 * Entrega Telegram: envia as partes compostas com resultado estruturado,
 * retry controlado e fallback de mídia. Única camada que fala com a
 * Bot API (§8.5 e §17 do prompt mestre).
 *
 * Regras:
 *   - retry APENAS para timeout, 429 e 5xx/transitórias — nunca 400/403;
 *   - respeita `retry_after` do 429;
 *   - foto por URL falhou → download seguro no servidor + upload multipart;
 *   - foto persistindo falha → parte textual completa preserva os dados
 *     e os botões (nada é perdido);
 *   - entrega parcial é reportada (primeira parte entregue não é reenviada);
 *   - logs e erros normalizados NUNCA contêm PII.
 */

import type {
  TelegramDeliveryResult,
  TelegramInlineKeyboard,
  TelegramOutboundPart,
} from './types';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 10_000;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 8_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_ATTEMPTS = 3;

// ── Tipagem interna ────────────────────────────────────────────

interface TelegramApiOk<T> {
  ok: true;
  result: T;
}
interface TelegramApiErr {
  ok: false;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}
type TelegramApiResponse<T> = TelegramApiOk<T> | TelegramApiErr;

interface ApiCallResult {
  ok: boolean;
  messageId?: number;
  description?: string;
  errorCode?: string;
  retryAfterMs?: number;
  retryable: boolean;
  networkError?: boolean;
}

function botToken(): string {
  return process.env.TELEGRAM_BOT_TOKEN || '';
}

function normalizeErrorCode(description: string | undefined, statusCode: number | undefined): string | undefined {
  if (!description && !statusCode) return undefined;
  if (description && /bot was blocked/i.test(description)) return 'bot_blocked';
  if (description && /chat not found/i.test(description)) return 'chat_not_found';
  if (statusCode === 429) return 'rate_limited';
  if (statusCode && statusCode >= 500) return 'telegram_server_error';
  return (description || `http_${statusCode}`).slice(0, 120);
}

/** Uma chamada à Bot API, sem retry. */
async function callTelegramOnce(
  method: string,
  body: Record<string, unknown>,
): Promise<ApiCallResult> {
  const token = botToken();
  if (!token) {
    return { ok: false, errorCode: 'bot_not_configured', retryable: false };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(body),
    });

    clearTimeout(timeoutId);

    let data: TelegramApiResponse<{ message_id: number }>;
    try {
      data = (await res.json()) as TelegramApiResponse<{ message_id: number }>;
    } catch {
      return {
        ok: false,
        errorCode: 'invalid_response',
        retryable: res.status >= 500,
        networkError: true,
      };
    }

    if (data.ok) {
      return { ok: true, messageId: data.result?.message_id, retryable: false };
    }

    const retryAfter = data.parameters?.retry_after;
    return {
      ok: false,
      description: data.description,
      errorCode: normalizeErrorCode(data.description, data.error_code ?? res.status),
      retryAfterMs: retryAfter ? retryAfter * 1000 : undefined,
      retryable: res.status === 429 || res.status >= 500,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const isTimeout = error instanceof DOMException && error.name === 'AbortError';
    return {
      ok: false,
      errorCode: isTimeout ? 'timeout' : 'network_error',
      retryable: true,
      networkError: true,
    };
  }
}

/** Chamada com retry (timeout/429/5xx) e backoff — nunca 400/403. */
async function callTelegramWithRetry(
  method: string,
  body: Record<string, unknown>,
  attemptsUsed: { value: number },
): Promise<ApiCallResult> {
  let last: ApiCallResult = { ok: false, errorCode: 'unknown', retryable: false };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attemptsUsed.value = attempt;
    last = await callTelegramOnce(method, body);
    if (last.ok || !last.retryable || attempt === MAX_ATTEMPTS) return last;

    const waitMs = last.retryAfterMs ?? 500 * 2 ** (attempt - 1);
    await new Promise((r) => setTimeout(r, Math.min(waitMs, 5_000)));
  }

  return last;
}

function keyboardToApi(replyMarkup?: TelegramInlineKeyboard) {
  if (!replyMarkup) return undefined;
  return {
    inline_keyboard: replyMarkup.rows.map((row) =>
      row.map((btn) => ({ text: btn.text, url: btn.url })),
    ),
  };
}

// ── Mídia: download seguro + upload multipart (§9.4, §17.4) ────

const PRIVATE_HOST_PATTERN = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?)/i;

/**
 * Baixa a imagem com proteção SSRF: apenas HTTPS, host não privado,
 * content-type image/*, tamanho limitado e timeout curto.
 */
async function downloadImageSafely(url: string): Promise<Buffer | null> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    if (PRIVATE_HOST_PATTERN.test(parsed.hostname)) return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), IMAGE_DOWNLOAD_TIMEOUT_MS);

    const res = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: 'error',
    });
    clearTimeout(timeoutId);

    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.startsWith('image/')) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) return null;

    return buffer;
  } catch {
    return null;
  }
}

/**
 * Envia foto por URL; falhando, tenta upload multipart dos bytes.
 * Retorna o resultado da ÚLTIMA tentativa e o método que funcionou.
 */
async function sendPhoto(
  chatId: string,
  photoUrl: string,
  caption: string,
  replyMarkup?: TelegramInlineKeyboard,
  attemptsUsed: { value: number } = { value: 0 },
): Promise<ApiCallResult & { viaUpload?: boolean }> {
  const baseBody: Record<string, unknown> = {
    chat_id: chatId,
    caption,
    parse_mode: 'HTML',
  };
  const markup = keyboardToApi(replyMarkup);
  if (markup) baseBody.reply_markup = markup;

  let result: ApiCallResult & { viaUpload?: boolean } = await callTelegramWithRetry(
    'sendPhoto',
    { ...baseBody, photo: photoUrl },
    attemptsUsed,
  );

  if (result.ok) return result;

  // Fallback: URL inacessível ao Telegram → baixa e envia os bytes
  const bytes = await downloadImageSafely(photoUrl);
  if (bytes) {
    try {
      const token = botToken();
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
      if (markup) form.append('reply_markup', JSON.stringify(markup));
      form.append('photo', new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), 'empreendimento.jpg');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendPhoto`, {
        method: 'POST',
        signal: controller.signal,
        body: form,
      });
      clearTimeout(timeoutId);

      let data: TelegramApiResponse<{ message_id: number }>;
      try {
        data = (await res.json()) as TelegramApiResponse<{ message_id: number }>;
      } catch {
        data = { ok: false, description: 'invalid_response' };
      }

      attemptsUsed.value += 1;

      if (data.ok) {
        return { ok: true, messageId: data.result?.message_id, retryable: false, viaUpload: true };
      }

      result = {
        ok: false,
        description: data.description,
        errorCode: normalizeErrorCode(data.description, data.error_code ?? res.status),
        retryable: false,
        viaUpload: true,
      };
    } catch {
      // upload falhou — mantém o resultado da URL como causa raiz
    }
  } else {
    result = { ...result, errorCode: result.errorCode || 'enterprise_image_unreachable' };
  }

  return result;
}

// ── Entrega de um conjunto de partes ───────────────────────────

export async function deliverParts(
  chatId: string,
  parts: TelegramOutboundPart[],
): Promise<TelegramDeliveryResult> {
  const messages: TelegramDeliveryResult['messages'] = [];
  let attempts = 0;
  let lastDeliveredMessageId: number | undefined;
  const attemptsUsed = { value: 0 };

  for (const part of parts) {
    if (part.kind === 'photo') {
      const result = await sendPhoto(chatId, part.image.url, part.caption, part.replyMarkup, attemptsUsed);
      attempts = Math.max(attempts, attemptsUsed.value);

      if (result.ok) {
        lastDeliveredMessageId = result.messageId;
        messages.push({ kind: 'photo', messageId: result.messageId, delivered: true });
      } else {
        const captionCarriesEverything = parts.length === 1;
        if (captionCarriesEverything) {
          // Variante compacta: a legenda tinha TODO o conteúdo —
          // reenvia como texto preservando dados e botões.
          const textResult = await callTelegramWithRetry(
            'sendMessage',
            {
              chat_id: chatId,
              text: part.caption,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
              reply_markup: keyboardToApi(part.replyMarkup),
            },
            attemptsUsed,
          );
          attempts = Math.max(attempts, attemptsUsed.value);
          messages.push({
            kind: 'text',
            messageId: textResult.messageId,
            delivered: textResult.ok,
            errorCode: textResult.ok ? 'photo_fallback_text' : result.errorCode,
          });
          if (textResult.ok) lastDeliveredMessageId = textResult.messageId;
        } else {
          // Variante encadeada: as partes de texto seguintes carregam
          // todo o conteúdo — a falha da foto não perde dados.
          messages.push({ kind: 'photo', delivered: false, errorCode: result.errorCode });
        }
      }
      continue;
    }

    // Parte de texto — encadeia na mensagem anterior quando possível
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: part.text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    const markup = keyboardToApi(part.replyMarkup);
    if (markup) body.reply_markup = markup;
    if (part.replyToPrevious && lastDeliveredMessageId) {
      body.reply_parameters = {
        message_id: lastDeliveredMessageId,
        allow_sending_without_reply: true,
      };
    }

    const result = await callTelegramWithRetry('sendMessage', body, attemptsUsed);
    attempts = Math.max(attempts, attemptsUsed.value);

    messages.push({
      kind: 'text',
      messageId: result.messageId,
      delivered: result.ok,
      errorCode: result.errorCode,
    });
    if (result.ok) lastDeliveredMessageId = result.messageId;
  }

  const deliveredCount = messages.filter((m) => m.delivered).length;
  const status: TelegramDeliveryResult['status'] =
    deliveredCount === 0 ? 'failed' : deliveredCount === parts.length ? 'delivered' : 'partial';

  return {
    ok: deliveredCount > 0,
    status,
    messages,
    attempts,
  };
}

/** Resultado estruturado para destinatário sem chat ( auditoria limpa ). */
export function skippedDelivery(reason: string): TelegramDeliveryResult {
  return {
    ok: false,
    status: 'failed',
    messages: [{ kind: 'text', delivered: false, errorCode: reason }],
    attempts: 0,
  };
}

/** Mensagem simples com resultado estruturado (fila, avisos administrativos). */
export async function sendTextMessage(
  chatId: string,
  text: string,
): Promise<TelegramDeliveryResult> {
  const attemptsUsed = { value: 0 };
  const result = await callTelegramWithRetry(
    'sendMessage',
    {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    },
    attemptsUsed,
  );

  return {
    ok: result.ok,
    status: result.ok ? 'delivered' : 'failed',
    messages: [
      {
        kind: 'text',
        messageId: result.messageId,
        delivered: result.ok,
        errorCode: result.errorCode,
      },
    ],
    attempts: attemptsUsed.value,
  };
}

export function isTelegramReady(): boolean {
  return !!botToken();
}
