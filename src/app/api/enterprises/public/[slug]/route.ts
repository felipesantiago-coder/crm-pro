import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { extractAndCache } from '../../extract-info/route';

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
        pdfContent: true,
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

    // Lazy extraction fallback: if cachedInfo is null but pdfContent exists,
    // extract now so the landing page always has data.
    if (!enterprise.cachedInfo && enterprise.pdfContent && enterprise.pdfContent.trim().length >= 20) {
      try {
        const info = await extractAndCache(enterprise.id);
        enterprise.cachedInfo = info as any;
      } catch (err) {
        console.warn(`[Enterprise Public] Lazy extraction failed for "${enterprise.name}":`, err instanceof Error ? err.message : err);
      }
    }

    // Strip pdfContent from response — it's internal only
    const { pdfContent: _pdfContent, ...publicData } = enterprise as any;

    return NextResponse.json(publicData);
  } catch (error) {
    console.error('[Enterprise Public] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}