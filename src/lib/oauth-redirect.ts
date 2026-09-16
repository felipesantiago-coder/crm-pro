/**
 * oauth-redirect.ts — Resolução de redirect_uri OAuth por origem da requisição.
 *
 * PROBLEMA RAIZ (2026-09, "Não autorizado" no callback do Google Calendar):
 * a aplicação é servida em DOIS hosts simultâneos (crm-pro.site E
 * www.crm-pro.site — ambos 200, sem redirect entre eles) e cookies são
 * host-scoped: a sessão criada no host em que o usuário navega NÃO é
 * enviada para o outro host. Com redirect_uri FIXO (derivado de
 * NEXTAUTH_URL), o callback sempre aterriza no host canônico — onde o
 * usuário que navegava pelo outro host NÃO tem cookie de sessão (nem
 * cookie de state) → getServerSession null → 401 "Não autorizado"
 * (Google) / invalid_state (Meta). O log do Vercel confirma: "No
 * outgoing requests" — a falha ocorre ANTES da troca de tokens.
 *
 * SOLUÇÃO: derivar o redirect_uri do host DA REQUISIÇÃO que inicia o
 * fluxo, restrito ao host "irmão" (swap www↔apex) do host canônico e a
 * allowlist explícita via env. O provedor (Google/Meta) redireciona o
 * NAVEGADOR exatamente para o redirect_uri usado no consentimento — logo
 * o callback aterriza no MESMO host do /start: cookie de sessão e de
 * state presentes, sessão válida. O valor derivado ainda PRECISA estar
 * registrado na lista de redirect URIs autorizados do provedor (Google
 * Cloud Console / Meta App Dashboard) — URI não registrado gera erro
 * VISÍVEL no diálogo (redirect_uri_mismatch), muito mais diagnósticável
 * que a falha silenciosa anterior.
 *
 * PURA e sem I/O — DI-friendly, testável (tests/oauth-redirect/).
 */

export interface HeadersLike {
  get(name: string): string | null;
}

/**
 * Origem pública da requisição: x-forwarded-host / x-forwarded-proto
 * (padrão Vercel/proxies) com fallback para a origem já resolvida pelo
 * Next (request.nextUrl.origin — localhost em dev, sem proxy na frente).
 * Ambos os headers podem chegar como lista "a, b" — usa o primeiro.
 */
export function resolveRequestOrigin(
  headers: HeadersLike,
  fallbackOrigin: string | null,
): string | null {
  const host = headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (!host) return fallbackOrigin || null;
  const proto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
  return `${proto}://${host}`;
}

export interface OAuthRedirectResolution {
  /** redirect_uri canônico atual (GOOGLE_REDIRECT_URI | NEXTAUTH_URL-based). */
  canonicalRedirectUri: string;
  /** Origem pública da requisição (resolveRequestOrigin) ou null. */
  requestOrigin: string | null;
  /** Origens extras permitidas (env, vírgula-separada). Só o HOST é tomado. */
  extraAllowedOrigins?: string[];
}

/** localhost, *.localhost e IPs não têm irmão www. real. */
const NO_SIBLING_HOSTNAME_RE = /^localhost$|\.localhost$|^\d{1,3}(\.\d{1,3}){3}$/;

function siblingHostname(hostname: string): string | null {
  if (NO_SIBLING_HOSTNAME_RE.test(hostname)) return null;
  if (hostname.startsWith('www.')) return hostname.slice(4);
  return `www.${hostname}`;
}

/**
 * Deriva o redirect_uri para ESTA requisição. Regras, em ordem:
 *
 *   1. canonical não-parseável → devolve canonical como veio
 *   2. requestOrigin ausente/inválida → canonical (comportamento atual)
 *   3. origem da requisição == origem canônica → canonical
 *   4. host da requisição == irmão www↔apex do canônico (MESMO protocolo)
 *      → canonical com hostname trocado (path/porta preservados — respeita
 *      override GOOGLE_REDIRECT_URI / META_OAUTH_REDIRECT_URI)
 *   5. origem na allowlist extra → canonical com HOST da allowlist
 *      (protocolo segue o canônico)
 *   6. qualquer outra origem → canonical (fallback seguro; o provedor
 *      ainda exige URI registrado no painel dele)
 */
export function resolveOAuthRedirectUriForRequest(opts: OAuthRedirectResolution): string {
  const { canonicalRedirectUri, requestOrigin, extraAllowedOrigins } = opts;

  let canonical: URL;
  try {
    canonical = new URL(canonicalRedirectUri);
  } catch {
    return canonicalRedirectUri;
  }

  if (!requestOrigin) return canonical.toString();

  let requestUrl: URL;
  try {
    requestUrl = new URL(requestOrigin);
  } catch {
    return canonical.toString();
  }

  if (requestUrl.origin === canonical.origin) return canonical.toString();

  // (4) irmão www↔apex — mesmo protocolo E mesma porta do canônico
  if (requestUrl.protocol === canonical.protocol && requestUrl.port === canonical.port) {
    const sib = siblingHostname(canonical.hostname);
    if (sib && requestUrl.hostname === sib) {
      const withSibling = new URL(canonical.toString());
      withSibling.hostname = sib;
      return withSibling.toString();
    }
  }

  // (5) allowlist extra — troca só o host; protocolo segue o canônico
  if (extraAllowedOrigins) {
    for (const allowed of extraAllowedOrigins) {
      let allowedUrl: URL;
      try {
        allowedUrl = new URL(allowed.trim());
      } catch {
        continue;
      }
      if (allowedUrl.origin === requestUrl.origin) {
        const swapped = new URL(canonical.toString());
        swapped.host = allowedUrl.host;
        return swapped.toString();
      }
    }
  }

  // (6) fallback seguro
  return canonical.toString();
}

/** Extrai origens extras de uma env "a, b" (ignora vazias). */
export function parseExtraOriginsEnv(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
