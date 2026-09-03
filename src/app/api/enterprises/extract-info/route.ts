import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { runExtraction, EXTRACTION_REQUEST_BUDGET_MS } from '@/lib/ai/extraction';
import { NexoError } from '@/lib/ai/errors';
import { getFeatureFlags } from '@/lib/ai/flags';

// Function serverless: o pipeline tem orçamento de parede próprio; o prazo de
// request (100 s) é capturado no topo do handler e cobre o ciclo completo
// (sessão + queries + IA + persistência) dentro do maxDuration de 120 s.
// CORREÇÃO (2026-09, 504 no upload): com maxDuration 60 e orçamento de apenas
// 48 s no loop de blocos, o overhead de DB fora do loop cruzava o limite —
// a function era morta sem corpo JSON e o cliente via erro genérico.
export const maxDuration = 120;

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
  // Prazo de parede da REQUEST INTEIRA — antes de qualquer await.
  const requestDeadlineAt = Date.now() + EXTRACTION_REQUEST_BUDGET_MS;
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
      deadlineAt: requestDeadlineAt,
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
      // CORREÇÃO (2026-09): rota admin — o detalhe técnico (ex.: causa da
      // falha de bloco) acompanha a resposta para diagnóstico na UI.
      return NextResponse.json(
        { ...body, detail: error.detail ? error.detail.slice(0, 200) : undefined },
        { status },
      );
    }
    console.error('[Extract Info v2] Error:', error);
    return NextResponse.json(
      { error: 'Erro ao extrair informações. Nada foi alterado.', code: 'internal_error' },
      { status: 500 },
    );
  }
}
