import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createHash, randomBytes } from 'node:crypto';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';

/**
 * POST /api/telegram/link-token
 *
 * Vinculação SEGURA do chat Telegram (§18.1): o CRM gera um token
 * aleatório de uso único com TTL curto; apenas o SHA-256 do token é
 * persistido. O usuário confirma a posse pelo bot via deep link
 * https://t.me/<bot>?start=<token-opaco>. Nenhum e-mail, id previsível
 * ou segredo de longa duração entra no deep link.
 *
 * Resposta: { deepLink, expiresAt, botUsername }
 */

const TOKEN_TTL_MS = 15 * 60_000;

/** Cache curto do username do bot (evita getMe a cada clique). */
let botUsernameCache: { username: string | null; expiresAt: number } = {
  username: null,
  expiresAt: 0,
};

async function resolveBotUsername(): Promise<string | null> {
  const envName = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '');
  if (envName) return envName;

  if (botUsernameCache.expiresAt > Date.now()) return botUsernameCache.username;

  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!token) return null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await res.json();
    const username: string | null = data?.ok ? data.result?.username || null : null;
    botUsernameCache = { username, expiresAt: Date.now() + 60 * 60_000 };
    return username;
  } catch {
    botUsernameCache = { username: null, expiresAt: Date.now() + 5 * 60_000 };
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // Rate limit: no máximo 5 tokens a cada 5 minutos por IP
    const limited = rateLimit(request, {
      maxRequests: 5,
      windowSeconds: 300,
      keyPrefix: 'telegram-link-token',
    });
    if (limited) return limited;

    const user = await db.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, name: true, telegramChatId: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }
    if (user.telegramChatId) {
      return NextResponse.json(
        { error: 'Seu Telegram já está vinculado. Desvincule antes de gerar um novo convite.' },
        { status: 409 },
      );
    }

    const botUsername = await resolveBotUsername();
    if (!botUsername) {
      return NextResponse.json(
        { error: 'Bot do Telegram indisponível no momento. Tente novamente em instantes.' },
        { status: 503 },
      );
    }

    // Token opaco: 48 caracteres hex (24 bytes de entropia)
    const token = randomBytes(24).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    // Housekeeping: limpa tokens expirados/consumidos deste usuário
    await db.telegramLinkToken.deleteMany({
      where: {
        userId: user.id,
        OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }],
      },
    }).catch(() => {});

    await db.telegramLinkToken.create({
      data: { tokenHash, userId: user.id, expiresAt },
    });

    const deepLink = `https://t.me/${botUsername}?start=${token}`;

    return NextResponse.json({
      deepLink,
      expiresAt: expiresAt.toISOString(),
      botUsername,
    });
  } catch (error) {
    console.error('[Telegram Link Token] Error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
