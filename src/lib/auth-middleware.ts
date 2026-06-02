import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

// Middleware para proteger API routes
// No Next.js 16, usamos checagem server-side nas API routes
// em vez do middleware edge tradicional.
export async function requireAuth(request: NextRequest): Promise<{ authorized: boolean; token?: any; userId?: string; role?: string }> {
  try {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET || 'crm-pro-secret-change-in-production',
    });

    if (!token) {
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
