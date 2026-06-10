import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';

// GET /api/google-calendar/status — Check if user has connected Google Calendar
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const token = await db.googleCalendarToken.findUnique({
      where: { userId: session.user.id },
      select: { createdAt: true, expiresAt: true },
    });

    const isConnected = !!token;

    return NextResponse.json({
      connected: isConnected,
      connectedAt: token?.createdAt || null,
      expiresAt: token?.expiresAt || null,
    });
  } catch (error) {
    console.error('[Google Calendar] Status error:', error);
    // Se a tabela não existe, retorna desconectado
    return NextResponse.json({ connected: false, connectedAt: null, expiresAt: null });
  }
}