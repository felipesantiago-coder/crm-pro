import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';

/**
 * GET /api/settings/ntfy/credentials
 * Returns the user's Ntfy token (for displaying credentials on settings page).
 * The token is NOT returned in the standard GET /api/settings/ntfy for security.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const user = await db.user.findUnique({
      where: { email: session.user.email },
      select: { ntfyTopic: true, ntfyToken: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    if (!user.ntfyTopic || !user.ntfyToken) {
      return NextResponse.json(
        { error: 'Ntfy não está ativado' },
        { status: 400 },
      );
    }

    const ntfyBaseUrl = (process.env.NTFY_BASE_URL || 'https://ntfy.sh').replace(/\/+$/, '');

    return NextResponse.json({
      ntfyTopic: user.ntfyTopic,
      ntfyToken: user.ntfyToken,
      subscribeUrl: `${ntfyBaseUrl}/${user.ntfyTopic}`,
    });
  } catch (error) {
    console.error('[Ntfy Credentials] GET error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}