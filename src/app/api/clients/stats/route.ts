import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [total, thisMonth] = await Promise.all([
      db.client.count(),
      db.client.count({
        where: { createdAt: { gte: startOfMonth } },
      }),
    ]);

    return NextResponse.json({ total, thisMonth });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json({ total: 0, thisMonth: 0 });
  }
}
