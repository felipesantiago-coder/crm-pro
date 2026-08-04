import { NextRequest, NextResponse } from 'next/server';
import { peekNextUser } from '@/lib/lead-queue';

/**
 * PUBLIC endpoint — no auth required.
 * Returns the next user in the default queue (or a specific queueId)
 * for the landing page to display. Does NOT advance the counter.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const queueId = searchParams.get('queueId');

    const member = await peekNextUser({ queueId: queueId || undefined });

    if (!member) {
      return NextResponse.json({
        hasQueue: false,
        message: 'Nenhuma fila ativa com membros',
      });
    }

    return NextResponse.json({
      hasQueue: true,
      userId: member.userId,
      userName: member.userName,
      userPhone: member.userPhone,
    });
  } catch (error) {
    console.error('[Queue Next User] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
