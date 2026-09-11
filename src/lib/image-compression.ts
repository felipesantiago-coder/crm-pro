/**
 * image-compression.ts — compressão adaptativa de upload de imagens
 * (Fase 7 da otimização Vercel — §Fase 7 do prompt).
 *
 * PROMPT: "No upload de imagem, preserve tipos, orientação, transparência,
 * ordem, alt text e hero. Faça limite de pixels, uma estratégia de
 * compressão com orçamento de CPU e teste de legibilidade; não force
 * 300 KB em plantas/diagramas."
 *
 * ANTES: as duas rotas de upload tinham pipelines duplicados que forçavam
 * TODO arquivo a ~300/400 KB — 6 tentativas de qualidade decrescente
 * (82→40) + redução de dimensão extra, sem limite de pixels (uma imagem
 * 20000×20000 — "decompression bomb" — era decodificada inteira, risco de
 * OOM/estouro do orçamento da function) e sem qualquer guarda para
 * plantas/diagramas (texto e linhas viravam borrão em q40).
 *
 * DEPOIS — 3 guardas da spec:
 *   1. LIMITE DE PIXELS: rejeita (413) ANTES de decodificar quando
 *      width×height > 24MP — a leitura de metadata só lê o header.
 *   2. ORÇAMENTO DE CPU: no máximo 4 encodes (foto) / 3 (diagrama) —
 *      contra até 7 do pipeline antigo.
 *   3. TESTE DE LEGIBILIDADE (decisão explícita): guardas determinísticos
 *      por MODO em vez de análise de pixels/OCR:
 *        - diagram (PNG, ou WebP/AVIF com alpha): dimensões originais
 *          preservadas (até 2400px — SEM downscale por target) e
 *          qualidade mínima ALTA (82) — se o resultado exceder o alvo de
 *          bytes, o arquivo MAIOR é aceito (legibilidade > bytes). Só o
 *          hard cap (2.5MB) dispara UMA redução de 15%.
 *        - photo (JPEG/WebP/AVIF sem alpha): alvo 300KB com ladder
 *          [82, 68, 50] + fallback de downscale 0.8/q60 — fotos toleram
 *          compressão forte sem perda percebida.
 *   Preservações (não é possível "não preservar"): orientação EXIF
 *   (.rotate() explícito — auto-orienta), transparência (WebP mantém
 *   alpha), tipo de saída WebP, ordem/alt text/hero (campos da rota,
 *   intocados).
 *
 * PUREZA: sem I/O além do sharp; planImageCompression é puro (testável
 * sem decodificação); compressForWeb usa sharp real nos testes
 * (buffers gerados em memória — prova semântica real de orientação,
 * alpha e dimensões).
 */
import sharp from 'sharp';

/** Limite de pixels — 24MP (ex.: 6000×4000). Acima disso → 413. */
export const IMAGE_MAX_PIXELS = 24_000_000;

/** Dimensão máxima por modo (lado maior). */
export const PHOTO_MAX_DIMENSION = 1920;
export const DIAGRAM_MAX_DIMENSION = 2400;

/** Alvos de bytes por modo/contexto. */
export const PHOTO_TARGET_BYTES = 300 * 1024;
export const DIAGRAM_TARGET_GALLERY_BYTES = 300 * 1024;
export const DIAGRAM_TARGET_FLOOR_PLAN_BYTES = 400 * 1024;
/** Hard cap do modo diagrama — UMA redução de 15% ao exceder. */
export const DIAGRAM_HARD_CAP_BYTES = 2.5 * 1024 * 1024;

/** Erro de limite de pixels — rotas mapeiam para 413. */
export class ImageTooLargeError extends Error {
  static readonly MAX_PIXELS = IMAGE_MAX_PIXELS;
  readonly code = 'image_too_many_pixels';
  /** NOTA: sem parameter property (node:test strip-only — padrão Fase 6). */
  readonly pixels: number;
  constructor(pixels: number) {
    super(`Imagem excede o limite de pixels (${pixels} > ${IMAGE_MAX_PIXELS})`);
    this.name = 'ImageTooLargeError';
    this.pixels = pixels;
  }
}

export type ImageMode = 'photo' | 'diagram';

export interface CompressionPlan {
  mode: ImageMode;
  /** Ladder de qualidade — 1 encode por nível, na ordem. */
  qualityLadder: number[];
  /** Dimensão máxima do lado maior (resize fit inside, sem ampliar). */
  maxDimension: number;
  /** Alvo de bytes do modo (diagrama pode EXCEDER — legibilidade). */
  targetBytes: number;
  /** Hard cap do diagrama (fotografia não tem — ladder cobre). */
  hardCapBytes: number | null;
  /** Escala do fallback único (null = sem fallback de downscale). */
  fallbackScale: number | null;
  fallbackQuality: number | null;
}

export interface CompressionResult {
  buffer: Buffer;
  mode: ImageMode;
  /** Qualidade do encode efetivamente aceito (diagnóstico/log). */
  quality: number;
  /** true = dimensões de saída < originais (downscale aconteceu). */
  resized: boolean;
  fromBytes: number;
  toBytes: number;
}

/** Metadados mínimos para o planejamento (leitura de HEADER — barato). */
interface CompressionMetadata {
  width?: number;
  height?: number;
  format?: string;
  hasAlpha?: boolean;
}

/**
 * PLANO puro — decisão foto × diagrama e orçamento de encodes.
 * Diagrama: PNG (formato canônico de planta/diagrama/logo) ou WebP/AVIF
 * com alpha. JPEG nunca é diagrama (câmera/foto). Entrada sem dimensões
 * conhecidas (formato exótico): trata como photo max dimension — o resize
 * real do sharp corrige qualquer desvio.
 */
export function planImageCompression(
  meta: CompressionMetadata,
  sourceBytes: number,
  opts: { context?: 'gallery' | 'floor-plan' } = {},
): CompressionPlan {
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const pixels = width * height;
  if (pixels > IMAGE_MAX_PIXELS) {
    throw new ImageTooLargeError(pixels);
  }

  const format = (meta.format || '').toLowerCase();
  const isDiagram =
    format === 'png' ||
    ((format === 'webp' || format === 'avif') && meta.hasAlpha === true);

  if (isDiagram) {
    return {
      mode: 'diagram',
      qualityLadder: [88, 82],
      maxDimension: DIAGRAM_MAX_DIMENSION,
      targetBytes:
        opts.context === 'floor-plan'
          ? DIAGRAM_TARGET_FLOOR_PLAN_BYTES
          : DIAGRAM_TARGET_GALLERY_BYTES,
      hardCapBytes: DIAGRAM_HARD_CAP_BYTES,
      fallbackScale: 0.85,
      fallbackQuality: 82,
    };
  }

  return {
    mode: 'photo',
    qualityLadder: [82, 68, 50],
    maxDimension: PHOTO_MAX_DIMENSION,
    targetBytes: PHOTO_TARGET_BYTES,
    hardCapBytes: null,
    fallbackScale: 0.8,
    fallbackQuality: 60,
  };
}

/**
 * Compressão WebP para a web, com plano adaptativo. Preserva orientação
 * (rotate() aplica EXIF) e transparência (WebP alpha). Retorna o MELHOR
 * resultado dentro do orçamento de encodes — diagramas podem exceder o
 * alvo de bytes de propósito.
 */
export async function compressForWeb(
  buffer: Buffer,
  opts: { context?: 'gallery' | 'floor-plan' } = {},
): Promise<CompressionResult> {
  const image = sharp(buffer);
  // Lê HEADER (barato) — suficiente para o limite de pixels ANTES de
  // decodificar o bitmap inteiro.
  const meta: CompressionMetadata = await image.metadata();
  const plan = planImageCompression(meta, buffer.length, opts);

  const baseWidth = meta.width ?? plan.maxDimension;
  const baseHeight = meta.height ?? plan.maxDimension;
  const needsResize = baseWidth > plan.maxDimension || baseHeight > plan.maxDimension;

  // Dimensões EFETIVAS do pipeline base (pós fit-inside para maxDimension)
  // — o fallback de downscale parte destas, nunca das originais.
  const baseRatio = needsResize
    ? Math.min(plan.maxDimension / baseWidth, plan.maxDimension / baseHeight)
    : 1;
  const effectiveWidth = Math.max(1, Math.round(baseWidth * baseRatio));
  const effectiveHeight = Math.max(1, Math.round(baseHeight * baseRatio));

  // Pipeline base: rotate() sem argumentos = auto-orientação por EXIF
  // (preserva orientação de fotos de celular); resize nunca amplia.
  const basePipeline = () => {
    let img = sharp(buffer).rotate();
    if (needsResize) {
      img = img.resize(plan.maxDimension, plan.maxDimension, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }
    return img;
  };

  const encode = async (quality: number, scale?: number): Promise<Buffer> => {
    if (scale && scale !== 1) {
      const w = Math.max(1, Math.round(effectiveWidth * scale));
      const h = Math.max(1, Math.round(effectiveHeight * scale));
      return sharp(buffer)
        .rotate()
        .resize(w, h, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality, effort: 4, smartSubsample: plan.mode === 'photo' })
        .toBuffer();
    }
    return basePipeline()
      .webp({ quality, effort: 4, smartSubsample: plan.mode === 'photo' })
      .toBuffer();
  };

  let lastBuffer: Buffer | null = null;
  let lastQuality = plan.qualityLadder[plan.qualityLadder.length - 1];

  for (const quality of plan.qualityLadder) {
    const out = await encode(quality);
    lastBuffer = out;
    lastQuality = quality;
    if (out.length <= plan.targetBytes) {
      return finalize(out, plan.mode, quality, baseWidth, baseHeight, buffer.length);
    }
  }

  // ── Pós-ladder ──
  // Diagrama: EXCEDE o alvo de propósito (legibilidade > bytes). Só o
  // hard cap dispara o fallback único (uma redução de 15% em q82).
  if (plan.mode === 'diagram') {
    if (plan.hardCapBytes && lastBuffer && lastBuffer.length > plan.hardCapBytes) {
      const out = await encode(plan.fallbackQuality!, plan.fallbackScale!);
      return finalize(out, plan.mode, plan.fallbackQuality!, baseWidth, baseHeight, buffer.length);
    }
    // Qualidade mínima ALTA preservada — sem redução adicional.
    return finalize(lastBuffer!, plan.mode, lastQuality, baseWidth, baseHeight, buffer.length);
  }

  // Foto: fallback único de downscale (comportamento do pipeline antigo,
  // agora com orçamento limitado — 4 encodes no pior caso).
  const out = await encode(plan.fallbackQuality!, plan.fallbackScale!);
  return finalize(out, plan.mode, plan.fallbackQuality!, baseWidth, baseHeight, buffer.length);
}

/** Métricas de saída (dims reais pós rotação/resize — header barato). */
async function finalize(
  buffer: Buffer,
  mode: ImageMode,
  quality: number,
  baseWidth: number,
  baseHeight: number,
  fromBytes: number,
): Promise<CompressionResult> {
  let resized = false;
  try {
    const outMeta = await sharp(buffer).metadata();
    const outW = outMeta.width ?? baseWidth;
    const outH = outMeta.height ?? baseHeight;
    resized = outW < baseWidth || outH < baseHeight;
  } catch {
    // Sem dims de saída — não bloqueia o upload por isso.
  }
  return { buffer, mode, quality, resized, fromBytes, toBytes: buffer.length };
}
