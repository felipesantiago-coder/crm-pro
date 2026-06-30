import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const enterprises = await db.enterprise.findMany({
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
        images: { select: { id: true, url: true, altText: true, sortOrder: true }, orderBy: { sortOrder: 'asc' } },
        _count: { select: { clients: true } },
      },
      orderBy: { name: 'asc' },
    });

    const regions = [...new Set(enterprises.map((e) => e.region).filter(Boolean))].sort();
    return NextResponse.json({ enterprises, regions });
  } catch (error) {
    console.error('[Enterprise Panel] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}