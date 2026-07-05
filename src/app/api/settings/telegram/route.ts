import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';

// Cache do bot username para evitar chamar getMe a cada request
let cachedBotUsername: string | null = null;
let botUsernameFetchTime = 0;
const BOT_USERNAME_CACHE_TTL = 60 * 60 * 1000; // 1 hora

/**
 * Obtém o username do bot via API do Telegram (com cache).
 * Usa a env var TELEGRAM_BOT_USERNAME se disponível.
 */
async function getBotUsername(): Promise<string | null> {
  // Prioridade 1: env var direta
  if (process.env.TELEGRAM_BOT_USERNAME) {
    return process.env.TELEGRAM_BOT_USERNAME.replace('@', '');
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  // Prioridade 2: cache em memória
  const now = Date.now();
  if (cachedBotUsername && now - botUsernameFetchTime < BOT_USERNAME_CACHE_TTL) {
    return cachedBotUsername;
  }

  // Prioridade 3: chamar getMe
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json();
    if (data.ok && data.result?.username) {
      cachedBotUsername = data.result.username;
      botUsernameFetchTime = now;
      return cachedBotUsername;
    }
  } catch (error) {
    console.error('[Telegram Settings] Failed to get bot username:', error);
  }

  return null;
}

/**
 * GET /api/settings/telegram
 * Returns the current user's telegram configuration status + deep link.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const user = await db.user.findUnique({
      where: { email: session.user.email },
      select: { telegramChatId: true, name: true, email: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    const botUsername = await getBotUsername();

    // Gerar deep link para conexão em 1 clique
    let deepLink: string | null = null;
    if (botUsername) {
      deepLink = `https://t.me/${botUsername}?start=${encodeURIComponent(user.email)}`;
    }

    return NextResponse.json({
      telegramChatId: user.telegramChatId || null,
      configured: !!user.telegramChatId,
      botConfigured: !!process.env.TELEGRAM_BOT_TOKEN,
      botUsername: botUsername || null,
      deepLink,
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