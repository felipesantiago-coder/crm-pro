import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

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
      },
      orderBy: { name: 'asc' },
    });

    // Resolve i18n fields to flat strings for the listing page
    const resolved = enterprises.map((e) => ({
      ...e,
      landingTitle: resolveI18nString(e.landingTitle as Record<string, string> | null, locale),
      landingSubtitle: resolveI18nString(e.landingSubtitle as Record<string, string> | null, locale),
    }));

    return NextResponse.json(resolved);
  } catch (error) {
    console.error('[Enterprise Public List] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
