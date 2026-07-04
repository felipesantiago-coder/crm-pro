import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ============================================================
// Client-side Tracking Endpoint (PUBLIC — no auth required)
// Receives tracking events from the pixel JS on external landing pages.
// Supports both single events and batch payloads (sendBeacon).
// ============================================================

// --- In-memory rate limiter: max 100 events per minute per IP ---
const RATE_LIMIT_MAX = 100;
const RATE_WINDOW_MS = 60_000; // 1 minute

const ipCounters = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipCounters.get(ip);

  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    // Start a fresh window
    ipCounters.set(ip, { count: 1, windowStart: now });
    return false;
  }

  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

// Periodically evict stale entries to prevent memory leaks
setInterval(
  () => {
    const now = Date.now();
    for (const [ip, entry] of ipCounters) {
      if (now - entry.windowStart > RATE_WINDOW_MS) {
        ipCounters.delete(ip);
      }
    }
  },
  RATE_WINDOW_MS,
);

// --- Types ---
interface TrackingPayload {
  visitorId: string;
  sessionId: string;
  siteId: string;
  eventType: string;
  eventName?: string | null;
  pageUrl?: string | null;
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  metadata?: unknown;
}

function extractIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

function isValidPayload(data: unknown): data is TrackingPayload {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return typeof d.visitorId === 'string' && typeof d.siteId === 'string';
}

// --- POST handler ---
export async function POST(request: NextRequest) {
  const ip = extractIp(request);

  // Rate limit check
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429 },
    );
  }

  // Parse body — support both raw JSON and pixel's data=JSON (URL-encoded)
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
  const events = rawEvents
    .map((e: unknown): TrackingPayload | null => {
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
        metadata: (() => {
          // Properly merge top-level lead_id into metadata without spreading the entire event
          if (r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata)) {
            const m = { ...(r.metadata as Record<string, unknown>) };
            if (r.lead_id) m.lead_id = r.lead_id;
            return m;
          }
          if (r.lead_id) return { lead_id: r.lead_id };
          return undefined;
        })(),
      };
    })
    .filter((e): e is TrackingPayload => e !== null && isValidPayload(e));

  const validEvents = events;

  if (validEvents.length === 0) {
    return NextResponse.json(
      { error: 'No valid events provided' },
      { status: 400 },
    );
  }

  // Check rate limit against total batch size
  // (the per-event increment already happened above once; adjust for batch)
  {
    const entry = ipCounters.get(ip);
    if (entry && entry.count + validEvents.length - 1 > RATE_LIMIT_MAX) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429 },
      );
    }
    if (entry) {
      entry.count += validEvents.length - 1;
    }
  }

  const userAgent = request.headers.get('user-agent') || null;

  try {
    // Process events — upsert visitors and create events in parallel
    await Promise.all(
      validEvents.map(async (event) => {
        const {
          visitorId,
          siteId,
          sessionId,
          eventType,
          eventName,
          pageUrl,
          referrer,
          utmSource,
          utmMedium,
          utmCampaign,
          utmContent,
          utmTerm,
          metadata,
        } = event;

        // Upsert visitor (update lastSeenAt if exists)
        await db.trackingVisitor.upsert({
          where: { visitorId },
          create: {
            visitorId,
            siteId,
            ip,
            userAgent,
          },
          update: {
            ip,
            userAgent,
          },
        });

        // Create the event
        await db.trackingEvent.create({
          data: {
            visitorId,
            sessionId,
            siteId,
            eventType,
            eventName: eventName ?? null,
            pageUrl: pageUrl ?? null,
            referrer: referrer ?? null,
            utmSource: utmSource ?? null,
            utmMedium: utmMedium ?? null,
            utmCampaign: utmCampaign ?? null,
            utmContent: utmContent ?? null,
            utmTerm: utmTerm ?? null,
            metadata: (metadata ?? undefined) as any,
          },
        });

        // Link visitor to lead on identify events — enables funnel tracking (pageview → lead)
        if (eventType === 'identify') {
          const rawMeta = (metadata as Record<string, unknown>) || {};
          const leadIdValue = typeof rawMeta.lead_id === 'string' ? rawMeta.lead_id : null;
          if (leadIdValue) {
            await db.trackingVisitor.update({
              where: { visitorId },
              data: { leadId: leadIdValue },
            });
          }
        }
      }),
    );
  } catch (error) {
    console.error('[Tracking] Error processing events:', error);
    // Return 200 anyway to not block the pixel — the client already sent the data
    // but log so we can investigate
    return NextResponse.json({ status: 'partial_error' });
  }

  return NextResponse.json({ status: 'ok' });
}