import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const STAGES = [
  'LEAD',
  'PROSPECT',
  'VISITA_AGENDADA',
  'VISITA_REALIZADA',
  'CARTA_PROPOSTA',
  'CONTRATO_GERADO',
  'FECHADO_GANHO',
  'FECHADO_PERDIDO',
] as const;

export async function GET(request: NextRequest) {
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
    const search = request.nextUrl.searchParams.get('search') || '';

    const accessFilter = isAdmin
      ? {}
      : {
          OR: [
            { createdBy: currentUser.id },
            { partners: { some: { userId: currentUser.id } } },
          ],
        };

    const searchFilter = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { enterprise: { contains: search, mode: 'insensitive' as const } },
            { region: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const clients = await db.client.findMany({
      where: {
        ...accessFilter,
        ...searchFilter,
      },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        region: true,
        enterprise: true,
        stage: true,
        updatedAt: true,
        _count: {
          select: {
            schedules: {
              where: { status: 'PENDING' },
            },
            interactions: true,
          },
        },
        schedules: {
          where: { status: 'PENDING' },
          select: {
            scheduledDate: true,
            scheduledTime: true,
          },
          orderBy: { scheduledDate: 'asc' },
          take: 1,
        },
        tags: {
          select: {
            tag: {
              select: { name: true, color: true },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // Group by stage
    const pipeline: Record<string, typeof clients> = {};
    for (const stage of STAGES) {
      pipeline[stage] = [];
    }
    for (const client of clients) {
      const stage = client.stage || 'LEAD';
      if (pipeline[stage]) {
        pipeline[stage].push(client);
      } else {
        pipeline['LEAD'].push(client);
      }
    }

    return NextResponse.json({
      stages: STAGES,
      pipeline,
    });
  } catch (error) {
    console.error('Erro ao buscar pipeline:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}