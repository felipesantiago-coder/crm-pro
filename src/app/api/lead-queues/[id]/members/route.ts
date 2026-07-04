import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';

// GET — list members of a queue
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { id } = await params;
    const members = await db.leadQueueMember.findMany({
      where: { queueId: id },
      include: { user: { select: { id: true, name: true, email: true, phone: true, role: true } } },
      orderBy: { order: 'asc' },
    });

    return NextResponse.json(members);
  } catch (error) {
    console.error('[Queue Members] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// POST — add member to queue
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: 'Usuário é obrigatório' }, { status: 400 });
    }

    // Get current max order
    const maxOrder = await db.leadQueueMember.aggregate({
      where: { queueId: id },
      _max: { order: true },
    });

    const member = await db.leadQueueMember.create({
      data: {
        queueId: id,
        userId,
        order: (maxOrder._max.order ?? -1) + 1,
      },
      include: { user: { select: { id: true, name: true, email: true, phone: true, role: true } } },
    });

    return NextResponse.json(member, { status: 201 });
  } catch (error: unknown) {
    console.error('[Queue Members] Erro:', error);
    const msg = error instanceof Error && error.message.includes('Unique') 
      ? 'Este usuário já está na fila' 
      : 'Erro interno';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH — toggle active / reorder member (memberId in request body)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { memberId, isActive, order } = body;

    if (!memberId) {
      return NextResponse.json({ error: 'memberId é obrigatório' }, { status: 400 });
    }

    const member = await db.leadQueueMember.update({
      where: { id: memberId, queueId: id },
      data: {
        ...(isActive !== undefined ? { isActive } : {}),
        ...(order !== undefined ? { order } : {}),
      },
      include: { user: { select: { id: true, name: true, email: true, phone: true, role: true } } },
    });

    return NextResponse.json(member);
  } catch (error) {
    console.error('[Queue Member] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// DELETE — remove member from queue (memberId in request body)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { memberId } = body;

    if (!memberId) {
      return NextResponse.json({ error: 'memberId é obrigatório' }, { status: 400 });
    }

    // Get the deleted member's order before removing
    const member = await db.leadQueueMember.findUnique({
      where: { id: memberId, queueId: id },
      select: { order: true },
    });

    if (!member) {
      return NextResponse.json({ error: 'Membro não encontrado nesta fila' }, { status: 404 });
    }

    await db.leadQueueMember.delete({ where: { id: memberId, queueId: id } });

    // Re-index remaining members to close gaps and keep sequential order.
    // This prevents currentIdx from pointing to wrong members after removal.
    const remaining = await db.leadQueueMember.findMany({
      where: { queueId: id },
      select: { id: true, order: true },
      orderBy: { order: 'asc' },
    });

    if (remaining.length > 0) {
      // Batch update orders sequentially (0, 1, 2, ...)
      const updates = remaining.map((m, idx) =>
        db.leadQueueMember.update({
          where: { id: m.id },
          data: { order: idx },
        })
      );
      await db.$transaction(updates);
    }

    // Adjust currentIdx if it was pointing past the new end of the list
    if (remaining.length > 0) {
      const queue = await db.leadQueue.findUnique({
        where: { id },
        select: { currentIdx: true },
      });
      if (queue && queue.currentIdx >= remaining.length) {
        await db.leadQueue.update({
          where: { id },
          data: { currentIdx: queue.currentIdx % remaining.length },
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Queue Member] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}