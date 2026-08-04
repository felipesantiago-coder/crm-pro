import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

// PATCH — toggle active / reorder member
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { id, memberId } = await params;
    const body = await request.json();
    const { isActive, order } = body;

    const member = await db.leadQueueMember.update({
      where: { id: memberId, queueId: id },
      data: {
        ...(isActive !== undefined ? { isActive } : {}),
        ...(order !== undefined ? { order: typeof order === 'number' ? order : 0 } : {}),
      },
      include: { user: { select: { id: true, name: true, email: true, phone: true, role: true } } },
    });

    return NextResponse.json(member);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: 'Membro não encontrado' }, { status: 404 });
    }
    console.error('[Queue Member] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// DELETE — remove member from queue
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { id, memberId } = await params;
    await db.leadQueueMember.delete({ where: { id: memberId, queueId: id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: 'Membro não encontrado' }, { status: 404 });
    }
    console.error('[Queue Member] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}