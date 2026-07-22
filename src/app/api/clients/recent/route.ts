import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';

// GET /api/clients/recent — Retorna últimos clientes do usuário (para polling de notificações)
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const recent = await db.client.findMany({
      where: { createdBy: session.user.id },
      select: { id: true, name: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    return NextResponse.json(recent);
  } catch (error) {
    console.error('[Clients Recent] Error:', error);
    return NextResponse.json([], { status: 200 });
  }
}