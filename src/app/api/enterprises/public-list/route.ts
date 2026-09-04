import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolvePublicEnterpriseInfo, mergePublicInfoI18n } from '@/lib/ai/enterprise-info';

/**
 * GET /api/enterprises/public-list — listagem pública (seção /empreendimentos).
 *
 * §12-v2 ("a base de dados é a única fonte da verdade pública") rev. Task 41:
 * - consome a MESMA cadeia estrita das demais superfícies: publicado →
 *   verificado, e SOMENTE com base documental presente (pdfContent);
 * - SEM fallback de catálogo estático e SEM legado cachedInfo;
 * - tradução i18n NUNCA ressuscita dado sem info aprovada (mergePublicInfoI18n);
 * - empreendimento SEM extração/edição aprovada com base presente NEM APARECE
 *   na listagem — "nada seja exibido na seção pública do empreendimento"
 *   (card-fantasma sem resumo leva a uma landing 404; omitir é mais coerente).
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

    // Resolve i18n fields to flat strings for the listing page.
    // §12-v2 rev. Task 41: sem info aprovada, o empreendimento é OMITIDO da
    // listagem pública (nada é exibido — nem card vazio).
    const resolved = enterprises
      .map((e) => {
        const { cachedInfoI18n, publishedInfo, verifiedInfo, ...listItem } = e;

        // ── §12-v2: cadeia pública estrita com gate de base documental ──
        const publicInfo = resolvePublicEnterpriseInfo(e, { requireBaseDocument: true });
        const hasApprovedInfo = publicInfo.source === 'published' || publicInfo.source === 'verified';
        if (!hasApprovedInfo) return null;

        // i18n: tradução do locale mesclada sobre a base aprovada (a tradução
        // NUNCA cria dado onde não há info aprovada — mergePublicInfoI18n).
        const info = mergePublicInfoI18n(
          publicInfo.info as Record<string, unknown> | null,
          cachedInfoI18n,
          locale,
        );

        return {
          ...listItem,
          landingTitle: resolveI18nString(e.landingTitle as Record<string, string> | null, locale),
          landingSubtitle: resolveI18nString(e.landingSubtitle as Record<string, string> | null, locale),
          cachedInfo: info,
          infoSource: publicInfo.source,
          infoReferenceDate: publicInfo.referenceDate,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    return NextResponse.json(resolved);
  } catch (error) {
    console.error('[Enterprise Public List] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
