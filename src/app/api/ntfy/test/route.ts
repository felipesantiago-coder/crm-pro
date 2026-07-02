import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';

const NTFY_BASE_URL = (process.env.NTFY_BASE_URL || 'https://ntfy.sh').replace(/\/+$/, '');

/**
 * POST /api/ntfy/test
 * Sends a test notification to the current user's Ntfy topic.
 */
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const user = await db.user.findUnique({
      where: { email: session.user.email },
      select: { ntfyTopic: true, ntfyToken: true, name: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    if (!user.ntfyTopic || !user.ntfyToken) {
      return NextResponse.json(
        { error: 'Ntfy não está ativado. Ative nas configurações primeiro.' },
        { status: 400 },
      );
    }

    // Send directly with full error details
    const credentials = Buffer.from(`${user.ntfyTopic}:${user.ntfyToken}`).toString('base64');
    const body = {
      topic: user.ntfyTopic,
      title: '✅ Notificações Ntfy Ativas!',
      body: `Olá, **${user.name}**! 🔔\n\nSuas notificações Ntfy estão ativas!\nVocê receberá alertas aqui sempre que um novo lead for cadastrado via landing page.\n\n_${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}_`,
      priority: 3,
      tags: ['white_check_mark'],
    };

    const res = await fetch(`${NTFY_BASE_URL}/${user.ntfyTopic}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${credentials}`,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 200 || res.status === 402) {
      return NextResponse.json({ success: true, message: 'Notificação de teste enviada!' });
    }

    const errorText = await res.text().catch(() => 'sem detalhes');
    return NextResponse.json(
      { error: `Ntfy retornou status ${res.status}: ${errorText}` },
      { status: 500 },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Ntfy Test] Error:', msg, error);
    return NextResponse.json({ error: `Erro interno: ${msg}` }, { status: 500 });
  }
}