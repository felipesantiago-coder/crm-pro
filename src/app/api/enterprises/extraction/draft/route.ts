import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { canDeleteDraft } from '@/lib/ai/extraction-core';
import { logAiUsage } from '@/lib/ai/telemetry';

/**
 * DELETE /api/enterprises/extraction/draft — apaga o RASCUNHO de extração
 * (extractionDraft/extractionDraftAt) do empreendimento.
 *
 * Escopo exato do pedido do administrador:
 *  - APAGA:   o rascunho de campos extraídos (bases anteriores) — o diálogo
 *             de revisão deixa de exibi-lo até nova extração;
 *  - PRESERVA: a base documental (pdfContent/documentHash — nada é removido
 *             do documento), os dados verificados (verifiedInfo), os
 *             publicados (publishedInfo/cachedInfo) e o histórico de versões.
 *
 * Guarda (canDeleteDraft): com uma run RUNNING a exclusão é recusada — a
 * execução gravaria um novo rascunho e o estado ficaria inconsistente.
 *
 * Body: { enterpriseId: string }
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const user = await db.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true },
    });
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Apenas administradores podem apagar o rascunho de extração.' }, { status: 403 });
    }

    const raw = await req.json().catch(() => null);
    const enterpriseId = (raw as { enterpriseId?: string } | null)?.enterpriseId;
    if (!enterpriseId) {
      return NextResponse.json({ error: 'enterpriseId é obrigatório' }, { status: 400 });
    }

    const enterprise = await db.enterprise.findUnique({
      where: { id: enterpriseId },
      select: { id: true, extractionDraft: true },
    });
    if (!enterprise) {
      return NextResponse.json({ error: 'Empreendimento não encontrado' }, { status: 404 });
    }
    if (!enterprise.extractionDraft) {
      return NextResponse.json({ error: 'Nenhum rascunho de extração para apagar.' }, { status: 404 });
    }

    const lastRun = await db.enterpriseExtractionRun.findFirst({
      where: { enterpriseId },
      orderBy: { startedAt: 'desc' },
      select: { status: true },
    });
    const guard = canDeleteDraft(lastRun?.status);
    if (!guard.allowed) {
      return NextResponse.json({ error: guard.reason }, { status: 409 });
    }

    await db.enterprise.update({
      where: { id: enterpriseId },
      data: {
        extractionDraft: Prisma.DbNull,
        extractionDraftAt: null,
      },
    });

    logAiUsage({
      capability: 'enterprise_info_publish', outcome: 'success',
      userId: user.id, userRole: user.role, scopeId: enterpriseId,
      note: 'rascunho de extração apagado (base documental preservada)',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Extraction Draft Delete] Error:', error);
    return NextResponse.json({ error: 'Erro ao apagar o rascunho. Nada foi alterado.' }, { status: 500 });
  }
}
