import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { isAdmin } from '@/lib/auth';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const enterprises = await db.enterprise.findMany({
      include: {
        _count: { select: { clients: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(enterprises);
  } catch (error) {
    console.error('Erro ao listar empreendimentos:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const body = await request.json();
    const { name, region } = body;

    if (!name || name.trim() === '') {
      return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 });
    }

    const enterprise = await db.enterprise.create({
      data: {
        name: name.trim(),
        region: region?.trim() || null,
      },
      include: {
        _count: { select: { clients: true } },
      },
    });

    return NextResponse.json(enterprise, { status: 201 });
  } catch (error) {
    console.error('Erro ao criar empreendimento:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
