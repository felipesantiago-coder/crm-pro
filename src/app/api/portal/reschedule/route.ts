import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { verifyPortalToken } from '@/lib/portal-token';
import { updateCalendarEvent } from '@/lib/google-calendar';

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, clientId, scheduleId, newDate, newTime } = body;

    if (!token || !clientId || !scheduleId || !newDate || !newTime) {
      return NextResponse.json(
        { error: 'Dados incompletos.' },
        { status: 400 }
      );
    }

    // Verify client and token
    const client = await db.client.findUnique({
      where: { id: clientId },
      select: { id: true, name: true, createdAt: true },
    });

    if (!client) {
      return NextResponse.json(
        { error: 'Cliente não encontrado.' },
        { status: 404 }
      );
    }

    const isValid = verifyPortalToken(token, client.id, client.createdAt.toISOString());
    if (!isValid) {
      return NextResponse.json(
        { error: 'Acesso não autorizado.' },
        { status: 403 }
      );
    }

    // Verify the schedule belongs to this client and is pending
    const schedule = await db.schedule.findFirst({
      where: {
        id: scheduleId,
        clientId: client.id,
        status: 'PENDING',
      },
      select: {
        id: true,
        scheduledDate: true,
        scheduledTime: true,
        createdBy: true,
        googleCalendarEventId: true,
      },
    });

    if (!schedule) {
      return NextResponse.json(
        { error: 'Agendamento não encontrado ou já concluído/cancelado.' },
        { status: 404 }
      );
    }

    // Prevent scheduling in the past
    const requestedDate = new Date(`${newDate}T${newTime}:00`);
    if (requestedDate < new Date()) {
      return NextResponse.json(
        { error: 'Não é possível agendar para uma data no passado.' },
        { status: 400 }
      );
    }

    // Update the schedule
    const updated = await db.schedule.update({
      where: { id: scheduleId },
      data: {
        scheduledDate: new Date(`${newDate}T12:00:00`),
        scheduledTime: newTime,
      },
    });

    // Create an interaction to log the reschedule
    const oldDate = new Date(schedule.scheduledDate).toLocaleDateString('pt-BR');
    const oldTime = schedule.scheduledTime;
    const newDateFormatted = new Date(newDate).toLocaleDateString('pt-BR');

    await db.interaction.create({
      data: {
        clientId: client.id,
        description: `🔄 Cliente reagendou visita de ${oldDate} às ${oldTime} para ${newDateFormatted} às ${newTime} (via Portal do Cliente).`,
      },
    });

    // Update Google Calendar event if linked (fire-and-forget, same pattern as CRM)
    if (schedule.googleCalendarEventId) {
      // Use waitUntil-like pattern: respond first, update calendar after
      updateCalendarEvent({
        userId: schedule.createdBy,
        eventId: schedule.googleCalendarEventId,
        date: newDate,
        time: newTime,
        summary: `Visita CRM Pro — ${client.name}`,
      }).catch((err) => {
        console.error('[PORTAL] Erro ao atualizar Google Calendar (não afeta o reagendamento):', err);
      });
    }

    return NextResponse.json({
      success: true,
      schedule: {
        id: updated.id,
        scheduledDate: updated.scheduledDate,
        scheduledTime: updated.scheduledTime,
        description: updated.description,
        status: updated.status,
      },
    });
  } catch (error) {
    console.error('[PORTAL] Erro ao reagendar:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor.' },
      { status: 500 }
    );
  }
}