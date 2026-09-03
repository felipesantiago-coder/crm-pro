import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { runExtraction } from '@/lib/ai/extraction';
import { NexoError } from '@/lib/ai/errors';
import { getFeatureFlags } from '@/lib/ai/flags';

// Function serverless: o pipeline tem orçamento de parede próprio (48 s);
// 60 s cobre o ciclo completo (IA + persistência) dentro do limite do plano.
export const maxDuration = 60;

/**
 * POST /api/enterprises/extract-info — v2 (Fase 3, prompt v1.0 §10).
 *
 * Executa a extração por blocos e grava APENAS o rascunho revisável
 * (`extractionDraft`) + run auditável. NUNCA toca verifiedInfo,
 * publishedInfo nem cachedInfo: falha ou saída inválida não sobrescreve
 * dados válidos (P0 da auditoria).
 *
 * Body: { enterpriseId: string, force?: boolean }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    if (!getFeatureFlags().extractionV2) {
      return NextResponse.json(
        { error: 'Extração revisável temporariamente desativada.', code: 'capability_disabled' },
        { status: 503 },
      );
    }

    const body = await req.json().catch(() => null);
    const enterpriseId = (body as { enterpriseId?: string } | null)?.enterpriseId;
    const force = Boolean((body as { force?: boolean } | null)?.force);

    if (!enterpriseId || typeof enterpriseId !== 'string') {
      return NextResponse.json({ error: 'enterpriseId é obrigatório' }, { status: 400 });
    }

    const user = await db.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Apenas administradores podem extrair informações.' }, { status: 403 });
    }

    const draft = await runExtraction({
      enterpriseId,
      userId: user.id,
      trigger: force ? 'REPROCESS' : 'MANUAL',
      force,
    });

    return NextResponse.json({
      runId: draft.runId,
      status: draft.status,
      needsReview: draft.needsReview,
      blocksProcessed: draft.blocksProcessed,
      blocksTotal: draft.blocksTotal,
      limitations: draft.limitations,
      fields: draft.fields,
      generatedAt: draft.generatedAt,
    });
  } catch (error) {
    if (error instanceof NexoError) {
      const { status, body } = error.toResponse();
      return NextResponse.json(body, { status });
    }
    console.error('[Extract Info v2] Error:', error);
    return NextResponse.json(
      { error: 'Erro ao extrair informações. Nada foi alterado.', code: 'internal_error' },
      { status: 500 },
    );
  }
}
