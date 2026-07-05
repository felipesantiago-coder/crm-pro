import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { notifyNewLead, isTelegramConfigured } from '@/lib/telegram';

/**
 * POST /api/telegram/test
 * Sends a realistic test notification to the current user's Telegram,
 * simulating a new lead from a real enterprise (with cover image).
 */
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    if (!isTelegramConfigured()) {
      return NextResponse.json(
        { error: 'O bot do Telegram não está configurado. Solicite ao administrador para configurar o TELEGRAM_BOT_TOKEN.' },
        { status: 400 },
      );
    }

    const user = await db.user.findUnique({
      where: { email: session.user.email },
      select: { telegramChatId: true, name: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    if (!user.telegramChatId) {
      return NextResponse.json(
        { error: 'Seu Telegram não está vinculado. Vincule primeiro pelo bot ou insira seu Chat ID.' },
        { status: 400 },
      );
    }

    // Find an enterprise with a cover image to make the test realistic
    const enterprise = await db.enterprise.findFirst({
      where: { imageUrl: { not: null } },
      select: { name: true, imageUrl: true, slug: true },
      orderBy: { createdAt: 'desc' },
    });

    const mockLeadData = {
      leadName: 'Maria Oliveira (Teste)',
      leadPhone: '+55 11 99999-1234',
      leadEmail: 'maria.oliveira@email.com',
      enterpriseName: enterprise?.name || 'Residencial Exemplo',
      enterpriseImageUrl: enterprise?.imageUrl || null,
      utmCampaign: 'campanha-teste-verao',
      utmSource: 'google_ads' as const,
      slug: enterprise?.slug || undefined,
      customAnswers: {
        'Interesse': 'Apartamento 2 quartos',
        'Faixa de preço': 'R$ 400.000 - R$ 600.000',
      },
    };

    const sent = await notifyNewLead(user.telegramChatId, mockLeadData);

    if (sent) {
      return NextResponse.json({
        success: true,
        message: 'Notificação de teste enviada com dados simulados de lead!',
        hasImage: !!enterprise?.imageUrl,
      });
    } else {
      return NextResponse.json(
        { error: 'Falha ao enviar notificação. Verifique se o Chat ID está correto.' },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error('[Telegram Test] Error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}