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

  // ── 1. Landing pages HTML: stale-while-revalidate ──────
  // Serve cached HTML immediately (fast TTFB) and revalidate in background.
  // JS/CSS chunks use content hashes and are unaffected by this.
  const isLandingPage = /^\/empreendimentos\/[^/]+(\/?$|\/cadastro-sucesso)/.test(pathname);

  if (isLandingPage) {
    response.headers.set('Cache-Control', 'public, max-age=0, stale-while-revalidate=30');
    return response;
  }

  // ── 2. Other HTML pages: never cache (admin, login, etc) ──
  const isOtherHtmlPage =
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/change-password' ||
    pathname === '/reset-password' ||
    pathname === '/forgot-password' ||
    pathname.startsWith('/portal');

  if (isOtherHtmlPage) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    response.headers.set('Surrogate-Control', 'no-store');
  }

  // ── 3. API routes: não cachear respostas ───────────────────
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
    '/reset-password',
    '/forgot-password',
    '/empreendimentos/:path*',
    '/portal/:path*',
    // API routes
    '/api/:path*',
    // _next/data (RSC payload — deve ser fresco)
    '/_next/data/:path*',
  ],
};
