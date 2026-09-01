import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { db } from '@/lib/db';
import { extractPropertiesFromPdf } from '@/lib/parse-resale-pdf';
import { authOptions } from '@/lib/auth-options';

// GET - List resale properties for an enterprise
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const properties = await db.resaleProperty.findMany({
      where: { enterpriseId: id },
      orderBy: { sortOrder: 'asc' },
    });
    const regions = [...new Set(properties.map(p => p.region).filter(Boolean))];
    const categories = [...new Set(properties.map(p => p.category).filter(Boolean))];
    const captors = [...new Set(properties.map(p => p.captor).filter(Boolean))];
    return NextResponse.json({ properties, regions, categories, captors });
  } catch (error) {
    console.error('Error fetching resale properties:', error);
    return NextResponse.json({ error: 'Erro ao buscar imoveis' }, { status: 500 });
  }
}

// POST - Extract properties from PDF and upsert
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'ADMIN') {
    return NextResponse.json({ error: 'Acesso restrito' }, { status: 403 });
  }
  try {
    const enterprise = await db.enterprise.findUnique({ where: { id }, select: { type: true, name: true } });
    if (!enterprise) return NextResponse.json({ error: 'Empreendimento nao encontrado' }, { status: 404 });
    if (enterprise.type !== 'REVENDA') {
      return NextResponse.json({ error: 'Este empreendimento nao e do tipo Revenda' }, { status: 400 });
    }
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 });
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Apenas arquivos PDF sao aceitos' }, { status: 400 });
    }
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'Arquivo muito grande. Maximo 20MB.' }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const { properties, pageCount } = await extractPropertiesFromPdf(buffer);
    let created = 0;
    const errors: string[] = [];
    for (const prop of properties) {
      try {
        await db.resaleProperty.upsert({
          where: { enterpriseId_code: { enterpriseId: id, code: prop.code } },
          create: {
            enterpriseId: id, code: prop.code, sortOrder: prop.sortOrder,
            name: prop.name || null, region: prop.region || null,
            category: prop.category, typology: prop.typology || null,
            bedrooms: prop.bedrooms, area: prop.area,
            address: prop.address || null, captor: prop.captor || null,
            appointment: prop.appointment || null, phone: prop.phone || null,
            phoneDigits: prop.phoneDigits || null, price: prop.price,
            condo: prop.condo, iptu: prop.iptu,
            notes: prop.notes || null, acceptsFinancing: prop.acceptsFinancing,
            acceptsFgts: prop.acceptsFgts, url: prop.url || null,
            dataNote: prop.dataNote || null, sourcePage: prop.sourcePage,
          },
          update: {
            sortOrder: prop.sortOrder, name: prop.name || null,
            region: prop.region || null, category: prop.category,
            typology: prop.typology || null, bedrooms: prop.bedrooms,
            area: prop.area, address: prop.address || null,
            captor: prop.captor || null, appointment: prop.appointment || null,
            phone: prop.phone || null, phoneDigits: prop.phoneDigits || null,
            price: prop.price, condo: prop.condo, iptu: prop.iptu,
            notes: prop.notes || null, acceptsFinancing: prop.acceptsFinancing,
            acceptsFgts: prop.acceptsFgts, url: prop.url || null,
            dataNote: prop.dataNote || null, sourcePage: prop.sourcePage,
          },
        });
        created++;
      } catch (e) {
        errors.push(prop.code + ': ' + (e as Error).message);
      }
    }
    const totalProperties = await db.resaleProperty.count({ where: { enterpriseId: id } });
    return NextResponse.json({ extracted: properties.length, created, updated: 0, errors, pageCount, totalProperties, enterpriseName: enterprise.name });
  } catch (error) {
    console.error('Error processing resale PDF:', error);
    const message = error instanceof Error ? error.message : 'Erro ao processar o PDF';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE - Clear all resale properties for an enterprise
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'ADMIN') {
    return NextResponse.json({ error: 'Acesso restrito' }, { status: 403 });
  }
  try {
    const count = await db.resaleProperty.deleteMany({ where: { enterpriseId: id } });
    return NextResponse.json({ deleted: count.count });
  } catch (error) {
    console.error('Error deleting resale properties:', error);
    return NextResponse.json({ error: 'Erro ao remover imoveis' }, { status: 500 });
  }
}
