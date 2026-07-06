import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getAuthUrl } from '@/lib/google-calendar';
import crypto from 'crypto';

// GET /api/google-calendar/auth — Inicia o fluxo OAuth do Google Calendar
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    if (!process.env.GOOGLE_CLIENT_ID) {
      return NextResponse.json(
        { error: 'Google Calendar não configurado. Contate o administrador.' },
        { status: 500 }
      );
    }

    // Gerar state com userId + random hex para proteção CSRF
    const state = `${session.user.id}:${crypto.randomBytes(16).toString('hex')}`;

    // Usa getAuthUrl da lib para garantir redirect_uri consistente com o callback
    const authUrl = getAuthUrl(state);

    return NextResponse.json({ url: authUrl });
  } catch (error) {
    console.error('[Google Calendar] Auth error:', error);
    return NextResponse.json(
      { error: 'Erro ao iniciar conexão com Google Calendar' },
      { status: 500 }
    );
  }
}
