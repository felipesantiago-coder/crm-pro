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

    const currentUser = await db.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true },
    });
    if (!currentUser) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    const isAdmin = currentUser.role === 'ADMIN';
    const accessFilter = isAdmin ? {} : {
      OR: [
        { createdBy: currentUser.id },
        { partners: { some: { userId: currentUser.id } } },
      ],
    };

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [total, thisMonth] = await Promise.all([
      db.client.count({ where: accessFilter }),
      db.client.count({
        where: { ...accessFilter, createdAt: { gte: startOfMonth } },
      }),
    ]);

    return NextResponse.json({ total, thisMonth });
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    return NextResponse.json({ total: 0, thisMonth: 0 });
  }
}
