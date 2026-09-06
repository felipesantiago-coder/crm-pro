import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';

// ============================================================
// /api/tags/[id] — Edição/exclusão com isolamento por usuário:
//   AUTOR da tag OU ADMIN pode editar/apagar. Tags legadas
//   (sem autor) ficam sob gestão exclusiva do ADMIN.
// ============================================================

/** Autoriza se o usuário logado for o autor da tag ou ADMIN. */
function canManage(
  tag: { createdById: string | null },
  session: { user: { id: string; role?: string } },
): boolean {
  if (session.user.role === 'ADMIN') return true;
  return !!tag.createdById && tag.createdById === session.user.id;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, session } = await requireAuth();
    if (error) return error;

    const { id } = await params;
    const body = await request.json();
    const { name, color } = body;

    const existingTag = await db.tag.findUnique({ where: { id } });
    if (!existingTag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    if (!canManage(existingTag, session)) {
      return NextResponse.json(
        { error: 'Acesso negado — apenas o autor da tag ou um admin pode editá-la' },
        { status: 403 },
      );
    }

    if (name && name.trim() !== existingTag.name) {
      // Duplicidade no escopo do MESMO autor da tag (null = legadas)
      const duplicateTag = await db.tag.findFirst({
        where: { createdById: existingTag.createdById, name: name.trim() },
      });
      if (duplicateTag && duplicateTag.id !== id) {
        return NextResponse.json({ error: 'Tag with this name already exists' }, { status: 409 });
      }
    }

    const tag = await db.tag.update({
      where: { id },
      data: {
        name: name?.trim() || existingTag.name,
        color: color?.trim() || existingTag.color,
      },
      include: {
        _count: {
          select: { clients: true },
        },
      },
    });

    return NextResponse.json(tag);
  } catch (error) {
    console.error('Error updating tag:', error);
    return NextResponse.json({ error: 'Failed to update tag' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, session } = await requireAuth();
    if (error) return error;

    const { id } = await params;

    const existingTag = await db.tag.findUnique({ where: { id } });
    if (!existingTag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    if (!canManage(existingTag, session)) {
      return NextResponse.json(
        { error: 'Acesso negado — apenas o autor da tag ou um admin pode excluí-la' },
        { status: 403 },
      );
    }

    await db.clientTag.deleteMany({ where: { tagId: id } });
    await db.tag.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting tag:', error);
    return NextResponse.json({ error: 'Failed to delete tag' }, { status: 500 });
  }
}
