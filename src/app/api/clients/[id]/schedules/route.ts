import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { notifyTeamScheduleCreated } from '@/lib/notifications';
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from '@/lib/google-calendar';

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
          creatorUser: {
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

    // Parse date string manually to avoid UTC timezone offset bug.
    // new Date('2025-06-07') creates midnight UTC, which becomes
    // 21h of the PREVIOUS day in UTC-3 (Brazil). Using Date constructor
    // with year/month/day creates local midnight correctly.
    const [year, month, day] = scheduledDate.split('-').map(Number);
    const parsedDate = new Date(year, month - 1, day, 12, 0, 0);

    const schedule = await db.schedule.create({
      data: {
        scheduledDate: parsedDate,
        scheduledTime,
        description: description?.trim() || null,
        status: 'PENDING',
        clientId: id,
        createdBy: currentUser.id,
      },
      include: {
        creatorUser: {
          select: { id: true, name: true },
        },
      },
    });

    // Notificar equipe do cliente sobre o agendamento (fire-and-forget)
    notifyTeamScheduleCreated({
      clientId: id,
      scheduledDate: parsedDate,
      scheduledTime,
      description: description?.trim() || null,
      creatorName: session.user.name || 'Usuário',
    }).catch(() => {});

    // [GOOGLE CALENDAR] Criar evento no Google Calendar (fire-and-forget)
    (async () => {
      try {
        const client = await db.client.findUnique({
          where: { id },
          select: { name: true },
        });
        const clientName = client?.name || 'Cliente';
        const eventId = await createCalendarEvent({
          userId: currentUser.id,
          summary: `Visita CRM Pro — ${clientName}`,
          description: description?.trim()
            ? `Visita agendada no CRM Pro para ${clientName}\n\nObservações: ${description.trim()}`
            : `Visita agendada no CRM Pro para ${clientName}`,
          date: scheduledDate,
          time: scheduledTime,
        });
        // Salvar ID do evento no agendamento
        await db.schedule.update({
          where: { id: schedule.id },
          data: { googleCalendarEventId: eventId },
        });
      } catch (err) {
        console.error('[GOOGLE CALENDAR] Erro ao criar evento (fire-and-forget):', err);
      }
    })().catch(() => {});

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
        creatorUser: {
          select: { id: true, name: true },
        },
      },
    });

    // [GOOGLE CALENDAR] Atualizar evento no Google Calendar (fire-and-forget)
    if (schedule.googleCalendarEventId) {
      const client = await db.client.findUnique({
        where: { id },
        select: { name: true },
      });
      const clientName = client?.name || 'Cliente';
      updateCalendarEvent({
        userId: schedule.createdBy,
        eventId: schedule.googleCalendarEventId,
        summary: `Visita CRM Pro — ${clientName}`,
        description: description || undefined,
        status: status as 'COMPLETED' | 'CANCELLED',
      }).catch((err) => {
        console.error('[GOOGLE CALENDAR] Erro ao atualizar evento (fire-and-forget):', err);
      });
    }

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

    // [GOOGLE CALENDAR] Excluir evento do Google Calendar (fire-and-forget)
    if (schedule.googleCalendarEventId) {
      deleteCalendarEvent(schedule.createdBy, schedule.googleCalendarEventId).catch((err) => {
        console.error('[GOOGLE CALENDAR] Erro ao excluir evento (fire-and-forget):', err);
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting schedule:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
