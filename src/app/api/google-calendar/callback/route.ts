import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import {
  exchangeCodeForTokens,
  resolveGoogleRedirectUriForRequest,
  resolveOAuthRequestOrigin,
} from '@/lib/google-calendar';
import { db } from '@/lib/db';

// GET /api/google-calendar/callback — Handle OAuth callback
//
// TODAS as respostas são redirects (o frontend navega direto para cá; JSON
// cru renderiza feio no navegador). O redirect_uri do exchange É O MESMO
// derivado por origem no /auth — o Google redireciona o navegador para o
// redirect_uri do consentimento, logo esta requisição chega no MESMO host
// onde a sessão (cookie host-scoped) existe.
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      // Diagnóstico do caso "Não autorizado" (2026-09): sessão não chegou
      // ao callback — causa clássica é o usuário navegar num host irmão
      // (apex vs www) com redirect_uri fixo no canônico (cookie host-scoped
      // não cruza hosts). Com redirect_uri por origem isso não deve ocorrer;
      // o log abaixo permite confirmar em produção SEM expor valores.
      const host =
        request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.nextUrl.host;
      const hasSessionCookie =
        request.cookies.has('__Secure-next-auth.session-token') ||
        request.cookies.has('next-auth.session-token');
      console.warn(
        `[Google Calendar] Callback sem sessão — host=${host} cookie-sessao=${hasSessionCookie ? 'presente' : 'ausente'} referer=${request.headers.get('referer') || 'n/a'}`,
      );
      return NextResponse.redirect(
        `${process.env.NEXTAUTH_URL || ''}/?google_calendar_error=session_expired`,
      );
    }

    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const oauthError = searchParams.get('error');
    const returnedState = searchParams.get('state');

    if (oauthError) {
      console.error('[Google Calendar] OAuth error:', oauthError);
      return NextResponse.redirect(`${process.env.NEXTAUTH_URL || ''}/?google_calendar_error=${oauthError}`);
    }

    if (!code) {
      return NextResponse.redirect(`${process.env.NEXTAUTH_URL || ''}/?google_calendar_error=no_code`);
    }

    // Validar state parameter (CSRF protection)
    if (!returnedState) {
      console.error('[Google Calendar] OAuth state ausente — possível ataque CSRF');
      return NextResponse.redirect(`${process.env.NEXTAUTH_URL || ''}/?google_calendar_error=invalid_state`);
    }

    // Verificar se o state contém o userId do usuário autenticado
    // Formato esperado: userId:randomHex (ex: "abc123:def456...")
    const [stateUserId] = returnedState.split(':');
    if (stateUserId !== session.user.id) {
      console.error('[Google Calendar] OAuth state userId não corresponde ao usuário autenticado');
      return NextResponse.redirect(`${process.env.NEXTAUTH_URL || ''}/?google_calendar_error=invalid_state`);
    }

    // Exchange code for tokens — redirect_uri IDÊNTICO ao do consentimento
    // (derivado da origem desta requisição: o Google mandou o navegador
    // exatamente para cá, então a origem aqui == origem do /auth)
    const requestOrigin = resolveOAuthRequestOrigin(request.headers, request.nextUrl.origin);
    const redirectUri = resolveGoogleRedirectUriForRequest(requestOrigin);
    const { accessToken, refreshToken, expiresAt } = await exchangeCodeForTokens(code, {
      redirectUri,
    });

    // Store tokens in DB (upsert for re-connections)
    await db.googleCalendarToken.upsert({
      where: { userId: session.user.id },
      update: {
        accessToken,
        refreshToken,
        expiresAt,
      },
      create: {
        userId: session.user.id,
        accessToken,
        refreshToken,
        expiresAt,
      },
    });

    // Redirect back to settings with success indicator
    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL || ''}/?google_calendar=connected`
    );
  } catch (error) {
    console.error('[Google Calendar] Callback error:', error);
    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL || ''}/?google_calendar_error=oauth_failed`
    );
  }
}
