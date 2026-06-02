import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const results: Record<string, unknown> = {};

  try {
    results.clients = await db.client.findMany({ take: 1 });
    results.clientsStatus = 'ok';
  } catch (e) {
    results.clientsStatus = 'error';
    results.clientsError = String(e);
  }

  try {
    results.tags = await db.tag.findMany({ take: 1 });
    results.tagsStatus = 'ok';
  } catch (e) {
    results.tagsStatus = 'error';
    results.tagsError = String(e);
  }

  try {
    results.reminders = await db.reminder.findMany({ take: 1 });
    results.remindersStatus = 'ok';
  } catch (e) {
    results.remindersStatus = 'error';
    results.remindersError = String(e);
  }

  try {
    results.enterprises = await db.enterprise.findMany({ take: 1 });
    results.enterprisesStatus = 'ok';
  } catch (e) {
    results.enterprisesStatus = 'error';
    results.enterprisesError = String(e);
  }

  try {
    results.users = await db.user.findMany({
      take: 1,
      select: { id: true, name: true, email: true, role: true },
    });
    results.usersStatus = 'ok';
  } catch (e) {
    results.usersStatus = 'error';
    results.usersError = String(e);
  }

  return NextResponse.json(results);
}
