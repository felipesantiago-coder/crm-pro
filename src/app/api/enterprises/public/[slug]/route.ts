import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolvePublicEnterpriseInfo, mergePublicInfoI18n } from '@/lib/ai/enterprise-info';

/**
 * Resolve a string from a locale-keyed JSON object.
 * Falls back: requested locale → pt-BR → first available value.
 */
function resolveI18nString(
  field: Record<string, string> | null | undefined,
  locale: string,
): string | null {
  if (!field || typeof field !== 'object') return null;
  return field[locale] || field['pt-BR'] || Object.values(field)[0] || null;
}

/**
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

    const enterprise = await db.enterprise.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        region: true,
        imageUrl: true,
        landingTitle: true,
        landingSubtitle: true,
        landingDescription: true,
        cachedInfo: true,
        cachedInfoI18n: true,
        pdfContent: true,
        publishedInfo: true,
        publishedAt: true,
        publishedVersion: true,
        verifiedInfo: true,
        verifiedInfoAt: true,
        mapLatitude: true,
        mapLongitude: true,
        createdAt: true,
        _count: {
          select: { clients: true },
        },
        images: {
          select: { id: true, url: true, altText: true, sortOrder: true },
          orderBy: { sortOrder: 'asc' },
        },
        floorPlans: {
          select: { id: true, url: true, altText: true, sortOrder: true, name: true, area: true, bedrooms: true, suites: true, hasBalcony: true, isGarden: true, isPenthouse: true, description: true },
          orderBy: { sortOrder: 'asc' },
        },
        formFields: {
          where: { isActive: true },
          select: {
            id: true,
            label: true,
            fieldType: true,
            placeholder: true,
            options: true,
            required: true,
            sortOrder: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!enterprise) {
      return NextResponse.json({ error: 'Empreendimento não encontrado' }, { status: 404 });
    }

    // ── §12-v2 rev. Task 41: público consome APENAS publicado → verificado, e
    // SOMENTE com base documental presente (pdfContent). Sem info aprovada, a
    // página pública NÃO EXISTE → 404 (a landing SSR aplica notFound(); aqui
    // o client-side refetch recebe o mesmo veredito). Rascunhos NUNCA são públicos.
    const resolved = resolvePublicEnterpriseInfo(enterprise as Record<string, unknown> & { id: string }, { requireBaseDocument: true });
    if (resolved.source === 'none') {
      return NextResponse.json({ error: 'Empreendimento sem informações públicas' }, { status: 404 });
    }
    enterprise.cachedInfo = resolved.info;
    const infoSource = resolved.source;
    const infoReferenceDate = resolved.referenceDate;

    // ── i18n resolution for text fields ──────────────
    // Resolve locale-keyed JSON → flat string for the landing page client
    const rawTitle = enterprise.landingTitle as Record<string, string> | null;
    const rawSubtitle = enterprise.landingSubtitle as Record<string, string> | null;
    const rawDesc = enterprise.landingDescription as Record<string, string> | null;

    enterprise.landingTitle = resolveI18nString(rawTitle, locale);
    enterprise.landingSubtitle = resolveI18nString(rawSubtitle, locale);
    enterprise.landingDescription = resolveI18nString(rawDesc, locale);

    // ── i18n resolution for cachedInfo ────────────────
    // If locale is not pt-BR and a translation exists, use it (merged over
    // base). §12-v2 rev. Task 41: a tradução NUNCA ressuscita dado — sem
    // info aprovada o retorno acima já foi 404; o merge só enriquece a info
    // existente (mergePublicInfoI18n).
    const i18nInfo = enterprise.cachedInfoI18n as Record<string, any> | null;
    enterprise.cachedInfo = mergePublicInfoI18n(
      enterprise.cachedInfo as Record<string, unknown> | null,
      i18nInfo,
      locale,
    ) as typeof enterprise.cachedInfo;

    // Remove internal i18n / draft-state fields from public response
    const {
      cachedInfoI18n: _removed,
      publishedInfo: _pi,
      verifiedInfo: _vi,
      ...publicData
    } = enterprise as typeof enterprise & Record<string, unknown>;
    return NextResponse.json({ ...publicData, infoSource, infoReferenceDate });
  } catch (error) {
    console.error('[Enterprise Public] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
