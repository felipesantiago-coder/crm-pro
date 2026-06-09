import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { NextResponse } from 'next/server';

export async function requireAuth() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: 'Não autorizado' }, { status: 401 }), session: null };
  }
  return { error: null, session };
}

export async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: 'Não autorizado' }, { status: 401 }), session: null };
  }
  // Check if user has ADMIN role from session token
  const userRole = (session as unknown as { role?: string })?.role ||
                   (session.user as unknown as { role?: string })?.role;
  if (userRole !== 'ADMIN') {
    return { error: NextResponse.json({ error: 'Acesso negado' }, { status: 403 }), session: null };
  }
  return { error: null, session };
}
