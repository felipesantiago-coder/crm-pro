import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';

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
