import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
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
        cachedInfo: true,
        images: {
          select: { id: true, url: true, altText: true, sortOrder: true },
          orderBy: { sortOrder: 'asc' },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json(enterprises);
  } catch (error) {
    console.error('[Enterprise Public List] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}