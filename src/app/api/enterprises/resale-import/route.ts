import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { db } from '@/lib/db';
import { authOptions } from '@/lib/auth-options';

/**
 * POST /api/enterprises/resale-import
 * One-shot: upload a PDF → auto-create REVENDA enterprise from filename → import all properties.
 * No enterprise name/region needed — everything comes from the PDF.
 */
export async function POST(req: NextRequest) {
  try {
    console.log('[resale-import] Handler started');

    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as { role?: string }).role !== 'ADMIN') {
      return NextResponse.json({ error: 'Acesso restrito' }, { status: 403 });
    }
    console.log('[resale-import] Auth passed');

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 });
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Apenas arquivos PDF sao aceitos' }, { status: 400 });
    }
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'Arquivo muito grande. Maximo 20MB.' }, { status: 400 });
    }
    console.log('[resale-import] File received:', file.name, 'size:', file.size);

    // 1. Extract enterprise name from filename (remove .pdf extension)
    const enterpriseName = file.name.replace(/\.pdf$/i, '').trim();

    // 2. Check if an enterprise with this name already exists (any type)
    const existing = await db.enterprise.findFirst({
      where: { name: enterpriseName },
      select: { id: true, name: true, type: true },
    });

    let enterpriseId: string;
    let isNew = false;

    if (existing) {
      enterpriseId = existing.id;
      if (existing.type !== 'REVENDA') {
        await db.enterprise.update({ where: { id: existing.id }, data: { type: 'REVENDA' } });
      }
    } else {
      const created = await db.enterprise.create({
        data: {
          name: enterpriseName,
          type: 'REVENDA',
          region: null,
        },
      });
      enterpriseId = created.id;
      isNew = true;
    }
    console.log('[resale-import] Enterprise resolved:', enterpriseId, 'name:', enterpriseName, 'isNew:', isNew);

    // 3. Extract properties from PDF (dynamic import to isolate failures)
    const buffer = Buffer.from(await file.arrayBuffer());
    console.log('[resale-import] Buffer created, size:', buffer.length);

    let properties: any[];
    let pageCount = 0;
    try {
      const { extractPropertiesFromPdf } = await import('@/lib/parse-resale-pdf');
      console.log('[resale-import] parse-resale-pdf module loaded');
      const result = await extractPropertiesFromPdf(buffer);
      properties = result.properties;
      pageCount = result.pageCount;
      const textPreview = result.textPreview || '';
      console.log('[resale-import] Extracted', properties.length, 'properties from', pageCount, 'pages');
      console.log('[resale-import] Text preview:', textPreview.slice(0, 1000));
    } catch (extractErr) {
      console.error('[resale-import] PDF extraction failed:', extractErr);
      const msg = extractErr instanceof Error ? extractErr.message : String(extractErr);
      return NextResponse.json({ error: 'Erro ao processar o PDF: ' + msg }, { status: 500 });
    }

    // 4. Upsert all properties
    let upserted = 0;
    const errors: string[] = [];
    for (const prop of properties) {
      try {
        await db.resaleProperty.upsert({
          where: { enterpriseId_code: { enterpriseId, code: prop.code } },
          create: {
            enterpriseId, code: prop.code, sortOrder: prop.sortOrder,
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
        upserted++;
      } catch (e) {
        errors.push(prop.code + ': ' + (e as Error).message);
      }
    }

    const totalProperties = await db.resaleProperty.count({ where: { enterpriseId } });

    // 5. Extract regions from the imported properties for the enterprise region field
    const regions = [...new Set(properties.map((p: any) => p.region).filter(Boolean))];
    if (regions.length > 0) {
      await db.enterprise.update({
        where: { id: enterpriseId },
        data: { region: regions.length === 1 ? regions[0] : `${regions.length} regioes` },
      });
    }

    console.log('[resale-import] Done. upserted:', upserted, 'errors:', errors.length);

    return NextResponse.json({
      extracted: properties.length,
      created: upserted,
      updated: 0,
      errors,
      pageCount,
      totalProperties,
      enterpriseId,
      enterpriseName,
      isNew,
      textPreview,
    });
  } catch (error) {
    console.error('[resale-import] UNHANDLED:', error);
    const message = error instanceof Error ? error.message : 'Erro ao processar o PDF';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
