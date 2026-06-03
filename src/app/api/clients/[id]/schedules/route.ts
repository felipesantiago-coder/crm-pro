import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

// GET /api/clients/[id]/schedules — List all schedules for a client
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { id } = await params;

    let schedules;
    try {
      schedules = await db.schedule.findMany({
        where: { clientId: id },
        orderBy: [
          { scheduledDate: 'asc' },
          { scheduledTime: 'asc' },
        ],
        include: {
          creator: {
            select: { id: true, name: true },
          },
        },
      });
    } catch {
      // Table may not exist yet
      return NextResponse.json([]);
    }

    return NextResponse.json(schedules);
  } catch (error) {
    console.error('Error fetching schedules:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}

// POST /api/clients/[id]/schedules — Create a new schedule
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { scheduledDate, scheduledTime, description } = body;

    if (!scheduledDate || !scheduledTime) {
      return NextResponse.json(
        { error: 'scheduledDate e scheduledTime são obrigatórios' },
        { status: 400 }
      );
    }

    // Look up current user for createdBy
    const currentUser = await db.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });
    if (!currentUser) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    const schedule = await db.schedule.create({
      data: {
        scheduledDate: new Date(scheduledDate),
        scheduledTime,
        description: description?.trim() || null,
        status: 'PENDING',
        clientId: id,
        createdBy: currentUser.id,
      },
      include: {
        creator: {
          select: { id: true, name: true },
        },
      },
    });

    return NextResponse.json(schedule, { status: 201 });
  } catch (error) {
    console.error('Error creating schedule:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}

// PATCH /api/clients/[id]/schedules — Update schedule status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { scheduleId, status } = body;

    if (!scheduleId || !status) {
      return NextResponse.json(
        { error: 'scheduleId e status são obrigatórios' },
        { status: 400 }
      );
    }

    const validStatuses = ['COMPLETED', 'CANCELLED'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: 'Status inválido. Use COMPLETED ou CANCELLED' },
        { status: 400 }
      );
    }

    const schedule = await db.schedule.findUnique({
      where: { id: scheduleId },
    });

    if (!schedule || schedule.clientId !== id) {
      return NextResponse.json({ error: 'Agendamento não encontrado' }, { status: 404 });
    }

    const updated = await db.schedule.update({
      where: { id: scheduleId },
      data: {
        status,
        ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}),
      },
      include: {
        creator: {
          select: { id: true, name: true },
        },
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating schedule:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/schedules — Remove a schedule
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { scheduleId } = body;

    if (!scheduleId) {
      return NextResponse.json(
        { error: 'scheduleId é obrigatório' },
        { status: 400 }
      );
    }

    const schedule = await db.schedule.findUnique({
      where: { id: scheduleId },
    });

    if (!schedule || schedule.clientId !== id) {
      return NextResponse.json({ error: 'Agendamento não encontrado' }, { status: 404 });
    }

    await db.schedule.delete({
      where: { id: scheduleId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting schedule:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
