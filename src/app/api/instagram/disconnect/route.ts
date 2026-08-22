import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { db } from '@/lib/db';

// POST /api/instagram/disconnect — Remove os tokens do Instagram
export async function POST() {
  try {
    const { error, session } = await requireAdmin();
    if (error) return error;

    await db.instagramToken.deleteMany({
      where: { userId: session.user.id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[INSTAGRAM DISCONNECT] Erro ao desconectar:', error);
    return NextResponse.json(
      { error: 'Erro ao desconectar conta do Instagram' },
      { status: 500 },
    );
  }
}
