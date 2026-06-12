import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';

export async function GET() {
  try {
    const { error } = await requireAuth();
    if (error) return error;

    const clients = await db.client.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 1000,
    });
    return NextResponse.json(clients);
  } catch (error) {
    console.error('Error fetching client names:', error);
    return NextResponse.json([], { status: 200 });
  }
}