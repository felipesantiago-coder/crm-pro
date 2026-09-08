import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import crypto from 'crypto';
import {
  META_OAUTH_STATE_COOKIE,
  META_OAUTH_STATE_TTL_MS,
  buildOAuthDialogUrl,
  resolveMetaOAuthRedirectUri,
  signOAuthState,
} from '@/lib/meta-oauth';
import { resolveMetaAppCredentials } from '@/lib/meta-oauth-server';

// ============================================================
// GET /api/meta-ad-accounts/oauth/start
// Inicia o Facebook Login for Business: valida admin, resolve as
// credenciais do app (env ou App Secret verificado em conta existente),
// emite um state assinado (HMAC, cookie httpOnly — CSRF stateless) e
// redireciona ao diálogo da Meta com TODAS as permissões pedidas em
// bloco único (META_OAUTH_SCOPES).
//
// ?accountId=<id> → modo RECONEXÃO (b): o callback atualiza o token
// DESTA conta em vez de criar novas linhas; usa auth_type=rerequest
// para re-perguntar permissões antes negadas.
//
// O frontend navega DIRETO para esta rota (window.location.href), então
// TODAS as respostas são redirects 30x; erros voltam como
// /?meta_oauth_error=<code> (contrato igual ao Google Calendar).
// ============================================================

export const dynamic = 'force-dynamic';

function errorRedirect(code: string, extra?: Record<string, string>): NextResponse {
  const url = new URL('/', process.env.NEXTAUTH_URL || 'http://localhost:3000');
  url.searchParams.set('meta_oauth_error', code);
  for (const [k, v] of Object.entries(extra || {})) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url.toString());
  // Nunca deixe um state órfão para trás.
  res.cookies.delete(META_OAUTH_STATE_COOKIE);
  return res;
}

/** Segredo do state: estável entre instâncias (o callback valida o
 *  HMAC) e exclusivo do deploy. NEXTAUTH_SECRET > App Secret do app. */
function resolveStateSecret(appSecret: string): string {
  return process.env.NEXTAUTH_SECRET || process.env.NEXTAUTH_URL || appSecret;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== 'ADMIN') {
      return errorRedirect('unauthorized');
    }

    const creds = await resolveMetaAppCredentials();
    if (!creds) {
      return errorRedirect('not_configured');
    }

    const redirectUri = resolveMetaOAuthRedirectUri();
    if (!redirectUri) {
      return errorRedirect('not_configured');
    }

    const accountId = new URL(request.url).searchParams.get('accountId') || null;
    if (accountId) {
      const { db } = await import('@/lib/db');
      const exists = await db.metaAdAccount.findUnique({ where: { id: accountId }, select: { id: true } });
      if (!exists) return errorRedirect('account_not_found');
    }

    const state = signOAuthState(
      { n: crypto.randomBytes(16).toString('hex'), t: Date.now(), ...(accountId ? { r: accountId } : {}) },
      resolveStateSecret(creds.appSecret),
    );

    const dialogUrl = buildOAuthDialogUrl({
      appId: creds.appId,
      redirectUri,
      state,
      authType: accountId ? 'rerequest' : undefined,
    });

    const res = NextResponse.redirect(dialogUrl);
    res.cookies.set(META_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax', // top-level redirect de volta precisa do cookie
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: Math.floor(META_OAUTH_STATE_TTL_MS / 1000),
    });
    return res;
  } catch (error) {
    console.error('[Meta OAuth] start falhou:', error);
    return errorRedirect('server_error');
  }
}
