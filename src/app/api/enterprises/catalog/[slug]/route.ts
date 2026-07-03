import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { isAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import enterprisesCatalog from '@/data/enterprises-catalog';

// GET /api/enterprises/catalog/[slug] — Return current effective cachedInfo
// (merged from static catalog + DB) for admin preview
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const { slug } = await params;
    const enterprise = await db.enterprise.findUnique({
      where: { slug },
      select: { id: true, name: true, slug: true, cachedInfo: true },
    });

    if (!enterprise) {
      return NextResponse.json({ error: 'Empreendimento não encontrado' }, { status: 404 });
    }

    const staticData = enterprisesCatalog[slug] || {};

    return NextResponse.json({
      id: enterprise.id,
      name: enterprise.name,
      slug: enterprise.slug,
      dbCachedInfo: enterprise.cachedInfo,
      staticCatalogData: staticData,
    });
  } catch (error) {
    console.error('[Enterprise Catalog GET] Error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// PUT /api/enterprises/catalog/[slug] — Update cachedInfo directly (no AI)
// Body: partial ExtractedInfo object — only provided fields are updated
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const { slug } = await params;
    const enterprise = await db.enterprise.findUnique({
      where: { slug },
      select: { id: true, name: true, cachedInfo: true },
    });

    if (!enterprise) {
      return NextResponse.json({ error: 'Empreendimento não encontrado' }, { status: 404 });
    }

    const body = await request.json();

    // Deep merge: existing cachedInfo + new fields from request
    const base = (enterprise.cachedInfo as Record<string, any>) || {};

    const updated: Record<string, any> = { ...base };

    // Simple fields
    for (const key of ['builder', 'architecture', 'landscaping', 'status', 'deliveryDate', 'price', 'summary'] as const) {
      if (body[key] !== undefined) updated[key] = body[key] || null;
    }

    // Numeric fields
    for (const key of ['totalUnits', 'floors', 'parkingSpots'] as const) {
      if (body[key] !== undefined) updated[key] = typeof body[key] === 'number' ? body[key] : null;
    }

    // Location — merge
    if (body.location && typeof body.location === 'object') {
      updated.location = { ...(base.location || {}) };
      for (const locKey of ['address', 'neighborhood', 'city', 'state', 'region', 'additionalInfo'] as const) {
        if (body.location[locKey] !== undefined) updated.location[locKey] = body.location[locKey] || null;
      }
    }

    // Differentials
    if (Array.isArray(body.differentials)) {
      updated.differentials = body.differentials.filter(Boolean).slice(0, 10);
    }

    // Apartment types
    if (Array.isArray(body.apartmentTypes)) {
      updated.apartmentTypes = body.apartmentTypes.map((apt: any) => ({
        name: apt.name || 'Tipo',
        area: apt.area || null,
        bedrooms: apt.bedrooms || null,
        description: apt.description || null,
        price: apt.price || null,
      }));
    }

    await db.enterprise.update({
      where: { id: enterprise.id },
      data: { cachedInfo: updated as any },
    });

    return NextResponse.json({
      success: true,
      message: `"${enterprise.name}" atualizado com sucesso.`,
      cachedInfo: updated,
    });
  } catch (error) {
    console.error('[Enterprise Catalog PUT] Error:', error);
    return NextResponse.json({ error: 'Erro ao atualizar' }, { status: 500 });
  }
}