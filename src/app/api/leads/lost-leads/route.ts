import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { notifyNewLead, notifyQueueUpdate } from '@/lib/telegram';

/**
 * Admin API — list and manage lost leads (safety net captures).
 * Requires authentication.
 */

// GET — list lost leads (paginated, filterable)
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const showRecovered = searchParams.get('showRecovered') === 'true';
    const slug = searchParams.get('slug') || undefined;

    const where: Prisma.LostLeadWhereInput = { isRecovered: showRecovered ? undefined : false };
    if (slug) where.slug = slug;

    const [items, total] = await Promise.all([
      db.lostLead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.lostLead.count({ where }),
    ]);

    return NextResponse.json({ items, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('[Lost Leads] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// POST — recover a lost lead (create real client from it)
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const body = await request.json();
    const { lostLeadId } = body;

    if (!lostLeadId || typeof lostLeadId !== 'string') {
      return NextResponse.json({ error: 'lostLeadId é obrigatório' }, { status: 400 });
    }

    const lostLead = await db.lostLead.findUnique({ where: { id: lostLeadId } });
    if (!lostLead) {
      return NextResponse.json({ error: 'Lead não encontrado' }, { status: 404 });
    }
    if (lostLead.isRecovered) {
      return NextResponse.json({ error: 'Este lead já foi recuperado' }, { status: 409 });
    }

    // Validate minimum data
    if (!lostLead.name || !lostLead.email) {
      return NextResponse.json({ error: 'Dados insuficientes para recuperar (nome e e-mail obrigatórios)' }, { status: 400 });
    }

    // Check if a client with this email already exists
    const existingClient = await db.client.findFirst({
      where: { email: lostLead.email },
      select: { id: true },
    });
    if (existingClient) {
      // Mark as recovered even if client already exists — the admin was notified
      await db.lostLead.update({
        where: { id: lostLeadId },
        data: { isRecovered: true, recoveredToClientId: existingClient.id },
      });
      return NextResponse.json({
        success: true,
        message: 'Cliente com este e-mail já existe',
        clientId: existingClient.id,
        alreadyExisted: true,
      });
    }

    // Find a user for createdBy (required FK)
    const firstUser = await db.user.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } });
    if (!firstUser) {
      return NextResponse.json({ error: 'Nenhum usuário cadastrado no sistema' }, { status: 500 });
    }

    // Find enterprise by slug for enterpriseId
    let enterpriseId: string | undefined;
    let enterpriseName: string | undefined;
    if (lostLead.slug) {
      const ent = await db.enterprise.findUnique({
        where: { slug: lostLead.slug },
        select: { id: true, name: true, region: true },
      });
      if (ent) {
        enterpriseId = ent.id;
        enterpriseName = ent.name;
      }
    }

    // Create the client
    const client = await db.client.create({
      data: {
        name: lostLead.name,
        email: lostLead.email,
        phone: lostLead.phone || undefined,
        enterpriseId: enterpriseId || undefined,
        region: undefined, // We don't have region from lost lead
        stage: 'LEAD',
        createdBy: firstUser.id,
        utmSource: lostLead.utmSource || undefined,
        utmMedium: lostLead.utmMedium || undefined,
        utmCampaign: lostLead.utmCampaign || undefined,
        utmContent: lostLead.utmContent || undefined,
        utmTerm: lostLead.utmTerm || undefined,
        notes: `[Recuperado de Lead Perdido]\nFonte: ${lostLead.source}\nSlug: ${lostLead.slug || 'N/A'}\nData original de captura: ${lostLead.createdAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}${lostLead.userAgent ? `\nUser Agent: ${lostLead.userAgent.slice(0, 100)}` : ''}${enterpriseName ? `\nEmpreendimento: ${enterpriseName}` : ''}`,
      },
    });

    // Create initial interaction
    await db.interaction.create({
      data: {
        clientId: client.id,
        description: `[Lead Recuperado] Lead perdido recuperado manualmente pelo admin. Fonte: ${lostLead.source}.`,
      },
    });

    // Try to assign via queue
    let assignedUserId: string | undefined;
    let assignedUserName: string | undefined;
    let assignedQueueId: string | undefined;
    try {
      const { assignLeadToUser, peekNextUser } = await import('@/lib/lead-queue');
      const assignResult = await assignLeadToUser({
        leadId: client.id,
        source: `recovered_lost_lead:${lostLead.slug || 'unknown'}`,
      });
      if (assignResult.assigned && assignResult.userId) {
        assignedUserId = assignResult.userId;
        assignedUserName = assignResult.userName;
        assignedQueueId = assignResult.queueId;
        await db.client.update({
          where: { id: client.id },
          data: { createdBy: assignResult.userId },
        }).catch(() => {});
      }
    } catch (queueErr) {
      console.error('[Lost Leads] Falha na atribuição de fila:', queueErr);
    }

    // Notify assigned agent via Telegram
    if (assignedUserId) {
      db.user.findUnique({ where: { id: assignedUserId }, select: { telegramChatId: true, name: true } }).then((user) => {
        if (user?.telegramChatId) {
          notifyNewLead(user.telegramChatId, {
            leadName: client.name,
            leadPhone: client.phone || '',
            leadEmail: client.email || '',
            enterpriseName: enterpriseName || null,
            utmCampaign: lostLead.utmCampaign || null,
            utmSource: lostLead.utmSource || null,
            slug: lostLead.slug || undefined,
            assignedUserName: assignedUserName,
            customAnswers: undefined,
          }).catch((err) => console.warn('[Lost Leads] Falha na notificação do atendente:', err));
        } else {
          console.warn(`[Lost Leads] Usuário ${user?.name || assignedUserId} sem Telegram configurado. Lead recuperado ${client.id} sem notificação.`);
        }
      }).catch(() => {});

      // Notify admin about queue rotation
      if (assignedQueueId && assignedUserName) {
        const capturedQueueId = assignedQueueId;
        const capturedUserName = assignedUserName;
        (async () => {
          try {
            const { peekNextUser } = await import('@/lib/lead-queue');
            const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { telegramChatId: true } });
            if (!admin?.telegramChatId) return;
            const nextUser = await peekNextUser({ queueId: capturedQueueId });
            await notifyQueueUpdate(admin.telegramChatId, {
              source: `recovered_lost_lead:${lostLead.slug || 'unknown'}`,
              assignedUserName: capturedUserName,
              nextUserName: nextUser?.userName || null,
              leadName: client.name,
              leadPhone: client.phone || undefined,
              enterpriseName: enterpriseName || undefined,
            });
          } catch (err) {
            console.warn('[Lost Leads] Admin queue notification failed:', err instanceof Error ? err.message : err);
          }
        })();
      }
    }

    // Mark as recovered
    await db.lostLead.update({
      where: { id: lostLeadId },
      data: { isRecovered: true, recoveredToClientId: client.id },
    });

    return NextResponse.json({ success: true, clientId: client.id, clientName: client.name });
  } catch (error) {
    console.error('[Lost Leads] Erro:', error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'Já existe um cliente com este e-mail' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// DELETE — discard a lost lead (mark as recovered without creating client)
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id é obrigatório' }, { status: 400 });
    }

    // Soft delete: mark as recovered with a note
    await db.lostLead.update({
      where: { id },
      data: { isRecovered: true },
    }).catch(() => {});

    // Hard delete
    await db.lostLead.delete({ where: { id } }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Lost Leads] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
