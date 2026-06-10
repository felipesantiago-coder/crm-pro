import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getAuthUrl } from '@/lib/google-calendar';
import { randomUUID } from 'crypto';

// GET /api/google-calendar/auth — Redirect to Google OAuth
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const state = randomUUID();
    const authUrl = getAuthUrl(state);

    // Redirect to Google
    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error('[Google Calendar] Auth error:', error);
    return NextResponse.json(
      { error: 'Erro ao iniciar conexão com Google Calendar. Verifique se as variáveis de ambiente estão configuradas.' },
      { status: 500 }
    );
  }
}