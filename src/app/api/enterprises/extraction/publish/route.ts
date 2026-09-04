import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  parseDraft,
  sanitizeEnterpriseInfo,
  buildInfoFromDecisions,
  criticalsPendingDecision,
  applyDecisionsToDraft,
} from '@/lib/ai/extraction';
import { enterpriseInfoSchema, type EnterpriseInfo } from '@/lib/ai/contracts';
import { logAiUsage } from '@/lib/ai/telemetry';

/**
 * POST /api/enterprises/extraction/publish — Fase 3 (§10.5/§10.6).
 *
 * Fluxo: revisão humana (decisões campo a campo) → aplicação conservadora →
 * publicação transacional. Campos críticos SEM decisão não são aplicados
 * (nunca publicados silenciosamente). Campos rejeitados/ausentes preservam
 * o valor verificado anterior. Publicar em bloco falha ou passa inteira.
 *
 * Body: {
 *   enterpriseId: string,
 *   decisions: Array<{ field, action: 'accept'|'edit'|'reject', value? }>,
 *   verifyOnly?: boolean  — aplica no verificado sem publicar nas superfícies
 *   note?: string
 * }
 */

const decisionSchema = z.object({
  field: z.string().min(1).max(80),
  action: z.enum(['accept', 'edit', 'reject']),
  value: z.unknown().optional(),
});

const bodySchema = z.object({
  enterpriseId: z.string().min(1),
  decisions: z.array(decisionSchema).max(64),
  verifyOnly: z.boolean().optional(),
  note: z.string().max(300).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const user = await db.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true, name: true },
    });
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Apenas administradores podem publicar informações.' }, { status: 403 });
    }

    const raw = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Requisição inválida' }, { status: 400 });
    }
    const { enterpriseId, decisions, verifyOnly = false, note } = parsed.data;

    const enterprise = await db.enterprise.findUnique({
      where: { id: enterpriseId },
      select: {
        id: true, name: true,
        extractionDraft: true,
        verifiedInfo: true,
        publishedVersion: true,
        cachedInfo: true,
      },
    });
    if (!enterprise) {
      return NextResponse.json({ error: 'Empreendimento não encontrado' }, { status: 404 });
    }

    const draft = parseDraft(enterprise.extractionDraft);
    if (!draft || draft.fields.length === 0) {
      return NextResponse.json(
        { error: 'Nenhum rascunho de extração disponível para revisão.' },
        { status: 422 },
      );
    }

    // Base atual: verificado anterior → legado cachedInfo → vazio.
    // NOTA (§19.7): cachedInfo legado NÃO é marcado automaticamente como
    // verificado sem decisão documentada — aqui ele entra apenas como base
    // de comparação para o administrador decidir campo a campo.
    const currentVerified: EnterpriseInfo | null = enterprise.verifiedInfo
      ? sanitizeEnterpriseInfo(enterprise.verifiedInfo)
      : enterprise.cachedInfo
        ? sanitizeEnterpriseInfo(enterprise.cachedInfo)
        : null;

    // Críticos SEM decisão = bloqueio de publicação (§12/§10.6).
    // CORREÇÃO (2026-09): o critério antigo só bloqueava conflicting/needs_review
    // (e ainda assim apenas quando havia algum 'accept' nas decisões) — um
    // crítico `found` sem decisão (ex.: status "Em Construção" extraído com
    // sucesso) passava despercebido e era publicado como valor anterior (null),
    // exibindo "A definir" nas superfícies públicas. criticalsPendingDecision
    // unifica: conflicting/needs_review/missing sempre bloqueiam; found bloqueia
    // quando o valor extraído diverge do valor verificado/legado atual.
    const pendingCriticals = criticalsPendingDecision({
      candidates: draft.fields,
      decisions,
      current: currentVerified,
    });
    if (!verifyOnly && pendingCriticals.length > 0) {
      return NextResponse.json(
        {
          error: `Resolva os campos críticos antes de publicar (aceite, edite ou rejeite cada um): ${pendingCriticals.join(', ')}.`,
          code: 'unresolved_critical_conflicts',
        },
        { status: 422 },
      );
    }

    const newInfo = buildInfoFromDecisions({
      current: currentVerified,
      candidates: draft.fields,
      decisions,
    });

    // Validação estrita final — saída que não passa no schema não persiste.
    const validation = enterpriseInfoSchema.safeParse(newInfo);
    if (!validation.success) {
      logAiUsage({
        capability: 'enterprise_info_publish', outcome: 'validation_error',
        userId: user.id, userRole: user.role, scopeId: enterpriseId,
        errorCode: 'invalid_output', note: 'buildInfoFromDecisions falhou no schema',
      });
      return NextResponse.json(
        { error: 'Validação falhou — nada foi alterado. A versão anterior permanece publicada.' },
        { status: 422 },
      );
    }

    // CORREÇÃO (2026-09, "botão de confirmar a edição não funciona"): as
    // decisões aplicadas são REGISTRADAS no rascunho (status do candidato
    // vira accepted/edited/rejected) e o needsReview é recalculado contra a
    // base aprovada. Sem isso, o recarregamento do diálogo zerava as decisões
    // locais e todo crítico com valor aprovado divergente do candidato voltava
    // a "aguardar decisão" — loop infinito de redecisão + versões publicadas
    // repetidas a cada tentativa.
    const reconciledDraft = applyDecisionsToDraft(draft, decisions, validation.data);

    const now = new Date();
    const publish = !verifyOnly;
    const nextVersion = enterprise.publishedVersion + (publish ? 1 : 0);

    await db.$transaction([
      db.enterprise.update({
        where: { id: enterpriseId },
        data: {
          verifiedInfo: validation.data,
          verifiedInfoAt: now,
          verifiedInfoBy: user.id,
          extractionDraft: reconciledDraft as unknown as Prisma.InputJsonValue,
          ...(publish
            ? {
                publishedInfo: validation.data,
                publishedAt: now,
                publishedVersion: nextVersion,
                // CORREÇÃO (2026-09): a superfície legada (painel "Informações"
                // do CRM e fallback público) lê cachedInfo — sem esta
                // sincronização, mesmo após revisar e publicar, a interface
                // continuava exibindo a versão antiga. cachedInfo passa a
                // espelhar SEMPRE o conteúdo aprovado por humano.
                cachedInfo: validation.data,
              }
            : {}),
        },
      }),
      ...(publish
        ? [db.enterpriseInfoVersion.create({
            data: {
              enterpriseId,
              version: nextVersion,
              info: validation.data,
              source: 'EXTRACTION_APPROVED' as const,
              publishedById: user.id,
              publishedAt: now,
            },
          })]
        : []),
    ]);

    logAiUsage({
      capability: 'enterprise_info_publish', outcome: 'success',
      userId: user.id, userRole: user.role, scopeId: enterpriseId,
      note: `${publish ? 'publicado' : 'verificado'} · v${publish ? nextVersion : enterprise.publishedVersion} · ${decisions.length} decisões${note ? ` · ${note.slice(0, 80)}` : ''}`,
    });

    return NextResponse.json({
      success: true,
      verified: validation.data,
      published: publish ? validation.data : null,
      publishedVersion: publish ? nextVersion : enterprise.publishedVersion,
      publishedAt: publish ? now.toISOString() : null,
    });
  } catch (error) {
    console.error('[Extraction Publish] Error:', error);
    return NextResponse.json(
      { error: 'Erro ao publicar. Nada foi alterado — a versão anterior permanece ativa.' },
      { status: 500 },
    );
  }
}
