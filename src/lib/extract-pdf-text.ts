// Shared PDF text extraction using pdfjs-dist.
// Works in Vercel serverless — no canvas/native dependency.

import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Suppress worker warning — we use fake worker (inline)
GlobalWorkerOptions.workerSrc = '';

// NOTE: We do NOT set standardFontDataUrl here because:
// 1. require.resolve returns Turbopack numeric module IDs at build time, not real paths
// 2. Standard fonts are only needed for PDF rendering, not text extraction
// 3. In Vercel serverless, the node_modules layer may be read-only anyway

/**
 * Extract all text from a PDF buffer, page by page.
 * Returns the full text joined by newlines.
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
  const doc = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  const pageCount = doc.numPages;
  const pageTexts: string[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const line = tc.items
      .filter((item: any) => item.str !== undefined)
      .map((item: any) => item.str)
      .join(' ');
    pageTexts.push(line);
  }

  doc.destroy();
  return { text: pageTexts.join('\n').trim(), pageCount };
}
