import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import crypto from 'crypto';
import {
  buildCalendarConsentUrl,
  resolveGoogleRedirectUriForRequest,
  resolveOAuthRequestOrigin,
} from '@/lib/google-calendar';

// GET /api/google-calendar/auth — Inicia o fluxo OAuth do Google Calendar.
//
// O frontend navega DIRETO para esta rota (window.location.href no botão
// "Conectar Google Calendar"), então TODAS as respostas devem ser redirects
// (30x). Devolver JSON aqui renderiza o JSON cru no navegador — bug histórico
// desta rota. Em caso de erro, volta para / com ?google_calendar_error=<code>,
// que o SettingsView converte em toast (mesmo contrato do callback).
//
// O redirect_uri é derivado da ORIGEM da requisição (irmão www↔apex do
// canônico ou allowlist GOOGLE_OAUTH_REDIRECT_ORIGINS) para que o callback
// volte ao host onde a sessão existe. Valor derivado precisa estar
// registrado no Google Cloud Console (redirect_uri_mismatch senão).
function errorRedirect(code: string): NextResponse {
  return NextResponse.redirect(
    `${process.env.NEXTAUTH_URL || ''}/?google_calendar_error=${code}`
  );
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return errorRedirect('unauthorized');
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;

    // redirect_uri derivado da ORIGEM desta requisição — o usuário pode
    // estar num host irmão (apex vs www); o callback precisa aterrar no
    // MESMO host onde a sessão (cookie host-scoped) existe. Em dev e no
    // host canônico o resultado é idêntico ao comportamento anterior.
    const requestOrigin = resolveOAuthRequestOrigin(request.headers, request.nextUrl.origin);
    const redirectUri = resolveGoogleRedirectUriForRequest(requestOrigin);

    if (!clientId) {
      return errorRedirect('not_configured');
    }

    // Gerar state com userId + random hex para proteção CSRF
    const state = `${session.user.id}:${crypto.randomBytes(16).toString('hex')}`;

    const authUrl = buildCalendarConsentUrl({ clientId, redirectUri, state });

    // Redirect (30x) → navegador segue direto para a tela de consentimento
    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error('[Google Calendar] Auth error:', error);
    return errorRedirect('auth_failed');
  }
}
