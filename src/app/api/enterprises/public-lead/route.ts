import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { notifyNewLead } from '@/lib/telegram';
import { notifyNewLead as notifyNewLeadNtfy } from '@/lib/ntfy';

/**
 * PUBLIC endpoint — no auth required.
 * Receives a lead submission from a landing page form.
 * Creates a Client record and optionally assigns it via the lead queue.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, phone, email, slug, customAnswers, utmSource, utmMedium, utmCampaign, utmContent, utmTerm } = body;

    // ── Validate slug format ───────────────────────────────
    if (slug && !/^[a-z0-9-]{1,100}$/.test(slug)) {
      return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 });
    }

    // ── Validate required fields ─────────────────────────────
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json(
        { error: 'Nome completo é obrigatório (mínimo 2 caracteres).' },
        { status: 400 },
      );
    }
    if (name.trim().length > 200) {
      return NextResponse.json({ error: 'Nome muito longo.' }, { status: 400 });
    }

    const cleanPhone = (phone || '').replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 10) {
      return NextResponse.json(
        { error: 'Telefone é obrigatório e deve conter DDD + número.' },
        { status: 400 },
      );
    }
    if (cleanPhone.length > 15) {
      return NextResponse.json({ error: 'Telefone inválido.' }, { status: 400 });
    }

    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return NextResponse.json(
        { error: 'E-mail é obrigatório e deve ser válido.' },
        { status: 400 },
      );
    }
    if (cleanEmail.length > 254) {
      return NextResponse.json({ error: 'E-mail inválido.' }, { status: 400 });
    }

    // ── Find enterprise by slug ──────────────────────────────
    let enterpriseId: string | null = null;
    let enterpriseName: string | null = null;
    let enterpriseRegion: string | null = null;

    if (slug) {
      const enterprise = await db.enterprise.findUnique({
        where: { slug },
        select: { id: true, name: true, region: true },
      });
      if (enterprise) {
        enterpriseId = enterprise.id;
        enterpriseName = enterprise.name;
        enterpriseRegion = enterprise.region;
      }
    }

    // ── Check for existing client (match by phone OR email) ─
    const existingClient = await db.client.findFirst({
      where: {
        OR: [
          { phone: cleanPhone },
          { email: cleanEmail },
        ],
      },
      select: { id: true, name: true, stage: true, enterpriseId: true, phone: true, email: true },
    });

    if (existingClient) {
      // Update existing client with this new interaction (no queue assignment — don't waste a turn)
      await db.interaction.create({
        data: {
          clientId: existingClient.id,
          description: `[Landing Page] Novo cadastro${enterpriseName ? ` — ${enterpriseName}` : ''}${slug ? ` (slug: ${slug})` : ''}`,
        },
      });

      return NextResponse.json({
        success: true,
        isExisting: true,
        clientId: existingClient.id,
        clientName: existingClient.name,
        assignedUser: null,
      });
    }

    // ── Find a user to assign as createdBy (queue or system) ─
    let assignedUser = null;
    let createdByUserId: string | null = null;

    try {
      const assignRes = await fetch(
        `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/lead-queues/assign`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: slug ? `landing_form:${slug}` : 'landing_form',
          }),
        },
      );
      if (assignRes.ok) {
        assignedUser = await assignRes.json();
        if (assignedUser.assigned) {
          createdByUserId = assignedUser.userId;
        }
      }
    } catch {
      // Silent
    }

    // Fallback: find first admin user
    if (!createdByUserId) {
      const firstUser = await db.user.findFirst({
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      createdByUserId = firstUser?.id || 'system';
    }

    // ── Build custom answers text ──────────────────────────────
    let customAnswersText = '';
    if (customAnswers && typeof customAnswers === 'object' && Object.keys(customAnswers).length > 0) {
      const lines = Object.entries(customAnswers)
        .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
        .map(([k, v]) => `  • ${k}: ${v}`);
      if (lines.length > 0) {
        customAnswersText = '\n\nRespostas do formulário:\n' + lines.join('\n');
      }
    }

    // ── Create client ────────────────────────────────────────
    const client = await db.client.create({
      data: {
        name: name.trim(),
        phone: cleanPhone,
        email: cleanEmail,
        region: enterpriseRegion,
        enterprise: enterpriseName || undefined,
        enterpriseId: enterpriseId || undefined,
        stage: 'LEAD',
        createdBy: createdByUserId,
        utmSource: typeof utmSource === 'string' ? utmSource : undefined,
        utmMedium: typeof utmMedium === 'string' ? utmMedium : undefined,
        utmCampaign: typeof utmCampaign === 'string' ? utmCampaign : undefined,
        utmContent: typeof utmContent === 'string' ? utmContent : undefined,
        utmTerm: typeof utmTerm === 'string' ? utmTerm : undefined,
        notes: `[Landing Page] Cadastro realizado via formulário${enterpriseName ? ` — ${enterpriseName}` : ''}${slug ? `\nSlug: ${slug}` : ''}${utmCampaign ? `\nCampanha: ${utmCampaign}` : ''}${customAnswersText}`,
      },
    });

    // ── Create initial interaction ───────────────────────────
    await db.interaction.create({
      data: {
        clientId: client.id,
        description: `[Landing Page] Cadastro inicial${enterpriseName ? ` — ${enterpriseName}` : ''}${slug ? ` (slug: ${slug})` : ''}`,
      },
    });

    // ── Send Telegram notification (fire-and-forget) ───────
    if (createdByUserId && createdByUserId !== 'system') {
      // Fetch assigned user's telegramChatId and ntfy config (may be null)
      db.user.findUnique({
        where: { id: createdByUserId },
        select: { telegramChatId: true, ntfyTopic: true, ntfyToken: true },
      }).then((user) => {
        const leadData = {
          leadName: client.name,
          leadPhone: client.phone || '',
          leadEmail: client.email || '',
          enterpriseName,
          utmCampaign: typeof utmCampaign === 'string' ? utmCampaign : null,
          utmSource: typeof utmSource === 'string' ? utmSource : null,
          slug: slug || undefined,
          customAnswers: (customAnswers && typeof customAnswers === 'object')
            ? Object.fromEntries(
                Object.entries(customAnswers).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== ''),
              )
            : undefined,
        };

        // Telegram notification
        if (user?.telegramChatId) {
          notifyNewLead(user.telegramChatId, leadData).catch((err) => console.warn('[Public Lead] Falha na notificação:', err));
        }

        // Ntfy notification
        if (user?.ntfyTopic && user?.ntfyToken) {
          notifyNewLeadNtfy(user.ntfyTopic, user.ntfyToken, leadData).catch((err) => console.warn('[Public Lead] Falha na notificação:', err));
        }
      }).catch(() => { /* silent */ });
    }

    return NextResponse.json({
      success: true,
      isExisting: false,
      clientId: client.id,
      clientName: client.name,
      assignedUser: assignedUser?.assigned ? {
        userId: assignedUser.userId,
        userName: assignedUser.userName,
        userPhone: assignedUser.userPhone,
      } : null,
    });
  } catch (error) {
    console.error('[Public Lead] Erro:', error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'Cadastro já realizado com esses dados.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Erro interno do servidor.' }, { status: 500 });
  }
}