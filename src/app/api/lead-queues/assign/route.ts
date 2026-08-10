import { NextRequest, NextResponse } from 'next/server';
import { assignLeadToUser, peekNextUser } from '@/lib/lead-queue';
import { notifyQueueUpdate } from '@/lib/telegram';
import { rateLimit } from '@/lib/rate-limit';
import { db } from '@/lib/db';

/**
 * PUBLIC — used by external integrations that need HTTP access.
 * Prefer using assignLeadToUser() directly from server code instead.
 *
 * Also sends an admin Telegram notification with:
 *   - Source type (WhatsApp click, form, etc.)
 *   - Who was assigned
 *   - Who is next in the queue
 *
 * Rate limited to prevent abuse.
 */
export async function POST(request: NextRequest) {
  // Rate limit: 20 assignments per minute per IP
  const rateLimitResult = rateLimit(request, { maxRequests: 20, windowSeconds: 60, keyPrefix: 'queue-assign' });
  if (rateLimitResult) return rateLimitResult;

  try {
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      // Fallback: if JSON parse fails (e.g., malformed request), treat as empty
      body = {};
    }
    const { leadId, queueId, source } = body as { leadId?: string; queueId?: string; source?: string };

    // Basic validation
    if (queueId && typeof queueId !== 'string') {
      return NextResponse.json({ error: 'queueId inválido' }, { status: 400 });
    }
    if (leadId && typeof leadId !== 'string') {
      return NextResponse.json({ error: 'leadId inválido' }, { status: 400 });
    }
    if (source && typeof source !== 'string') {
      return NextResponse.json({ error: 'source inválido' }, { status: 400 });
    }

    const result = await assignLeadToUser({ leadId, queueId, source });

    // ── Fire-and-forget: notify admin about queue rotation ──
    if (result.assigned && result.message !== 'already_assigned') {
      (async () => {
        try {
          // Find admin's Telegram chat ID
          const admin = await db.user.findFirst({
            where: { role: 'ADMIN' },
            select: { telegramChatId: true },
          });
          if (!admin?.telegramChatId) return;

          // Peek who is NEXT (without advancing the counter)
          const nextUser = await peekNextUser({ queueId: result.queueId });

          await notifyQueueUpdate(admin.telegramChatId, {
            source: source || 'api',
            assignedUserName: result.userName || 'Desconhecido',
            nextUserName: nextUser?.userName || null,
          });
        } catch (err) {
          console.warn('[Queue Assign] Admin notification failed:', err instanceof Error ? err.message : err);
        }
      })();
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Queue Assign] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
