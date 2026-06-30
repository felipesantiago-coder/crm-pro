import { NextRequest, NextResponse } from 'next/server';

/**
 * Edge Middleware — executa em TODAS as requisições antes de chegar
 * às páginas ou API routes.
 *
 * Responsabilidades:
 *  1. Impedir cache de HTML pelo navegador (evita código antigo após deploy)
 *  2. Impedir cache de dados da API (sempre dados frescos)
 *  3. Adicionar headers de segurança em páginas públicas
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const response = NextResponse.next();

  // ── 1. Páginas HTML: nunca cachear ────────────────────────
  // Garante que o navegador sempre busca a versão mais recente
  // do HTML. Os chunks JS (_next/static/*) continuam cacheáveis
  // pois usam hash no nome de arquivo.
  const isHtmlPage =
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/change-password' ||
    pathname.startsWith('/empreendimentos') ||
    pathname.startsWith('/portal');

  if (isHtmlPage) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    response.headers.set('Surrogate-Control', 'no-store');
  }

  // ── 2. API routes: não cachear respostas ───────────────────
  const isApi = pathname.startsWith('/api/');
  if (isApi && !pathname.includes('/track/pixel.gif')) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    response.headers.set('Pragma', 'no-cache');
  }

  return response;
}

// Matcher: intercepta tudo EXCETO arquivos estáticos com hash
// (_next/static/chunks/xxx.js, _next/static/css/xxx.css, imagens, fontes)
export const config = {
  matcher: [
    // Páginas
    '/',
    '/login',
    '/change-password',
    '/empreendimentos/:path*',
    '/portal/:path*',
    // API routes
    '/api/:path*',
    // _next/data (RSC payload — deve ser fresco)
    '/_next/data/:path*',
  ],
};
