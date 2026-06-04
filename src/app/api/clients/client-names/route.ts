import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
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
