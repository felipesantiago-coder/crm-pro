import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { isAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

/**
 * Equipes — gestão exclusiva do ADMIN.
 *
 * GET  /api/teams — payload autocontido para a UI:
 *   { teams: [...com membros], teamless: [usuários sem equipe], admins: [ADMIN] }
 *   Consumidores: aba Equipes (admin-panel) e fluxo "equipe → membros" das
 *   filas (queues-tab). Administradores não pertencem a equipes (design).
 *
 * POST /api/teams — cria equipe { name }.
 */

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
} as const;

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const [teams, teamless, admins] = await Promise.all([
      db.team.findMany({
        orderBy: { name: 'asc' },
        include: {
          members: {
            select: USER_SELECT,
            orderBy: { name: 'asc' },
          },
        },
      }),
      db.user.findMany({
        where: { teamId: null, role: 'USER' },
        select: USER_SELECT,
        orderBy: { name: 'asc' },
      }),
      db.user.findMany({
        where: { role: 'ADMIN' },
        select: USER_SELECT,
        orderBy: { name: 'asc' },
      }),
    ]);

    return NextResponse.json({ teams, teamless, admins });
  } catch (error) {
    console.error('[Teams] Erro ao listar:', error);
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
    const name = typeof body?.name === 'string' ? body.name.trim() : '';

    if (!name) {
      return NextResponse.json({ error: 'Nome da equipe é obrigatório' }, { status: 400 });
    }
    if (name.length > 80) {
      return NextResponse.json({ error: 'Nome muito longo (máx. 80 caracteres)' }, { status: 400 });
    }

    const team = await db.team.create({
      data: { name },
      include: { members: { select: USER_SELECT, orderBy: { name: 'asc' } } },
    });

    return NextResponse.json(team, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'Já existe uma equipe com este nome' }, { status: 409 });
    }
    console.error('[Teams] Erro ao criar:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
