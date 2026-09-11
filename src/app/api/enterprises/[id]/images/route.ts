import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { supabaseServer } from '@/lib/supabase-server';
import { invalidatePublicSnapshotsForEnterprise } from '@/lib/public-snapshot';
import { compressForWeb, ImageTooLargeError } from '@/lib/image-compression';

const MAX_IMAGES = 15;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB raw (will be compressed)
const ALLOWED_TYPES = new Set([
  'image/webp',
  'image/jpeg',
  'image/png',
  'image/avif',
]);

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
        { error: 'Tipo de arquivo inválido. Use WebP, JPEG, PNG ou AVIF.' },
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

    // Fase 7 — compressão adaptativa (src/lib/image-compression.ts):
    // limite de pixels (413 ANTES de decodificar), modo foto × diagrama
    // (PNG/alpha NÃO é forçado a 300KB — legibilidade > bytes), orçamento
    // de CPU (≤4 encodes vs 7 antes), orientação EXIF e alpha preservados.
    let compressedBuffer: Buffer;
    let compressionMode: string;
    let compressionBytes = 0;
    try {
      const rawBuffer = Buffer.from(await file.arrayBuffer());
      const result = await compressForWeb(rawBuffer);
      compressedBuffer = result.buffer;
      compressionMode = result.mode;
      compressionBytes = result.toBytes;
      const originalSizeKB = Math.round(result.fromBytes / 1024);
      const compressedSizeKB = Math.round(result.toBytes / 1024);
      console.log(
        `[Images POST] Compressão (${result.mode}): ${originalSizeKB}KB → ${compressedSizeKB}KB · q${result.quality} · resized=${result.resized}`,
      );
    } catch (err) {
      if (err instanceof ImageTooLargeError) {
        return NextResponse.json(
          { error: `Imagem muito grande em pixels (${err.pixels.toLocaleString('pt-BR')}). Máximo ${Math.round(ImageTooLargeError.MAX_PIXELS / 1_000_000)}MP.` },
          { status: 413 },
        );
      }
      throw err;
    }

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

    // Fase 7: galeria/hero mudaram → snapshot público invalidado
    // (tabela filha não recarrega updatedAt do enterprise).
    await invalidatePublicSnapshotsForEnterprise(db, id);

    return NextResponse.json(
      { ...image, compression: { mode: compressionMode, bytes: compressionBytes } },
      { status: 201 },
    );
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
      // Fase 7: ordem da galeria é payload público.
      await invalidatePublicSnapshotsForEnterprise(db, id);
      return NextResponse.json({ success: true });
    }

    // Update single image altText
    if (body.imageId && body.altText !== undefined) {
      const updated = await db.enterpriseImage.update({
        where: { id: body.imageId, enterpriseId: id },
        data: { altText: body.altText || null },
      });
      // Fase 7: altText é payload público (acessibilidade).
      await invalidatePublicSnapshotsForEnterprise(db, id);
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
      // Fase 7: hero mudou via enterprise.update (updatedAt diverge a
      // digital) — invalidação explícita acelera a convergência (o
      // recompute do hit seguinte seria de qualquer forma necessário;
      // aqui nem a leitura da digital antiga acontece).
      await invalidatePublicSnapshotsForEnterprise(db, id);
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

    // Fase 7: imagem removida do payload público.
    await invalidatePublicSnapshotsForEnterprise(db, id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Images DELETE] Erro:', error);
    return NextResponse.json({ error: 'Erro ao excluir imagem.' }, { status: 500 });
  }
}