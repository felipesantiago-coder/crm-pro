import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import crypto from 'crypto';
import { buildCalendarConsentUrl } from '@/lib/google-calendar';

// GET /api/google-calendar/auth — Inicia o fluxo OAuth do Google Calendar.
//
// O frontend navega DIRETO para esta rota (window.location.href no botão
// "Conectar Google Calendar"), então TODAS as respostas devem ser redirects
// (30x). Devolver JSON aqui renderiza o JSON cru no navegador — bug histórico
// desta rota. Em caso de erro, volta para / com ?google_calendar_error=<code>,
// que o SettingsView converte em toast (mesmo contrato do callback).
function errorRedirect(code: string): NextResponse {
  return NextResponse.redirect(
    `${process.env.NEXTAUTH_URL || ''}/?google_calendar_error=${code}`
  );
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return errorRedirect('unauthorized');
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = `${process.env.NEXTAUTH_URL || ''}/api/google-calendar/callback`;

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
