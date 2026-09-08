import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { isAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

/**
 * Equipes — gestão exclusiva do ADMIN.
 *
 * PATCH  /api/teams/[id] — renomeia { name }.
 * DELETE /api/teams/[id] — exclui a equipe; os membros ficam sem equipe
 *                          (FK ON DELETE SET NULL), nunca são excluídos.
 */

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
} as const;

function normalizeName(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

export async function PATCH(
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
    const name = normalizeName(body?.name);

    if (!name) {
      return NextResponse.json({ error: 'Nome da equipe é obrigatório' }, { status: 400 });
    }
    if (name.length > 80) {
      return NextResponse.json({ error: 'Nome muito longo (máx. 80 caracteres)' }, { status: 400 });
    }

    const team = await db.team.update({
      where: { id },
      data: { name },
      include: { members: { select: USER_SELECT, orderBy: { name: 'asc' } } },
    });

    return NextResponse.json(team);
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return NextResponse.json({ error: 'Equipe não encontrada' }, { status: 404 });
      }
      if (error.code === 'P2002') {
        return NextResponse.json({ error: 'Já existe uma equipe com este nome' }, { status: 409 });
      }
    }
    console.error('[Teams] Erro ao renomear:', error);
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

    await db.team.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: 'Equipe não encontrada' }, { status: 404 });
    }
    console.error('[Teams] Erro ao excluir:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
