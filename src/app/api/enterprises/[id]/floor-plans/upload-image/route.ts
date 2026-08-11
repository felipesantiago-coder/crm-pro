import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { supabaseServer } from '@/lib/supabase-server';
import sharp from 'sharp';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB raw
const COMPRESS_TARGET_BYTES = 400 * 1024; // 400KB (floor plans need more detail)
const MAX_DIMENSION = 2400; // Floor plans can be larger for detail
const ALLOWED_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png', 'image/avif']);

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

  const qualityLevels = [88, 82, 75, 68, 60, 50];
  for (const quality of qualityLevels) {
    const compressed = await image
      .resize(width, height, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality, effort: 4 })
      .toBuffer();

    if (compressed.length <= COMPRESS_TARGET_BYTES) return compressed;

    if (quality === qualityLevels[qualityLevels.length - 1]) {
      return image
        .resize(Math.round(width * 0.8), Math.round(height * 0.8), { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 55, effort: 4 })
        .toBuffer();
    }
  }

  return image
    .resize(width, height, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 55, effort: 4 })
    .toBuffer();
}

/**
 * POST /api/enterprises/[id]/floor-plans/upload-image
 * Upload an image for a specific floor plan.
 * FormData: { file: File, planId: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const { id: enterpriseId } = await params;
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const planId = formData.get('planId') as string | null;

    if (!planId) {
      return NextResponse.json({ error: 'planId é obrigatório.' }, { status: 400 });
    }
    if (!file) {
      return NextResponse.json({ error: 'Nenhum arquivo enviado.' }, { status: 400 });
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: 'Tipo inválido. Use WebP, JPEG, PNG ou AVIF.' },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'Arquivo muito grande. Máximo 10MB.' }, { status: 400 });
    }

    // Verify plan belongs to this enterprise
    const plan = await db.enterpriseFloorPlan.findUnique({
      where: { id: planId, enterpriseId },
    });
    if (!plan) {
      return NextResponse.json({ error: 'Planta não encontrada.' }, { status: 404 });
    }

    // Delete old image from storage if exists
    if (plan.url) {
      try {
        const url = new URL(plan.url);
        const oldPath = url.pathname.split('/enterprise-images/')[1];
        if (oldPath) {
          await supabaseServer.storage.from('enterprise-images').remove([oldPath]);
        }
      } catch { /* skip */ }
    }

    // Compress
    const rawBuffer = Buffer.from(await file.arrayBuffer());
    const compressedBuffer = await compressImage(rawBuffer);
    console.log(
      `[FloorPlan Image] Compressão: ${Math.round(rawBuffer.length / 1024)}KB → ${Math.round(compressedBuffer.length / 1024)}KB`,
    );

    // Upload to Supabase Storage
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).slice(2, 8);
    const storagePath = `enterprises/${enterpriseId}/floor-plans/${timestamp}-${randomSuffix}.webp`;

    const { error: uploadError } = await supabaseServer.storage
      .from('enterprise-images')
      .upload(storagePath, compressedBuffer, {
        contentType: 'image/webp',
        upsert: false,
      });

    if (uploadError) {
      console.error('[FloorPlan Image] Upload error:', uploadError);
      return NextResponse.json({ error: 'Erro ao fazer upload da imagem.' }, { status: 500 });
    }

    const { data: urlData } = supabaseServer.storage
      .from('enterprise-images')
      .getPublicUrl(storagePath);

    // Update plan URL in database
    const updated = await db.enterpriseFloorPlan.update({
      where: { id: planId },
      data: { url: urlData.publicUrl },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('[FloorPlan Image POST] Erro:', error);
    return NextResponse.json({ error: 'Erro ao enviar imagem da planta.' }, { status: 500 });
  }
}
