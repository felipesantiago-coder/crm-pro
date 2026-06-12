import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { notifyTeamInteractionAdded } from '@/lib/notifications';

async function requireAuth() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: 'Não autorizado' }, { status: 401 }), session: null };
  }
  return { error: null, session };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error } = await requireAuth();
    if (error) return error;

    const { id } = await params;
    const body = await request.json();
    const { description } = body;

    if (!description || description.trim() === '') {
      return NextResponse.json(
        { error: 'A descrição da interação é obrigatória' },
        { status: 400 }
      );
    }

    const existingClient = await db.client.findUnique({ where: { id } });
    if (!existingClient) {
      return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });
    }

    const session = await getServerSession(authOptions);
    const authorEmail = session?.user?.email;

    const interaction = await db.interaction.create({
      data: {
        description: description.trim(),
        clientId: id,
      },
    });

    // Notificar parceiros sobre a nova interação (fire-and-forget)
    notifyTeamInteractionAdded({
      clientId: id,
      interactionDescription: description.trim(),
      creatorEmail: authorEmail,
    }).catch(() => {});

    await db.client.update({
      where: { id },
      data: { lastInteractionAt: new Date() },
    });

    return NextResponse.json(interaction, { status: 201 });
  } catch (error) {
    console.error('Error recording interaction:', error);
    return NextResponse.json({ error: 'Erro ao registrar interação' }, { status: 500 });
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error } = await requireAuth();
    if (error) return error;

    const { id } = await params;

    const interactions = await db.interaction.findMany({
      where: { clientId: id },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(interactions);
  } catch (error) {
    console.error('Error fetching interactions:', error);
    return NextResponse.json({ error: 'Erro ao buscar interações' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error } = await requireAuth();
    if (error) return error;

    const { id: clientId } = await params;
    const body = await request.json();
    const { interactionId } = body;

    if (!interactionId) {
      return NextResponse.json({ error: 'ID da interação é obrigatório' }, { status: 400 });
    }

    const interaction = await db.interaction.findUnique({ where: { id: interactionId } });
    if (!interaction || interaction.clientId !== clientId) {
      return NextResponse.json({ error: 'Interação não encontrada' }, { status: 404 });
    }

    await db.interaction.delete({ where: { id: interactionId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting interaction:', error);
    return NextResponse.json({ error: 'Erro ao excluir interação' }, { status: 500 });
  }
}