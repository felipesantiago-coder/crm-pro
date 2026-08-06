import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { db } from '@/lib/db';

/**
 * Toggle resolved status for an error log — ADMIN only.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const resolved = body.resolved;

  if (typeof resolved !== 'boolean') {
    return NextResponse.json({ error: 'resolved boolean required' }, { status: 400 });
  }

  try {
    const updated = await db.clientErrorLog.update({
      where: { id },
      data: { resolved },
    });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: 'Erro não encontrado' }, { status: 404 });
  }
}

/**
 * Delete an error log — ADMIN only.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { id } = await params;

  try {
    await db.clientErrorLog.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Erro não encontrado' }, { status: 404 });
  }
}
