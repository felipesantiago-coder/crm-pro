import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';

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
          include: {
            user: { select: { id: true, name: true, phone: true } },
          },
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
    const { name, description, isActive, isDefault } = body;

    if (isDefault) {
      await db.leadQueue.updateMany({ where: { isDefault: true, NOT: { id } }, data: { isDefault: false } });
    }

    const queue = await db.leadQueue.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(description !== undefined ? { description: description?.trim() || null } : {}),
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
    });

    return NextResponse.json(queue);
  } catch (error) {
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
    await db.leadQueue.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Lead Queue] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}