import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * PUBLIC endpoint — no auth required.
 * Returns the next user in the default queue (or a specific queue) for the landing page.
 * The response includes the user's phone number for the WhatsApp CTA.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const queueId = searchParams.get('queueId');
    const slug = searchParams.get('slug');

    // Find the queue
    let queue;
    if (queueId) {
      queue = await db.leadQueue.findUnique({
        where: { id: queueId, isActive: true },
        include: {
          members: {
            where: { isActive: true },
            include: { user: { select: { id: true, name: true, phone: true } } },
            orderBy: { order: 'asc' },
          },
        },
      });
    } else {
      // Use default queue
      queue = await db.leadQueue.findFirst({
        where: { isDefault: true, isActive: true },
        include: {
          members: {
            where: { isActive: true },
            include: { user: { select: { id: true, name: true, phone: true } } },
            orderBy: { order: 'asc' },
          },
        },
      });
    }

    if (!queue || queue.members.length === 0) {
      return NextResponse.json({ 
        hasQueue: false, 
        message: queue ? 'Nenhum membro ativo na fila' : 'Nenhuma fila configurada' 
      });
    }

    // Round-robin: pick member at currentIdx
    const idx = queue.currentIdx % queue.members.length;
    const member = queue.members[idx];

    // Advance counter (atomic-ish via update)
    await db.leadQueue.update({
      where: { id: queue.id },
      data: { currentIdx: { increment: 1 } },
    });

    // Create assignment record (no lead yet — WhatsApp click)
    await db.leadQueueAssignment.create({
      data: {
        queueId: queue.id,
        userId: member.userId,
        source: slug ? `landing_page:${slug}` : 'landing_page',
      },
    });

    return NextResponse.json({
      hasQueue: true,
      userId: member.userId,
      userName: member.user.name,
      userPhone: member.user.phone,
    });
  } catch (error) {
    console.error('[Queue Next User] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}