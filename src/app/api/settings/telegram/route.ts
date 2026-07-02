import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';

/**
 * GET /api/settings/telegram
 * Returns the current user's telegram configuration status.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const user = await db.user.findUnique({
      where: { email: session.user.email },
      select: { telegramChatId: true, name: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    return NextResponse.json({
      telegramChatId: user.telegramChatId || null,
      configured: !!user.telegramChatId,
      botConfigured: !!process.env.TELEGRAM_BOT_TOKEN,
    });
  } catch (error) {
    console.error('[Telegram Settings] GET error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

/**
 * PUT /api/settings/telegram
 * Saves the current user's telegramChatId.
 * Also accepts "disconnect" action to unlink.
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const body = await request.json();
    const { action, chatId } = body;

    const user = await db.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    if (action === 'disconnect') {
      await db.user.update({
        where: { id: user.id },
        data: { telegramChatId: null },
      });
      return NextResponse.json({ success: true, telegramChatId: null });
    }

    if (action === 'connect' && chatId) {
      // Check if this chatId is already claimed by another user
      const existingOwner = await db.user.findFirst({
        where: { telegramChatId: chatId },
        select: { id: true, name: true },
      });

      if (existingOwner && existingOwner.id !== user.id) {
        return NextResponse.json(
          { error: `Este chat ID já está vinculado a ${existingOwner.name}.` },
          { status: 409 },
        );
      }

      // Connect Telegram and deactivate Ntfy (mutual exclusion)
      await db.user.update({
        where: { id: user.id },
        data: { telegramChatId: String(chatId), ntfyTopic: null, ntfyToken: null },
      });
      return NextResponse.json({ success: true, telegramChatId: String(chatId) });
    }

    return NextResponse.json({ error: 'Ação inválida' }, { status: 400 });
  } catch (error) {
    console.error('[Telegram Settings] PUT error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}