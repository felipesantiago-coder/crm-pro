import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolvePublicEnterpriseInfo } from '@/lib/ai/enterprise-info';

/**
 * GET /api/enterprises/public-list — listagem pública (seção /empreendimentos).
 *
 * §12-v2 ("a base de dados é a única fonte da verdade pública"):
 * - consome a MESMA cadeia estrita das demais superfícies: publicado →
 *   verificado, e SOMENTE com base documental presente (pdfContent);
 * - SEM fallback de catálogo estático e SEM legado cachedInfo;
 * - base removida (ou sem extração publicada) → `cachedInfo` null e
 *   `landingSubtitle` SUPRIMIDO no card — nada derivado de base é exibido
 *   ("nada seja exibido na seção pública do empreendimento").
 * Rascunho de extração NUNCA é público.
 */

function resolveI18nString(field: Record<string, string> | null | undefined, locale: string): string | null {
  if (!field || typeof field !== 'object') return null;
  return field[locale] || field['pt-BR'] || Object.values(field)[0] || null;
}

export async function GET(request: NextRequest) {
  try {
    const locale = request.headers.get('x-locale') || 'pt-BR';

    const enterprises = await db.enterprise.findMany({
      where: { slug: { not: null } },
      select: {
        id: true,
        name: true,
        slug: true,
        region: true,
        imageUrl: true,
        landingTitle: true,
        landingSubtitle: true,
        images: {
          select: { id: true, url: true, altText: true, sortOrder: true },
          orderBy: { sortOrder: 'asc' },
          take: 1,
        },
        cachedInfo: true,
        cachedInfoI18n: true,
        pdfContent: true,
        publishedInfo: true,
        publishedAt: true,
        publishedVersion: true,
        verifiedInfo: true,
        verifiedInfoAt: true,
      },
      orderBy: { name: 'asc' },
    });

    // Resolve i18n fields to flat strings for the listing page
    const resolved = enterprises.map((e) => {
      const { cachedInfoI18n, publishedInfo, verifiedInfo, ...listItem } = e;

      // ── §12-v2: cadeia pública estrita com gate de base documental ──
      const publicInfo = resolvePublicEnterpriseInfo(e, { requireBaseDocument: true });
      const hasApprovedInfo = publicInfo.source === 'published' || publicInfo.source === 'verified';
      let info: Record<string, unknown> | null = publicInfo.info as Record<string, unknown> | null;

      // i18n: tradução do locale mesclada sobre a base (idêntico à landing)
      if (locale !== 'pt-BR' && cachedInfoI18n && (cachedInfoI18n as Record<string, Record<string, unknown>>)[locale]) {
        info = { ...(info || {}), ...(cachedInfoI18n as Record<string, Record<string, unknown>>)[locale] };
      }

      return {
        ...listItem,
        landingTitle: resolveI18nString(e.landingTitle as Record<string, string> | null, locale),
        // Sem extração/edição publicada, o resumo do card NÃO recua para o
        // landingSubtitle (texto curado que pode carregar preço antigo) —
        // "nada seja exibido" (§12-v2).
        landingSubtitle: hasApprovedInfo
          ? resolveI18nString(e.landingSubtitle as Record<string, string> | null, locale)
          : null,
        cachedInfo: info,
        infoSource: publicInfo.source,
        infoReferenceDate: publicInfo.referenceDate,
      };
    });

    return NextResponse.json(resolved);
  } catch (error) {
    console.error('[Enterprise Public List] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
