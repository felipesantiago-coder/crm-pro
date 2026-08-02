import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import enterprisesCatalog, { EnterpriseCatalogEntry } from '@/data/enterprises-catalog';

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
        floorPlans: {
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

    // Use catalog as fallback for any null/missing fields in DB cachedInfo.
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