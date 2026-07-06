import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';

// POST /api/google-calendar/disconnect — Remove Google Calendar tokens
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    await db.googleCalendarToken.deleteMany({
      where: { userId: session.user.id },
    });

    // Limpar googleCalendarEventId dos agendamentos deste usuário
    // (não deletamos os eventos do Google Calendar — o usuário pode querer mantê-los)
    await db.schedule.updateMany({
      where: { createdBy: session.user.id, googleCalendarEventId: { not: null } },
      data: { googleCalendarEventId: null },
    });

    // Limpar googleCalendarEventId dos lembretes vinculados a clientes deste usuário
    const userClientIds = await db.client.findMany({
      where: { createdBy: session.user.id },
      select: { id: true },
    });
    if (userClientIds.length > 0) {
      await db.reminder.updateMany({
        where: {
          clientId: { in: userClientIds.map(c => c.id) },
          googleCalendarEventId: { not: null },
        },
        data: { googleCalendarEventId: null },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Google Calendar] Disconnect error:', error);
    return NextResponse.json({ error: 'Erro ao desconectar' }, { status: 500 });
  }
}