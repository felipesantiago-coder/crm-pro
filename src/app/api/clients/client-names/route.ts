import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';

export async function GET() {
  try {
    const { error, session } = await requireAuth();
    if (error) return error;

    const user = await db.user.findUnique({
      where: { email: session!.user!.email },
      select: { id: true, role: true },
    });
    if (!user) return NextResponse.json([], { status: 200 });

    const clients = await db.client.findMany({
      where: user.role === 'ADMIN' ? undefined : {
        OR: [
          { createdBy: user.id },
          { partners: { some: { userId: user.id } } },
        ],
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 1000,
    });
    return NextResponse.json(clients);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}