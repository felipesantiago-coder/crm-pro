/**
 * app-secret-validation.ts — Validação do App Secret NO ATO DE SALVAR
 * (aba Webhook do card de conta e criação de conta).
 *
 * O diagnóstico v4 (etapa 5c) expôs o elo auto-consistente: o self-test
 * HMAC assina e verifica com o MESMO secret salvo — um secret ERRADO
 * passa local e só falha nas entregas REAIS do Meta (assinadas com o
 * secret verdadeiro), que são todas rejeitadas — o sintoma "polling
 * funciona, webhook mudo com tudo verde" (caso real: app 858296646928219,
 * secret errado salvo por meses com diagnóstico todo verde).
 *
 * Esta validação fecha a porta na ENTRADA: ao salvar um App Secret, o
 * servidor monta o app access token (app_id|app_secret) e o testa
 * CONTRA a Graph API:
 *   1. debug_token com o token da conta → app id emissor do token
 *   2. GET /{app-id} com o app access token → aceito = secret REAL
 *
 * Só o veredito 'invalid' BLOQUEIA o salvamento (code 190 / "Invalid
 * OAuth access token signature" — determinístico, é secret errado).
 * Falhas de rede, Graph fora do ar ou impossibilidade de derivar o app
 * id retornam 'unverifiable': o salvamento passa com aviso — nunca
 * bloqueamos o admin por indisponibilidade transitória da Meta.
 */

export type AppSecretValidation =
  | { verdict: 'ok'; appId: string }
  | { verdict: 'invalid'; appId: string | null; details: string; fix: string }
  | { verdict: 'unverifiable'; reason: string };

export interface GraphCallOutcome {
  ok: boolean;
  status?: number;
  /** Código de erro da Graph API (data.error.code), quando presente. */
  code?: number | null;
  data?: any;
  error?: string;
}

/** App access token clássico: "{app-id}|{app-secret}" (formato da Meta). */
function appAccessToken(appId: string, appSecret: string): string {
  return `${appId}|${appSecret}`;
}

/**
 * Classifica o resultado dos 2 passos (FUNÇÃO PURA — testável sem rede).
 * @param debugToken resultado do GET /debug_token com o token da conta
 * @param appCheck   resultado do GET /{app-id} com o app access token
 *                   (null quando o debug_token falhou antes)
 */
export function evaluateAppSecretValidation(input: {
  debugToken: GraphCallOutcome;
  appCheck: GraphCallOutcome | null;
}): AppSecretValidation {
  const { debugToken, appCheck } = input;

  const appId =
    typeof debugToken.data?.data?.app_id === 'string' ? debugToken.data.data.app_id : null;
  if (!debugToken.ok || !appId) {
    return {
      verdict: 'unverifiable',
      reason: `App Secret salvo SEM validação — não foi possível determinar o app id emissor do token da conta (debug_token falhou: ${debugToken.error || 'resposta sem app_id'}); reexecute o diagnóstico para confirmar o secret`,
    };
  }

  if (appCheck && appCheck.ok) {
    return { verdict: 'ok', appId };
  }

  const message = (appCheck?.error || `HTTP ${appCheck?.status ?? '?'}`).trim();
  const invalid =
    appCheck?.code === 190 ||
    (appCheck?.status === 400 && /access_token|oauth|invalid|signature/i.test(message)) ||
    /invalid oauth access token signature/i.test(message);
  if (invalid) {
    return {
      verdict: 'invalid',
      appId,
      details: `O App Secret informado NÃO confere com o app ${appId} — a Graph API rejeitou o app access token montado com ele (${message}). Um secret errado passa no self-test HMAC local (o CRM assina e verifica com o MESMO secret errado), mas TODAS as entregas reais do Meta seriam rejeitadas — o sintoma "polling funciona, webhook mudo". O secret NÃO foi salvo.`,
      fix: `Copie o App Secret EXATO de Meta for Developers → app ${appId} → Configurações → Básico ("Mostrar" pede sua senha), cole sem espaços ou quebras de linha nas pontas e salve novamente.`,
    };
  }
  return {
    verdict: 'unverifiable',
    reason: `App Secret salvo SEM validação — falha transitória ao consultar a Graph API (${message}); reexecute o diagnóstico para confirmar o secret`,
  };
}

const GRAPH_API_BASE = 'https://graph.facebook.com/v26.0';
const TIMEOUT_MS = 8_000;

/**
 * I/O: roda os 2 passos reais contra a Graph API e devolve o veredito.
 * @param effectiveToken access token EFETIVO da conta após este save
 * @param appSecret      App Secret NOVO que está sendo salvo
 */
export async function validateAppSecretAtSave(
  effectiveToken: string,
  appSecret: string,
): Promise<AppSecretValidation> {
  if (!effectiveToken) {
    return {
      verdict: 'unverifiable',
      reason: 'App Secret salvo SEM validação — a conta não tem access token para derivar o app id; salve o token e reexecute o diagnóstico para confirmar o secret',
    };
  }
  const debugToken = await graphGet(
    `debug_token?input_token=${encodeURIComponent(effectiveToken)}`,
    effectiveToken,
  );
  const appId =
    typeof debugToken.data?.data?.app_id === 'string' ? debugToken.data.data.app_id : null;
  if (!debugToken.ok || !appId) {
    return evaluateAppSecretValidation({ debugToken, appCheck: null });
  }
  const appCheck = await graphGet(
    `${appId}?fields=id,name`,
    appAccessToken(appId, appSecret),
  );
  return evaluateAppSecretValidation({ debugToken, appCheck });
}

async function graphGet(pathWithQuery: string, token: string): Promise<GraphCallOutcome> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `${GRAPH_API_BASE}/${pathWithQuery}${pathWithQuery.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        code: typeof data?.error?.code === 'number' ? data.error.code : null,
        data,
        error: data?.error?.message || `HTTP ${res.status}`,
      };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeoutId);
  }
}
