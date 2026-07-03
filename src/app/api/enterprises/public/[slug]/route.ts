import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import enterprisesCatalog, { EnterpriseCatalogEntry } from '@/data/enterprises-catalog';

/**
 * Deep merge: catalog (static) overrides dbCachedInfo.
 * Only non-null catalog fields win; null catalog fields fall back to DB.
 */
function mergeCachedInfo(
  dbCachedInfo: any,
  catalog: EnterpriseCatalogEntry,
): any {
  if (!catalog || Object.keys(catalog).length === 0) return dbCachedInfo;

  const base = dbCachedInfo || {};
  const merged: any = { ...base };

  // Simple string/number fields — catalog wins if non-null
  for (const key of ['builder', 'architecture', 'landscaping', 'status', 'deliveryDate', 'price', 'totalUnits', 'floors', 'parkingSpots', 'summary'] as const) {
    if (catalog[key] !== undefined && catalog[key] !== null) {
      merged[key] = catalog[key];
    }
  }

  // Location — merge field by field
  if (catalog.location) {
    merged.location = { ...(base.location || {}) };
    for (const locKey of ['address', 'neighborhood', 'city', 'state', 'region', 'additionalInfo'] as const) {
      if (catalog.location[locKey] !== undefined && catalog.location[locKey] !== null) {
        merged.location[locKey] = catalog.location[locKey];
      }
    }
  }

  // Differentials — catalog wins if non-empty array
  if (Array.isArray(catalog.differentials) && catalog.differentials.length > 0) {
    merged.differentials = catalog.differentials;
  }

  // Apartment types — catalog wins if non-empty array
  if (Array.isArray(catalog.apartmentTypes) && catalog.apartmentTypes.length > 0) {
    merged.apartmentTypes = catalog.apartmentTypes;
  }

  return merged;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

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
        createdAt: true,
        _count: {
          select: { clients: true },
        },
        images: {
          select: { id: true, url: true, altText: true, sortOrder: true },
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

    // Merge static catalog data over DB cachedInfo.
    // Catalog is the primary source for ficha técnica fields;
    // DB is fallback for any field the catalog doesn't define.
    const catalog = enterprisesCatalog[slug];
    if (catalog) {
      enterprise.cachedInfo = mergeCachedInfo(enterprise.cachedInfo, catalog);
    }

    return NextResponse.json(enterprise);
  } catch (error) {
    console.error('[Enterprise Public] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}