import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { updateCalendarEvent, deleteCalendarEvent } from '@/lib/google-calendar';
import { after } from 'next/server';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, session } = await requireAuth();
    if (error) return error;

    const { id } = await params;
    const body = await request.json();
    const { title, description, dueDate, dueTime, notified } = body;

    const existing = await db.reminder.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Reminder not found' }, { status: 404 });
    }

    const newTitle = title?.trim() !== undefined ? title.trim() : existing.title;
    const newDescription = description?.trim() !== undefined ? (description.trim() || null) : existing.description;
    const newDueDate = dueDate ? new Date(dueDate) : existing.dueDate;
    const newDueTime = dueTime !== undefined ? dueTime : existing.dueTime;

    const reminder = await db.reminder.update({
      where: { id },
      data: {
        title: newTitle,
        description: newDescription,
        dueDate: newDueDate,
        dueTime: newDueTime,
        notified: notified !== undefined ? notified : existing.notified,
      },
      include: {
        client: {
          select: { id: true, name: true },
        },
      },
    });

    // [GOOGLE CALENDAR] Atualizar evento APÓS a response ser enviada
    if (existing.googleCalendarEventId) {
      after(async () => {
        try {
          const currentUser = await db.user.findUnique({
            where: { email: session!.user!.email! },
            select: { id: true },
          });
          if (!currentUser) return;

          const client = await db.client.findUnique({
            where: { id: existing.clientId },
            select: { name: true },
          });
          const clientName = client?.name || 'Cliente';

          if (notified === true) {
            // Marcar como concluído no Google Calendar
            await updateCalendarEvent({
              userId: currentUser.id,
              eventId: existing.googleCalendarEventId!,
              summary: `[CONCLUÍDO] ${newTitle}`,
              description: `✅ Lembrete concluído no CRM Pro — ${clientName}\n\n${newDescription || ''}`,
            });
          } else {
            // Atualizar dados do evento
            const dateStr = dueDate || existing.dueDate.toISOString().split('T')[0];
            const timeStr = dueTime || existing.dueTime;

            await updateCalendarEvent({
              userId: currentUser.id,
              eventId: existing.googleCalendarEventId!,
              summary: `Lembrete CRM Pro — ${newTitle}`,
              description: newDescription
                ? `Lembrete do CRM Pro para ${clientName}\n\n${newDescription}`
                : `Lembrete do CRM Pro para ${clientName}`,
              date: dateStr,
              time: timeStr || undefined,
            });
          }
          console.log('[GOOGLE CALENDAR] Evento de lembrete atualizado:', existing.googleCalendarEventId);
        } catch (err) {
          console.error('[GOOGLE CALENDAR] Erro ao atualizar evento de lembrete (não afeta o lembrete):', err);
        }
      });
    }

    return NextResponse.json(reminder);
  } catch (error) {
    console.error('Error updating reminder:', error);
    return NextResponse.json({ error: 'Failed to update reminder' }, { status: 500 });
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

    // Buscar o lembrete para obter o googleCalendarEventId antes de deletar
    const existing = await db.reminder.findUnique({
      where: { id },
      select: { googleCalendarEventId: true },
    });

    await db.reminder.delete({ where: { id } });

    // [GOOGLE CALENDAR] Deletar evento APÓS a response ser enviada
    if (existing?.googleCalendarEventId) {
      after(async () => {
        try {
          const currentUser = await db.user.findUnique({
            where: { email: session!.user!.email! },
            select: { id: true },
          });
          if (!currentUser) return;

          await deleteCalendarEvent(currentUser.id, existing.googleCalendarEventId!);
          console.log('[GOOGLE CALENDAR] Evento de lembrete excluído:', existing.googleCalendarEventId);
        } catch (err) {
          console.error('[GOOGLE CALENDAR] Erro ao excluir evento de lembrete (não afeta o lembrete):', err);
        }
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting reminder:', error);
    return NextResponse.json({ error: 'Failed to delete reminder' }, { status: 500 });
  }
}