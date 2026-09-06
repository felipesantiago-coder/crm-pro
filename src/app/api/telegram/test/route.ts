import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { isTelegramConfigured } from '@/lib/telegram';
import { sendLeadCardTest } from '@/lib/lead-notify/service';

/**
 * POST /api/telegram/test
 *
 * Envia a PRÉVIA REAL do cartão de lead ao chat do usuário: usa exatamente
 * o mesmo compositor e cliente de entrega da produção, com eventKind
 * 'test' e dados explicitamente fictícios (§19). Nenhum lead real é
 * criado e nenhum dado real de cliente é enviado.
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
      select: { id: true, telegramChatId: true, name: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    if (!user.telegramChatId) {
      return NextResponse.json(
        { error: 'Seu Telegram não está vinculado. Use o botão "Vincular Telegram".' },
        { status: 400 },
      );
    }

    const result = await sendLeadCardTest(user.telegramChatId, user.id, user.name);

    if (result.ok) {
      const parcial = result.status === 'partial';
      return NextResponse.json({
        success: true,
        status: result.status,
        message: parcial
          ? 'Prévia enviada parcialmente — parte do cartão falhou. Verifique o diagnóstico.'
          : 'Prévia enviada! Confira o cartão no seu Telegram.',
      });
    }

    const errorCode = result.messages.find((m) => !m.delivered)?.errorCode;
    const friendly =
      errorCode === 'bot_blocked'
        ? 'Você bloqueou o bot — desbloqueie e tente novamente.'
        : errorCode === 'chat_not_found'
          ? 'Chat não encontrado — vincule seu Telegram novamente.'
          : 'Falha ao enviar a prévia. Tente novamente em instantes.';

    return NextResponse.json(
      { error: friendly, status: result.status, errorCode },
      { status: 500 },
    );
  } catch (error) {
    console.error('[Telegram Test] Error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
