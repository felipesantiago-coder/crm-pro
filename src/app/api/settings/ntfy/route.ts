import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { generateNtfyTopic, generateNtfyToken } from '@/lib/ntfy';

/**
 * GET /api/settings/ntfy
 * Returns the current user's Ntfy configuration status.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const user = await db.user.findUnique({
      where: { email: session.user.email },
      select: { ntfyTopic: true, name: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    // Build the subscribe URL if topic exists
    const ntfyBaseUrl = (process.env.NTFY_BASE_URL || 'https://ntfy.sh').replace(/\/+$/, '');
    const subscribeUrl = user.ntfyTopic ? `${ntfyBaseUrl}/${user.ntfyTopic}` : null;

    return NextResponse.json({
      ntfyTopic: user.ntfyTopic || null,
      configured: !!user.ntfyTopic,
      subscribeUrl,
    });
  } catch (error) {
    console.error('[Ntfy Settings] GET error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

/**
 * PUT /api/settings/ntfy
 * Activates or deactivates Ntfy notifications.
 *
 * Actions:
 *   - "activate"  → generates topic + token, saves to user
 *   - "deactivate" → clears topic + token
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const body = await request.json();
    const { action } = body;

    const user = await db.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    if (action === 'deactivate') {
      await db.user.update({
        where: { id: user.id },
        data: { ntfyTopic: null, ntfyToken: null },
      });
      return NextResponse.json({ success: true, ntfyTopic: null });
    }

    if (action === 'activate') {
      // Check if user already has Ntfy configured
      const existing = await db.user.findUnique({
        where: { id: user.id },
        select: { ntfyTopic: true },
      });

      if (existing?.ntfyTopic) {
        // Already activated — return current config with token
        const existingWithToken = await db.user.findUnique({
          where: { id: user.id },
          select: { ntfyTopic: true, ntfyToken: true },
        });
        const ntfyBaseUrl = (process.env.NTFY_BASE_URL || 'https://ntfy.sh').replace(/\/+$/, '');
        return NextResponse.json({
          success: true,
          ntfyTopic: existing.ntfyTopic,
          ntfyToken: existingWithToken?.ntfyToken || null,
          subscribeUrl: `${ntfyBaseUrl}/${existing.ntfyTopic}`,
          alreadyActive: true,
        });
      }

      // Generate unique topic and token
      const ntfyTopic = generateNtfyTopic();
      const ntfyToken = generateNtfyToken();

      // Verify uniqueness (extremely unlikely collision, but check anyway)
      const topicExists = await db.user.findFirst({
        where: { ntfyTopic },
        select: { id: true },
      });

      if (topicExists) {
        // Regenerate on collision (practically impossible)
        const newTopic = generateNtfyTopic();
        const newToken = generateNtfyToken();
        // Activate Ntfy and deactivate Telegram (mutual exclusion)
        await db.user.update({
          where: { id: user.id },
          data: { ntfyTopic: newTopic, ntfyToken: newToken, telegramChatId: null },
        });
        const ntfyBaseUrl = (process.env.NTFY_BASE_URL || 'https://ntfy.sh').replace(/\/+$/, '');
        return NextResponse.json({
          success: true,
          ntfyTopic: newTopic,
          ntfyToken: newToken,
          subscribeUrl: `${ntfyBaseUrl}/${newTopic}`,
        });
      }

      // Activate Ntfy and deactivate Telegram (mutual exclusion)
      await db.user.update({
        where: { id: user.id },
        data: { ntfyTopic, ntfyToken, telegramChatId: null },
      });

      const ntfyBaseUrl = (process.env.NTFY_BASE_URL || 'https://ntfy.sh').replace(/\/+$/, '');
      return NextResponse.json({
        success: true,
        ntfyTopic,
        ntfyToken,
        subscribeUrl: `${ntfyBaseUrl}/${ntfyTopic}`,
      });
    }

    return NextResponse.json({ error: 'Ação inválida' }, { status: 400 });
  } catch (error) {
    console.error('[Ntfy Settings] PUT error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}