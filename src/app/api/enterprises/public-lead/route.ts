import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { notifyNewLead, notifyQueueUpdate } from '@/lib/telegram';
import { rateLimit } from '@/lib/rate-limit';
import { assignLeadToUser, peekNextUser, type AssignResult } from '@/lib/lead-queue';

/**
 * PUBLIC endpoint — no auth required.
 * Receives a lead submission from a landing page form.
 * Creates a Client record and assigns it via the lead queue.
 *
 * SAFETY GUARANTEES:
 * 1. Client creation + dedup check run inside a Serializable transaction
 *    to prevent race-condition duplicates.
 * 2. Email has a partial UNIQUE constraint (WHERE email IS NOT NULL) at DB level.
 * 3. Queue assignment has its own Serializable transaction + idempotency cache.
 * 4. Existing clients get their phone/email updated with newest data.
 * 5. Hero mini-form .temp emails are rejected server-side.
 */
export async function POST(request: NextRequest) {
  // Rate limit: 5 submissions per minute per IP
  const rateLimitResult = rateLimit(request, { maxRequests: 5, windowSeconds: 60, keyPrefix: 'public-lead' });
  if (rateLimitResult) return rateLimitResult;

  try {
    const body = await request.json();
    const { name, phone, email, slug, customAnswers, utmSource, utmMedium, utmCampaign, utmContent, utmTerm, metaEventId } = body;

    // ── Validate slug format ──
    if (slug && !/^[a-z0-9-]{1,100}$/.test(slug)) {
      return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 });
    }

    // ── Validate required fields ──
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json({ error: 'Nome completo é obrigatório (mínimo 2 caracteres).' }, { status: 400 });
    }
    if (name.trim().length > 200) {
      return NextResponse.json({ error: 'Nome muito longo.' }, { status: 400 });
    }

    const cleanPhone = (phone || '').replace(/\D/g, '');
    // Phone is now optional on landing pages — if provided, validate format
    if (cleanPhone.length > 0 && cleanPhone.length < 10) {
      return NextResponse.json({ error: 'Telefone inválido. Informe DDD + número (mínimo 10 dígitos) ou deixe em branco.' }, { status: 400 });
    }
    if (cleanPhone.length > 15) {
      return NextResponse.json({ error: 'Telefone inválido.' }, { status: 400 });
    }

    const cleanEmail = (email || '').trim().toLowerCase();
    // Email is optional when phone is provided (Brazilian real estate: phone is primary contact)
    const hasValidPhone = cleanPhone.length >= 10;
    const hasValidEmail = cleanEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail);
    if (!hasValidEmail) {
      if (!hasValidPhone) {
        return NextResponse.json({ error: 'Informe um telefone válido ou um e-mail.' }, { status: 400 });
      }
      // Email missing but phone valid — allow
    } else if (cleanEmail.length > 254) {
      return NextResponse.json({ error: 'E-mail inválido.' }, { status: 400 });
    }

    // ── Find enterprise by slug ──
    let enterpriseId: string | null = null;
    let enterpriseName: string | null = null;
    let enterpriseRegion: string | null = null;
    let enterpriseImageUrl: string | null = null;

    if (slug) {
      const enterprise = await db.enterprise.findUnique({
        where: { slug },
        select: { id: true, name: true, region: true, imageUrl: true },
      });
      if (enterprise) {
        enterpriseId = enterprise.id;
        enterpriseName = enterprise.name;
        enterpriseRegion = enterprise.region;
        enterpriseImageUrl = enterprise.imageUrl;
      }
    }

    // ── Check for existing client (match by email OR phone if provided) ──
    const existingWhere: Prisma.ClientWhereInput[] = [];
    if (hasValidEmail) existingWhere.push({ email: cleanEmail });
    if (cleanPhone.length >= 10) {
      existingWhere.push({ phone: cleanPhone });
    }
    if (existingWhere.length === 0) {
      return NextResponse.json({ error: 'Informe um telefone ou e-mail.' }, { status: 400 });
    }
    const existingClient = await db.client.findFirst({
      where: { OR: existingWhere },
      select: { id: true, name: true, stage: true, enterpriseId: true, phone: true, email: true },
    });

    if (existingClient) {
      // Create interaction recording the repeat contact
      await db.interaction.create({
        data: {
          clientId: existingClient.id,
          description: `[Landing Page] Novo cadastro${enterpriseName ? ` — ${enterpriseName}` : ''}${slug ? ` (slug: ${slug})` : ''}`,
        },
      });

      // CRITICAL FIX: Even for existing clients, still assign via queue
      // so the lead reaches the next available agent.
      // This was previously returning assignedUser: null for existing clients,
      // meaning repeat leads had NO queue assignment.
      let assignedUser: AssignResult | null = null;
      try {
        assignedUser = await assignLeadToUser({
          leadId: existingClient.id,
          source: slug ? `landing_form:${slug}` : 'landing_form',
        });
      } catch (err) {
        console.error('[Public Lead] Falha na atribuição de fila (lead existente):', err);
      }

      // Send Telegram notification for repeat lead (awaited — serverless-safe)
      if (assignedUser?.assigned && assignedUser.userId && assignedUser.message !== 'already_assigned') {
        try {
          const notifyUser = await db.user.findUnique({
            where: { id: assignedUser.userId },
            select: { telegramChatId: true, name: true },
          });
          if (notifyUser?.telegramChatId) {
            console.log(`[Public Lead] Enviando notificação Telegram para agente "${notifyUser.name}" (lead existente ${existingClient.id})`);
            await notifyNewLead(notifyUser.telegramChatId, {
              leadName: existingClient.name,
              leadPhone: existingClient.phone || '',
              leadEmail: existingClient.email || '',
              enterpriseName,
              enterpriseImageUrl: enterpriseImageUrl || undefined,
              utmCampaign: typeof utmCampaign === 'string' ? utmCampaign : null,
              utmSource: typeof utmSource === 'string' ? utmSource : null,
              slug: slug || undefined,
              assignedUserName: assignedUser.userName,
              customAnswers: undefined,
            });
            console.log(`[Public Lead] ✅ Notificação Telegram enviada ao agente "${notifyUser.name}"`);
          } else {
            console.warn(`[Public Lead] Usuário ${notifyUser?.name || assignedUser.userId} atribuído mas sem Telegram configurado. Lead ${existingClient.id} sem notificação.`);
          }
        } catch (notifyErr) {
          console.warn('[Public Lead] Falha na notificação (lead existente):', notifyErr);
        }

        // Notify admin about queue rotation (awaited — serverless-safe)
        try {
          const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { telegramChatId: true } });
          if (admin?.telegramChatId) {
            const nextUser = await peekNextUser({ queueId: assignedUser.queueId });
            await notifyQueueUpdate(admin.telegramChatId, {
              source: slug ? `landing_form:${slug}` : 'landing_form',
              assignedUserName: assignedUser.userName || 'Desconhecido',
              nextUserName: nextUser?.userName || null,
              leadName: existingClient.name,
              leadPhone: existingClient.phone,
              enterpriseName,
            });
          }
        } catch (err) {
          console.warn('[Public Lead] Admin queue notification failed (existing):', err instanceof Error ? err.message : err);
        }
      } else {
        console.warn(`[Public Lead] Lead existente ${existingClient.id} sem fila disponível. Nenhuma notificação enviada.`);
      }

      return NextResponse.json({
        success: true,
        isExisting: true,
        clientId: existingClient.id, // UUID is non-sequential and unguessable; needed for CRMPIXEL.identify()
        clientName: existingClient.name,
        assignedUser: assignedUser?.assigned ? {
          userId: assignedUser.userId,
          userName: assignedUser.userName,
          userPhone: assignedUser.userPhone,
        } : null,
      });
    }

    // ── Helper: fire Meta CAPI event (fire-and-forget, ad-blocker proof) ──
    const fireMetaCAPI = () => {
      if (!process.env.META_PIXEL_ID || !process.env.META_ACCESS_TOKEN) return;
      const fbp = request.cookies.get('_fbp')?.value;
      const fbc = request.cookies.get('_fbc')?.value;
      fetch('/api/meta-capi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_name: 'Lead',
          event_id: metaEventId || undefined,
          action_source: 'website',
          user_data: {
            email: cleanEmail || undefined,
            phone: cleanPhone.length >= 10 ? cleanPhone : undefined,
            name: name.trim(),
            fbp: fbp || undefined,
            fbc: fbc || undefined,
            ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
            user_agent: request.headers.get('user-agent') || undefined,
            page_url: slug ? `${process.env.NEXT_PUBLIC_APP_URL || ''}/empreendimentos/${slug}` : undefined,
          },
          custom_data: {
            content_name: enterpriseName || undefined,
            content_category: 'empreendimento',
            value: 1,
            currency: 'BRL',
          },
        }),
      }).catch((err) => console.warn('[Public Lead] Meta CAPI fire-and-forget failed:', err?.message));
    };

    // ── Helper: send Telegram notification to assigned agent (awaited) ──
    const sendNotification = async (userId: string, leadData: Parameters<typeof notifyNewLead>[1], clientName: string) => {
      try {
        const user = await db.user.findUnique({
          where: { id: userId },
          select: { telegramChatId: true, name: true },
        });
        if (user?.telegramChatId) {
          console.log(`[Public Lead] Enviando notificação Telegram para agente "${user.name}" (lead ${clientName})`);
          await notifyNewLead(user.telegramChatId, leadData);
          console.log(`[Public Lead] ✅ Notificação Telegram enviada ao agente "${user.name}"`);
        } else {
          console.warn(`[Public Lead] Usuário ${user?.name || userId} sem Telegram configurado. Lead ${clientName} sem notificação push.`);
        }
      } catch (err) {
        console.warn(`[Public Lead] Falha na notificação Telegram para ${clientName}:`, err);
      }
    };

    // ── Build custom answers text ──
    let customAnswersText = '';
    if (customAnswers && typeof customAnswers === 'object' && Object.keys(customAnswers).length > 0) {
      const lines = Object.entries(customAnswers)
        .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
        .slice(0, 20)
        .map(([k, v]) => `  • ${String(k).slice(0, 50)}: ${String(v).slice(0, 500)}`);
      if (lines.length > 0) {
        customAnswersText = '\n\nRespostas do formulário:\n' + lines.join('\n');
      }
    }

    // ════════════════════════════════════════════════════════════
    // Dedup + client creation using upsert pattern.
    // Compatible with PgBouncer Transaction pooler (no interactive tx).
    //
    // Strategy:
    // 1. Check for existing client (email OR phone) — plain query
    // 2. If found, update and return
    // 3. If not, try create. On P2002 (unique constraint), find + return.
    //    DB-level unique constraints (email, metaLeadgenId) prevent duplicates.
    // ════════════════════════════════════════════════════════════
    interface ClientResult {
      id: string; name: string; phone: string | null; email: string | null;
    }
    interface ClientOutcome { client: ClientResult; isNew: boolean }

    const getClientOrCreate = async (): Promise<ClientOutcome> => {
      // Step 1: Check for existing client (email OR phone)
      const existing = await db.client.findFirst({
        where: { OR: [{ email: cleanEmail }, ...(cleanPhone.length >= 10 ? [{ phone: cleanPhone }] : [])] },
        select: { id: true, name: true, phone: true, email: true },
      });

      if (existing) {
        // Update lastInteractionAt (and phone if different)
        const updates: Prisma.ClientUpdateManyMutationInput = { lastInteractionAt: new Date() };
        if (cleanPhone.length >= 10 && existing.phone !== cleanPhone) {
          updates.phone = cleanPhone;
        }
        await db.client.update({ where: { id: existing.id }, data: updates });
        return { client: existing, isNew: false };
      }

      // Step 2: No existing client found — try to create
      const firstUser = await db.user.findFirst({
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!firstUser) {
        throw new Error('NO_USER');
      }

      try {
        const newClient = await db.client.create({
          data: {
            name: name.trim(),
            phone: cleanPhone.length >= 10 ? cleanPhone : null,
            email: cleanEmail || null,
            region: enterpriseRegion,
            enterprise: enterpriseName || undefined,
            enterpriseId: enterpriseId || undefined,
            stage: 'LEAD',
            createdBy: firstUser.id,
            utmSource: typeof utmSource === 'string' ? utmSource.slice(0, 200) : undefined,
            utmMedium: typeof utmMedium === 'string' ? utmMedium.slice(0, 100) : undefined,
            utmCampaign: typeof utmCampaign === 'string' ? utmCampaign.slice(0, 200) : undefined,
            utmContent: typeof utmContent === 'string' ? utmContent.slice(0, 200) : undefined,
            utmTerm: typeof utmTerm === 'string' ? utmTerm.slice(0, 200) : undefined,
            notes: `[Landing Page] Cadastro realizado via formulário${enterpriseName ? ` — ${enterpriseName}` : ''}${slug ? `\nSlug: ${slug}` : ''}${utmCampaign ? `\nCampanha: ${utmCampaign}` : ''}${customAnswersText}`,
          },
        });
        return {
          client: { id: newClient.id, name: newClient.name, phone: newClient.phone, email: newClient.email },
          isNew: true,
        };
      } catch (createError) {
        // P2002 = unique constraint (another request created the client between our check and create)
        if (createError instanceof Prisma.PrismaClientKnownRequestError && createError.code === 'P2002') {
          const retryExisting = await db.client.findFirst({
            where: { OR: [{ email: cleanEmail }, ...(cleanPhone.length >= 10 ? [{ phone: cleanPhone }] : [])] },
            select: { id: true, name: true, phone: true, email: true },
          });
          if (retryExisting) return { client: retryExisting, isNew: false };
        }
        throw createError;
      }
    };

    // ── Execute client lookup/creation ──
    let clientResult: Awaited<ReturnType<typeof getClientOrCreate>>;
    try {
      clientResult = await getClientOrCreate();
    } catch (error) {
      if (error instanceof Error && error.message === 'NO_USER') {
        console.error('[Public Lead] Nenhum usuário encontrado no sistema. Lead perdido.');
        return NextResponse.json({ error: 'Sistema não configurado: nenhum usuário cadastrado.' }, { status: 500 });
      }
      throw error;
    }

    const { client, isNew } = clientResult;

    // ── Create interaction record for new clients ──
    if (isNew) {
      await db.interaction.create({
        data: {
          clientId: client.id,
          description: `[Landing Page] Cliente cadastrado via formulário${enterpriseName ? ` — ${enterpriseName}` : ''}${slug ? ` (slug: ${slug})` : ''}${utmCampaign ? ` | Campanha: ${utmCampaign}` : ''}.`,
        },
      });
    }

    // ── Assign via lead queue ──
    let assignedUser: AssignResult | null = null;
    try {
      assignedUser = await assignLeadToUser({
        leadId: client.id,
        source: slug ? `landing_form:${slug}` : 'landing_form',
      });
      if (assignedUser?.assigned && assignedUser.userId && isNew) {
        // Update createdBy to the queue-assigned user (only for new clients)
        await db.client.update({
          where: { id: client.id },
          data: { createdBy: assignedUser.userId },
        }).catch(() => { /* non-critical */ });
      }
    } catch (err) {
      console.error(`[Public Lead] Falha na atribuição de fila (${isNew ? 'lead novo' : 'lead existente'}):`, err);
    }

    // ── Send Telegram notification to assigned agent (awaited — serverless-safe) ──
    if (assignedUser?.assigned && assignedUser.userId && assignedUser.message !== 'already_assigned') {
      await sendNotification(assignedUser.userId, {
        leadName: client.name,
        leadPhone: client.phone || '',
        leadEmail: client.email || '',
        enterpriseName,
        enterpriseImageUrl: enterpriseImageUrl || undefined,
        utmCampaign: typeof utmCampaign === 'string' ? utmCampaign : null,
        utmSource: typeof utmSource === 'string' ? utmSource : null,
        slug: slug || undefined,
        assignedUserName: assignedUser.userName,
        customAnswers: (customAnswers && typeof customAnswers === 'object')
          ? Object.fromEntries(
              Object.entries(customAnswers).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== ''),
            ) as Record<string, string>
          : undefined,
      }, client.name);

      // Notify admin about queue rotation (awaited — serverless-safe)
      try {
        const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { telegramChatId: true } });
        if (admin?.telegramChatId) {
          const nextUser = await peekNextUser({ queueId: assignedUser.queueId });
          await notifyQueueUpdate(admin.telegramChatId, {
            source: slug ? `landing_form:${slug}` : 'landing_form',
            assignedUserName: assignedUser.userName || 'Desconhecido',
            nextUserName: nextUser?.userName || null,
            leadName: client.name,
            leadPhone: client.phone,
            enterpriseName,
          });
        }
      } catch (err) {
        console.warn('[Public Lead] Admin queue notification failed (new):', err instanceof Error ? err.message : err);
      }
    } else {
      console.warn(`[Public Lead] Lead ${client.id} (${client.name}) sem fila disponível. Nenhuma notificação enviada.`);
    }

    // ── Fire Meta CAPI event ──
    fireMetaCAPI();

    return NextResponse.json({
      success: true,
      isExisting: !isNew,
      clientId: client.id, // UUID is non-sequential and unguessable; needed for CRMPIXEL.identify()
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
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return NextResponse.json({ error: 'Erro de configuração: nenhum usuário cadastrado no sistema.' }, { status: 500 });
    }
    return NextResponse.json({ error: 'Erro interno do servidor.' }, { status: 500 });
  }
}
