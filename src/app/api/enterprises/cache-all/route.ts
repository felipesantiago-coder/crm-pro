import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { runExtraction, EXTRACTION_REQUEST_BUDGET_MS } from '@/lib/ai/extraction';
import { NexoError } from '@/lib/ai/errors';
import { getFeatureFlags } from '@/lib/ai/flags';

// Function serverless: o prazo de request (100 s) cobre o lote completo e é
// repassado a cada runExtraction (deadlineAt) — um item que começa perto do
// fim do lote recebe só o tempo restante, nunca estoura o maxDuration de 120 s.
// CORREÇÃO (2026-09, família do 504 no upload): com deadline de lote de 50 s e
// maxDuration 60, um runExtraction iniciado aos 49 s rodava mais 48 s além do
// limite — a function era morta sem resposta. O prazo agora é absoluto e
// compartilhado por todo o lote.
export const maxDuration = 120;

/**
 * POST /api/enterprises/cache-all — v2 (Fase 3).
 *
 * Lote administrativo: gera rascunhos de extração para empreendimentos que
 * ainda NÃO possuem rascunho. Grava apenas `extractionDraft` + runs —
 * NUNCA publica automaticamente (§10.1: "Nunca publicar automaticamente uma
 * extração nova"). A revisão e a publicação continuam individuais.
 */
export async function POST() {
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

    const user = await db.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true },
    });
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const enterprises = await db.enterprise.findMany({
      where: {
        AND: [
          { pdfContent: { not: null } },
          { pdfContent: { not: '' } },
        ],
      },
      select: { id: true, name: true, extractionDraft: true, pdfContent: true },
    });

    // Apenas sem rascunho, ou com rascunho de documento antigo (hash divergente)
    const toProcess = enterprises.filter((e) => {
      if (!e.extractionDraft) return true;
      const d = e.extractionDraft as { documentHash?: string };
      return false; // já tem rascunho — reprocesso individual é manual ("Reprocessar")
    });

    if (toProcess.length === 0) {
      return NextResponse.json({
        message: 'Todos os empreendimentos já possuem rascunho de extração para revisão.',
        processed: 0,
        total: 0,
      });
    }

    const results: Array<{ id: string; name: string; success: boolean; needsReview?: boolean; error?: string }> = [];
    let successCount = 0;

    // Orçamento de parede do lote: a function é encerrada graciosamente antes
    // do maxDuration; os empreendimentos restantes ficam pendentes para a
    // próxima execução (o botão pode ser acionado novamente).
    const batchDeadlineAt = Date.now() + EXTRACTION_REQUEST_BUDGET_MS;
    let pendingCount = 0;

    for (const enterprise of toProcess) {
      // Margem de 5 s para os writes de finalize do último item responderem.
      if (batchDeadlineAt - Date.now() < 5_000) {
        pendingCount++;
        continue;
      }
      try {
        const draft = await runExtraction({
          enterpriseId: enterprise.id,
          userId: user.id,
          trigger: 'MANUAL',
          deadlineAt: batchDeadlineAt,
        });
        results.push({ id: enterprise.id, name: enterprise.name, success: true, needsReview: draft.needsReview });
        successCount++;
      } catch (err) {
        const msg = err instanceof NexoError ? err.message : 'Erro desconhecido';
        results.push({ id: enterprise.id, name: enterprise.name, success: false, error: msg });
        console.error(`[Cache All v2] Falha em "${enterprise.name}":`, msg);
      }
      // Delay para respeitar limites do provedor
      await new Promise((r) => setTimeout(r, 500));
    }

    return NextResponse.json({
      message: pendingCount > 0
        ? `${successCount} de ${toProcess.length} empreendimentos com rascunho gerado; ${pendingCount} ficaram pendentes pelo limite de tempo — acione novamente para processá-los.`
        : `${successCount} de ${toProcess.length} empreendimentos com rascunho gerado — revise e publique individualmente.`,
      processed: successCount,
      total: toProcess.length,
      pending: pendingCount,
      results,
    });
  } catch (error) {
    console.error('[Cache All v2] Error:', error);
    return NextResponse.json({ error: 'Erro ao processar em lote' }, { status: 500 });
  }
}
