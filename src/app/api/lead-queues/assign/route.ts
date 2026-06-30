import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * PUBLIC — used by landing page form submissions or Meta webhook.
 * Assigns a lead to the next user in the queue and returns their info.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { leadId, queueId, source } = body;

    // Find queue
    const queue = await db.leadQueue.findFirst({
      where: {
        ...(queueId ? { id: queueId } : { isDefault: true }),
        isActive: true,
      },
      include: {
        members: {
          where: { isActive: true },
          include: { user: { select: { id: true, name: true, phone: true } } },
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!queue || queue.members.length === 0) {
      return NextResponse.json({ assigned: false, message: 'Nenhuma fila ativa com membros' });
    }

    const idx = queue.currentIdx % queue.members.length;
    const member = queue.members[idx];

    // Advance counter + create assignment in transaction
    await db.$transaction([
      db.leadQueue.update({
        where: { id: queue.id },
        data: { currentIdx: { increment: 1 } },
      }),
      db.leadQueueAssignment.create({
        data: {
          queueId: queue.id,
          userId: member.userId,
          leadId: leadId || null,
          source: source || 'api',
        },
      }),
    ]);

    return NextResponse.json({
      assigned: true,
      userId: member.userId,
      userName: member.user.name,
      userPhone: member.user.phone,
      queueId: queue.id,
    });
  } catch (error) {
    console.error('[Queue Assign] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}