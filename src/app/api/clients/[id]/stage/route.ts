import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const VALID_STAGES = [
  'LEAD',
  'PROSPECT',
  'VISITA_AGENDADA',
  'VISITA_REALIZADA',
  'CARTA_PROPOSTA',
  'CONTRATO_GERADO',
  'FECHADO_GANHO',
  'FECHADO_PERDIDO',
] as const;

type Stage = (typeof VALID_STAGES)[number];

function isValidStage(value: string): value is Stage {
  return (VALID_STAGES as readonly string[]).includes(value);
}

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

export async function PATCH(
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
    const { stage } = body;

    if (!stage || typeof stage !== 'string' || !isValidStage(stage)) {
      return NextResponse.json(
        { error: 'Stage inválido. Valores permitidos: ' + VALID_STAGES.join(', ') },
        { status: 400 }
      );
    }

    // Buscar usuário atual para verificar permissão
    const currentUser = await db.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true },
    });

    if (!currentUser) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    // Verificar acesso ao cliente (criador, parceiro ou admin)
    const hasAccess = await canAccessClient(id, currentUser.id, currentUser.role === 'ADMIN');
    if (!hasAccess) {
      return NextResponse.json({ error: 'Acesso negado a este cliente' }, { status: 403 });
    }

    const existingClient = await db.client.findUnique({ where: { id } });
    if (!existingClient) {
      return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });
    }

    const client = await db.client.update({
      where: { id },
      data: {
        stage,
        ...(stage === 'VISITA_AGENDADA' || stage === 'VISITA_REALIZADA'
          ? { lastInteractionAt: new Date() }
          : {}),
      },
    });

    return NextResponse.json(client);
  } catch (error) {
    console.error('Erro ao atualizar stage do cliente:', error);
    return NextResponse.json({ error: 'Erro ao atualizar stage' }, { status: 500 });
  }
}