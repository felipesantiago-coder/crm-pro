import { NextRequest, NextResponse } from 'next/server';
import { peekNextUser } from '@/lib/lead-queue';
import { rateLimit } from '@/lib/rate-limit';

/**
 * PUBLIC endpoint — no auth required.
 * Returns the next user in the default queue (or a specific queueId)
 * for the landing page to display. Does NOT advance the counter.
 *
 * Rate limited to prevent abuse / enumeration.
 */
export async function GET(request: NextRequest) {
  // Rate limit: 30 requests per minute per IP (landing page peek)
  const rateLimitResult = rateLimit(request, { maxRequests: 30, windowSeconds: 60, keyPrefix: 'queue-peek' });
  if (rateLimitResult) return rateLimitResult;

  try {
    const { searchParams } = new URL(request.url);
    const queueId = searchParams.get('queueId');
    const slug = searchParams.get('slug');

    const member = await peekNextUser({
      queueId: queueId || undefined,
      slug: slug || undefined,
    });

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
