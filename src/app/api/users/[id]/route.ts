import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { isAdmin } from '@/lib/auth';
import { db } from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const { id } = await params;

    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        mustChangePassword: true,
        createdAt: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    return NextResponse.json(user);
  } catch (error) {
    console.error('Erro ao buscar usuário:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const { id } = await params;

    if (id === session.user.id) {
      return NextResponse.json(
        { error: 'Você não pode excluir seu próprio usuário' },
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            queueMemberships: true,
            queueAssignments: true,
            createdClients: true,
            createdSchedules: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    // SAFETY: Check for queue assignments before deleting.
    // Deleting a user with CASCADE would destroy all assignment history.
    // Reassign assignments and remove memberships first.
    if (user._count.queueAssignments > 0 || user._count.queueMemberships > 0) {
      // Reassign all queue assignments to the admin performing the deletion
      // This preserves the full audit trail of who was assigned when
      if (user._count.queueAssignments > 0) {
        await db.leadQueueAssignment.updateMany({
          where: { userId: id },
          data: { userId: session.user.id },
        });
        console.warn(`[User Delete] ${user._count.queueAssignments} atribuições de fila de ${user.name} reatribuídas ao admin.`);
      }

      // Remove from all queue memberships
      await db.leadQueueMember.deleteMany({
        where: { userId: id },
      });
    }

    // Reassign created clients to the deleting admin
    if (user._count.createdClients > 0) {
      await db.client.updateMany({
        where: { createdBy: id },
        data: { createdBy: session.user.id },
      });
    }

    // Reassign created schedules to the deleting admin
    if (user._count.createdSchedules > 0) {
      await db.schedule.updateMany({
        where: { createdBy: id },
        data: { createdBy: session.user.id },
      });
    }

    await db.user.delete({
      where: { id },
    });

    return NextResponse.json({
      message: 'Usuário excluído com sucesso',
      reassignedClients: user._count.createdClients,
      reassignedSchedules: user._count.createdSchedules,
      preservedAssignments: user._count.queueAssignments,
    });
  } catch (error) {
    console.error('Erro ao excluir usuário:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
