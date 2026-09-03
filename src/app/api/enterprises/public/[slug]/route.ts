import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import enterprisesCatalog, { EnterpriseCatalogEntry } from '@/data/enterprises-catalog';
import { resolvePublicEnterpriseInfo } from '@/lib/ai/enterprise-info';

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
 * Merge: DB cachedInfo is the PRIMARY source; catalog is FALLBACK only.
 * DB fields win when non-null. Catalog fills in only null/undefined DB fields.
 */
function mergeCachedInfo(
  dbCachedInfo: any,
  catalog: EnterpriseCatalogEntry,
): any {
  if (!catalog || Object.keys(catalog).length === 0) return dbCachedInfo;

  const base = dbCachedInfo || {};
  const merged: any = { ...base };

  // Simple string/number fields — DB wins if non-null; catalog fills nulls
  for (const key of ['builder', 'architecture', 'landscaping', 'status', 'deliveryDate', 'price', 'totalUnits', 'floors', 'parkingSpots', 'summary'] as const) {
    if ((merged[key] === null || merged[key] === undefined) && catalog[key] !== undefined && catalog[key] !== null) {
      merged[key] = catalog[key];
    }
  }

  // Location — DB wins per-field; catalog fills missing
  if (catalog.location) {
    merged.location = { ...(base.location || {}) };
    for (const locKey of ['address', 'neighborhood', 'city', 'state', 'region', 'additionalInfo'] as const) {
      if ((merged.location[locKey] === null || merged.location[locKey] === undefined) && catalog.location[locKey] !== undefined && catalog.location[locKey] !== null) {
        merged.location[locKey] = catalog.location[locKey];
      }
    }
  }

  // Differentials — DB wins if non-empty array; catalog fills only if DB is empty/missing
  if (!Array.isArray(merged.differentials) || merged.differentials.length === 0) {
    if (Array.isArray(catalog.differentials) && catalog.differentials.length > 0) {
      merged.differentials = catalog.differentials;
    }
  }

  // Apartment types — DB wins if non-empty array; catalog fills only if DB is empty/missing
  if (!Array.isArray(merged.apartmentTypes) || merged.apartmentTypes.length === 0) {
    if (Array.isArray(catalog.apartmentTypes) && catalog.apartmentTypes.length > 0) {
      merged.apartmentTypes = catalog.apartmentTypes;
    }
  }

  return merged;
}

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

    // ── Fase 5 (§12): público consome publicado → verificado → legado.
    // Resultado exposto em `cachedInfo` (camada de compatibilidade marcada);
    // rascunhos de extração NUNCA são públicos. Telemetria de dependência
    // legada é emitida pelo resolver.
    const resolved = resolvePublicEnterpriseInfo(enterprise as Record<string, unknown> & { id: string });
    enterprise.cachedInfo = resolved.info;
    const infoSource = resolved.source;
    const infoReferenceDate = resolved.referenceDate;

    // Use catalog as fallback for any null/missing fields in DB cachedInfo.
    const catalog = enterprisesCatalog[slug];
    if (catalog) {
      enterprise.cachedInfo = mergeCachedInfo(enterprise.cachedInfo, catalog);
    }

    // ── i18n resolution for text fields ──────────────
    // Resolve locale-keyed JSON → flat string for the landing page client
    const rawTitle = enterprise.landingTitle as Record<string, string> | null;
    const rawSubtitle = enterprise.landingSubtitle as Record<string, string> | null;
    const rawDesc = enterprise.landingDescription as Record<string, string> | null;

    enterprise.landingTitle = resolveI18nString(rawTitle, locale);
    enterprise.landingSubtitle = resolveI18nString(rawSubtitle, locale);
    enterprise.landingDescription = resolveI18nString(rawDesc, locale);

    // ── i18n resolution for cachedInfo ────────────────
    // If locale is not pt-BR and a translation exists, use it (merged over base)
    const i18nInfo = enterprise.cachedInfoI18n as Record<string, any> | null;
    if (locale !== 'pt-BR' && i18nInfo && i18nInfo[locale]) {
      // Deep-merge: translated fields override base, base fills missing
      const base = (enterprise.cachedInfo && typeof enterprise.cachedInfo === 'object')
        ? enterprise.cachedInfo as Record<string, any> : {};
      const translated = i18nInfo[locale];
      enterprise.cachedInfo = { ...base, ...(typeof translated === 'object' ? translated : {}) };
    }

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
