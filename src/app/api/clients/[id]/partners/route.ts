import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { notifyTeamPartnerAdded } from '@/lib/notifications';

// GET /api/clients/[id]/partners — Listar parceiros de um cliente
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { id } = await params;

    const partners = await db.clientPartner.findMany({
      where: { clientId: id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        addedByUser: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json(partners);
  } catch (error) {
    console.error('Erro ao listar parceiros:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}

// POST /api/clients/[id]/partners — Adicionar parceiro a um cliente
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId é obrigatório' }, { status: 400 });
    }

    // Verificar se o cliente existe
    const client = await db.client.findUnique({ where: { id } });
    if (!client) {
      return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });
    }

    // Não permitir adicionar o criador como parceiro
    if (userId === client.createdBy) {
      return NextResponse.json(
        { error: 'O criador do cliente não pode ser adicionado como parceiro' },
        { status: 400 }
      );
    }

    // Verificar se o usuário a ser adicionado existe
    const targetUser = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true },
    });
    if (!targetUser) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    // Verificar se já é parceiro
    const existing = await db.clientPartner.findUnique({
      where: { clientId_userId: { clientId: id, userId } },
    });
    if (existing) {
      return NextResponse.json(
        { error: 'Este usuário já é parceiro deste cliente' },
        { status: 409 }
      );
    }

    // Buscar o usuário que está adicionando (addedBy)
    const addingUser = await db.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, name: true },
    });
    if (!addingUser) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    const partner = await db.clientPartner.create({
      data: {
        clientId: id,
        userId,
        addedBy: addingUser.id,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        addedByUser: { select: { id: true, name: true, email: true } },
      },
    });

    // Notificar equipe sobre o novo parceiro (fire-and-forget)
    notifyTeamPartnerAdded({
      clientId: id,
      newPartnerName: targetUser.name,
      addedByName: addingUser.name || 'Usuário',
    }).catch(() => {});

    return NextResponse.json(partner, { status: 201 });
  } catch (error) {
    console.error('Erro ao adicionar parceiro:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/partners — Remover parceiro de um cliente
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId é obrigatório' }, { status: 400 });
    }

    await db.clientPartner.deleteMany({
      where: { clientId: id, userId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Erro ao remover parceiro:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
