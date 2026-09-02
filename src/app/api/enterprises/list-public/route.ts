import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const enterprises = await db.enterprise.findMany({
      select: {
        id: true,
        name: true,
        region: true,
        imageUrl: true,
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json(enterprises);
  } catch (error) {
    console.error('Erro ao listar empreendimentos:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
