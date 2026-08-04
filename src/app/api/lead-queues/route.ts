import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

// GET — list all queues
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const queues = await db.leadQueue.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        members: {
          where: { isActive: true },
          include: { user: { select: { id: true, name: true, email: true, phone: true, role: true } } },
          orderBy: { order: 'asc' },
        },
        _count: { select: { assignments: true } },
      },
    });

    return NextResponse.json(queues);
  } catch (error) {
    console.error('[Lead Queues] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// POST — create queue
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const body = await request.json();
    const { name, description, isDefault } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 });
    }
    if (name.trim().length > 200) {
      return NextResponse.json({ error: 'Nome muito longo (máx. 200 caracteres)' }, { status: 400 });
    }

    // FIX: wrap isDefault swap + create in transaction to prevent race condition
    const queue = await db.$transaction(async (tx) => {
      if (isDefault) {
        await tx.leadQueue.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }
      return tx.leadQueue.create({
        data: {
          name: name.trim(),
          description: description?.trim()?.slice(0, 500) || null,
          isDefault: isDefault || false,
        },
        include: {
          members: {
            include: { user: { select: { id: true, name: true, email: true, phone: true, role: true } } },
            orderBy: { order: 'asc' },
          },
          _count: { select: { assignments: true } },
        },
      });
    });

    return NextResponse.json(queue, { status: 201 });
  } catch (error) {
    console.error('[Lead Queues] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
