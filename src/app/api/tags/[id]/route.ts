import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const { id } = await params;
    const body = await request.json();
    const { name, color } = body;

    const existingTag = await db.tag.findUnique({ where: { id } });
    if (!existingTag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    if (name && name.trim() !== existingTag.name) {
      const duplicateTag = await db.tag.findUnique({ where: { name: name.trim() } });
      if (duplicateTag) {
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
    const { error } = await requireAdmin();
    if (error) return error;

    const { id } = await params;
    await db.clientTag.deleteMany({ where: { tagId: id } });
    await db.tag.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting tag:', error);
    return NextResponse.json({ error: 'Failed to delete tag' }, { status: 500 });
  }
}