import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { sendTestNotification, isTelegramConfigured } from '@/lib/telegram';

/**
 * POST /api/telegram/test
 * Sends a test notification to the current user's Telegram.
 */
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    if (!isTelegramConfigured()) {
      return NextResponse.json(
        { error: 'O bot do Telegram não está configurado. Solicite ao administrador para configurar o TELEGRAM_BOT_TOKEN.' },
        { status: 400 },
      );
    }

    const user = await db.user.findUnique({
      where: { email: session.user.email },
      select: { telegramChatId: true, name: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    if (!user.telegramChatId) {
      return NextResponse.json(
        { error: 'Seu Telegram não está vinculado. Vincule primeiro pelo bot ou insira seu Chat ID.' },
        { status: 400 },
      );
    }

    const sent = await sendTestNotification(user.telegramChatId, user.name);

    if (sent) {
      return NextResponse.json({ success: true, message: 'Notificação de teste enviada!' });
    } else {
      return NextResponse.json(
        { error: 'Falha ao enviar notificação. Verifique se o Chat ID está correto.' },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error('[Telegram Test] Error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}