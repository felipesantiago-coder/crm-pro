import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { supabaseServer } from '@/lib/supabase-server';
import sharp from 'sharp';

const MAX_IMAGES = 15;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB raw (will be compressed)
const COMPRESS_TARGET_KB = 300;
const COMPRESS_TARGET_BYTES = COMPRESS_TARGET_KB * 1024;
const MAX_DIMENSION = 1920;
const ALLOWED_TYPES = new Set([
  'image/webp',
  'image/jpeg',
  'image/png',
  'image/avif',
  'image/heic',
  'image/heif',
]);

/**
 * Compress an image buffer to target ~300KB using sharp.
 * Converts to WebP for best compression ratio.
 * Returns the compressed buffer.
 */
async function compressImage(buffer: Buffer): Promise<Buffer> {
  const image = sharp(buffer);

  // Get metadata
  const metadata = await image.metadata();

  // Calculate output dimensions (max 1920px on longest side)
  let width = metadata.width || MAX_DIMENSION;
  let height = metadata.height || MAX_DIMENSION;

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  // If image is already small and under target, just convert to WebP
  if (buffer.length <= COMPRESS_TARGET_BYTES) {
    return image
      .resize(width, height, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 })
      .toBuffer();
  }

  // Try quality levels from high to low until under target
  const qualityLevels = [82, 75, 68, 60, 50, 40];
  for (const quality of qualityLevels) {
    const compressed = await image
      .resize(width, height, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality, effort: 4 })
      .toBuffer();

    if (compressed.length <= COMPRESS_TARGET_BYTES) {
      return compressed;
    }

    // If even lowest quality is too large, reduce dimensions further
    if (quality === qualityLevels[qualityLevels.length - 1]) {
      const reducedWidth = Math.round(width * 0.8);
      const reducedHeight = Math.round(height * 0.8);
      return image
        .resize(reducedWidth, reducedHeight, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 50, effort: 4 })
        .toBuffer();
    }
  }

  // Fallback (should not reach here)
  return image
    .resize(width, height, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 50, effort: 4 })
    .toBuffer();
}

/**
 * GET /api/enterprises/[id]/images
 * List all images for an enterprise.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const { id } = await params;

    const images = await db.enterpriseImage.findMany({
      where: { enterpriseId: id },
      orderBy: { sortOrder: 'asc' },
    });

    return NextResponse.json(images);
  } catch (error) {
    console.error('[Images GET] Erro:', error);
    return NextResponse.json({ error: 'Erro ao buscar imagens.' }, { status: 500 });
  }
}

/**
 * POST /api/enterprises/[id]/images
 * Upload a new image (max 15 per enterprise).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const { id } = await params;

    // Check current count
    const count = await db.enterpriseImage.count({ where: { enterpriseId: id } });
    if (count >= MAX_IMAGES) {
      return NextResponse.json(
        { error: `Máximo de ${MAX_IMAGES} imagens por empreendimento.` },
        { status: 400 },
      );
    }

    // Verify enterprise exists
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

    // Get next sort order
    const maxOrder = await db.enterpriseImage.aggregate({
      where: { enterpriseId: id },
      _max: { sortOrder: true },
    });
    const nextOrder = (maxOrder._max.sortOrder ?? -1) + 1;

    // Compress image to ~300KB WebP
    const rawBuffer = Buffer.from(await file.arrayBuffer());
    const originalSizeKB = Math.round(rawBuffer.length / 1024);
    const compressedBuffer = await compressImage(rawBuffer);
    const compressedSizeKB = Math.round(compressedBuffer.length / 1024);
    console.log(
      `[Images POST] Compressão: ${originalSizeKB}KB → ${compressedSizeKB}KB`,
    );

    // Upload compressed buffer to Supabase Storage
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).slice(2, 8);
    const storagePath = `enterprises/${enterprise.id}/${timestamp}-${randomSuffix}.webp`;

    const { error: uploadError } = await supabaseServer.storage
      .from('enterprise-images')
      .upload(storagePath, compressedBuffer, {
        contentType: 'image/webp',
        upsert: false,
      });

    if (uploadError) {
      console.error('[Images POST] Upload error:', uploadError);
      return NextResponse.json({ error: 'Erro ao fazer upload da imagem.' }, { status: 500 });
    }

    // Get public URL
    const { data: urlData } = supabaseServer.storage
      .from('enterprise-images')
      .getPublicUrl(storagePath);

    const publicUrl = urlData.publicUrl;

    // Save to database
    const image = await db.enterpriseImage.create({
      data: {
        enterpriseId: id,
        url: publicUrl,
        altText: altText?.trim() || null,
        sortOrder: nextOrder,
      },
    });

    // If this is the first image, set as enterprise imageUrl (hero)
    if (count === 0) {
      await db.enterprise.update({
        where: { id },
        data: { imageUrl: publicUrl },
      });
    }

    return NextResponse.json(image, { status: 201 });
  } catch (error) {
    console.error('[Images POST] Erro:', error);
    return NextResponse.json({ error: 'Erro ao enviar imagem.' }, { status: 500 });
  }
}

/**
 * PUT /api/enterprises/[id]/images
 * Reorder images or update altText.
 * Body: { orders: [{ id: string, sortOrder: number }] } or { imageId: string, altText: string }
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

    // Reorder batch
    if (body.orders && Array.isArray(body.orders)) {
      await Promise.all(
        body.orders.map((item: { id: string; sortOrder: number }) =>
          db.enterpriseImage.update({
            where: { id: item.id, enterpriseId: id },
            data: { sortOrder: item.sortOrder },
          }),
        ),
      );
      return NextResponse.json({ success: true });
    }

    // Update single image altText
    if (body.imageId && body.altText !== undefined) {
      const updated = await db.enterpriseImage.update({
        where: { id: body.imageId, enterpriseId: id },
        data: { altText: body.altText || null },
      });
      return NextResponse.json(updated);
    }

    // Set as hero (enterprise imageUrl)
    if (body.setAsHero && body.imageId) {
      const image = await db.enterpriseImage.findUnique({
        where: { id: body.imageId, enterpriseId: id },
      });
      if (!image) {
        return NextResponse.json({ error: 'Imagem não encontrada.' }, { status: 404 });
      }
      await db.enterprise.update({
        where: { id },
        data: { imageUrl: image.url },
      });
      return NextResponse.json({ success: true, imageUrl: image.url });
    }

    return NextResponse.json({ error: 'Operação inválida.' }, { status: 400 });
  } catch (error) {
    console.error('[Images PUT] Erro:', error);
    return NextResponse.json({ error: 'Erro ao atualizar imagens.' }, { status: 500 });
  }
}

/**
 * DELETE /api/enterprises/[id]/images?imageId=xxx
 * Delete a specific image from an enterprise.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const { id } = await params;
    const imageId = request.nextUrl.searchParams.get('imageId');

    if (!imageId) {
      return NextResponse.json({ error: 'imageId é obrigatório.' }, { status: 400 });
    }

    const image = await db.enterpriseImage.findUnique({
      where: { id: imageId, enterpriseId: id },
    });

    if (!image) {
      return NextResponse.json({ error: 'Imagem não encontrada.' }, { status: 404 });
    }

    // Delete from Supabase Storage (extract path from URL)
    try {
      const url = new URL(image.url);
      const storagePath = url.pathname.split('/enterprise-images/')[1];
      if (storagePath) {
        await supabaseServer.storage.from('enterprise-images').remove([storagePath]);
      }
    } catch {
      // URL parse failed — skip storage deletion, still delete DB record
    }

    // Delete from database
    await db.enterpriseImage.delete({ where: { id: imageId } });

    // If the deleted image was the hero, update enterprise imageUrl
    const enterprise = await db.enterprise.findUnique({
      where: { id },
      select: { imageUrl: true },
    });
    if (enterprise?.imageUrl === image.url) {
      const nextImage = await db.enterpriseImage.findFirst({
        where: { enterpriseId: id },
        orderBy: { sortOrder: 'asc' },
      });
      await db.enterprise.update({
        where: { id },
        data: { imageUrl: nextImage?.url || null },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Images DELETE] Erro:', error);
    return NextResponse.json({ error: 'Erro ao excluir imagem.' }, { status: 500 });
  }
}