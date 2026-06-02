import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const now = new Date();

    const dueReminders = await db.reminder.findMany({
      where: {
        dueDate: { lte: now },
        notified: false,
      },
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
  } catch (error) {
    console.error('Error checking reminders:', error);
    return NextResponse.json({ error: 'Failed to check reminders' }, { status: 500 });
  }
}
