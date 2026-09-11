/**
 * compression.test.ts — contratos da Fase 7 (otimização Vercel):
 * compressão adaptativa de upload de imagem.
 *
 * §Fase 7 do prompt: "preserve tipos, orientação, transparência, ordem,
 * alt text e hero. Faça limite de pixels, uma estratégia de compressão
 * com orçamento de CPU e teste de legibilidade; não force 300 KB em
 * plantas/diagramas."
 *
 * Estratégia dos testes: sharp REAL com buffers gerados em memória —
 * prova semântica de verdade (orientação EXIF aplicada, alpha mantido,
 * dimensões preservadas, bytes resultantes) em vez de fakes. Ruído
 * gaussiano simula o pior caso de compressão (foto difícil).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  planImageCompression,
  compressForWeb,
  ImageTooLargeError,
  IMAGE_MAX_PIXELS,
  PHOTO_MAX_DIMENSION,
  DIAGRAM_MAX_DIMENSION,
} from '../../src/lib/image-compression.ts';

// ── Plano puro (foto × diagrama + orçamento) ───────────────────────

describe('planImageCompression — decisão foto × diagrama (puro)', () => {
  test('PNG → diagrama (planta/diagrama/logo); JPEG → foto', () => {
    const png = planImageCompression({ width: 2000, height: 1400, format: 'png' }, 1_000_000);
    assert.equal(png.mode, 'diagram');
    const jpeg = planImageCompression({ width: 3000, height: 2000, format: 'jpeg' }, 2_000_000);
    assert.equal(jpeg.mode, 'photo');
  });

  test('WebP/AVIF COM alpha → diagrama; SEM alpha → foto', () => {
    const webpAlpha = planImageCompression({ width: 800, height: 600, format: 'webp', hasAlpha: true }, 100_000);
    assert.equal(webpAlpha.mode, 'diagram');
    const webpOpaque = planImageCompression({ width: 800, height: 600, format: 'webp', hasAlpha: false }, 100_000);
    assert.equal(webpOpaque.mode, 'photo');
    const avifAlpha = planImageCompression({ width: 800, height: 600, format: 'avif', hasAlpha: true }, 100_000);
    assert.equal(avifAlpha.mode, 'diagram');
  });

  test('orçamento de CPU: ladder + fallback ≤ 4 encodes (foto) / ≤ 3 (diagrama)', () => {
    const photo = planImageCompression({ width: 3000, height: 2000, format: 'jpeg' }, 2_000_000);
    assert.equal(photo.qualityLadder.length + 1, 4);
    const diagram = planImageCompression({ width: 2000, height: 1400, format: 'png' }, 1_000_000);
    assert.equal(diagram.qualityLadder.length + 1, 3);
  });

  test('limite de pixels: > 24MP lança ImageTooLargeError ANTES de decodificar', () => {
    assert.throws(
      () => planImageCompression({ width: 7000, height: 7000, format: 'jpeg' }, 100_000),
      (err: unknown) => err instanceof ImageTooLargeError,
    );
    // Exatamente no limite NÃO lança.
    const ok = planImageCompression(
      { width: 6000, height: 4000, format: 'jpeg' }, 100_000,
    );
    assert.equal(ok.mode, 'photo');
    assert.ok(IMAGE_MAX_PIXELS === 24_000_000);
  });
});

// ── Compressão real (sharp) — FOTOS ────────────────────────────────

async function jpegNoise(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 30 } },
  }).jpeg({ quality: 98 }).toBuffer();
}

describe('compressForWeb — fotos', () => {
  test('foto grande (3000×2000) → WebP ≤ alvo, dimensão ≤ 1920, mode photo', async () => {
    const input = await jpegNoise(3000, 2000);
    const result = await compressForWeb(input);
    assert.equal(result.mode, 'photo');
    assert.equal(result.fromBytes, input.length);
    assert.ok(result.toBytes <= 300 * 1024, `esperado ≤300KB, veio ${result.toBytes}B`);
    const meta = await sharp(result.buffer).metadata();
    assert.ok((meta.width ?? 0) <= PHOTO_MAX_DIMENSION);
    assert.ok((meta.height ?? 0) <= PHOTO_MAX_DIMENSION);
    assert.equal(meta.format, 'webp');
    assert.equal(result.resized, true);
  });

  test('foto pequena e leve → 1 encode em q82, sem downscale', async () => {
    const flat = await sharp({
      create: { width: 400, height: 300, channels: 3, background: '#336699' },
    }).jpeg().toBuffer();
    const result = await compressForWeb(flat);
    assert.equal(result.mode, 'photo');
    assert.equal(result.quality, 82, 'primeiro nível do ladder basta');
    assert.equal(result.resized, false);
    const meta = await sharp(result.buffer).metadata();
    assert.equal(meta.width, 400);
    assert.equal(meta.height, 300);
  });

  test('foto impossível de comprimir (ruído) → fallback de downscale ÚNICO e retorna', async () => {
    // 2400×1600 ruído gaussiano: ladder inteiro não atinge 300KB →
    // fallback 0.8/q60 — resultado SEMPRE retorna (nunca trava/rejeita).
    const input = await jpegNoise(2400, 1600);
    const result = await compressForWeb(input);
    assert.equal(result.mode, 'photo');
    const meta = await sharp(result.buffer).metadata();
    assert.ok((meta.width ?? 0) <= PHOTO_MAX_DIMENSION);
    assert.ok(result.toBytes > 0);
  });

  test('orientação EXIF aplicada (rotate) — foto de celular "deitado" sai em pé', async () => {
    // Armazenada 300×200 com EXIF orientation 6 → exibida 200×300.
    const stored = await sharp({
      create: { width: 300, height: 200, channels: 3, background: '#ff8800' },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();

    const rawMeta = await sharp(stored).metadata();
    assert.equal(rawMeta.width, 300);
    assert.equal(rawMeta.height, 200);
    assert.equal(rawMeta.orientation, 6);

    const result = await compressForWeb(stored);
    const outMeta = await sharp(result.buffer).metadata();
    assert.equal(outMeta.width, 200, 'largura/altura trocadas = orientação aplicada');
    assert.equal(outMeta.height, 300);
    assert.notEqual(outMeta.orientation, 6, 'EXIF de orientação é resolvido no encode');
  });
});

// ── Compressão real (sharp) — DIAGRAMAS/PLANTAS ────────────────────

async function pngDiagram(width: number, height: number, alpha = false): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="${alpha ? 'rgba(20,40,80,0.85)' : 'white'}"/>
    <line x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}" stroke="black" stroke-width="3"/>
    <line x1="${width / 2}" y1="0" x2="${width / 2}" y2="${height}" stroke="black" stroke-width="3"/>
    <rect x="${width * 0.1}" y="${height * 0.1}" width="${width * 0.25}" height="${height * 0.25}" fill="none" stroke="black" stroke-width="5"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe('compressForWeb — plantas/diagramas (legibilidade > bytes)', () => {
  test('PNG (planta) → modo diagrama: dimensões PRESERVADAS, qualidade ≥ 82, NÃO forçado a 300KB', async () => {
    const input = await pngDiagram(2200, 1600);
    const result = await compressForWeb(input, { context: 'floor-plan' });
    assert.equal(result.mode, 'diagram');
    assert.equal(result.quality >= 82, true, `qualidade mínima alta, veio q${result.quality}`);
    assert.equal(result.resized, false, '2200×1600 ≤ 2400 → SEM downscale');
    const meta = await sharp(result.buffer).metadata();
    assert.equal(meta.width, 2200);
    assert.equal(meta.height, 1600);
    // A prova da spec: o resultado pode exceder 300KB — a legibilidade
    // manda; NÃO há loop de qualidade decrescente até caber.
  });

  test('diagrama maior que 2400px → única redução é o cap do maxDimension (fit inside)', async () => {
    const input = await pngDiagram(4000, 3000);
    const result = await compressForWeb(input, { context: 'floor-plan' });
    assert.equal(result.mode, 'diagram');
    const meta = await sharp(result.buffer).metadata();
    assert.equal(meta.width, DIAGRAM_MAX_DIMENSION);
    assert.ok((meta.height ?? 0) <= DIAGRAM_MAX_DIMENSION);
    assert.equal(result.quality >= 82, true);
  });

  test('transparência preservada (PNG com alpha → WebP com alpha)', async () => {
    const input = await pngDiagram(600, 400, true);
    const before = await sharp(input).stats();
    assert.equal(before.isOpaque, false, 'fixture precisa ter alpha');
    const result = await compressForWeb(input);
    assert.equal(result.mode, 'diagram');
    const after = await sharp(result.buffer).stats();
    assert.equal(after.isOpaque, false, 'alpha DEVE sobreviver ao WebP');
    const meta = await sharp(result.buffer).metadata();
    assert.equal(meta.hasAlpha, true);
  });

  test('logo PNG pequeno já dentro do alvo → 1 encode, sem perdas extras', async () => {
    const input = await pngDiagram(500, 350);
    const result = await compressForWeb(input);
    assert.equal(result.mode, 'diagram');
    assert.equal(result.quality, 88, 'primeiro nível do ladder');
    assert.equal(result.resized, false);
  });
});

// ── Limite de pixels com sharp real ────────────────────────────────

describe('compressForWeb — limite de pixels (decompression bomb)', () => {
  test('imagem 7000×7000 (49MP) → ImageTooLargeError sem decodificar bitmap', async () => {
    // Cria o ARQUIVO (header) — o limite deve disparar pela metadata,
    // antes de qualquer decodificação de 7000×7000 pixels.
    const input = await sharp({
      create: { width: 7000, height: 7000, channels: 3, background: '#123456' },
    }).jpeg({ quality: 10 }).toBuffer();
    await assert.rejects(
      compressForWeb(input),
      (err: unknown) => {
        assert.ok(err instanceof ImageTooLargeError);
        assert.equal((err as ImageTooLargeError).pixels, 49_000_000);
        assert.equal(ImageTooLargeError.MAX_PIXELS, 24_000_000);
        return true;
      },
    );
  });
});
