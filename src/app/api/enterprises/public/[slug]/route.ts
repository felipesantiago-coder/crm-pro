import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  servePublicEnterprise,
  createDbPublicSnapshotDeps,
} from '@/lib/public-snapshot';

/**
 * GET /api/enterprises/public/[slug] — ficha pública do empreendimento.
 *
 * Fase 7: payload composto pela FONTE ÚNICA (public-enterprise-view) e
 * servido com o snapshot público versionado (public-snapshot.ts):
 *   - frescor por request garantido pela digital de frescor
 *     (Enterprise.updatedAt + publishedVersion — publish/unpublish/troca
 *    /remoção divergem a digital → recomposição imediata);
 *   - caminho feliz = 2 queries leves (freshness + snapshot por
 *     slug+locale) em vez de 1 query pesada (pdfContent) + 3 subselects;
 *   - degradação automática para a composição dinâmica (tabela ausente/
 *     erro — WARN único) e reversão por PUBLIC_SNAPSHOT_V2=legacy;
 *   - fila (peekNextUser) e draft NUNCA passam por aqui; pdfContent saiu
 *     do payload (vazava nesta resposta até a Fase 7 — documento interno).
 *
 * mergeCachedInfo foi REMOVIDO (§12-v2): o catálogo estático NUNCA mais
 * preenche campos públicos — o público exibe somente a extração/edição
 * publicada, e apenas com base documental presente.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    // Read locale from middleware-set header (default: pt-BR)
    const locale = request.headers.get('x-locale') || 'pt-BR';

    const served = await servePublicEnterprise(
      createDbPublicSnapshotDeps(db),
      { slug, locale },
    );

    if (!served) {
      // slug inexistente OU gate §12-v2 (info 'none' — sem aprovação com
      // base presente): mesma resposta da landing SSR (notFound).
      return NextResponse.json(
        { error: 'Empreendimento sem informações públicas' },
        { status: 404 },
      );
    }

    return NextResponse.json(served.payload);
  } catch (error) {
    console.error('[Enterprise Public] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
