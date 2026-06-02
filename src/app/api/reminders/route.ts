import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId') || '';

    const where: Record<string, unknown> = {};
    if (clientId) {
      where.clientId = clientId;
    }

    const reminders = await db.reminder.findMany({
      where,
      include: {
        client: {
          select: { id: true, name: true },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    return NextResponse.json(reminders);
  } catch (error) {
    console.error('Error fetching reminders:', error);
    return NextResponse.json({ error: 'Failed to fetch reminders' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, description, dueDate, clientId } = body;

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

    const reminder = await db.reminder.create({
      data: {
        title: title.trim(),
        description: description?.trim() || null,
        dueDate: new Date(dueDate),
        clientId,
      },
      include: {
        client: {
          select: { id: true, name: true },
        },
      },
    });

    return NextResponse.json(reminder, { status: 201 });
  } catch (error) {
    console.error('Error creating reminder:', error);
    return NextResponse.json({ error: 'Failed to create reminder' }, { status: 500 });
  }
}
