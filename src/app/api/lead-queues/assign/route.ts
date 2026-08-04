import { NextRequest, NextResponse } from 'next/server';
import { assignLeadToUser } from '@/lib/lead-queue';

/**
 * PUBLIC — used by external integrations that need HTTP access.
 * Prefer using assignLeadToUser() directly from server code instead.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { leadId, queueId, source } = body;

    // Basic validation
    if (queueId && typeof queueId !== 'string') {
      return NextResponse.json({ error: 'queueId inválido' }, { status: 400 });
    }
    if (leadId && typeof leadId !== 'string') {
      return NextResponse.json({ error: 'leadId inválido' }, { status: 400 });
    }

    const result = await assignLeadToUser({ leadId, queueId, source });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Queue Assign] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
