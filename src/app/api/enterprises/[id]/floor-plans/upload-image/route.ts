import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { supabaseServer } from '@/lib/supabase-server';
import { invalidatePublicSnapshotsForEnterprise } from '@/lib/public-snapshot';
import { compressForWeb, ImageTooLargeError } from '@/lib/image-compression';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB raw
const ALLOWED_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png', 'image/avif']);

/**
 * POST /api/enterprises/[id]/floor-plans/upload-image
 * Upload an image for a specific floor plan.
 * FormData: { file: File, planId: string }
 *
 * Fase 7 (§Fase 7 do prompt): plantas/diagramas passam pelo modo DIAGRAM
 * da compressão adaptativa — preserva nitidez de texto/linhas:
 *   - SEM redução de dimensões (até 2400px) e qualidade mínima alta (82);
 *   - NÃO força o target de bytes: se o arquivo comprimido exceder o
 *     alvo, é ACEITO com qualidade alta (legibilidade > bytes) — o
 *     hard cap só dispara uma redução única de 15%;
 *   - limite de pixels (413 antes de decodificar), orientação EXIF e
 *     transparência preservados, orçamento de CPU (≤3 encodes).
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
      return NextResponse.json({ error: 'Tipo inválido. Use WebP, JPEG, PNG ou AVIF.' }, { status: 400 });
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

    // Fase 7 — compressão adaptativa (src/lib/image-compression.ts).
    let compressedBuffer: Buffer;
    try {
      const rawBuffer = Buffer.from(await file.arrayBuffer());
      const result = await compressForWeb(rawBuffer, { context: 'floor-plan' });
      compressedBuffer = result.buffer;
      console.log(
        `[FloorPlan Image] Compressão (${result.mode}): ${Math.round(result.fromBytes / 1024)}KB → ${Math.round(result.toBytes / 1024)}KB · q${result.quality} · resized=${result.resized}`,
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

    // Fase 7: imagem da planta é payload público.
    await invalidatePublicSnapshotsForEnterprise(db, enterpriseId);

    return NextResponse.json(updated);
  } catch (error) {
    console.error('[FloorPlan Image POST] Erro:', error);
    return NextResponse.json({ error: 'Erro ao enviar imagem da planta.' }, { status: 500 });
  }
}
