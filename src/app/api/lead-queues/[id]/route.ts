import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { setNextUser } from '@/lib/lead-queue';

// GET — single queue with details
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
    const queue = await db.leadQueue.findUnique({
      where: { id },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true, phone: true, role: true } } },
          orderBy: { order: 'asc' },
        },
        assignments: {
          take: 50,
          include: { user: { select: { id: true, name: true, phone: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!queue) {
      return NextResponse.json({ error: 'Fila não encontrada' }, { status: 404 });
    }

    return NextResponse.json(queue);
  } catch (error) {
    console.error('[Lead Queue] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// PUT — update queue
export async function PUT(
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
    const { name, description, isActive, isDefault, nextUserId } = body;

    // Admin: manually set next user in queue
    if (nextUserId) {
      try {
        const result = await setNextUser(id, nextUserId);
        return NextResponse.json({ success: true, message: `Próximo atendente: ${result.userName}` });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Erro ao definir próximo atendente';
        return NextResponse.json({ error: msg }, { status: 400 });
      }
    }

    // Batch transaction: unset isDefault on others, then update queue.
    // Uses batch $transaction (array form) — compatible with PgBouncer.
    const operations: Prisma.PrismaPromise<unknown>[] = [];
    if (isDefault) {
      operations.push(
        db.leadQueue.updateMany({
          where: { isDefault: true, NOT: { id } },
          data: { isDefault: false },
        }),
      );
    }
    operations.push(
      db.leadQueue.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name: String(name).trim().slice(0, 200) } : {}),
          ...(description !== undefined ? { description: description ? String(description).trim().slice(0, 500) : null } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
          ...(isDefault !== undefined ? { isDefault } : {}),
        },
        include: {
          members: {
            include: { user: { select: { id: true, name: true, email: true, phone: true, role: true } } },
            orderBy: { order: 'asc' },
          },
          _count: { select: { assignments: true } },
        },
      }),
    );
    const results = await db.$transaction(operations);
    const queue = results[results.length - 1] as Awaited<ReturnType<typeof db.leadQueue.update>>;

    return NextResponse.json(queue);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: 'Fila não encontrada' }, { status: 404 });
    }
    console.error('[Lead Queue] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// DELETE — delete queue
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { id } = await params;

    // FIX: Check existence first to return 404, and warn about cascade
    const queue = await db.leadQueue.findUnique({
      where: { id },
      include: { _count: { select: { assignments: true, members: true } } },
    });
    if (!queue) {
      return NextResponse.json({ error: 'Fila não encontrada' }, { status: 404 });
    }

    await db.leadQueue.delete({ where: { id } });
    return NextResponse.json({
      success: true,
      deletedAssignments: queue._count.assignments,
      deletedMembers: queue._count.members,
    });
  } catch (error) {
    console.error('[Lead Queue] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
