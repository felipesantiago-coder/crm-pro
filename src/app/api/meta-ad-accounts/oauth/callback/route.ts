import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import {
  META_OAUTH_STATE_COOKIE,
  MetaOAuthError,
  debugAccessToken,
  exchangeCodeForToken,
  exchangeLongLivedToken,
  fetchUserAdAccounts,
  fetchUserPages,
  findMissingScopes,
  normalizeOAuthDialogError,
  resolveMetaOAuthRedirectUri,
  verifyOAuthState,
} from '@/lib/meta-oauth';
import { persistOAuthConnection, resolveMetaAppCredentials } from '@/lib/meta-oauth-server';

// ============================================================
// GET /api/meta-ad-accounts/oauth/callback
// Recebe o retorno do diálogo da Meta e conclui a conexão:
//
//   1. Erros do diálogo (access_denied etc.) → classificados
//   2. State (cookie HMAC) verificado — CSRF + TTL de 10 min
//   3. code → token curto → token LONGA duração (~60 dias)
//   4. debug_token → validade, app emissor, expiração, ESCOPOS
//      └─ escopo exigente ausente → ?meta_oauth_error=missing_permissions
//         &scopes=... (APP REVIEW PENDENTE — (a))
//   5. /me/adaccounts (só ATIVAS) + /me/accounts
//   6. persistOAuthConnection:
//      ?reconnect → atualiza o token da conta alvo ((b) Reconectar)
//      padrão     → cria UMA linha por conta ATIVA autorizada
//                   (existentes são PULADAS, nunca sobrescritas)
//   7. Redirect /?meta_oauth=connected|reconnected (toast no app)
// ============================================================

export const dynamic = 'force-dynamic';
// Exchange + debug + listagens + promote_pages por conta: margem além
// do default de 10s (serverless).
export const maxDuration = 30;

function errorRedirect(code: string, extra?: Record<string, string | undefined>): NextResponse {
  const url = new URL('/', process.env.NEXTAUTH_URL || 'http://localhost:3000');
  url.searchParams.set('meta_oauth_error', code);
  for (const [k, v] of Object.entries(extra || {})) {
    if (v) url.searchParams.set(k, v.slice(0, 300));
  }
  const res = NextResponse.redirect(url.toString());
  res.cookies.delete(META_OAUTH_STATE_COOKIE);
  return res;
}

function successRedirect(params: Record<string, string>): NextResponse {
  const url = new URL('/', process.env.NEXTAUTH_URL || 'http://localhost:3000');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url.toString());
  res.cookies.delete(META_OAUTH_STATE_COOKIE);
  return res;
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);

    // 1. Erros devolvidos PELO DIÁLOGO da Meta (usuário cancelou, etc.)
    const dialogError = url.searchParams.get('error');
    if (dialogError) {
      return errorRedirect(normalizeOAuthDialogError(dialogError, url.searchParams.get('error_reason')), {
        detail: url.searchParams.get('error_description') || undefined,
      });
    }

    // Sessão: o admin precisa continuar logado no retorno.
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== 'ADMIN') {
      return errorRedirect('unauthorized');
    }

    const code = url.searchParams.get('code');
    const stateCookie = request.cookies.get(META_OAUTH_STATE_COOKIE)?.value;
    if (!code || !stateCookie) {
      return errorRedirect('invalid_state');
    }

    // 2. Credenciais + verificação do state (HMAC + TTL)
    const creds = await resolveMetaAppCredentials();
    if (!creds) {
      return errorRedirect('not_configured');
    }
    const stateSecret = process.env.NEXTAUTH_SECRET || process.env.NEXTAUTH_URL || creds.appSecret;
    const statePayload = verifyOAuthState(stateCookie, stateSecret);
    if (!statePayload) {
      return errorRedirect('invalid_state');
    }

    const redirectUri = resolveMetaOAuthRedirectUri();
    if (!redirectUri) {
      return errorRedirect('not_configured');
    }

    // 3. Troca do código por token (curto → LONGA duração)
    let token: string;
    let tokenExpiresAt: Date | null;
    let shortLivedFallback = false;
    try {
      const shortToken = await exchangeCodeForToken(creds, code, redirectUri);
      try {
        const longToken = await exchangeLongLivedToken(creds, shortToken.accessToken);
        token = longToken.accessToken;
        tokenExpiresAt = longToken.expiresIn
          ? new Date(Date.now() + longToken.expiresIn * 1000)
          : null;
      } catch (e) {
        // Fallback: token curto ainda funciona (~1h) — conecta com aviso
        // explícito em vez de falhar a conexão inteira.
        shortLivedFallback = true;
        token = shortToken.accessToken;
        tokenExpiresAt = new Date(Date.now() + 55 * 60 * 1000);
        console.warn('[Meta OAuth] Extensão para longa duração falhou (fallback curto):',
          e instanceof MetaOAuthError ? e.message : e);
      }
    } catch (e) {
      if (e instanceof MetaOAuthError) {
        return errorRedirect(e.kind, { detail: e.detail || e.message });
      }
      return errorRedirect('token_exchange_failed', { detail: e instanceof Error ? e.message : String(e) });
    }

    // 4. Prova o token contra a Meta + ESCOPOS concedidos
    let inspection;
    try {
      inspection = await debugAccessToken(creds, token);
    } catch (e) {
      if (e instanceof MetaOAuthError) {
        return errorRedirect(e.kind, { detail: e.detail || e.message });
      }
      return errorRedirect('graph_failed', { detail: e instanceof Error ? e.message : String(e) });
    }
    if (!inspection.isValid) {
      return errorRedirect('token_exchange_failed', { detail: 'Token devolvido pela Meta inválido (debug_token)' });
    }
    if (inspection.appId && inspection.appId !== creds.appId) {
      return errorRedirect('app_mismatch', { detail: inspection.appId });
    }

    // ── (a) PERMISSÃO NÃO APROVADA: a Meta omite do diálogo permissões
    // sem Advanced Access — a falta aparece AQUI, no token real. ──
    const missing = findMissingScopes(inspection.scopes);
    if (missing.length > 0) {
      return errorRedirect('missing_permissions', { scopes: missing.join(',') });
    }

    // 5. Ativos autorizados (contas ATIVAS + páginas)
    let adAccounts;
    try {
      adAccounts = (await fetchUserAdAccounts(token)).filter((a) => a.status === undefined || a.status === 1);
    } catch (e) {
      return errorRedirect(e instanceof MetaOAuthError ? e.kind : 'graph_failed', {
        detail: e instanceof MetaOAuthError ? (e.detail || e.message) : e instanceof Error ? e.message : String(e),
      });
    }
    if (adAccounts.length === 0) {
      return errorRedirect('no_ad_accounts');
    }
    let pages = [] as Awaited<ReturnType<typeof fetchUserPages>>;
    try {
      pages = await fetchUserPages(token);
    } catch (e) {
      console.warn('[Meta OAuth] /me/accounts falhou (seguindo sem pages):', e instanceof Error ? e.message : e);
    }

    // 6. Persistência
    const result = await persistOAuthConnection({
      token,
      tokenExpiresAt,
      appId: creds.appId,
      appSecret: creds.appSecret,
      adAccounts,
      pages,
      reconnectAccountId: statePayload.r || null,
    });

    if (result.mode === 'reconnect') {
      return successRedirect({
        meta_oauth: 'reconnected',
        name: result.account.name,
        ...(shortLivedFallback ? { short_lived: '1' } : {}),
      });
    }

    if (result.created.length === 0) {
      return errorRedirect('all_accounts_exist', {
        detail: 'use "Reconectar com o Facebook" no card da conta para renovar o token',
      });
    }

    return successRedirect({
      meta_oauth: 'connected',
      accounts: String(result.created.length),
      skipped: String(result.skipped.length),
      ...(shortLivedFallback ? { short_lived: '1' } : {}),
    });
  } catch (error) {
    console.error('[Meta OAuth] callback falhou:', error);
    if (error instanceof Error && error.message === 'account_not_found') {
      return errorRedirect('account_not_found');
    }
    return errorRedirect('server_error');
  }
}
