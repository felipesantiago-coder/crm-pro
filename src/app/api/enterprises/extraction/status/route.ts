import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { parseDraft } from '@/lib/ai/extraction';

/**
 * GET /api/enterprises/extraction/status?enterpriseId=…
 * (prompt v1.0 §10.1/§10.6 + §11 — alimenta o cartão de saúde e a revisão.)
 *
 * Devolve: última run, draft atual, verifiedInfo, publishedInfo (com versão
 * e data), versões publicadas e indicadores de saúde da base. Somente ADMIN.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const user = await db.user.findUnique({
      where: { email: session.user.email },
      select: { role: true },
    });
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const enterpriseId = req.nextUrl.searchParams.get('enterpriseId');
    if (!enterpriseId) {
      return NextResponse.json({ error: 'enterpriseId é obrigatório' }, { status: 400 });
    }

    const enterprise = await db.enterprise.findUnique({
      where: { id: enterpriseId },
      select: {
        id: true,
        name: true,
        pdfContent: true,
        documentHash: true,
        extractionDraft: true,
        extractionDraftAt: true,
        verifiedInfo: true,
        verifiedInfoAt: true,
        verifiedInfoBy: true,
        publishedInfo: true,
        publishedAt: true,
        publishedVersion: true,
        updatedAt: true,
      },
    });
    if (!enterprise) {
      return NextResponse.json({ error: 'Empreendimento não encontrado' }, { status: 404 });
    }

    const [lastRun, versions] = await Promise.all([
      db.enterpriseExtractionRun.findFirst({
        where: { enterpriseId },
        orderBy: { startedAt: 'desc' },
        select: {
          id: true, status: true, trigger: true, startedById: true,
          promptVersion: true, blocksTotal: true, blocksProcessed: true,
          error: true, startedAt: true, completedAt: true, documentHash: true,
        },
      }),
      db.enterpriseInfoVersion.findMany({
        where: { enterpriseId },
        orderBy: { version: 'desc' },
        take: 10,
        select: { id: true, version: true, source: true, publishedById: true, publishedAt: true },
      }),
    ]);

    const contentLength = enterprise.pdfContent?.length ?? 0;
    const draft = parseDraft(enterprise.extractionDraft);

    // ── Saúde da base (§11.1) ────────────────────────────────────────────
    const draftStale = draft
      ? Boolean(enterprise.documentHash && draft.documentHash !== enterprise.documentHash)
      : false;
    let healthStatus: 'ready' | 'processing' | 'needs_review' | 'failed' | 'stale' | 'no_document';
    if (contentLength < 20) {
      healthStatus = 'no_document';
    } else if (lastRun?.status === 'RUNNING') {
      healthStatus = 'processing';
    } else if (lastRun?.status === 'FAILED' && !draft) {
      healthStatus = 'failed';
    } else if (draftStale) {
      healthStatus = 'stale';
    } else if (draft?.needsReview) {
      healthStatus = 'needs_review';
    } else {
      healthStatus = 'ready';
    }

    const missingFields = draft?.fields.filter((f) => f.status === 'missing').map((f) => f.field) ?? [];
    const conflictingFields = draft?.fields.filter((f) => f.status === 'conflicting').map((f) => f.field) ?? [];
    // 'accepted'/'edited' contam como encontrados: foram extraídos e depois
    // decididos/aprimorados por humano no publish (conciliação do rascunho).
    const foundFields = draft?.fields.filter((f) => f.status === 'found' || f.status === 'needs_review' || f.status === 'accepted' || f.status === 'edited').map((f) => f.field) ?? [];

    return NextResponse.json({
      enterpriseId: enterprise.id,
      document: {
        hasText: contentLength >= 20,
        characters: contentLength,
        documentHash: enterprise.documentHash,
        lastUploadedAt: enterprise.updatedAt,
      },
      draft: draft
        ? {
            runId: draft.runId,
            status: draft.status,
            generatedAt: draft.generatedAt,
            blocksProcessed: draft.blocksProcessed,
            blocksTotal: draft.blocksTotal,
            needsReview: draft.needsReview,
            stale: draftStale,
            fields: draft.fields,
            limitations: draft.limitations,
          }
        : null,
      verified: enterprise.verifiedInfo
        ? { info: enterprise.verifiedInfo, at: enterprise.verifiedInfoAt, by: enterprise.verifiedInfoBy }
        : null,
      published: enterprise.publishedInfo
        ? { info: enterprise.publishedInfo, at: enterprise.publishedAt, version: enterprise.publishedVersion }
        : null,
      lastRun,
      versions,
      health: {
        status: healthStatus,
        coverage: {
          found: foundFields,
          missing: missingFields,
          conflicting: conflictingFields,
        },
      },
    });
  } catch (error) {
    console.error('[Extraction Status] Error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
