import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { exchangeCodeForTokens } from '@/lib/google-calendar';
import { db } from '@/lib/db';

// GET /api/google-calendar/callback — Handle OAuth callback
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
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

    // Exchange code for tokens
    const { accessToken, refreshToken, expiresAt } = await exchangeCodeForTokens(code);

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
