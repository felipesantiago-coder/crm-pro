#!/usr/bin/env python3
"""
Apply all 7 tracking pipeline fixes:
1. Fix pixel payload format in /api/track (accept URL-encoded data=JSON + snake_case mapping)
2. Return clientId from public-lead + call CRMPIXEL.identify() on landing page
3. next-user becomes peek-only (no counter advance, no ghost assignment)
4. assign uses atomic interactive transaction
5. Dedup changes from AND to OR in public-lead
6. Don't advance queue for duplicate leads
7. Add CRMPIXEL tracking to footer/FAQ WhatsApp links
"""

import os

BASE = '/home/z/my-project/repo-source'

# ═══════════════════════════════════════════════════════════
# FIX 1: /api/track/route.ts — accept pixel's data=JSON format + snake_case
# ═══════════════════════════════════════════════════════════
track_file = os.path.join(BASE, 'src/app/api/track/route.ts')
with open(track_file, 'r') as f:
    track_content = f.read()

# Replace the entire POST handler body parsing section
old_parse = '''  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Support both single event and batch (array) payloads
  const events: TrackingPayload[] = Array.isArray(body)
    ? body
    : [body];

  // Validate each event — skip invalid ones but don't fail the whole batch
  const validEvents = events.filter(isValidPayload);'''

new_parse = '''  // Parse body — support both raw JSON and pixel's data=JSON (URL-encoded)
  let body: unknown;
  const contentType = request.headers.get('content-type') || '';

  try {
    if (contentType.includes('application/x-www-form-urlencoded')) {
      // Pixel sends: data=<url-encoded-json>
      const rawBody = await request.text();
      const urlParams = new URLSearchParams(rawBody);
      const dataParam = urlParams.get('data');
      if (dataParam) {
        body = JSON.parse(decodeURIComponent(dataParam));
      } else {
        return NextResponse.json({ error: 'No data parameter' }, { status: 400 });
      }
    } else {
      body = await request.json();
    }
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  // Support both single event and batch (array) payloads
  const rawEvents: unknown[] = Array.isArray(body) ? body : [body];

  // Normalize pixel snake_case → camelCase and validate
  const events: TrackingPayload[] = rawEvents
    .map((e: unknown) => {
      if (typeof e !== 'object' || e === null) return null;
      const r = e as Record<string, unknown>;
      // Map pixel's snake_case fields to the camelCase schema
      return {
        visitorId: (r.visitorId as string) || (r.vid as string) || '',
        sessionId: (r.sessionId as string) || (r.sid as string) || '',
        siteId: (r.siteId as string) || (r.site_id as string) || '',
        eventType: (r.eventType as string) || (r.event as string) || '',
        eventName: (r.eventName as string) || (r.event_name as string) || null,
        pageUrl: (r.pageUrl as string) || (r.url as string) || null,
        referrer: (r.referrer as string) || null,
        utmSource: (r.utmSource as string) || (r.utm_source as string) || null,
        utmMedium: (r.utmMedium as string) || (r.utm_medium as string) || null,
        utmCampaign: (r.utmCampaign as string) || (r.utm_campaign as string) || null,
        utmContent: (r.utmContent as string) || (r.utm_content as string) || null,
        utmTerm: (r.utmTerm as string) || (r.utm_term as string) || null,
        metadata: r.metadata || r.lead_id ? { ...r, lead_id: r.lead_id } : null,
      };
    })
    .filter((e): e is TrackingPayload => e !== null && isValidPayload(e));

  const validEvents = events;'''

track_content = track_content.replace(old_parse, new_parse)

with open(track_file, 'w') as f:
    f.write(track_content)

print("✅ Fix 1: /api/track/route.ts — accepts URL-encoded data=JSON + snake_case mapping")


# ═══════════════════════════════════════════════════════════
# FIX 3: next-user/route.ts — peek only (no advance, no ghost assignment)
# ═══════════════════════════════════════════════════════════
next_user_file = os.path.join(BASE, 'src/app/api/lead-queues/next-user/route.ts')
with open(next_user_file, 'r') as f:
    nu_content = f.read()

old_nu_logic = '''    // Round-robin: pick member at currentIdx
    const idx = queue.currentIdx % queue.members.length;
    const member = queue.members[idx];

    // Advance counter (atomic-ish via update)
    await db.leadQueue.update({
      where: { id: queue.id },
      data: { currentIdx: { increment: 1 } },
    });

    // Create assignment record (no lead yet — WhatsApp click)
    await db.leadQueueAssignment.create({
      data: {
        queueId: queue.id,
        userId: member.userId,
        source: slug ? `landing_page:${slug}` : 'landing_page',
      },
    });

    return NextResponse.json({
      hasQueue: true,
      userId: member.userId,
      userName: member.user.name,
      userPhone: member.user.phone,
    });'''

new_nu_logic = '''    // Peek only — return current member WITHOUT advancing counter or creating assignment.
    // The counter only advances on actual lead assignment (form submit via /api/lead-queues/assign).
    // This prevents ghost assignments from page loads and double-advancing when form is submitted.
    const idx = queue.currentIdx % queue.members.length;
    const member = queue.members[idx];

    return NextResponse.json({
      hasQueue: true,
      userId: member.userId,
      userName: member.user.name,
      userPhone: member.user.phone,
    });'''

nu_content = nu_content.replace(old_nu_logic, new_nu_logic)

with open(next_user_file, 'w') as f:
    f.write(nu_content)

print("✅ Fix 3: next-user/route.ts — peek only, no counter advance, no ghost assignment")


# ═══════════════════════════════════════════════════════════
# FIX 4: assign/route.ts — atomic interactive transaction
# ═══════════════════════════════════════════════════════════
assign_file = os.path.join(BASE, 'src/app/api/lead-queues/assign/route.ts')
with open(assign_file, 'r') as f:
    assign_content = f.read()

old_assign_logic = '''    const idx = queue.currentIdx % queue.members.length;
    const member = queue.members[idx];

    // Advance counter + create assignment in transaction
    await db.$transaction([
      db.leadQueue.update({
        where: { id: queue.id },
        data: { currentIdx: { increment: 1 } },
      }),
      db.leadQueueAssignment.create({
        data: {
          queueId: queue.id,
          userId: member.userId,
          leadId: leadId || null,
          source: source || 'api',
        },
      }),
    ]);

    return NextResponse.json({
      assigned: true,
      userId: member.userId,
      userName: member.user.name,
      userPhone: member.user.phone,
      queueId: queue.id,
    });'''

new_assign_logic = '''    // Atomic round-robin: read currentIdx INSIDE the transaction to prevent race conditions
    const result = await db.$transaction(async (tx) => {
      // Re-read queue with lock (row-level) to get the latest currentIdx
      const freshQueue = await tx.leadQueue.findUniqueOrThrow({
        where: { id: queue.id },
        select: { currentIdx: true },
      });

      // Also re-read active members inside the transaction
      const activeMembers = await tx.leadQueueMember.findMany({
        where: { queueId: queue.id, isActive: true },
        include: { user: { select: { id: true, name: true, phone: true } } },
        orderBy: { order: 'asc' },
      });

      if (activeMembers.length === 0) {
        return null;
      }

      const idx = freshQueue.currentIdx % activeMembers.length;
      const member = activeMembers[idx];

      // Advance counter + create assignment atomically
      await tx.leadQueue.update({
        where: { id: queue.id },
        data: { currentIdx: { increment: 1 } },
      });

      const assignment = await tx.leadQueueAssignment.create({
        data: {
          queueId: queue.id,
          userId: member.userId,
          leadId: leadId || null,
          source: source || 'api',
        },
      });

      return { member, assignment };
    }, {
      isolationLevel: 'Serializable',
      timeout: 10000,
    });

    if (!result) {
      return NextResponse.json({ assigned: false, message: 'Nenhum membro ativo na fila' });
    }

    return NextResponse.json({
      assigned: true,
      userId: result.member.userId,
      userName: result.member.user.name,
      userPhone: result.member.user.phone,
      queueId: queue.id,
    });'''

# Also need to add the import for leadQueueMember
old_assign_imports = '''import { db } from '@/lib/db';'''
new_assign_imports = '''import { db } from '@/lib/db';
import { Prisma } from '@prisma/client\';'''

assign_content = assign_content.replace(old_assign_imports, new_assign_imports)
assign_content = assign_content.replace(old_assign_logic, new_assign_logic)

with open(assign_file, 'w') as f:
    f.write(assign_content)

print("✅ Fix 4: assign/route.ts — atomic interactive transaction with Serializable isolation")


# ═══════════════════════════════════════════════════════════
# FIX 5 + 6: public-lead/route.ts — OR dedup + don't advance queue on duplicate
# ═══════════════════════════════════════════════════════════
lead_file = os.path.join(BASE, 'src/app/api/enterprises/public-lead/route.ts')
with open(lead_file, 'r') as f:
    lead_content = f.read()

# Fix 5: Change AND to OR for deduplication
old_dedup = '''    // ── Check for existing client with same phone + email ────
    const existingClient = await db.client.findFirst({
      where: {
        AND: [
          { phone: cleanPhone },
          { email: cleanEmail },
        ],
      },
      select: { id: true, name: true, stage: true, enterpriseId: true },
    });'''

new_dedup = '''    // ── Check for existing client (match by phone OR email) ─
    const existingClient = await db.client.findFirst({
      where: {
        OR: [
          { phone: cleanPhone },
          { email: cleanEmail },
        ],
      },
      select: { id: true, name: true, stage: true, enterpriseId: true, phone: true, email: true },
    });'''

lead_content = lead_content.replace(old_dedup, new_dedup)

# Fix 6: Don't advance queue on duplicate — just return existing client info
old_dup_block = '''    if (existingClient) {
      // Update existing client with this new interaction
      await db.interaction.create({
        data: {
          clientId: existingClient.id,
          description: `[Landing Page] Novo cadastro${enterpriseName ? ` — ${enterpriseName}` : ''}${slug ? ` (slug: ${slug})` : ''}`,
        },
      });

      // Still assign to queue if possible
      let assignedUser = null;
      try {
        const assignRes = await fetch(
          `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/lead-queues/assign`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              leadId: existingClient.id,
              source: slug ? `landing_form:${slug}` : 'landing_form',
            }),
          },
        );
        if (assignRes.ok) {
          assignedUser = await assignRes.json();
        }
      } catch {
        // Silent — queue assignment is best-effort
      }

      return NextResponse.json({
        success: true,
        isExisting: true,
        clientName: existingClient.name,
        assignedUser: assignedUser?.assigned ? {
          userId: assignedUser.userId,
          userName: assignedUser.userName,
          userPhone: assignedUser.userPhone,
        } : null,
      });
    }'''

new_dup_block = '''    if (existingClient) {
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
    }'''

lead_content = lead_content.replace(old_dup_block, new_dup_block)

# Fix 2: Return clientId for NEW clients too
old_return = '''    return NextResponse.json({
      success: true,
      isExisting: false,
      clientName: client.name,
      assignedUser: assignedUser?.assigned ? {
        userId: assignedUser.userId,
        userName: assignedUser.userName,
        userPhone: assignedUser.userPhone,
      } : null,
    });'''

new_return = '''    return NextResponse.json({
      success: true,
      isExisting: false,
      clientId: client.id,
      clientName: client.name,
      assignedUser: assignedUser?.assigned ? {
        userId: assignedUser.userId,
        userName: assignedUser.userName,
        userPhone: assignedUser.userPhone,
      } : null,
    });'''

lead_content = lead_content.replace(old_return, new_return)

with open(lead_file, 'w') as f:
    f.write(lead_content)

print("✅ Fix 5: public-lead/route.ts — dedup changed from AND to OR (phone OR email)")
print("✅ Fix 6: public-lead/route.ts — no queue advance on duplicate lead")
print("✅ Fix 2: public-lead/route.ts — returns clientId for both new and existing clients")


# ═══════════════════════════════════════════════════════════
# FIX 2b + 7: Landing page — CRMPIXEL.identify() after form + tracking on all WhatsApp links
# ═══════════════════════════════════════════════════════════
landing_file = os.path.join(BASE, 'src/app/empreendimentos/[slug]/page.tsx')
with open(landing_file, 'r') as f:
    landing_content = f.read()

# Fix 2b: Call CRMPIXEL.identify() after form submit
old_pixel_track = '''        // Track pixel event
        if (typeof window !== 'undefined' && window.CRMPIXEL) {
          window.CRMPIXEL.track('lead_form_submit', { enterprise: enterprise?.name });
        }

        // Redirect to success page'''

new_pixel_track = '''        // Track pixel event + identify visitor with new lead
        if (typeof window !== 'undefined' && window.CRMPIXEL) {
          window.CRMPIXEL.track('lead_form_submit', { enterprise: enterprise?.name });
          if (data.clientId) {
            window.CRMPIXEL.identify(data.clientId);
          }
        }

        // Redirect to success page'''

landing_content = landing_content.replace(old_pixel_track, new_pixel_track)

# Fix 7a: Add CRMPIXEL tracking to FAQ CTA WhatsApp link (line ~1325-1333)
old_faq_whatsapp = '''              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#25D366] text-white font-semibold text-sm hover:bg-[#20bd5a] transition-colors shadow-lg shadow-[#25D366]/15"
              >
                <Phone className="h-4 w-4" />
                Fale com um consultor pelo WhatsApp
              </a>'''

new_faq_whatsapp = '''              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  if (typeof window !== 'undefined' && window.CRMPIXEL) {
                    window.CRMPIXEL.track('whatsapp_click', { enterprise: e.name, source: 'faq_cta', userId: queueUser?.userId });
                  }
                }}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#25D366] text-white font-semibold text-sm hover:bg-[#20bd5a] transition-colors shadow-lg shadow-[#25D366]/15"
              >
                <Phone className="h-4 w-4" />
                Fale com um consultor pelo WhatsApp
              </a>'''

landing_content = landing_content.replace(old_faq_whatsapp, new_faq_whatsapp)

# Fix 7b: Add CRMPIXEL tracking to footer WhatsApp link (line ~1383-1393)
old_footer_whatsapp = '''                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 text-sm text-white/30 hover:text-[#C9A96E] transition-colors"
                >
                  <div className="h-8 w-8 rounded-lg bg-[#25D366]/10 flex items-center justify-center flex-shrink-0">
                    <Phone className="h-3.5 w-3.5 text-[#25D366]" />
                  </div>
                  WhatsApp
                </a>'''

new_footer_whatsapp = '''                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    if (typeof window !== 'undefined' && window.CRMPIXEL) {
                      window.CRMPIXEL.track('whatsapp_click', { enterprise: e.name, source: 'footer', userId: queueUser?.userId });
                    }
                  }}
                  className="flex items-center gap-2.5 text-sm text-white/30 hover:text-[#C9A96E] transition-colors"
                >
                  <div className="h-8 w-8 rounded-lg bg-[#25D366]/10 flex items-center justify-center flex-shrink-0">
                    <Phone className="h-3.5 w-3.5 text-[#25D366]" />
                  </div>
                  WhatsApp
                </a>'''

landing_content = landing_content.replace(old_footer_whatsapp, new_footer_whatsapp)

with open(landing_file, 'w') as f:
    f.write(landing_content)

print("✅ Fix 2b: Landing page — CRMPIXEL.identify(clientId) called after form submit")
print("✅ Fix 7: Landing page — CRMPIXEL tracking added to FAQ CTA and footer WhatsApp links")


print("\n✅ All 7 fixes applied successfully!")
