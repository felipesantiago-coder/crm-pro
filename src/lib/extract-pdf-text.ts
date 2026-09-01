// Shared PDF text extraction using pdf-parse v1 (bundles pdfjs-dist internally).
// Zero native dependencies — works in Vercel serverless out of the box.

export async function extractTextFromPdf(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
  // Dynamic import to avoid any module-evaluation issues in Turbopack
  const pdfParse = (await import('pdf-parse')).default || (await import('pdf-parse'));
  
  const data = await pdfParse(buffer);
  return {
    text: (data.text || '').trim(),
    pageCount: data.numpages || 0,
  };
}
