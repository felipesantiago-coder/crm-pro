import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

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

    // Atomic round-robin: read currentIdx INSIDE the transaction to prevent race conditions
    const result = await db.$transaction(async (tx) => {
      // Re-read queue with lock (row-level) to get the latest currentIdx
      const freshQueue = await tx.leadQueue.findUniqueOrThrow({
        where: { id: queue.id },
        select: { currentIdx: true },
      });

      // Also re-read active members inside the transaction
      const activeMembers = await tx.leadQueueMember.findMany({
        where: { queueId: queue.id, isActive: true },
        include: { user: { select: { id: true, name: true, phone: true } } },
        orderBy: { order: 'asc' },
      });

      if (activeMembers.length === 0) {
        return null;
      }

      const idx = freshQueue.currentIdx % activeMembers.length;
      const member = activeMembers[idx];

      // Advance counter + create assignment atomically
      await tx.leadQueue.update({
        where: { id: queue.id },
        data: { currentIdx: { increment: 1 } },
      });

      const assignment = await tx.leadQueueAssignment.create({
        data: {
          queueId: queue.id,
          userId: member.userId,
          leadId: leadId || null,
          source: source || 'api',
        },
      });

      return { member, assignment };
    }, {
      isolationLevel: 'Serializable',
      timeout: 10000,
    });

    if (!result) {
      return NextResponse.json({ assigned: false, message: 'Nenhum membro ativo na fila' });
    }

    return NextResponse.json({
      assigned: true,
      userId: result.member.userId,
      userName: result.member.user.name,
      userPhone: result.member.user.phone,
      queueId: queue.id,
    });
  } catch (error) {
    console.error('[Queue Assign] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}