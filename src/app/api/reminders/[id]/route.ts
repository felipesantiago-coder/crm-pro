import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';

async function canAccessClient(clientId: string, userId: string, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true;
  const client = await db.client.findFirst({
    where: {
      id: clientId,
      OR: [
        { createdBy: userId },
        { partners: { some: { userId } } },
      ],
    },
    select: { id: true },
  });
  return !!client;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, session } = await requireAuth();
    if (error) return error;

    const { id } = await params;
    const body = await request.json();
    const { title, description, dueDate, notified } = body;

    const existing = await db.reminder.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Lembrete não encontrado' }, { status: 404 });
    }

    // Verificar permissão de acesso ao cliente associado ao lembrete
    const currentUser = await db.user.findUnique({
      where: { email: session!.user!.email! },
      select: { id: true, role: true },
    });
    if (!currentUser) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    const hasAccess = await canAccessClient(existing.clientId, currentUser.id, currentUser.role === 'ADMIN');
    if (!hasAccess) {
      return NextResponse.json({ error: 'Acesso negado a este cliente' }, { status: 403 });
    }

    const reminder = await db.reminder.update({
      where: { id },
      data: {
        title: title?.trim() !== undefined ? title.trim() : existing.title,
        description: description?.trim() !== undefined ? (description.trim() || null) : existing.description,
        dueDate: dueDate ? new Date(dueDate) : existing.dueDate,
        notified: notified !== undefined ? notified : existing.notified,
      },
      include: {
        client: {
          select: { id: true, name: true },
        },
      },
    });

    return NextResponse.json(reminder);
  } catch (error) {
    console.error('Error updating reminder:', error);
    return NextResponse.json({ error: 'Erro ao atualizar lembrete' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, session } = await requireAuth();
    if (error) return error;

    const { id } = await params;

    // Buscar o lembrete para verificar o clientId associado
    const existing = await db.reminder.findUnique({
      where: { id },
      select: { id: true, clientId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Lembrete não encontrado' }, { status: 404 });
    }

    // Verificar permissão de acesso ao cliente associado ao lembrete
    const currentUser = await db.user.findUnique({
      where: { email: session!.user!.email! },
      select: { id: true, role: true },
    });
    if (!currentUser) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    const hasAccess = await canAccessClient(existing.clientId, currentUser.id, currentUser.role === 'ADMIN');
    if (!hasAccess) {
      return NextResponse.json({ error: 'Acesso negado a este cliente' }, { status: 403 });
    }

    await db.reminder.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting reminder:', error);
    return NextResponse.json({ error: 'Erro ao excluir lembrete' }, { status: 500 });
  }
}