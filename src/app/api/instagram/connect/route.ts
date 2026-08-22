import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import crypto from 'crypto';

// GET /api/instagram/connect — Inicia o fluxo OAuth do Instagram
export async function GET() {
  try {
    const { error, session } = await requireAdmin();
    if (error) return error;

    const appId = process.env.INSTAGRAM_APP_ID;
    if (!appId) {
      return NextResponse.json(
        { error: 'Instagram não configurado. Contate o administrador.' },
        { status: 500 },
      );
    }

    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json(
        { error: 'Segredo de proteção CSRF não configurado.' },
        { status: 500 },
      );
    }

    // Gerar state criptográfico: randomHex.hmacHex.userId
    const randomHex = crypto.randomBytes(32).toString('hex');
    const hmacHex = crypto
      .createHmac('sha256', cronSecret)
      .update(randomHex)
      .digest('hex');
    const state = `${randomHex}.${hmacHex}.${session.user.id}`;

    const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/instagram/callback`;

    const redirectUrl =
      `https://api.instagram.com/oauth/authorize?` +
      new URLSearchParams({
        client_id: appId,
        redirect_uri: callbackUrl,
        scope: 'instagram_basic,instagram_content_publish',
        response_type: 'code',
        state,
      }).toString();

    const response = NextResponse.redirect(redirectUrl);

    // Definir cookie com o randomHex para validação no callback
    response.cookies.set('ig_oauth_state', randomHex, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 600000, // 10 minutos
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('[INSTAGRAM CONNECT] Erro ao iniciar OAuth:', error);
    return NextResponse.json(
      { error: 'Erro ao iniciar conexão com Instagram' },
      { status: 500 },
    );
  }
}
