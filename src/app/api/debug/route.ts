import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }
  try {
    // Testar conexão com o banco
    const userCount = await db.user.count();

    // Buscar todos os usuários (sem expor hashes completos)
    const users = await db.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        mustChangePassword: true,
        createdAt: true,
      },
    });

    // Verificar se a tabela clients existe
    let clientCount = 0;
    try {
      clientCount = await db.client.count();
    } catch {
      // Tabela pode não existir
    }

    // Detectar provedor do banco pela URL (para debug)
    const dbUrl = process.env.DATABASE_URL || '';
    const dbProvider = dbUrl.includes('neon.tech') ? 'Neon' : dbUrl.includes('supabase') ? 'Supabase (LEGADO — deveria ser Neon)' : dbUrl.includes('file:') ? 'SQLite (local)' : 'Desconhecido';

    return NextResponse.json({
      status: 'ok',
      database: 'connected',
      databaseProvider: dbProvider,
      users: {
        count: userCount,
        list: users,
      },
      clients: {
        count: clientCount,
      },
      env: {
        databaseUrlSet: !!process.env.DATABASE_URL,
        databaseUrlPrefix: dbUrl.substring(0, 30) + '...',
        nextauthSecretSet: !!process.env.NEXTAUTH_SECRET,
        nextauthUrl: process.env.NEXTAUTH_URL || 'not set',
        supabaseStorageSet: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        supabaseStorageNote: 'Supabase usado APENAS para Storage/Realtime (NAO como banco de dados)',
      },
    });
  } catch (error) {
    console.error('[DEBUG] Erro:', error);
    return NextResponse.json({
      status: 'error',
      message: 'Erro ao conectar com o banco de dados',
      error: String(error),
      env: {
        databaseUrlSet: !!process.env.DATABASE_URL,
        nextauthSecretSet: !!process.env.NEXTAUTH_SECRET,
      },
    }, { status: 500 });
  }
}
