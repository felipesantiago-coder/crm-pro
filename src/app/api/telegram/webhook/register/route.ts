import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import {
  buildTelegramWebhookUrl,
  classifyTelegramWebhook,
  resolveWebhookBaseUrl,
  type TelegramWebhookInfo,
} from '@/lib/telegram-webhook';

/**
 * Telegram Webhook — registro e diagnóstico (ADMIN).
 *
 * Paralelo ao "Assinar webhook" da Meta (subscribe-app-webhook): fecha,
 * na ENTRADA, o elo que mantinha o bot mudo em produção — o setWebhook
 * era um passo MANUAL documentado só num comentário, nunca executado.
 *
 * GET  /api/telegram/webhook/register
 *   → diagnóstico: getMe + getWebhookInfo + envs, com veredito pronto.
 *
 * POST /api/telegram/webhook/register
 *   → registra o webhook no bot (idempotente): setWebhook com a URL
 *     pública desta instalação, secret do ambiente (se houver) e
 *     allowed_updates=['message']; devolve o diagnóstico pós-registro.
 *
 * Env usados:
 *   TELEGRAM_BOT_TOKEN      — token do @BotFather (obrigatório)
 *   TELEGRAM_WEBHOOK_SECRET — secret autenticando entregas (recomendado;
 *                             DEVE ser igual ao secret_token registrado)
 *   TELEGRAM_WEBHOOK_URL    — override da URL pública (opcional)
 *   NEXTAUTH_URL / NEXT_PUBLIC_APP_URL — base pública fallback
 */

const TG_TIMEOUT_MS = 8000;

interface TelegramApiResponse<T> {
  ok?: boolean;
  result?: T;
  description?: string;
}

/** GET na API do Telegram com timeout curto; nunca lança. */
async function telegramGet<T>(
  botToken: string,
  method: string,
  params?: Record<string, string>,
): Promise<TelegramApiResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TG_TIMEOUT_MS);
  try {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/${method}${query}`,
      { signal: controller.signal },
    );
    return (await res.json()) as TelegramApiResponse<T>;
  } catch (error) {
    return {
      ok: false,
      description: error instanceof Error ? error.message : 'network error',
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Diagnóstico completo a partir dos fatos coletados. */
async function diagnose(botToken: string | undefined) {
  const expectedBase = resolveWebhookBaseUrl(process.env);
  const expectedUrl = expectedBase ? buildTelegramWebhookUrl(expectedBase) : null;

  const env = {
    botTokenConfigured: !!botToken,
    webhookSecretConfigured: !!process.env.TELEGRAM_WEBHOOK_SECRET,
    botUsernameEnv: process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '') || null,
  };

  if (!botToken) {
    return {
      diagnosis: {
        status: 'bot_error' as const,
        verdict:
          'TELEGRAM_BOT_TOKEN não está configurado no ambiente — nem o bot nem o ' +
          'webhook podem funcionar. Defina o token do @BotFather na Vercel.',
        problems: ['TELEGRAM_BOT_TOKEN ausente'],
        hints: [] as string[],
      },
      bot: null,
      webhook: null,
      expectedUrl,
      env,
    };
  }

  const [me, info] = await Promise.all([
    telegramGet<{ id: number; username?: string }>(botToken, 'getMe'),
    telegramGet<TelegramWebhookInfo>(botToken, 'getWebhookInfo'),
  ]);

  const diagnosis = classifyTelegramWebhook({
    webhookInfo: info.ok ? info.result ?? null : null,
    getMeOk: !!me.ok,
    expectedUrl: expectedUrl || '',
    hasWebhookSecret: env.webhookSecretConfigured,
    envBotUsername: env.botUsernameEnv,
    botUsername: me.ok ? me.result?.username || null : null,
  });

  return {
    diagnosis,
    bot: me.ok ? { id: me.result?.id ?? null, username: me.result?.username || null } : null,
    webhook: info.ok ? info.result ?? null : { last_error_message: info.description },
    expectedUrl,
    env,
  };
}

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  try {
    const result = await diagnose(process.env.TELEGRAM_BOT_TOKEN);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[Telegram Webhook Register] diagnose error:', err);
    return NextResponse.json({ error: 'Erro no diagnóstico do webhook' }, { status: 500 });
  }
}

export async function POST() {
  const { error } = await requireAdmin();
  if (error) return error;
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json(
        { error: 'TELEGRAM_BOT_TOKEN não configurado no ambiente.' },
        { status: 400 },
      );
    }

    const base = resolveWebhookBaseUrl(process.env);
    if (!base) {
      return NextResponse.json(
        {
          error:
            'URL pública do app não configurada. Defina NEXTAUTH_URL (ou NEXT_PUBLIC_APP_URL / TELEGRAM_WEBHOOK_URL) na Vercel.',
        },
        { status: 400 },
      );
    }

    const webhookUrl = buildTelegramWebhookUrl(base);
    const params: Record<string, string> = {
      url: webhookUrl,
      // Comandos do bot (/start, /help, /unlink) são mensagens.
      allowed_updates: JSON.stringify(['message']),
      // Recuperação: descarta updates envelhecidos na fila (convites
      // expiram em 15 min; usuário regenera o convite se necessário).
      drop_pending_updates: 'true',
    };
    // O secret registrado PRECISA ser igual ao que a rota do webhook valida.
    if (process.env.TELEGRAM_WEBHOOK_SECRET) {
      params.secret_token = process.env.TELEGRAM_WEBHOOK_SECRET;
    }

    const registered = await telegramGet<boolean>(botToken, 'setWebhook', params);
    if (!registered.ok) {
      console.error('[Telegram Webhook Register] setWebhook failed:', registered.description);
      return NextResponse.json(
        {
          error: `Telegram recusou o registro do webhook: ${registered.description || 'erro desconhecido'}`,
        },
        { status: 502 },
      );
    }

    const result = await diagnose(botToken);
    return NextResponse.json({ ok: true, registered: true, webhookUrl, ...result });
  } catch (err) {
    console.error('[Telegram Webhook Register] error:', err);
    return NextResponse.json({ error: 'Erro ao registrar o webhook' }, { status: 500 });
  }
}
