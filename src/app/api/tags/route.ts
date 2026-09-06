import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';

// ============================================================
// /api/tags — Tags com ISOLAMENTO POR USUÁRIO
//   GET  → usuário comum lista apenas as tags que ELE criou;
//          ADMIN lista todas (incluindo legadas sem autor).
//   POST → a tag nasce com createdById do usuário logado; nome
//          duplicado só conflita DENTRO das tags do próprio autor.
// ============================================================

export async function GET() {
  try {
    const { error, session } = await requireAuth();
    if (error) return error;

    const isAdmin = session.user.role === 'ADMIN';
    const tags = await db.tag.findMany({
      where: isAdmin ? {} : { createdById: session.user.id },
      include: {
        _count: {
          select: { clients: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json(tags);
  } catch (error) {
    console.error('Error fetching tags:', error);
    return NextResponse.json({ error: 'Failed to fetch tags' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { error, session } = await requireAuth();
    if (error) return error;

    const body = await request.json();
    const { name, color } = body;

    if (!name || name.trim() === '') {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    // Duplicidade NO ESCOPO DO AUTOR (não global): dois usuários podem
    // ter tags com o mesmo nome — a de cada um é independente.
    const existingTag = await db.tag.findFirst({
      where: { createdById: session.user.id, name: name.trim() },
    });
    if (existingTag) {
      return NextResponse.json({ error: 'Tag with this name already exists' }, { status: 409 });
    }

    const tag = await db.tag.create({
      data: {
        name: name.trim(),
        color: color?.trim() || '#0d9488',
        createdById: session.user.id,
      },
      include: {
        _count: {
          select: { clients: true },
        },
      },
    });

    return NextResponse.json(tag, { status: 201 });
  } catch (error) {
    console.error('Error creating tag:', error);
    return NextResponse.json({ error: 'Failed to create tag' }, { status: 500 });
  }
}
