import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { resolveGoogleRedirectUri } from '@/lib/google-calendar';

// GET /api/google-calendar/status — Check if user has connected Google Calendar
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const token = await db.googleCalendarToken.findUnique({
      where: { userId: session.user.id },
      select: { createdAt: true, expiresAt: true },
    });

    const isConnected = !!token;

    // Diagnóstico OAuth: o redirect_uri EFETIVO que a rota de auth envia ao
    // Google. Precisa ser IDÊNTICO ao registrado no Google Cloud Console
    // ("URIs de redirecionamento autorizados") — qualquer divergência gera
    // `Erro 400: redirect_uri_mismatch` na tela de consentimento.
    let redirectUri: string | null = null;
    let redirectUriSource: 'GOOGLE_REDIRECT_URI' | 'NEXTAUTH_URL' = 'NEXTAUTH_URL';
    try {
      redirectUri = resolveGoogleRedirectUri();
      if (process.env.GOOGLE_REDIRECT_URI) {
        redirectUriSource = 'GOOGLE_REDIRECT_URI';
      }
    } catch {
      redirectUri = null; // envs ausentes — a rota de auth devolverá not_configured
    }

    return NextResponse.json({
      connected: isConnected,
      connectedAt: token?.createdAt || null,
      expiresAt: token?.expiresAt || null,
      redirectUri,
      redirectUriSource,
    });
  } catch (error) {
    console.error('[Google Calendar] Status error:', error);
    // Se a tabela não existe, retorna desconectado
    return NextResponse.json({ connected: false, connectedAt: null, expiresAt: null });
  }
}