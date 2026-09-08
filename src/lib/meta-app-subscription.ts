/**
 * meta-app-subscription.ts — Assinatura do webhook NO NÍVEL DO APP (Meta).
 *
 * A cadeia completa do webhook de leads tem DOIS registros distintos na Meta:
 *
 *   1. PÁGINA → APP: POST /{page-id}/subscribed_apps?subscribed_fields=leadgen
 *      (diz ao Meta que a página quer eventos de lead NO app em questão)
 *   2. APP → CALLBACK URL: assinatura de webhook do objeto "page" com o
 *      campo "leadgen" (diz ao Meta PARA ONDE entregar: callback_url +
 *      verify_token configurados no app)
 *
 * O diagnóstico clássico cobre (1) e o webhook do CRM cobre a recepção —
 * mas NADA cobria (2). Sem ela, o Meta recebe o evento de lead da página
 * e não tem para onde entregar: zero entregas, zero leads perdidos,
 * diagnóstico todo verde — exatamente o sintoma "só polling funciona".
 *
 * Funções PURAS (sem I/O): a rota de diagnóstico busca
 * GET /{app-id}/subscriptions com app access token (app_id|app_secret —
 * que também CONFIRMA o App Secret real contra a Graph API, pois o
 * self-test HMAC local é auto-consistente e não prova o segredo) e
 * entrega o resultado para evaluateAppSubscription.
 */

export interface AppSubscriptionEntry {
  object?: string;
  callback_url?: string;
  fields?: string[];
  active?: boolean;
}

/** App access token clássico: "{app-id}|{app-secret}". */
export function buildAppAccessToken(appId: string, appSecret: string): string {
  return `${appId}|${appSecret}`;
}

/** Encontra a assinatura do objeto "page" (com ou sem o campo leadgen). */
export function pickPageSubscription(data: unknown): AppSubscriptionEntry | null {
  const rows = (data as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return null;
  for (const row of rows as AppSubscriptionEntry[]) {
    if (row && row.object === 'page') return row;
  }
  return null;
}

/** Host de callbackUrl é o mesmo de expectedUrl (false se algum for inválido/vazio). */
export function isCallbackHostMatch(callbackUrl: string, expectedUrl: string): boolean {
  if (!callbackUrl || !expectedUrl) return false;
  try {
    return new URL(callbackUrl).host === new URL(expectedUrl).host;
  } catch {
    return false;
  }
}

export type AppSubscriptionEvaluation = {
  status: 'ok' | 'warn' | 'error' | 'skip';
  details: string;
  fix?: string;
};

export type AppSubscriptionFetchOutcome =
  | { kind: 'no_app_id' }
  | { kind: 'network_error'; error: string }
  | { kind: 'graph_error'; status?: number; code?: number | null; message: string }
  | { kind: 'ok'; subscriptions: AppSubscriptionEntry[] };

export interface EvaluateAppSubscriptionInput {
  appId: string | null;
  appSecret: string | null;
  /** URL pública do webhook deste CRM: {origin}/api/webhooks/meta-leads. */
  expectedWebhookUrl: string;
  fetchOutcome: AppSubscriptionFetchOutcome;
}

/**
 * Avalia o resultado da consulta GET /{app-id}/subscriptions e aponta o
 * elo exato quebrado (ou confirma o fim da cadeia) com correção específica.
 */
export function evaluateAppSubscription(input: EvaluateAppSubscriptionInput): AppSubscriptionEvaluation {
  const { appId, appSecret, expectedWebhookUrl, fetchOutcome } = input;

  if (!appSecret) {
    return {
      status: 'skip',
      details: 'Assinatura do app não verificada — conta sem App Secret (sem ele o CRM não consulta as assinaturas do app nem valida entregas)',
    };
  }

  if (fetchOutcome.kind === 'no_app_id') {
    return {
      status: 'warn',
      details: 'Assinatura do app não verificada — não foi possível determinar o app id desta conta (debug_token indisponível para o token salvo)',
      fix: 'Confirme manualmente em Meta for Developers → app → Webhooks → Objeto Page: campo leadgen assinado com esta URL do CRM.',
    };
  }

  if (fetchOutcome.kind === 'network_error') {
    return {
      status: 'warn',
      details: `Assinatura do app não verificada — falha de rede ao consultar a Graph API: ${fetchOutcome.error}`,
      fix: 'Reexecute o diagnóstico; se persistir, verifique a conectividade do servidor com graph.facebook.com.',
    };
  }

  if (fetchOutcome.kind === 'graph_error') {
    const invalidSecret =
      fetchOutcome.code === 190 ||
      (fetchOutcome.status === 400 && /access_token|oauth|invalid/i.test(fetchOutcome.message));
    if (invalidSecret) {
      return {
        status: 'error',
        details: `CAUSA RAIZ TÍPICA de "polling funciona, webhook mudo": o App Secret salvo NÃO confere com o app ${appId ?? '(app desta conta)'} — a Graph API rejeitou o app access token montado com ele (${fetchOutcome.message}). O self-test HMAC local continua verde porque o CRM assina e verifica com o MESMO secret errado; entregas reais do Meta (assinadas com o secret REAL) seriam todas rejeitadas.`,
        fix: `Copie o App Secret EXATO de Meta for Developers → app ${appId ?? ''} → Configurações → Básico e salve na aba Webhook desta conta; reexecute o diagnóstico.`,
      };
    }
    return {
      status: 'warn',
      details: `Falha ao consultar as assinaturas do app ${appId ?? ''} — ${fetchOutcome.message}`,
      fix: 'Reexecute o diagnóstico; se persistir, confirme em Meta for Developers → Webhooks.',
    };
  }

  // kind === 'ok'
  const page = pickPageSubscription({ data: fetchOutcome.subscriptions });

  if (!page) {
    return {
      status: 'error',
      details: `ÚLTIMO ELO QUEBRADO: o app ${appId} NÃO TEM webhook do objeto Page configurado na Meta — a página pode estar inscrita no app, mas o app não tem Callback URL: o Meta NÃO TEM PARA ONDE entregar os leads (zero entregas, zero leads perdidos, tudo o mais verde).`,
      fix: `Registre o webhook no app: Meta for Developers → app ${appId} → Webhooks → Objeto "Page" → campo "leadgen" com Callback URL ${expectedWebhookUrl || '(URL pública do CRM)/api/webhooks/meta-leads'} e Verify Token = verify token DESTA conta — ou use o botão "Assinar webhook do app" (aba Testes do card), que registra tudo automaticamente.`,
    };
  }

  const fields = Array.isArray(page.fields) ? page.fields : [];
  if (!fields.includes('leadgen')) {
    return {
      status: 'error',
      details: `O app ${appId} tem webhook do objeto Page, mas SEM o campo leadgen (campos: ${fields.join(', ') || 'nenhum'}) — eventos de lead nunca serão entregues.`,
      fix: `Assine o campo "leadgen" no webhook do app: Meta for Developers → Webhooks → Page, ou o botão "Assinar webhook do app" (aba Testes do card).`,
    };
  }

  if (page.active === false) {
    return {
      status: 'error',
      details: `O webhook Page/leadgen do app ${appId} existe mas está INATIVO — o Meta retém as entregas.`,
      fix: 'Reative a assinatura: Meta for Developers → Webhooks → Page (ou regrave via botão "Assinar webhook do app", que reativa).',
    };
  }

  const callbackUrl = typeof page.callback_url === 'string' ? page.callback_url : '';
  const hostOk = expectedWebhookUrl ? isCallbackHostMatch(callbackUrl, expectedWebhookUrl) : null;
  if (hostOk === false) {
    let callbackHost = callbackUrl;
    let expectedHost = expectedWebhookUrl;
    try {
      callbackHost = new URL(callbackUrl).host;
      expectedHost = new URL(expectedWebhookUrl).host;
    } catch {
      // mantém as strings originais
    }
    return {
      status: 'error',
      details: `ÚLTIMO ELO QUEBRADO: o webhook do app ${appId} está ATIVO (Page/leadgen) mas o Callback URL aponta para OUTRO host — "${callbackHost}" — as entregas estão indo para OUTRO sistema e o CRM nunca recebe nada.`,
      fix: `Atualize o Callback URL do webhook Page no app ${appId} para ${expectedWebhookUrl} (Meta for Developers → Webhooks → Page → Editar), ou use o botão "Assinar webhook do app" (aba Testes do card), que regrava o callback desta conta.`,
    };
  }

  const hostNote = hostOk === true ? `apontando para ${safeHost(callbackUrl)}` : `callback: ${callbackUrl || 'não informado'} — confira se é o host público deste CRM`;
  return {
    status: 'ok',
    details: `FIM DA CADEIA CONFIRMADO: app ${appId} tem webhook Page/leadgen ATIVO na Meta ${hostNote} — e o App Secret foi CONFIRMADO na Graph API (app access token aceito).`,
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
