import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { locales, defaultLocale, isValidLocale, type Locale } from './i18n/config';

const LOCALE_COOKIE = 'locale';

/**
 * Gera hash curto do User-Agent para session binding (Edge-compatible).
 */
async function hashUserAgent(ua: string): Promise<string> {
  const data = new TextEncoder().encode(ua);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/**
 * Edge Middleware — executa em TODAS as requisições antes de chegar
 * às páginas ou API routes.
 *
 * Responsabilidades:
 *  1. Session binding: invalida sessão se o User-Agent mudou
 *  2. Roteamento de locale (/en/..., /es/...) para landing pages
 *  3. Impedir cache de HTML pelo navegador (evita código antigo após deploy)
 *  4. Impedir cache de dados da API (sempre dados frescos)
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const response = NextResponse.next();

  // ── 0. Session Binding para rotas autenticadas ───────
  // Verifica se o JWT tem uaHash e se bate com o User-Agent atual.
  // Se não bater, redireciona para login (invalida sessão no cliente).
  // Rotas públicas (landing pages, portal, auth) são ignoradas.
  const isAuthRoute = pathname.startsWith('/api/auth');
  const isPublicApi =
    pathname.startsWith('/api/track/') ||
    pathname.startsWith('/api/enterprises/public') ||
    pathname.startsWith('/api/enterprises/catalog/') ||
    pathname.startsWith('/api/enterprises/list-public') ||
    pathname.startsWith('/api/portal/') ||
    pathname.startsWith('/api/webhooks/meta-leads/route');
  const isLandingOrPublic =
    pathname.startsWith('/empreendimentos/') ||
    pathname.startsWith('/en/') ||
    pathname.startsWith('/es/') ||
    pathname === '/login' ||
    pathname === '/forgot-password' ||
    pathname === '/reset-password' ||
    pathname.startsWith('/portal');

  if (!isAuthRoute && !isPublicApi && !isLandingOrPublic && pathname.startsWith('/api/')) {
    try {
      const token = await getToken({
        req: request,
        secret: process.env.NEXTAUTH_SECRET!,
      });
      if (token?.uaHash) {
        const currentUaHash = await hashUserAgent(request.headers.get('user-agent') || '');
        if (token.uaHash !== currentUaHash) {
          console.warn(`[MIDDLEWARE] Session binding mismatch — userId=${token.id}`);
          // Deleta o cookie de sessão para forçar re-login
          const res = NextResponse.json({ error: 'Sessão inválida. Faça login novamente.' }, { status: 401 });
          const sessionCookie = request.cookies.get('next-auth.session-token') ||
            request.cookies.get('__Secure-next-auth.session-token');
          if (sessionCookie) {
            res.cookies.delete(sessionCookie.name, { path: '/' });
          }
          return res;
        }
      }
    } catch {
      // Falha na verificação — não bloqueia (getToken pode falhar se cookie ausente)
    }
  }

  // ── 1. Locale routing for empreendimentos ───────
  let detectedLocale: Locale | null = null;
  let cleanPath = pathname;

  for (const l of locales) {
    if (l === defaultLocale) continue;
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
    let effectiveLocale: Locale = defaultLocale;
    if (detectedLocale) {
      effectiveLocale = detectedLocale;
    } else {
      const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
      if (cookieLocale && isValidLocale(cookieLocale)) {
        effectiveLocale = cookieLocale;
      }
    }
    response.headers.set('x-locale', effectiveLocale);

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

  // ── 2. Landing pages HTML: revalidação obrigatória ─────
  // CORREÇÃO (2026-09, "seção pública desatualizada"): antes usava
  // stale-while-revalidate=60, que permitia CDN/navegador servirem uma cópia
  // ANTIGA da landing por até uma janela de 60s após a publicação de uma base
  // nova. Regra §12: atualização publicada deve refletir OBRIGATORIAMENTE →
  // max-age=0 + must-revalidate (sem stale).
  const isLandingPage = /^\/empreendimentos\/[^/]+(\/?$|\/cadastro-sucesso)/.test(pathname);

  if (isLandingPage) {
    response.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
    return response;
  }

  // ── 3. Other HTML pages: never cache ──
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

  // ── 4. API routes: não cachear respostas ───────────────────
  const isApi = pathname.startsWith('/api/');
  if (isApi && !pathname.includes('/track/pixel.gif')) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    response.headers.set('Pragma', 'no-cache');
  }

  return response;
}

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
