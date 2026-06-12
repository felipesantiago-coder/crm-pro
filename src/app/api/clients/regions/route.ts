import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';

export async function GET() {
  try {
    const { error } = await requireAuth();
    if (error) return error;

    const clients = await db.client.findMany({
      select: { region: true },
      distinct: ['region'],
      where: { region: { not: null } },
      orderBy: { region: 'asc' },
    });
    return NextResponse.json(clients.map((c) => c.region).filter(Boolean));
  } catch (error) {
    console.error('Error fetching regions:', error);
    return NextResponse.json([], { status: 200 });
  }
}