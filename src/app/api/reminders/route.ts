import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { createCalendarEvent } from '@/lib/google-calendar';
import { after } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { error } = await requireAuth();
    if (error) return error;

    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId') || '';

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

    const where: Record<string, unknown> = {};
    if (clientId) {
      where.clientId = clientId;
    }

    const [reminders, total] = await Promise.all([
      db.reminder.findMany({
        where,
        include: {
          client: {
            select: { id: true, name: true },
          },
        },
        orderBy: { dueDate: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.reminder.count({ where }),
    ]);

    return NextResponse.json({ reminders, total, page, limit });
  } catch (error) {
    console.error('Error fetching reminders:', error);
    return NextResponse.json({ error: 'Failed to fetch reminders' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { error, session } = await requireAuth();
    if (error) return error;

    const body = await request.json();
    const { title, description, dueDate, dueTime, clientId } = body;

    if (!title || title.trim() === '') {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }
    if (!dueDate) {
      return NextResponse.json({ error: 'Due date is required' }, { status: 400 });
    }
    if (!clientId) {
      return NextResponse.json({ error: 'Client is required' }, { status: 400 });
    }

    const clientExists = await db.client.findUnique({ where: { id: clientId } });
    if (!clientExists) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    // Look up current user for Google Calendar
    const currentUser = await db.user.findUnique({
      where: { email: session!.user!.email! },
      select: { id: true },
    });

    // Parse date string to avoid UTC offset bug
    const [year, month, day] = dueDate.split('-').map(Number);
    const parsedDate = new Date(year, month - 1, day, 12, 0, 0);

    const reminder = await db.reminder.create({
      data: {
        title: title.trim(),
        description: description?.trim() || null,
        dueDate: parsedDate,
        dueTime: dueTime || null,
        clientId,
      },
      include: {
        client: {
          select: { id: true, name: true },
        },
      },
    });

    // [GOOGLE CALENDAR] Criar evento APÓS a response ser enviada
    if (currentUser && dueTime) {
      after(async () => {
        try {
          const clientName = clientExists.name || 'Cliente';
          const eventId = await createCalendarEvent({
            userId: currentUser.id,
            summary: `Lembrete CRM Pro — ${title.trim()}`,
            description: description?.trim()
              ? `Lembrete do CRM Pro para ${clientName}\n\n${description.trim()}`
              : `Lembrete do CRM Pro para ${clientName}`,
            date: dueDate,
            time: dueTime,
          });
          await db.reminder.update({
            where: { id: reminder.id },
            data: { googleCalendarEventId: eventId },
          });
          console.log('[GOOGLE CALENDAR] Evento de lembrete criado:', eventId);
        } catch (err) {
          console.error('[GOOGLE CALENDAR] Erro ao criar evento de lembrete (não afeta o lembrete):', err);
        }
      });
    }

    return NextResponse.json(reminder, { status: 201 });
  } catch (error) {
    console.error('Error creating reminder:', error);
    return NextResponse.json({ error: 'Failed to create reminder' }, { status: 500 });
  }
}