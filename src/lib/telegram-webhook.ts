/**
 * Telegram Bot Webhook — lógica de registro e diagnóstico.
 *
 * Paralelo ao que existe para o webhook da Meta (meta-app-subscription):
 * o bot do Telegram só entrega updates se um webhook estiver registrado
 * via setWebhook — passo MANUAL que não vivia em nenhum lugar do código
 * (só num comentário no header do route). Sem registro, o bot fica mudo
 * para TUDO (nem /start responde), exatamente o sintoma observado em
 * produção. Esta lib concentra a lógica PURA:
 *
 *   - buildTelegramWebhookUrl   → URL pública esperada do webhook
 *   - normalizeWebhookUrl       → comparação estável entre URLs
 *   - resolveWebhookBaseUrl     → base pública a partir dos envs
 *   - classifyTelegramWebhook   → veredito + problemas a partir de
 *                                 getWebhookInfo + getMe + envs
 *
 * As chamadas HTTP reais (getMe/getWebhookInfo/setWebhook) ficam na
 * rota admin /api/telegram/webhook/register.
 */

/** Shape relevante do getWebhookInfo da API do Telegram. */
export interface TelegramWebhookInfo {
  url?: string;
  has_custom_certificate?: boolean;
  pending_update_count?: number;
  ip_address?: string;
  last_error_date?: number;
  last_error_message?: string;
  last_synchronization_error_date?: number;
  max_connections?: number;
  allowed_updates?: string[];
}

export type TelegramWebhookStatus =
  | 'ok'
  | 'unregistered'
  | 'url_mismatch'
  | 'secret_mismatch_hint'
  | 'no_message_updates'
  | 'bot_error'
  | 'unknown';

export interface TelegramWebhookDiagnosis {
  status: TelegramWebhookStatus;
  /** Frase única, pronta para exibir na UI. */
  verdict: string;
  /** Impedimentos/erros ativos (bloqueiam ou degradam a entrega). */
  problems: string[];
  /** Recomendações não-bloqueantes. */
  hints: string[];
}

/** Monta a URL do webhook a partir da base pública do app. */
export function buildTelegramWebhookUrl(appUrl: string): string {
  const base = appUrl.trim().replace(/\/+$/, '');
  return `${base}/api/telegram/webhook`;
}

/**
 * Normaliza URL para comparação: minúsculas, sem barra final e sem
 * query (query na URL do webhook é suspeita e não entra no esperado).
 */
export function normalizeWebhookUrl(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, '').toLowerCase();
  }
}

/**
 * Base pública do app para o webhook. Ordem:
 *   1. TELEGRAM_WEBHOOK_URL (override explícito)
 *   2. NEXTAUTH_URL
 *   3. NEXT_PUBLIC_APP_URL
 * Só aceita http(s). Retorna null se nenhuma válida existir.
 */
export function resolveWebhookBaseUrl(
  env: Record<string, string | undefined>,
): string | null {
  const candidates = [
    env.TELEGRAM_WEBHOOK_URL,
    env.NEXTAUTH_URL,
    env.NEXT_PUBLIC_APP_URL,
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && /^https?:\/\//i.test(value)) {
      return value.replace(/\/+$/, '');
    }
  }
  return null;
}

/** Rótulo curto do status para a UI. */
export function statusLabel(status: TelegramWebhookStatus): string {
  const labels: Record<TelegramWebhookStatus, string> = {
    ok: 'OK — webhook registrado e saudável',
    unregistered: 'NÃO REGISTRADO — o bot não recebe nada',
    url_mismatch: 'URL DIVERGENTE do esperado',
    secret_mismatch_hint: 'ENTREGAS FALHANDO (suspeita de secret divergente)',
    no_message_updates: "allowed_updates não inclui 'message'",
    bot_error: 'TOKEN DO BOT REJEITADO PELA API',
    unknown: 'INDETERMINADO — verifique manualmente',
  };
  return labels[status];
}

export interface ClassifyTelegramWebhookInput {
  webhookInfo: TelegramWebhookInfo | null;
  /** getMe ok = token do bot válido. */
  getMeOk: boolean;
  /** URL esperada (buildTelegramWebhookUrl sobre a base resolvida). */
  expectedUrl: string;
  /** TELEGRAM_WEBHOOK_SECRET está definido no ambiente. */
  hasWebhookSecret: boolean;
  /** TELEGRAM_BOT_USERNAME do env, se definido (sem @). */
  envBotUsername?: string | null;
  /** username REAL do bot (getMe), se obtido. */
  botUsername?: string | null;
}

/**
 * Classifica a saúde do webhook a partir dos fatos observados.
 * Nunca lança — retornos sempre completos (status/verdict/problems/hints).
 */
export function classifyTelegramWebhook(
  input: ClassifyTelegramWebhookInput,
): TelegramWebhookDiagnosis {
  const { webhookInfo, getMeOk, expectedUrl, hasWebhookSecret } = input;
  const problems: string[] = [];
  const hints: string[] = [];

  // ── Token do bot: pré-condição de tudo ──────────────────────
  if (!getMeOk) {
    return {
      status: 'bot_error',
      verdict:
        'O TELEGRAM_BOT_TOKEN foi rejeitado pela API do Telegram (getMe falhou). ' +
        'Confira se o token do @BotFather está correto na Vercel.',
      problems: ['getMe retornou erro — token inválido ou rede bloqueando a saída'],
      hints,
    };
  }

  // ── Mismatch de bot: env aponta para outro bot que o token ──
  const envBot = input.envBotUsername?.replace(/^@/, '').toLowerCase() || null;
  const realBot = input.botUsername?.replace(/^@/, '').toLowerCase() || null;
  if (envBot && realBot && envBot !== realBot) {
    problems.push(
      `Divergência de bots: TELEGRAM_BOT_USERNAME (@${envBot}) aponta para um bot ` +
      `DIFERENTE do token (@${realBot}) — convites abrem um bot, o webhook vive no outro.`,
    );
  }

  // ── Webhook registrado? ─────────────────────────────────────
  const registeredUrl = webhookInfo?.url?.trim() || '';
  if (!registeredUrl) {
    problems.push('Nenhum webhook registrado — o Telegram não entrega NENHUM update ao CRM.');
    return {
      status: 'unregistered',
      verdict:
        'Webhook do bot NUNCA foi registrado (ou foi removido). O bot fica mudo para ' +
        'tudo — nem /start responde. Use "Registrar webhook" para corrigir agora.',
      problems,
      hints: [...hints, 'Registro esperado em: ' + expectedUrl],
    };
  }

  // ── URL divergente? ─────────────────────────────────────────
  if (expectedUrl && normalizeWebhookUrl(registeredUrl) !== normalizeWebhookUrl(expectedUrl)) {
    problems.push(
      `Webhook aponta para ${registeredUrl}, mas o esperado é ${expectedUrl}. ` +
      `Updates estão indo para outro lugar.`,
    );
    return {
      status: 'url_mismatch',
      verdict:
        'O webhook está registrado numa URL DIFERENTE da desta instalação. ' +
        'Re-registre para redirecionar as entregas para cá.',
      problems,
      hints,
    };
  }

  // ── allowed_updates sem "message"? ──────────────────────────
  const allowed = webhookInfo?.allowed_updates;
  if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes('message')) {
    problems.push(
      `allowed_updates = [${allowed.join(', ')}] — sem 'message' os comandos do bot ` +
      `(/start, /help) não chegam. Re-registre para corrigir.`,
    );
    return {
      status: 'no_message_updates',
      verdict:
        "O webhook existe mas foi registrado SEM 'message' em allowed_updates — " +
        'comandos nunca chegam. Re-registre para corrigir.',
      problems,
      hints,
    };
  }

  // ── Última entrega falhou? ──────────────────────────────────
  const lastError = webhookInfo?.last_error_message?.trim() || '';
  if (lastError) {
    if (/401|unauthorized/i.test(lastError)) {
      problems.push(`Última entrega falhou: "${lastError}" — típico de secret_token divergente.`);
      return {
        status: 'secret_mismatch_hint',
        verdict:
          'O webhook está registrado e a URL confere, MAS as entregas estão tomando 401: ' +
          'o secret_token do registro difere da TELEGRAM_WEBHOOK_SECRET da Vercel. ' +
          'Re-registre (usa o secret do ambiente) ou alinhe a variável.',
        problems,
        hints,
      };
    }
    if (/50[023]|timeout|ECONNREFUSED|network/i.test(lastError)) {
      problems.push(`Última entrega falhou: "${lastError}" — o servidor não respondeu a tempo.`);
    } else {
      problems.push(`Última entrega reportou erro: "${lastError}".`);
    }
  }

  // ── Saudável (com dicas) ────────────────────────────────────
  const pending = webhookInfo?.pending_update_count ?? 0;
  if (!hasWebhookSecret) {
    hints.push(
      'TELEGRAM_WEBHOOK_SECRET não definida — o webhook aceita updates de qualquer ' +
      'origem. Defina a variável e re-registre para autenticar as entregas.',
    );
  }
  if (pending > 0) {
    hints.push(`${pending} update(s) na fila do Telegram aguardando entrega.`);
  }

  return {
    status: 'ok',
    verdict:
      'Webhook registrado, apontando para esta instalação e sem erros de entrega. ' +
      'Se um /start ainda ficar mudo, gere um convite novo no CRM e teste.',
    problems,
    hints,
  };
}
