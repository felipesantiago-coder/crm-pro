import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';

export async function GET() {
  try {
    const { error, session } = await requireAuth();
    if (error) return error;

    const user = await db.user.findUnique({
      where: { email: session!.user!.email },
      select: { id: true, role: true },
    });
    if (!user) return NextResponse.json([]);

    const now = new Date();

    const whereClause = user.role === 'ADMIN'
      ? { dueDate: { lte: now }, notified: false }
      : {
          dueDate: { lte: now },
          notified: false,
          userId: user.id,
        };

    const dueReminders = await db.reminder.findMany({
      where: whereClause,
      include: {
        client: {
          select: { id: true, name: true },
        },
      },
    });

    if (dueReminders.length > 0) {
      await db.reminder.updateMany({
        where: {
          id: { in: dueReminders.map((r) => r.id) },
        },
        data: { notified: true },
      });
    }

    return NextResponse.json(dueReminders);
  } catch {
    return NextResponse.json({ error: 'Erro ao verificar lembretes' }, { status: 500 });
  }
}