import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { runExtraction } from '@/lib/ai/extraction';
import { NexoError } from '@/lib/ai/errors';
import { getFeatureFlags } from '@/lib/ai/flags';

// Function serverless: a extração tem orçamento de parede próprio (48 s por
// run); 60 s cobre o ciclo completo sem estourar o limite do plano Vercel.
export const maxDuration = 60;

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
    const batchDeadlineAt = Date.now() + 50_000;
    let pendingCount = 0;

    for (const enterprise of toProcess) {
      if (Date.now() >= batchDeadlineAt) {
        pendingCount++;
        continue;
      }
      try {
        const draft = await runExtraction({
          enterpriseId: enterprise.id,
          userId: user.id,
          trigger: 'MANUAL',
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
