import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveGeoIP } from '@/lib/geo-ip';
import { isLikelyBot } from '@/lib/bot-detector';

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
  // Extra pixel fields stored in metadata
  screen?: string | null;
  timezone?: string | null;
  language?: string | null;
  connection?: string | null;
  ts?: number | null;
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
  const userAgent = request.headers.get('user-agent') || null;

  // Bot filtering — silently drop bot traffic
  if (isLikelyBot(userAgent)) {
    console.log(`[Tracking] Bot dropped — ip=${ip} ua=${userAgent?.substring(0, 80)}`);
    return NextResponse.json({ status: 'ok' });
  }

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
      const rawBody = await request.text();
      const urlParams = new URLSearchParams(rawBody);
      const dataParam = urlParams.get('data');
      if (dataParam) {
        // urlParams.get() already decodes — do NOT double-decode
        body = JSON.parse(dataParam);
      } else {
        return NextResponse.json({ error: 'No data parameter' }, { status: 400 });
      }
    } else {
      body = await request.json();
    }
  } catch (parseErr) {
    console.error(`[Tracking] Parse error — ip=${ip} ct=${contentType} err=${parseErr instanceof Error ? parseErr.message : parseErr}`);
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  // Support both single event and batch (array) payloads
  const rawEvents: unknown[] = Array.isArray(body) ? body : [body];

  // Normalize pixel snake_case → camelCase, validate, and capture extra fields
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
          // Fields already mapped to top-level columns
          const mapped = new Set([
            'visitorId','vid','sessionId','sid','siteId','site_id',
            'eventType','event','eventName','event_name','pageUrl','url',
            'referrer','utmSource','utm_source','utmMedium','utm_medium',
            'utmCampaign','utm_campaign','utmContent','utm_content','utmTerm','utm_term',
            'metadata','cookie_consent',
          ]);
          const m: Record<string, unknown> = {};
          // 1) Preserve explicit metadata sub-object if present
          if (r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata)) {
            Object.assign(m, r.metadata as Record<string, unknown>);
          }
          // 2) Capture ALL remaining fields from the raw pixel payload
          for (const key of Object.keys(r)) {
            if (!mapped.has(key) && r[key] !== undefined && r[key] !== null) {
              m[key] = r[key];
            }
          }
          return Object.keys(m).length > 0 ? m : undefined;
        })(),
      };
    })
    .filter((e): e is TrackingPayload => e !== null && isValidPayload(e));

  const validEvents = events;

  if (validEvents.length === 0) {
    console.warn(`[Tracking] No valid events after normalization — ip=${ip} rawCount=${rawEvents.length}`);
    return NextResponse.json(
      { error: 'No valid events provided' },
      { status: 400 },
    );
  }

  // Check rate limit against total batch size
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

  const eventTypes = validEvents.map((e) => e.eventType);
  console.log(`[Tracking] Processing ${validEvents.length} event(s) — types=[${eventTypes.join(',')}] ip=${ip} siteId=${validEvents[0]?.siteId}`);

  try {
    // ── STEP 1: Write events to DB IMMEDIATELY (no geo-IP dependency) ──
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

        // Upsert visitor (WITHOUT geo — geo updated asynchronously below)
        await db.trackingVisitor.upsert({
          where: { visitorId },
          create: {
            visitorId,
            siteId,
            ip,
            userAgent,
            country: null,
            city: null,
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

        // Link visitor to lead on identify events
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

  // Parse and extract geo_hint from first event's metadata for Geo-IP fallback
  const geoHint = validEvents[0]?.metadata as Record<string, unknown> | undefined;
  const geoHintTz = (geoHint?.geo_hint as string) || null;

  // ── STEP 2: Resolve Geo-IP in background (fire-and-forget) ──
  // This does NOT block the response. Geo data is updated asynchronously.
  // Uses geo_hint (client timezone) as fallback when IP providers fail (e.g. IG IAB).
  const visitorIds = [...new Set(validEvents.map((e) => e.visitorId))];
  resolveGeoIP(ip, geoHintTz)
      .then((geo) => {
        if (geo.country || geo.city) {
          Promise.all(
            visitorIds.map((vid) =>
              db.trackingVisitor.update({
                where: { visitorId: vid },
                data: {
                  country: geo.country || null,
                  city: geo.city || null,
                },
              }).catch(() => {}),
            ),
          );
        }
      })
      .catch(() => {
        /* Geo-IP failed silently — visitor record already created without geo */
      });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Tracking] DB error — ip=${ip} events=${validEvents.length} err=${errMsg}`, error);
    return NextResponse.json({ status: 'partial_error' });
  }

  return NextResponse.json({ status: 'ok' });
}

// --- GET handler: health check & debug info (admin only) ---
export async function GET(request: NextRequest) {
  try {
    const { requireAdmin } = await import('@/lib/api-auth');
    const { error } = await requireAdmin();
    if (error) return error;

    const [visitorCount, eventCount, latestEvent] = await Promise.all([
      db.trackingVisitor.count(),
      db.trackingEvent.count(),
      db.trackingEvent.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true, eventType: true, createdAt: true, visitorId: true } }),
    ]);

    return NextResponse.json({
      status: 'healthy',
      tables: { visitors: visitorCount, events: eventCount },
      latestEvent,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { status: 'error', error: errMsg, hint: 'As tabelas tracking_visitors e tracking_events podem nao existir. Execute a migracao no Neon SQL Editor (console.neon.tech) ou rode npx prisma db push.' },
      { status: 500 },
    );
  }
}
