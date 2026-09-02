import { NextRequest, NextResponse } from 'next/server';

/**
 * Rate limiter in-memory por IP.
 * Para produção com múltiplas instâncias, considerar Redis/Upstash.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup a cada 5 minutos para evitar memory leak
let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 5 * 60 * 1000;

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (now >= entry.resetAt) store.delete(key);
  }
}

export interface RateLimitOptions {
  /** Máximo de requisições na janela */
  maxRequests: number;
  /** Tamanho da janela em segundos */
  windowSeconds: number;
  /** Identificador customizado (ex: email) */
  keyPrefix?: string;
}

const DEFAULT_OPTIONS: RateLimitOptions = {
  maxRequests: 10,
  windowSeconds: 60,
};

/**
 * Verifica rate limit. Retorna null se OK, ou uma Response 429 se excedido.
 */
export function rateLimit(request: NextRequest, options?: Partial<RateLimitOptions>): NextResponse | null {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  cleanup();

  // Identificador: IP + prefixo customizado
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
    || request.headers.get('x-real-ip') 
    || 'unknown';
  const prefix = options?.keyPrefix ? `${options.keyPrefix}:` : '';
  const key = `${prefix}${ip}`;
  
  const now = Date.now();
  const windowMs = opts.windowSeconds * 1000;

  let entry = store.get(key);

  if (!entry || now >= entry.resetAt) {
    // Nova janela
    store.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  entry.count++;

  if (entry.count > opts.maxRequests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return NextResponse.json(
      { error: 'Muitas requisições. Tente novamente em instantes.' },
      { 
        status: 429,
        headers: { 'Retry-After': String(retryAfter) }
      }
    );
  }

  return null;
}

/**
 * Rate limiter para tentativas de login (por email + IP).
 * Mais agressivo: 5 tentativas por minuto.
 */
export function loginRateLimit(request: NextRequest, email: string): NextResponse | null {
  return rateLimit(request, {
    maxRequests: 5,
    windowSeconds: 60,
    keyPrefix: `login:${email}`,
  });
}
