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

  // Parse body
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
  const validEvents = events.filter(isValidPayload);

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
            metadata: metadata ?? null,
          },
        });
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