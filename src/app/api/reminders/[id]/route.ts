import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, description, dueDate, notified } = body;

    const existing = await db.reminder.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Reminder not found' }, { status: 404 });
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
    return NextResponse.json({ error: 'Failed to update reminder' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await db.reminder.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting reminder:', error);
    return NextResponse.json({ error: 'Failed to delete reminder' }, { status: 500 });
  }
}
