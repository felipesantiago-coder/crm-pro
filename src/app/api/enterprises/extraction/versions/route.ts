import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { z } from 'zod';
import { planVersionDeletion } from '@/lib/ai/extraction-core';
import { logAiUsage } from '@/lib/ai/telemetry';

/**
 * GET /api/enterprises/extraction/versions?enterpriseId=… — histórico de
 * versões publicadas com diff resumido por campo (§10.6/§10.7 — o Nexo e a
 * UI usam isto para "resumir diferenças entre versões").
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

    const versions = await db.enterpriseInfoVersion.findMany({
      where: { enterpriseId },
      orderBy: { version: 'desc' },
      take: 20,
      select: {
        id: true, version: true, info: true, source: true,
        publishedById: true, publishedAt: true,
      },
    });

    // Diff resumido entre versões consecutivas (sem conteúdo pesado).
    const withDiff = versions.map((v, idx) => {
      const prev = versions[idx + 1] ?? null;
      const changedFields: string[] = [];
      if (prev) {
        const a = v.info as Record<string, unknown>;
        const b = prev.info as Record<string, unknown>;
        for (const key of Object.keys(a)) {
          if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) changedFields.push(key);
        }
      }
      return {
        id: v.id,
        version: v.version,
        source: v.source,
        publishedById: v.publishedById,
        publishedAt: v.publishedAt,
        changedFields: changedFields.slice(0, 20),
      };
    });

    return NextResponse.json({ versions: withDiff });
  } catch (error) {
    console.error('[Extraction Versions] Error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// ── Apagar versões antigas (gestão do administrador) ────────────────────────

const deleteBodySchema = z
  .object({
    enterpriseId: z.string().min(1),
    version: z.number().int().positive().optional(),
    keepCurrent: z.boolean().optional(),
  })
  .refine((b) => b.keepCurrent === true || typeof b.version === 'number', {
    message: 'informe version (exclusão individual) ou keepCurrent (limpeza em lote)',
  });

/**
 * DELETE /api/enterprises/extraction/versions — apaga versões anteriores do
 * histórico (bases anteriores), a pedido do administrador.
 *
 * Modos:
 *  - { enterpriseId, version: N }        → apaga UMA versão anterior;
 *  - { enterpriseId, keepCurrent: true } → apaga TODAS as anteriores à ativa.
 *
 * Invariáveis (planVersionDeletion, testado):
 *  - a versão ATIVA (publishedVersion) NUNCA é apagada — é a âncora da
 *    numeração e a referência do conteúdo no ar; tentativa → 409;
 *  - publishedInfo/verifiedInfo/cachedInfo vivem no Enterprise — apagar
 *    linhas do histórico NÃO altera o que está publicado;
 *  - publicar/restaurar sempre criam versões NOVAS, então nada quebra.
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
      return NextResponse.json({ error: 'Apenas administradores podem apagar versões.' }, { status: 403 });
    }

    const raw = await req.json().catch(() => null);
    const parsed = deleteBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Requisição inválida' }, { status: 400 });
    }
    const { enterpriseId, version, keepCurrent = false } = parsed.data;

    const enterprise = await db.enterprise.findUnique({
      where: { id: enterpriseId },
      select: { id: true, publishedVersion: true },
    });
    if (!enterprise) {
      return NextResponse.json({ error: 'Empreendimento não encontrado' }, { status: 404 });
    }

    const existing = await db.enterpriseInfoVersion.findMany({
      where: { enterpriseId },
      select: { version: true },
    });
    const plan = planVersionDeletion(existing, enterprise.publishedVersion);

    let targetVersions: number[];
    if (keepCurrent) {
      targetVersions = plan.deletable;
    } else {
      if (version === plan.active) {
        return NextResponse.json(
          { error: 'A versão ativa (publicada agora) não pode ser apagada — publique ou restaure outra versão para substituí-la.' },
          { status: 409 },
        );
      }
      if (!existing.some((v) => v.version === version)) {
        return NextResponse.json({ error: 'Versão não encontrada' }, { status: 404 });
      }
      targetVersions = [version as number];
    }

    if (targetVersions.length === 0) {
      return NextResponse.json({ success: true, deleted: 0, remaining: existing.length, active: plan.active });
    }

    const result = await db.enterpriseInfoVersion.deleteMany({
      where: { enterpriseId, version: { in: targetVersions } },
    });

    logAiUsage({
      capability: 'enterprise_info_publish', outcome: 'success',
      userId: user.id, userRole: user.role, scopeId: enterpriseId,
      note: `versões apagadas: ${result.count}${keepCurrent ? ' (limpeza de antigas)' : ` (v${version})`}`,
    });

    return NextResponse.json({
      success: true,
      deleted: result.count,
      remaining: existing.length - result.count,
      active: plan.active,
    });
  } catch (error) {
    console.error('[Extraction Versions Delete] Error:', error);
    return NextResponse.json({ error: 'Erro ao apagar versões. Nada foi alterado.' }, { status: 500 });
  }
}
