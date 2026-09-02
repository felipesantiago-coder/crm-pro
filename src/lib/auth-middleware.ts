import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Gera um hash SHA-256 curto (primeiros 32 chars hex) do User-Agent.
 * Usa SubtleCrypto (disponível no Edge Runtime e Node.js).
 */
async function hashUserAgent(ua: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(ua);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// Middleware para proteger API routes
// No Next.js 16, usamos checagem server-side nas API routes
// em vez do middleware edge tradicional.
export async function requireAuth(request: NextRequest): Promise<{ authorized: boolean; token?: any; userId?: string; role?: string }> {
  try {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET!,
    });

    if (!token) {
      return { authorized: false };
    }

    // ── Session Binding: verificar User-Agent ──
    // Se o token tiver um uaHash, verifica se o UA atual bate.
    // Tokens antigos (sem uaHash) são aceitos normalmente (compatibilidade).
    const currentUaHash = await hashUserAgent(request.headers.get('user-agent') || '');
    if (token.uaHash && token.uaHash !== currentUaHash) {
      console.warn(`[AUTH] Session binding mismatch — userId=${token.id}`);
      return { authorized: false };
    }

    return {
      authorized: true,
      token,
      userId: token.id as string,
      role: token.role as string,
    };
  } catch {
    return { authorized: false };
  }
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
}

export function forbiddenResponse() {
  return NextResponse.json({ error: 'Acesso negado. Apenas administradores.' }, { status: 403 });
}
