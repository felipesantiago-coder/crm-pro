import { NextRequest, NextResponse } from 'next/server';
import { locales, defaultLocale, isValidLocale, type Locale } from './i18n/config';

const LOCALE_COOKIE = 'locale';

/**
 * Edge Middleware — executa em TODAS as requisições antes de chegar
 * às páginas ou API routes.
 *
 * Responsabilidades:
 *  1. Roteamento de locale (/en/..., /es/...) para landing pages
 *  2. Impedir cache de HTML pelo navegador (evita código antigo após deploy)
 *  3. Impedir cache de dados da API (sempre dados frescos)
 *  4. Adicionar headers de segurança em páginas públicas
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const response = NextResponse.next();

  // ── 0. Locale routing for empreendimentos ───────
  // Detect locale from URL: /en/empreendimentos/... or /es/empreendimentos/...
  let detectedLocale: Locale | null = null;
  let cleanPath = pathname;

  for (const l of locales) {
    if (l === defaultLocale) continue; // pt-BR has no prefix
    const prefix = `/${l}/`;
    if (pathname === `/${l}` || pathname.startsWith(prefix)) {
      detectedLocale = l;
      cleanPath = pathname.slice(l.length + 1) || '/';
      break;
    }
  }

  const isEmpreendimentosPath =
    cleanPath === '/empreendimentos' ||
    cleanPath.startsWith('/empreendimentos/');

  if (isEmpreendimentosPath) {
    // Determine effective locale:
    // 1. URL prefix (if present)
    // 2. Cookie
    // 3. Default (pt-BR)
    let effectiveLocale: Locale = defaultLocale;

    if (detectedLocale) {
      effectiveLocale = detectedLocale;
    } else {
      const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
      if (cookieLocale && isValidLocale(cookieLocale)) {
        effectiveLocale = cookieLocale;
      }
    }

    // Set locale header for server components
    response.headers.set('x-locale', effectiveLocale);

    // If locale was detected from URL, rewrite to strip the prefix
    if (detectedLocale) {
      const url = request.nextUrl.clone();
      url.pathname = cleanPath + (url.search || '');
      return NextResponse.rewrite(url, {
        headers: {
          ...Object.fromEntries(response.headers.entries()),
          'x-locale': effectiveLocale,
        },
      });
    }
  }

  // ── 1. Landing pages HTML: stale-while-revalidate ──────
  const isLandingPage = /^\/empreendimentos\/[^/]+(\/?$|\/cadastro-sucesso)/.test(pathname);

  if (isLandingPage) {
    // stale-while-revalidate: serve cached HTML immediately while revalidating in background.
    // 60s matches the ISR revalidate interval on [slug]/page.tsx.
    response.headers.set('Cache-Control', 'public, max-age=0, stale-while-revalidate=60');
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
export const config = {
  matcher: [
    '/',
    '/login',
    '/change-password',
    '/reset-password',
    '/forgot-password',
    '/empreendimentos/:path*',
    '/en/:path*',
    '/es/:path*',
    '/portal/:path*',
    '/api/:path*',
    '/_next/data/:path*',
  ],
};
