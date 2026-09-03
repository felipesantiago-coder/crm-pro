// Shared PDF text extraction using pdf-parse v1.1.1 (bundles pdfjs-dist v2 internally).
// Zero native dependencies — works in Vercel serverless out of the box.
// We import lib/pdf-parse.js directly to skip the buggy index.js debug code
// (https://github.com/DefinitelyTyped/DefinitelyTyped/issues/58368).
//
// Fase 3 (prompt v1.0 §10.3): o texto extraído preserva os limites de página
// com marcadores `[--- Página N ---]`, permitindo que a extração revisável
// atribua evidências por página. Documentos legados (sem marcadores) seguem
// funcionando — as evidências recebem page=null.


interface PdfExtractResult {
  text: string;
  pageCount: number;
}

const PAGE_MARKER_PREFIX = '[--- Página ';

export async function extractTextFromPdf(buffer: Buffer): Promise<PdfExtractResult> {
  const mod = await import('pdf-parse/lib/pdf-parse.js');
  const pdfParse = (mod as any).default || mod;

  // Renderizador por página — replica o default do pdf-parse acumulando
  // cada página em um array para inserir marcadores de página.
  const pageTexts: string[] = [];
  const renderPage = async (pageData: any): Promise<string> => {
    const textContent = await pageData.getTextContent({
      normalizeWhitespace: false,
      disableCombineTextItems: false,
    });
    let lastY: number | undefined;
    let text = '';
    for (const item of textContent.items) {
      if (lastY === item.transform[5] || lastY === undefined) {
        text += item.str;
      } else {
        text += `\n${item.str}`;
      }
      lastY = item.transform[5];
    }
    pageTexts.push(text);
    return text;
  };

  const data = await pdfParse(buffer, { pagerender: renderPage });
  const pageCount = data.numpages || pageTexts.length || 0;

  const marked = pageTexts
    .map((t, i) => `${PAGE_MARKER_PREFIX}${i + 1} ---]\n${t}`)
    .join('\n\n');

  // Fallback: se o renderizador custom não coletou páginas, usa o texto plano.
  const text = (marked.trim().length > 0 ? marked : (data.text || '')).trim();
  return { text, pageCount };
}
