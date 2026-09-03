import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { enterpriseInfoSchema } from '@/lib/ai/contracts';
import { logAiUsage } from '@/lib/ai/telemetry';

/**
 * POST /api/enterprises/extraction/restore — restauração de versão
 * (prompt v1.0 §10.6 item 6 / critério §10.8 "rollback").
 *
 * Restaura uma versão publicada anterior: verified + published voltam ao
 * conteúdo da versão, e a restauração cria uma NOVA versão (histórico é
 * append-only — nada é apagado).
 *
 * Body: { enterpriseId: string, version: number }
 */
export async function POST(req: NextRequest) {
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
      return NextResponse.json({ error: 'Apenas administradores podem restaurar versões.' }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const enterpriseId = (body as { enterpriseId?: string } | null)?.enterpriseId;
    const version = (body as { version?: number } | null)?.version;

    if (!enterpriseId || typeof version !== 'number') {
      return NextResponse.json({ error: 'enterpriseId e version são obrigatórios' }, { status: 400 });
    }

    const target = await db.enterpriseInfoVersion.findUnique({
      where: { enterpriseId_version: { enterpriseId, version } },
    });
    if (!target) {
      return NextResponse.json({ error: 'Versão não encontrada' }, { status: 404 });
    }

    const validation = enterpriseInfoSchema.safeParse(target.info);
    if (!validation.success) {
      return NextResponse.json({ error: 'Versão armazenada é inválida — nada foi alterado.' }, { status: 422 });
    }

    const enterprise = await db.enterprise.findUnique({
      where: { id: enterpriseId },
      select: { publishedVersion: true },
    });
    if (!enterprise) {
      return NextResponse.json({ error: 'Empreendimento não encontrado' }, { status: 404 });
    }

    const now = new Date();
    const nextVersion = enterprise.publishedVersion + 1;

    await db.$transaction([
      db.enterprise.update({
        where: { id: enterpriseId },
        data: {
          verifiedInfo: validation.data,
          verifiedInfoAt: now,
          verifiedInfoBy: user.id,
          publishedInfo: validation.data,
          publishedAt: now,
          publishedVersion: nextVersion,
          // Consistência com publish: superfície legada espelha a versão
          // restaurada (aprovada por humano).
          cachedInfo: validation.data,
        },
      }),
      db.enterpriseInfoVersion.create({
        data: {
          enterpriseId,
          version: nextVersion,
          info: validation.data,
          source: 'RESTORE' as const,
          publishedById: user.id,
          publishedAt: now,
        },
      }),
    ]);

    logAiUsage({
      capability: 'enterprise_info_publish', outcome: 'success',
      userId: user.id, userRole: user.role, scopeId: enterpriseId,
      note: `restauração da v${version} → nova v${nextVersion}`,
    });

    return NextResponse.json({
      success: true,
      restoredFrom: version,
      publishedVersion: nextVersion,
      info: validation.data,
    });
  } catch (error) {
    console.error('[Extraction Restore] Error:', error);
    return NextResponse.json({ error: 'Erro ao restaurar. Nada foi alterado.' }, { status: 500 });
  }
}
