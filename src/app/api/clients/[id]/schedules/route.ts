import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { notifyTeamScheduleCreated } from '@/lib/notifications';
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from '@/lib/google-calendar';

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

async function getAuthenticatedUser(email: string) {
  return db.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  });
}

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

    // Verificar permissão de acesso ao cliente
    const currentUser = await getAuthenticatedUser(session.user.email);
    if (!currentUser) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    const hasAccess = await canAccessClient(id, currentUser.id, currentUser.role === 'ADMIN');
    if (!hasAccess) {
      return NextResponse.json({ error: 'Acesso negado a este cliente' }, { status: 403 });
    }

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
      select: { id: true, role: true },
    });
    if (!currentUser) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    // Verificar permissão de acesso ao cliente
    const hasAccess = await canAccessClient(id, currentUser.id, currentUser.role === 'ADMIN');
    if (!hasAccess) {
      return NextResponse.json({ error: 'Acesso negado a este cliente' }, { status: 403 });
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

    // Notificar equipe do cliente sobre o agendamento
    notifyTeamScheduleCreated({
      clientId: id,
      scheduledDate: parsedDate,
      scheduledTime,
      description: description?.trim() || null,
      creatorName: session.user.name || 'Usuário',
    }).catch(() => {});

    // [GOOGLE CALENDAR] Criar evento APÓS a response ser enviada.
    // after() do Next.js 16 permite executar código em background
    // sem ser morto pelo encerramento da serverless function na Vercel.
    after(async () => {
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
        await db.schedule.update({
          where: { id: schedule.id },
          data: { googleCalendarEventId: eventId },
        });

      } catch (err) {
        console.error('[GOOGLE CALENDAR] Erro ao criar evento (não afeta o agendamento):', err);
      }
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
    const { scheduleId, status, scheduledDate, scheduledTime, description } = body;

    if (!scheduleId) {
      return NextResponse.json(
        { error: 'scheduleId é obrigatório' },
        { status: 400 }
      );
    }

    const isStatusChange = !!status;
    const isFieldEdit = scheduledDate || scheduledTime || description !== undefined;

    // Validar status se fornecido
    if (isStatusChange) {
      const validStatuses = ['COMPLETED', 'CANCELLED'];
      if (!validStatuses.includes(status)) {
        return NextResponse.json(
          { error: 'Status inválido. Use COMPLETED ou CANCELLED' },
          { status: 400 }
        );
      }
    }

    // Verificar permissão de acesso ao cliente antes de buscar o agendamento
    const currentUser = await getAuthenticatedUser(session.user.email);
    if (!currentUser) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    const hasAccess = await canAccessClient(id, currentUser.id, currentUser.role === 'ADMIN');
    if (!hasAccess) {
      return NextResponse.json({ error: 'Acesso negado a este cliente' }, { status: 403 });
    }

    const schedule = await db.schedule.findUnique({
      where: { id: scheduleId },
    });

    if (!schedule || schedule.clientId !== id) {
      return NextResponse.json({ error: 'Agendamento não encontrado' }, { status: 404 });
    }

    // Montar dados de atualização
    const updateData: Record<string, unknown> = {};
    if (isStatusChange) {
      updateData.status = status;
      if (status === 'COMPLETED') updateData.completedAt = new Date();
    }
    if (scheduledDate) {
      const [year, month, day] = scheduledDate.split('-').map(Number);
      updateData.scheduledDate = new Date(year, month - 1, day, 12, 0, 0);
    }
    if (scheduledTime) updateData.scheduledTime = scheduledTime;
    if (description !== undefined) updateData.description = description?.trim() || null;

    const updated = await db.schedule.update({
      where: { id: scheduleId },
      data: updateData,
      include: {
        creatorUser: {
          select: { id: true, name: true },
        },
      },
    });

    // [GOOGLE CALENDAR] Atualizar evento APÓS a response ser enviada
    if (schedule.googleCalendarEventId) {
      after(async () => {
        try {
          const client = await db.client.findUnique({
            where: { id },
            select: { name: true },
          });
          const clientName = client?.name || 'Cliente';
          await updateCalendarEvent({
            userId: schedule.createdBy,
            eventId: schedule.googleCalendarEventId,
            summary: `Visita CRM Pro — ${clientName}`,
            status: status as 'COMPLETED' | 'CANCELLED',
          });
        } catch (err) {
          console.error('[GOOGLE CALENDAR] Erro ao atualizar evento (não afeta o agendamento):', err);
        }
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

    // Verificar permissão de acesso ao cliente antes de excluir
    const currentUser = await getAuthenticatedUser(session.user.email);
    if (!currentUser) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    const hasAccess = await canAccessClient(id, currentUser.id, currentUser.role === 'ADMIN');
    if (!hasAccess) {
      return NextResponse.json({ error: 'Acesso negado a este cliente' }, { status: 403 });
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

    // [GOOGLE CALENDAR] Excluir evento APÓS a response ser enviada
    if (schedule.googleCalendarEventId) {
      after(async () => {
        try {
          await deleteCalendarEvent(schedule.createdBy, schedule.googleCalendarEventId);
        } catch (err) {
          console.error('[GOOGLE CALENDAR] Erro ao excluir evento (não afeta o agendamento):', err);
        }
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting schedule:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}