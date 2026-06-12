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
    const error = searchParams.get('error');

    if (error) {
      console.error('[Google Calendar] OAuth error:', error);
      return NextResponse.redirect(`${process.env.NEXTAUTH_URL || ''}/?google_calendar_error=${error}`);
    }

    if (!code) {
      return NextResponse.redirect(`${process.env.NEXTAUTH_URL || ''}/?google_calendar_error=no_code`);
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
    const msg = error instanceof Error ? error.message : 'Erro desconhecido';
    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL || ''}/?google_calendar_error=${encodeURIComponent(msg)}`
    );
  }
}