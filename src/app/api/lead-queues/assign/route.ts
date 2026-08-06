import { NextRequest, NextResponse } from 'next/server';
import { assignLeadToUser } from '@/lib/lead-queue';
import { rateLimit } from '@/lib/rate-limit';

/**
 * PUBLIC — used by external integrations that need HTTP access.
 * Prefer using assignLeadToUser() directly from server code instead.
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
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Queue Assign] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
