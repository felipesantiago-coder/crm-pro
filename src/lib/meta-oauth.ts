// ============================================================
// META OAUTH — Facebook Login for Business (conexão de contas de
// anúncios SEM token manual).
// ============================================================
// MODELO: UM único app (o do CRM) serve N usuários. Cada usuário
// autoriza o app sobre os PRÓPRIOS ativos (contas de anúncio, páginas,
// formulários) e o CRM recebe um token de USUÁRIO de longa duração
// (~60 dias) com todas as permissões pedidas em bloco único. O usuário
// não cria app, não entra no Meta for Developers e não gera System User.
//
// Este módulo concentra a lógica PURA (state assinado HMAC, URL do
// diálogo, comparação de escopos, classificadores de erro e de
// expiração de token — tudo testável sem rede) e o I/O da Graph API
// (troca de código → token curto → longa duração → debug_token →
// listagem de contas/páginas). A camada de BANCO vive em
// meta-oauth-server.ts para manter este arquivo livre de Prisma.
//
// Falha de PERMISSÃO NÃO APROVADA (a): quando o app ainda não tem
// Advanced Access no App Review, a Meta SILENCIOSAMENTE omite a
// permissão do diálogo (para quem não tem papel no app) — a detecção
// acontece aqui, comparando o granular_scopes do debug_token contra
// META_OAUTH_REQUIRED_SCOPES, e vira erro 'missing_permissions' com a
// lista exata para o usuário/admin.
//
// Expiração de token (b): tokens de usuário OAuth expiram (~60 dias).
// classifyTokenStatus/resolveAccountAuthStatus alimentam o convite de
// reconexão na UI; classifyGraphAuthFailure (190/200) marca contas
// cujo uso falhou em runtime (sync-forms, polling).
// ============================================================
import crypto from 'crypto';

export const GRAPH_API_VERSION = 'v26.0';
export const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
export const FACEBOOK_OAUTH_DIALOG = `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`;

/** Permissões pedidas SEMPRE EM BLOCO ÚNICO no diálogo OAuth — nunca
 * incremental (pedir depois exige auth_type=rerequest e re-consentimento).
 * Referência: docs/meta-app-review-checklist.md. */
export const META_OAUTH_SCOPES = [
  'leads_retrieval',            // ler leads dos formulários (edge /leads)
  'ads_management',             // listar/gerir contas de anúncio do usuário
  'ads_read',                   // leitura de ads (fallback de listagem)
  'pages_show_list',            // listar páginas do usuário
  'pages_read_engagement',      // ler conteúdo/engajamento das páginas
  'pages_manage_metadata',      // inscrever a página no webhook do app (leadgen)
  'business_management',        // ativos geridos via Business Manager
] as const;

/** Subconjunto SEM o qual a conexão não funciona — base do diagnóstico
 * 'missing_permissions' pós-consentimento (App Review pendente). */
export const META_OAUTH_REQUIRED_SCOPES = [
  'leads_retrieval',
  'ads_management',
  'pages_show_list',
  'pages_manage_metadata',
] as const;

export const META_OAUTH_STATE_COOKIE = 'meta_oauth_state';
export const META_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

// ============================================================
// STATE assinado (HMAC-SHA256) — CSRF stateless (serverless-safe)
// ============================================================
// Formato: <payload-b64url>.<hmac-b64url> com payload { n, t, r? }:
//   n = nonce aleatório, t = emissão (ms), r = accountId a reconectar.

export interface OAuthStatePayload {
  n: string;
  t: number;
  /** (b) Reconexão de UMA conta existente (botão Reconectar do card). */
  r?: string;
}

function bytesToBase64Url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

function hmac(message: string, secret: string): Buffer {
  return crypto.createHmac('sha256', secret).update(message).digest();
}

export function signOAuthState(payload: OAuthStatePayload, secret: string): string {
  const body = bytesToBase64Url(Buffer.from(JSON.stringify(payload)));
  const sig = bytesToBase64Url(hmac(body, secret));
  return `${body}.${sig}`;
}

export function verifyOAuthState(state: string | undefined | null, secret: string): OAuthStatePayload | null {
  if (!state || typeof state !== 'string') return null;
  const dot = state.indexOf('.');
  if (dot <= 0 || dot === state.length - 1) return null;
  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = hmac(body, secret);
  let received: Buffer;
  try {
    received = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthStatePayload;
    if (!parsed || typeof parsed.n !== 'string' || typeof parsed.t !== 'number') return null;
    if (Date.now() - parsed.t > META_OAUTH_STATE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ============================================================
// Diálogo OAuth
// ============================================================

export interface OAuthDialogOptions {
  appId: string;
  redirectUri: string;
  state: string;
  /** 'rerequest' força a Meta a re-perguntar permissões antes negadas
   *  (usado na reconexão — sem isso permissões recusadas nunca voltam). */
  authType?: 'rerequest';
}

export function buildOAuthDialogUrl({ appId, redirectUri, state, authType }: OAuthDialogOptions): string {
  const url = new URL(FACEBOOK_OAUTH_DIALOG);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', META_OAUTH_SCOPES.join(','));
  if (authType) url.searchParams.set('auth_type', authType);
  return url.toString();
}

/** Redirect URI do fluxo — DEVE ser idêntico no diálogo, no exchange e
 *  no cadastro "Valid OAuth Redirect URIs" do app (senão a Meta devolve
 *  redirect_uri_mismatch). Override opcional via META_OAUTH_REDIRECT_URI. */
export function resolveMetaOAuthRedirectUri(): string | null {
  const override = process.env.META_OAUTH_REDIRECT_URI;
  if (override) return override.replace(/\/+$/, '');
  const base = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || '';
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/api/meta-ad-accounts/oauth/callback`;
}

// ============================================================
// Erros do DIÁLOGO (query params de volta ao callback)
// ============================================================

/** Normaliza o par (error, error_reason) do diálogo em código estável. */
export function normalizeOAuthDialogError(error: string | null, reason: string | null): string {
  const e = (error || '').toLowerCase();
  const r = (reason || '').toLowerCase();
  if (e === 'access_denied' || r === 'user_denied') return 'access_denied';
  if (e === 'server_error') return 'server_error';
  if (e === 'no_response' || e === 'unknown_error') return 'server_error';
  return e || 'unknown';
}

// ============================================================
// Escopos concedidos × exigidos (detecção de App Review pendente)
// ============================================================

/** Extrai os escopos de um debug_token. A Graph devolve duas formas
 *  conforme o token: granular_scopes [{scope, target_ids}] (moderno) ou
 *  scopes ["..."] (legado). Aceita ambas, tolerante a lixo. */
export function extractGrantedScopes(debugData: unknown): string[] {
  const granted = new Set<string>();
  const data = debugData as {
    granular_scopes?: Array<{ scope?: string } | string>;
    scopes?: Array<string> | string;
  } | null;
  if (!data) return [];
  if (Array.isArray(data.granular_scopes)) {
    for (const g of data.granular_scopes) {
      const name = typeof g === 'string' ? g : g?.scope;
      if (typeof name === 'string' && name) granted.add(name);
    }
  }
  if (Array.isArray(data.scopes)) {
    for (const s of data.scopes) if (typeof s === 'string' && s) granted.add(s);
  } else if (typeof data.scopes === 'string') {
    for (const s of data.scopes.split(/[,\s]+/)) if (s) granted.add(s);
  }
  return Array.from(granted);
}

export function findMissingScopes(
  granted: string[],
  required: readonly string[] = META_OAUTH_REQUIRED_SCOPES,
): string[] {
  const have = new Set(granted);
  return required.filter((s) => !have.has(s));
}

// ============================================================
// Estado do token (b) — expiração e convite de reconexão
// ============================================================

export type AccountTokenStatus = 'unknown' | 'ok' | 'expiring' | 'expired' | 'permission_denied';

/** Janela de aviso antes da expiração (badge âmbar + convite de renovação). */
export const TOKEN_EXPIRING_WINDOW_DAYS = 7;

export function daysUntil(date: Date | string | null | undefined, now: Date = new Date()): number | null {
  if (!date) return null;
  const t = typeof date === 'string' ? new Date(date) : date;
  const ms = t.getTime() - now.getTime();
  if (Number.isNaN(ms)) return null;
  return Math.ceil(ms / 86_400_000);
}

/** Status derivado da expiração do token (fonte: tokenExpiresAt). */
export function classifyTokenStatus(
  tokenExpiresAt: Date | string | null | undefined,
  now: Date = new Date(),
): AccountTokenStatus {
  if (!tokenExpiresAt) return 'unknown';
  const d = daysUntil(tokenExpiresAt, now);
  if (d === null) return 'unknown';
  if (d <= 0) return 'expired';
  if (d <= TOKEN_EXPIRING_WINDOW_DAYS) return 'expiring';
  return 'ok';
}

/** Status final da conta: expiração COMPUTADA vence o status armazenado
 *  (pode estar defasado), depois permissão negada armazenada, depois
 *  expired armazenado (token marcado em runtime sem expiresAt salvo). */
export function resolveAccountAuthStatus(
  account: { authStatus?: string | null; tokenExpiresAt?: Date | string | null },
  now: Date = new Date(),
): AccountTokenStatus {
  const computed = classifyTokenStatus(account.tokenExpiresAt ?? null, now);
  if (computed === 'expired') return 'expired';
  if (computed === 'expiring') return 'expiring';
  const stored = account.authStatus;
  if (stored === 'permission_denied') return 'permission_denied';
  if (stored === 'expired') return 'expired';
  return computed === 'unknown' ? 'unknown' : 'ok';
}

// ============================================================
// Classificação de falhas Graph em runtime (b) — 190/200/10
// ============================================================

export type GraphAuthFailureKind = 'expired' | 'permission_denied' | 'transient';

/** 190 = token expirado/revogado/inválido; 200 e 10 = permissão negada
 *  (não aprovada no review ou revogada pelo usuário); 1..17/32/613 =
 *  rate limit/indisponibilidade (TRANSITÓRIO — não marca reconexão).
 *  null = erro não é de autenticação (não marcar a conta). */
export function classifyGraphAuthFailure(code: number | string | null | undefined): GraphAuthFailureKind | null {
  const n = typeof code === 'string' ? parseInt(code, 10) : code;
  if (n === undefined || n === null || Number.isNaN(n)) return null;
  if (n === 190 || n === 102) return 'expired';
  if (n === 200 || n === 10) return 'permission_denied';
  if ([1, 2, 3, 4, 17, 32, 613].includes(n)) return 'transient';
  return null;
}

/** Extrai o error.code da Graph API de uma mensagem crua (o polling
 *  lança `HTTP 400: {"error":{"code":190,...}}` como string). */
export function extractGraphErrorCode(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/"code"\s*:\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// ============================================================
// Erros do fluxo OAuth (troca/exchange/debug) — kinds estáveis que o
// callback converte em ?meta_oauth_error=<kind>
// ============================================================

export type MetaOAuthErrorKind =
  | 'app_credentials'
  | 'redirect_mismatch'
  | 'code_invalid_or_used'
  | 'token_exchange_failed'
  | 'app_mismatch'
  | 'graph_failed';

export class MetaOAuthError extends Error {
  kind: MetaOAuthErrorKind;
  detail?: string;
  graphCode?: number;

  constructor(kind: MetaOAuthErrorKind, message: string, options?: { detail?: string; graphCode?: number }) {
    super(message);
    this.name = 'MetaOAuthError';
    this.kind = kind;
    this.detail = options?.detail;
    this.graphCode = options?.graphCode;
  }
}

const GRAPH_TIMEOUT_MS = 10_000;

/** Mapeia o corpo de erro da Graph para o kind estável do fluxo. */
function mapGraphErrorToKind(parsed: { message?: string; code?: number }): MetaOAuthError {
  const message = parsed?.message || 'Erro desconhecido da Graph API';
  const code = typeof parsed?.code === 'number' ? parsed.code : undefined;
  if (message.toLowerCase().includes('redirect_uri')) {
    return new MetaOAuthError('redirect_mismatch', 'redirect_uri não registrado no app da Meta', { detail: message, graphCode: code });
  }
  if (code === 190 && /code(.+)was(.+)invalid|invalid authorization code/i.test(message)) {
    return new MetaOAuthError('code_invalid_or_used', 'Código de autorização inválido ou já utilizado', { detail: message, graphCode: code });
  }
  if (code === 101 || code === 190 || /invalid.{0,20}(app|application|client|secret)/i.test(message)) {
    return new MetaOAuthError('app_credentials', 'App ID ou App Secret inválidos', { detail: message, graphCode: code });
  }
  return new MetaOAuthError('token_exchange_failed', 'Falha na troca de token com a Meta', { detail: message, graphCode: code });
}

async function graphGetJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GRAPH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    const text = await response.text().catch(() => '');
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    if (!response.ok) {
      const err = data?.error || {};
      throw mapGraphErrorToKind({ message: err.message, code: err.code });
    }
    return data;
  } catch (e) {
    if (e instanceof MetaOAuthError) throw e;
    if (e instanceof Error && e.name === 'AbortError') {
      throw new MetaOAuthError('graph_failed', 'Timeout na Graph API');
    }
    throw new MetaOAuthError('graph_failed', e instanceof Error ? e.message : 'Falha de rede na Graph API');
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================
// I/O Graph — troca de tokens, debug, listagem de ativos
// ============================================================

export interface TokenExchangeResult {
  accessToken: string;
  tokenType?: string;
  expiresIn?: number | null;
}

export interface MetaAppCredentialsInput {
  appId: string;
  appSecret: string;
}

/** code (10 min, uso único) → access token de CURTA duração. */
export async function exchangeCodeForToken(
  creds: MetaAppCredentialsInput,
  code: string,
  redirectUri: string,
): Promise<TokenExchangeResult> {
  const url =
    `${GRAPH_API_BASE}/oauth/access_token?client_id=${encodeURIComponent(creds.appId)}` +
    `&client_secret=${encodeURIComponent(creds.appSecret)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&code=${encodeURIComponent(code)}`;
  try {
    const data = await graphGetJson(url);
    if (!data?.access_token) {
      throw new MetaOAuthError('token_exchange_failed', 'Resposta sem access_token na troca do código');
    }
    return { accessToken: data.access_token, tokenType: data.token_type, expiresIn: data.expires_in ?? null };
  } catch (e) {
    if (e instanceof MetaOAuthError) throw e;
    throw new MetaOAuthError('token_exchange_failed', e instanceof Error ? e.message : 'Falha na troca do código');
  }
}

/** Token curto → LONGA duração (~60 dias) via fb_exchange_token. */
export async function exchangeLongLivedToken(
  creds: MetaAppCredentialsInput,
  shortLivedToken: string,
): Promise<TokenExchangeResult> {
  const url =
    `${GRAPH_API_BASE}/oauth/access_token?grant_type=fb_exchange_token` +
    `&client_id=${encodeURIComponent(creds.appId)}` +
    `&client_secret=${encodeURIComponent(creds.appSecret)}` +
    `&fb_exchange_token=${encodeURIComponent(shortLivedToken)}`;
  const data = await graphGetJson(url);
  if (!data?.access_token) {
    throw new MetaOAuthError('token_exchange_failed', 'Resposta sem access_token na extensão do token');
  }
  return { accessToken: data.access_token, tokenType: data.token_type, expiresIn: data.expires_in ?? null };
}

export interface TokenInspection {
  isValid: boolean;
  appId?: string;
  userId?: string;
  /** Data de expiração (epoch s → Date). 0 = não expira (System User). */
  expiresAt: Date | null;
  neverExpires: boolean;
  scopes: string[];
}

/** debug_token com APP TOKEN (app_id|app_secret): prova o token contra
 *  a Meta, revela o app emissor, a expiração REAL e os escopos concedidos
 *  (granular_scopes) — base do diagnóstico 'missing_permissions'. */
export async function debugAccessToken(
  creds: MetaAppCredentialsInput,
  inputToken: string,
): Promise<TokenInspection> {
  const appToken = `${creds.appId}|${creds.appSecret}`;
  const url = `${GRAPH_API_BASE}/debug_token?input_token=${encodeURIComponent(inputToken)}&access_token=${encodeURIComponent(appToken)}`;
  const data = await graphGetJson(url);
  const d = data?.data || {};
  const neverExpires = d.expires_at === 0;
  return {
    isValid: !!d.is_valid,
    appId: d.app_id || undefined,
    userId: d.user_id || undefined,
    expiresAt: neverExpires || !d.expires_at ? null : new Date(d.expires_at * 1000),
    neverExpires,
    scopes: extractGrantedScopes(d),
  };
}

export interface GrantedAdAccount {
  id: string;
  accountId?: string;
  name: string;
  currency?: string;
  /** 1 = ACTIVE (apenas estas viram contas no CRM). */
  status?: number;
}

/** /me/adaccounts com o token do usuário — contas que ele autorizou
 *  compartilhar. Paginação simples (até 5 páginas de 100). */
export async function fetchUserAdAccounts(userToken: string): Promise<GrantedAdAccount[]> {
  const out: GrantedAdAccount[] = [];
  let after: string | null = null;
  for (let page = 0; page < 5; page++) {
    const url =
      `${GRAPH_API_BASE}/me/adaccounts?fields=id,account_id,name,currency,account_status` +
      `&limit=100&access_token=${encodeURIComponent(userToken)}` +
      (after ? `&after=${encodeURIComponent(after)}` : '');
    const data = await graphGetJson(url);
    for (const a of data?.data || []) {
      if (!a?.id) continue;
      out.push({ id: a.id, accountId: a.account_id, name: a.name || '', currency: a.currency, status: a.account_status });
    }
    after = data?.paging?.cursors?.after || null;
    if (!after || !(data?.data?.length > 0)) break;
  }
  return out;
}

export interface GrantedPage {
  id: string;
  name: string;
  /** Page access token — NÃO expira junto com o token do usuário. */
  accessToken?: string;
}

/** /me/accounts — páginas do usuário (com page tokens quando possível). */
export async function fetchUserPages(userToken: string): Promise<GrantedPage[]> {
  const out: GrantedPage[] = [];
  let after: string | null = null;
  for (let page = 0; page < 5; page++) {
    const url =
      `${GRAPH_API_BASE}/me/accounts?fields=id,name,access_token&limit=100` +
      `&access_token=${encodeURIComponent(userToken)}` +
      (after ? `&after=${encodeURIComponent(after)}` : '');
    const data = await graphGetJson(url);
    for (const p of data?.data || []) {
      if (!p?.id) continue;
      out.push({ id: p.id, name: p.name || '', accessToken: p.access_token || undefined });
    }
    after = data?.paging?.cursors?.after || null;
    if (!after || !(data?.data?.length > 0)) break;
  }
  return out;
}

/** /{act_id}/promote_pages — páginas que ANUNCIAM para a conta. É o
 *  mapeamento preciso página → conta usado para preencher pageIds/
 *  pageTokens de cada conta criada (webhook resolve a conta por page id). */
export async function fetchAccountPromotablePages(userToken: string, adAccountId: string): Promise<GrantedPage[]> {
  const url =
    `${GRAPH_API_BASE}/${encodeURIComponent(adAccountId)}/promote_pages` +
    `?fields=id,name,access_token&limit=100&access_token=${encodeURIComponent(userToken)}`;
  const data = await graphGetJson(url);
  return (data?.data || [])
    .filter((p: any) => p?.id)
    .map((p: any) => ({ id: String(p.id), name: p.name || '', accessToken: p.access_token || undefined }));
}
