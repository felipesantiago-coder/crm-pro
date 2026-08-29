import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

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

    // FIX: validate user exists
    const userExists = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!userExists) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 400 });
    }

    // Atomic INSERT with subquery for max order — single statement,
    // compatible with PgBouncer Transaction pooler.
    // Uses raw SQL because Prisma batch $transaction doesn't allow
    // using results of earlier queries in later ones.
    const newMember = await db.$queryRaw<Array<{ id: string; queueId: string; userId: string; order: number; isActive: boolean; createdAt: Date }>>`
      INSERT INTO "lead_queue_members" ("id", "queueId", "userId", "order", "isActive", "createdAt")
      SELECT gen_random_uuid(), ${id}, ${userId}, COALESCE(MAX("order"), -1) + 1, true, NOW()
      FROM "lead_queue_members" WHERE "queueId" = ${id}
      RETURNING "id", "queueId", "userId", "order", "isActive", "createdAt"
    `;

    if (!newMember.length) {
      return NextResponse.json({ error: 'Erro ao adicionar membro' }, { status: 500 });
    }

    const member = await db.leadQueueMember.findUnique({
      where: { id: newMember[0].id },
      include: { user: { select: { id: true, name: true, email: true, phone: true, role: true } } },
    });

    return NextResponse.json(member, { status: 201 });
  } catch (error: unknown) {
    console.error('[Queue Members] Erro:', error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return NextResponse.json({ error: 'Este usuário já está na fila' }, { status: 409 });
      }
      if (error.code === 'P2003') {
        return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 400 });
      }
    }
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
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

// DELETE — remove member from queue (memberId in request body)
// NOTE: prefer using the /[memberId] sub-route instead (better REST)
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
