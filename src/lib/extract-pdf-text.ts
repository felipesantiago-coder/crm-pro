// Shared PDF text extraction using pdf-parse v1.1.1 (bundles pdfjs-dist v2 internally).
// Zero native dependencies — works in Vercel serverless out of the box.
// We import lib/pdf-parse.js directly to skip the buggy index.js debug code
// (https://github.com/DefinitelyTyped/DefinitelyTyped/issues/58368).

export async function extractTextFromPdf(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
  // Import the internal lib directly — index.js has a bug where !module.parent
  // evaluates to true in bundled environments (Turbopack), triggering test code
  // that tries to read ./test/data/05-versions-space.pdf
  const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default || (await import('pdf-parse/lib/pdf-parse.js'));
  
  const data = await pdfParse(buffer);
  return {
    text: (data.text || '').trim(),
    pageCount: data.numpages || 0,
  };
}
