import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { notifyTeamPartnerAdded } from '@/lib/notifications';

async function canAccessClient(clientId: string, userId: string, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true;
  const client = await db.client.findFirst({
    where: {
      id: clientId,
      OR: [
        { createdBy: userId },
        { partners: { some: { userId } } },
      ],
    },
    select: { id: true },
  });
  return !!client;
}

async function getAuthenticatedUser(email: string) {
  return db.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  });
}

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

    // Verificar permissão de acesso ao cliente
    const currentUser = await getAuthenticatedUser(session.user.email);
    if (!currentUser) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    const hasAccess = await canAccessClient(id, currentUser.id, currentUser.role === 'ADMIN');
    if (!hasAccess) {
      return NextResponse.json({ error: 'Acesso negado a este cliente' }, { status: 403 });
    }

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

    // Verificar permissão de acesso ao cliente
    const currentUser = await db.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, name: true, role: true },
    });
    if (!currentUser) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    const hasAccess = await canAccessClient(id, currentUser.id, currentUser.role === 'ADMIN');
    if (!hasAccess) {
      return NextResponse.json({ error: 'Acesso negado a este cliente' }, { status: 403 });
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

    const partner = await db.clientPartner.create({
      data: {
        clientId: id,
        userId,
        addedBy: currentUser.id,
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
      addedByName: currentUser.name || 'Usuário',
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

    // Verificar permissão de acesso ao cliente antes de remover parceiro
    const currentUser = await getAuthenticatedUser(session.user.email);
    if (!currentUser) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    const hasAccess = await canAccessClient(id, currentUser.id, currentUser.role === 'ADMIN');
    if (!hasAccess) {
      return NextResponse.json({ error: 'Acesso negado a este cliente' }, { status: 403 });
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