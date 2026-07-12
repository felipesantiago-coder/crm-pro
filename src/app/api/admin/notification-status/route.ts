import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { db } from '@/lib/db';

// GET /api/admin/notification-status — Retorna status de notificação de todos os usuários (admin only)
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const users = await db.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        telegramChatId: true,
        ntfyTopic: true,
        googleCalendarToken: { select: { createdAt: true } },
      },
      orderBy: { name: 'asc' },
    });

    // Retorna apenas booleans — não expõe dados sensíveis (chatId, token)
    const status = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      telegramConnected: !!u.telegramChatId,
      ntfyConnected: !!u.ntfyTopic,
      googleCalendarConnected: !!u.googleCalendarToken,
    }));

    return NextResponse.json(status);
  } catch (error) {
    console.error('[Admin] Erro ao buscar status de notificações:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}