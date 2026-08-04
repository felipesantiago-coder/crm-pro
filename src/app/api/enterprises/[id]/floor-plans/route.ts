import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { supabaseServer } from '@/lib/supabase-server';
import sharp from 'sharp';

const MAX_PLANS = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const COMPRESS_TARGET_BYTES = 400 * 1024; // 400KB for floor plans (need more detail)
const MAX_DIMENSION = 2048;
const ALLOWED_TYPES = new Set([
  'image/webp',
  'image/jpeg',
  'image/png',
  'image/avif',
  'image/heic',
  'image/heif',
]);

async function compressImage(buffer: Buffer): Promise<Buffer> {
  const image = sharp(buffer);
  const metadata = await image.metadata();

  let width = metadata.width || MAX_DIMENSION;
  let height = metadata.height || MAX_DIMENSION;

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  if (buffer.length <= COMPRESS_TARGET_BYTES) {
    return image
      .resize(width, height, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85, effort: 4 })
      .toBuffer();
  }

  const qualityLevels = [85, 78, 70, 60, 50];
  for (const quality of qualityLevels) {
    const compressed = await image
      .resize(width, height, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality, effort: 4 })
      .toBuffer();

    if (compressed.length <= COMPRESS_TARGET_BYTES) return compressed;

    if (quality === qualityLevels[qualityLevels.length - 1]) {
      return image
        .resize(Math.round(width * 0.8), Math.round(height * 0.8), { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 50, effort: 4 })
        .toBuffer();
    }
  }

  return image
    .resize(width, height, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 50, effort: 4 })
    .toBuffer();
}

/**
 * GET — list floor plans
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const { id } = await params;
    const plans = await db.enterpriseFloorPlan.findMany({
      where: { enterpriseId: id },
      orderBy: { sortOrder: 'asc' },
    });
    return NextResponse.json(plans);
  } catch (error) {
    console.error('[FloorPlans GET] Erro:', error);
    return NextResponse.json({ error: 'Erro ao buscar plantas.' }, { status: 500 });
  }
}

/**
 * POST — upload a new floor plan
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const { id } = await params;

    const count = await db.enterpriseFloorPlan.count({ where: { enterpriseId: id } });
    if (count >= MAX_PLANS) {
      return NextResponse.json(
        { error: `Máximo de ${MAX_PLANS} plantas por empreendimento.` },
        { status: 400 },
      );
    }

    const enterprise = await db.enterprise.findUnique({ where: { id }, select: { id: true } });
    if (!enterprise) {
      return NextResponse.json({ error: 'Empreendimento não encontrado.' }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const altText = formData.get('altText') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'Nenhum arquivo enviado.' }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: 'Tipo de arquivo inválido. Use WebP, JPEG, PNG, AVIF ou HEIC.' },
        { status: 400 },
      );
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'Arquivo muito grande. Máximo 10MB.' }, { status: 400 });
    }

    const maxOrder = await db.enterpriseFloorPlan.aggregate({
      where: { enterpriseId: id },
      _max: { sortOrder: true },
    });
    const nextOrder = (maxOrder._max.sortOrder ?? -1) + 1;

    const rawBuffer = Buffer.from(await file.arrayBuffer());
    const compressedBuffer = await compressImage(rawBuffer);

    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).slice(2, 8);
    const storagePath = `floor-plans/${enterprise.id}/${timestamp}-${randomSuffix}.webp`;

    const { error: uploadError } = await supabaseServer.storage
      .from('enterprise-images')
      .upload(storagePath, compressedBuffer, {
        contentType: 'image/webp',
        upsert: false,
      });

    if (uploadError) {
      console.error('[FloorPlans POST] Upload error:', uploadError);
      return NextResponse.json({ error: 'Erro ao fazer upload da planta.' }, { status: 500 });
    }

    const { data: urlData } = supabaseServer.storage
      .from('enterprise-images')
      .getPublicUrl(storagePath);

    const plan = await db.enterpriseFloorPlan.create({
      data: {
        enterpriseId: id,
        url: urlData.publicUrl,
        altText: altText?.trim() || null,
        sortOrder: nextOrder,
      },
    });

    return NextResponse.json(plan, { status: 201 });
  } catch (error) {
    console.error('[FloorPlans POST] Erro:', error);
    return NextResponse.json({ error: 'Erro ao enviar planta.' }, { status: 500 });
  }
}

/**
 * PUT — reorder floor plans
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const { id } = await params;
    const body = await request.json();

    if (body.orders && Array.isArray(body.orders)) {
      await Promise.all(
        body.orders.map((item: { id: string; sortOrder: number }) =>
          db.enterpriseFloorPlan.update({
            where: { id: item.id, enterpriseId: id },
            data: { sortOrder: item.sortOrder },
          }),
        ),
      );
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Operação inválida.' }, { status: 400 });
  } catch (error) {
    console.error('[FloorPlans PUT] Erro:', error);
    return NextResponse.json({ error: 'Erro ao atualizar plantas.' }, { status: 500 });
  }
}

/**
 * PATCH — update a single floor plan (e.g. altText / caption)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const { id } = await params;
    const body = await request.json();
    const { planId, altText } = body;

    if (!planId) {
      return NextResponse.json({ error: 'planId é obrigatório.' }, { status: 400 });
    }

    const plan = await db.enterpriseFloorPlan.findUnique({
      where: { id: planId, enterpriseId: id },
    });
    if (!plan) {
      return NextResponse.json({ error: 'Planta não encontrada.' }, { status: 404 });
    }

    const updated = await db.enterpriseFloorPlan.update({
      where: { id: planId },
      data: { altText: typeof altText === 'string' ? altText.trim() || null : undefined },
    });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('[FloorPlans PATCH] Erro:', error);
    return NextResponse.json({ error: 'Erro ao atualizar planta.' }, { status: 500 });
  }
}

/**
 * DELETE — remove a floor plan
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const { id } = await params;
    const planId = request.nextUrl.searchParams.get('planId');

    if (!planId) {
      return NextResponse.json({ error: 'planId é obrigatório.' }, { status: 400 });
    }

    const plan = await db.enterpriseFloorPlan.findUnique({
      where: { id: planId, enterpriseId: id },
    });

    if (!plan) {
      return NextResponse.json({ error: 'Planta não encontrada.' }, { status: 404 });
    }

    // Delete from Supabase Storage
    try {
      const url = new URL(plan.url);
      const storagePath = url.pathname.split('/enterprise-images/')[1];
      if (storagePath) {
        await supabaseServer.storage.from('enterprise-images').remove([storagePath]);
      }
    } catch {
      // URL parse failed — skip storage deletion
    }

    await db.enterpriseFloorPlan.delete({ where: { id: planId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[FloorPlans DELETE] Erro:', error);
    return NextResponse.json({ error: 'Erro ao excluir planta.' }, { status: 500 });
  }
}
