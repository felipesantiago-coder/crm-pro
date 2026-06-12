import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { isAdmin } from '@/lib/auth';
import { db } from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const { id } = await params;
    const enterprise = await db.enterprise.findUnique({
      where: { id },
      include: {
        _count: { select: { clients: true } },
      },
    });

    if (!enterprise) {
      return NextResponse.json({ error: 'Empreendimento não encontrado' }, { status: 404 });
    }

    return NextResponse.json(enterprise);
  } catch (error) {
    console.error('Erro ao buscar empreendimento:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { name, region } = body;

    const enterprise = await db.enterprise.findUnique({ where: { id } });
    if (!enterprise) {
      return NextResponse.json({ error: 'Empreendimento não encontrado' }, { status: 404 });
    }

    const updated = await db.enterprise.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(region !== undefined ? { region: region?.trim() || null } : {}),
      },
      include: {
        _count: { select: { clients: true } },
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Erro ao atualizar empreendimento:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const { id } = await params;

    // Set enterpriseId to null on all linked clients first
    await db.client.updateMany({
      where: { enterpriseId: id },
      data: { enterpriseId: null },
    });

    await db.enterprise.delete({ where: { id } });

    return NextResponse.json({ message: 'Empreendimento excluído com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir empreendimento:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
