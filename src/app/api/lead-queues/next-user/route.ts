import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * PUBLIC endpoint — no auth required.
 * Returns the next user in the queue for the landing page.
 * Supports lookup by: queueId (direct), slug (enterprise-linked queue), or default queue.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const queueId = searchParams.get('queueId');
    const slug = searchParams.get('slug');

    // Find the queue
    let queue;

    if (queueId) {
      // Direct queue ID lookup
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
    } else if (slug) {
      // Slug lookup: try to find a queue linked to this enterprise's slug first.
      // The queue name convention is the enterprise slug, but we also check description
      // and fall back to default queue if no slug-specific queue exists.
      queue = await db.leadQueue.findFirst({
        where: {
          OR: [
            { name: { equals: slug, mode: 'insensitive' } },
            { description: { equals: slug, mode: 'insensitive' } },
          ],
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

      // Fall back to default queue if no slug-specific queue found
      if (!queue) {
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
    } else {
      // No queueId, no slug — use default queue
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

    // Peek only — return current member WITHOUT advancing counter or creating assignment.
    // The counter only advances on actual lead assignment (form submit via /api/lead-queues/assign).
    // This prevents ghost assignments from page loads and double-advancing when form is submitted.
    const idx = queue.currentIdx % queue.members.length;
    const member = queue.members[idx];

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