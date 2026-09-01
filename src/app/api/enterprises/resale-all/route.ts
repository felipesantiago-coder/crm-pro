import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { db } from '@/lib/db';
import { authOptions } from '@/lib/auth-options';

// GET - List all resale properties across all REVENDA enterprises
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 });
    }

    const properties = await db.resaleProperty.findMany({
      where: { enterprise: { type: 'REVENDA' } },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true, code: true, sortOrder: true, name: true, region: true,
        category: true, typology: true, bedrooms: true, area: true,
        address: true, captor: true, appointment: true, phone: true,
        phoneDigits: true, price: true, condo: true, iptu: true,
        notes: true, acceptsFinancing: true, acceptsFgts: true,
        url: true, dataNote: true,
        enterpriseId: true,
        enterprise: { select: { id: true, name: true } },
      },
    });

    const regions = [...new Set(properties.map(p => p.region).filter(Boolean))].sort((a, b) =>
      a!.localeCompare(b!, 'pt-BR')
    );
    const categories = [...new Set(properties.map(p => p.category).filter(Boolean))].sort((a, b) =>
      a!.localeCompare(b!, 'pt-BR')
    );
    const captors = [...new Set(properties.map(p => p.captor).filter(Boolean))].sort((a, b) =>
      a!.localeCompare(b!, 'pt-BR')
    );

    return NextResponse.json({ properties, regions, categories, captors });
  } catch (error) {
    console.error('Error fetching all resale properties:', error);
    return NextResponse.json({ error: 'Erro ao buscar imoveis' }, { status: 500 });
  }
}
