// Shared PDF text extraction using pdfjs-dist.
// Works in Vercel serverless — no canvas/native dependency.
// Uses dynamic import to avoid module-evaluation crashes in serverless.

/**
 * Extract all text from a PDF buffer, page by page.
 * Returns the full text joined by newlines.
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
  console.log('[extract-pdf-text] Starting extraction, buffer size:', buffer.length);

  // Dynamic import to avoid module-evaluation crashes in Turbopack/Vercel
  let getDocument: any;
  let GlobalWorkerOptions: any;
  try {
    const pdfjsModule = await import('pdfjs-dist/legacy/build/pdf.mjs');
    getDocument = pdfjsModule.getDocument;
    GlobalWorkerOptions = pdfjsModule.GlobalWorkerOptions;
    console.log('[extract-pdf-text] pdfjs-dist loaded successfully');
  } catch (importErr) {
    console.error('[extract-pdf-text] Failed to import pdfjs-dist:', importErr);
    throw new Error('Falha ao carregar biblioteca de PDF. Detalhes: ' + (importErr instanceof Error ? importErr.message : String(importErr)));
  }

  // Disable worker — run on main thread (required for serverless)
  GlobalWorkerOptions.workerSrc = '';

  let doc: any;
  try {
    console.log('[extract-pdf-text] Calling getDocument...');
    const loadingTask = getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      disableAutoFetch: true,
      isEvalSupported: false,
    });
    doc = await loadingTask.promise;
    console.log('[extract-pdf-text] Document loaded, pages:', doc.numPages);
  } catch (docErr) {
    console.error('[extract-pdf-text] getDocument failed:', docErr);
    throw new Error('Falha ao abrir o PDF. O arquivo pode estar corrompido. Detalhes: ' + (docErr instanceof Error ? docErr.message : String(docErr)));
  }

  const pageCount = doc.numPages;
  const pageTexts: string[] = [];

  for (let i = 1; i <= pageCount; i++) {
    try {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const line = tc.items
        .filter((item: any) => 'str' in item && item.str !== undefined)
        .map((item: any) => item.str)
        .join(' ');
      pageTexts.push(line);
    } catch (pageErr) {
      console.error(`[extract-pdf-text] Error extracting page ${i}:`, pageErr);
      pageTexts.push(''); // Continue with other pages
    }
  }

  doc.destroy();
  const text = pageTexts.join('\n').trim();
  console.log('[extract-pdf-text] Extraction complete. Text length:', text.length, 'pages:', pageCount);
  return { text, pageCount };
}
