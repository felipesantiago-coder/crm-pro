// Shared PDF text extraction using pdfjs-dist.
// Works in Vercel serverless — no canvas/native dependency.

import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'path';
import fs from 'fs';

// Suppress worker warning — we use fake worker (inline)
GlobalWorkerOptions.workerSrc = '';

// Set standard font data path so pdfjs-dist can load fonts in serverless
const stdFontPath = path.resolve(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts');
if (fs.existsSync(stdFontPath)) {
  GlobalWorkerOptions.standardFontDataUrl = `file://${stdFontPath}/`;
}

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
