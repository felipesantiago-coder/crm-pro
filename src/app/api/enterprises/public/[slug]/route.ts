import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

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

    return NextResponse.json(enterprise);
  } catch (error) {
    console.error('[Enterprise Public] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}