import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import crypto from 'crypto';

// GET /api/google-calendar/auth — Inicia o fluxo OAuth do Google Calendar
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = `${process.env.NEXTAUTH_URL || ''}/api/google-calendar/callback`;

    if (!clientId) {
      return NextResponse.json(
        { error: 'Google Calendar não configurado. Contate o administrador.' },
        { status: 500 }
      );
    }

    // Gerar state com userId + random hex para proteção CSRF
    const state = `${session.user.id}:${crypto.randomBytes(16).toString('hex')}`;

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    return NextResponse.json({ url: authUrl });
  } catch (error) {
    console.error('[Google Calendar] Auth error:', error);
    return NextResponse.json(
      { error: 'Erro ao iniciar conexão com Google Calendar' },
      { status: 500 }
    );
  }
}
