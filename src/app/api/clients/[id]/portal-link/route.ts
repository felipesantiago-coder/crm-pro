import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { generatePortalToken } from '@/lib/portal-token';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { id } = await params;

    // Verificar se o usuário tem acesso ao cliente
    const user = await db.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    if (user.role !== 'ADMIN') {
      const accessible = await db.client.findFirst({
        where: {
          id,
          OR: [
            { createdBy: user.id },
            { partners: { some: { userId: user.id } } },
          ],
        },
        select: { id: true },
      });
      if (!accessible) {
        return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
      }
    }

    const client = await db.client.findUnique({
      where: { id },
      select: { id: true, createdAt: true },
    });

    if (!client) {
      return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });
    }

    // Build base URL from: env var > request headers > fallback
    const envUrl = process.env.NEXT_PUBLIC_APP_URL;
    let baseUrl = '';
    if (envUrl) {
      baseUrl = envUrl.replace(/\/$/, '');
    } else {
      const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
      const proto = request.headers.get('x-forwarded-proto') || 'https';
      baseUrl = `${proto}://${host}`;
    }

    const token = generatePortalToken(client.id, client.createdAt.toISOString());
    const url = `${baseUrl}/portal?t=${token}&c=${client.id}`;

    return NextResponse.json({ url });
  } catch (error) {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}