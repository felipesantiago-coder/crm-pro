import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { sendNtfyTest } from '@/lib/ntfy';

/**
 * POST /api/ntfy/test
 * Sends a test notification to the current user's Ntfy topic.
 */
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const user = await db.user.findUnique({
      where: { email: session.user.email },
      select: { ntfyTopic: true, ntfyToken: true, name: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    if (!user.ntfyTopic) {
      return NextResponse.json(
        { error: 'Ntfy não está ativado. Ative nas configurações primeiro.' },
        { status: 400 },
      );
    }

    const sent = await sendNtfyTest(user.ntfyTopic, user.ntfyToken || '', user.name);

    if (sent) {
      return NextResponse.json({ success: true, message: 'Notificação de teste enviada!' });
    } else {
      return NextResponse.json(
        { error: 'Falha ao enviar notificação. Tente novamente.' },
        { status: 500 },
      );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Ntfy Test] Error:', msg, error);
    return NextResponse.json({ error: `Erro interno: ${msg}` }, { status: 500 });
  }
}