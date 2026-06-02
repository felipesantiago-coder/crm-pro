import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
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

    return NextResponse.json({
      status: 'ok',
      database: 'connected',
      users: {
        count: userCount,
        list: users,
      },
      clients: {
        count: clientCount,
      },
      env: {
        databaseUrlSet: !!process.env.DATABASE_URL,
        databaseUrlPrefix: process.env.DATABASE_URL?.substring(0, 15) + '...',
        nextauthSecretSet: !!process.env.NEXTAUTH_SECRET,
        nextauthUrl: process.env.NEXTAUTH_URL || 'not set',
        supabaseUrlSet: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
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
