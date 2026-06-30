import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ============================================================
// Server-side Tracking Endpoint
// Called from landing page backends when a form is submitted.
// Authenticated via x-tracking-key header compared against
// env var TRACKING_SERVER_KEY (default: "crm-tracking-2024").
//
// If leadId is provided, the TrackingVisitor is linked to the lead.
// Returns the created event and visitor info for confirmation.
// ============================================================

const TRACKING_SERVER_KEY = process.env.TRACKING_SERVER_KEY || 'crm-tracking-2024';

// --- Types ---
interface ServerTrackingPayload {
  siteId: string;
  visitorId?: string | null;
  sessionId?: string | null;
  eventType: string;
  eventName?: string | null;
  pageUrl?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  leadId?: string | null;
  metadata?: unknown;
}

function isValidPayload(data: unknown): data is ServerTrackingPayload {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return typeof d.siteId === 'string' && typeof d.eventType === 'string';
}

// --- POST handler ---
export async function POST(request: NextRequest) {
  // 1. Authenticate via API key
  const providedKey = request.headers.get('x-tracking-key');
  if (!providedKey || providedKey !== TRACKING_SERVER_KEY) {
    return NextResponse.json(
      { error: 'Invalid or missing tracking key' },
      { status: 401 },
    );
  }

  // 2. Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!isValidPayload(body)) {
    return NextResponse.json(
      { error: 'Missing required fields: siteId and eventType' },
      { status: 400 },
    );
  }

  const {
    siteId,
    visitorId: rawVisitorId,
    sessionId,
    eventType,
    eventName,
    pageUrl,
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
    leadId,
    metadata,
  } = body;

  // Generate a visitor ID if not provided
  const visitorId = rawVisitorId || `srv-${crypto.randomUUID()}`;

  // Derive IP from headers (best-effort on server-to-server)
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    null;

  try {
    // 3. Upsert visitor, optionally linking to a lead
    const visitor = await db.trackingVisitor.upsert({
      where: { visitorId },
      create: {
        visitorId,
        siteId,
        leadId: leadId ?? null,
        ip,
        userAgent: 'server-side',
      },
      update: {
        ip,
        userAgent: 'server-side',
        ...(leadId ? { leadId } : {}),
      },
    });

    // 4. Create the tracking event
    const event = await db.trackingEvent.create({
      data: {
        visitorId,
        sessionId: sessionId || `srv-session-${Date.now()}`,
        siteId,
        eventType,
        eventName: eventName ?? null,
        pageUrl: pageUrl ?? null,
        referrer: null,
        utmSource: utmSource ?? null,
        utmMedium: utmMedium ?? null,
        utmCampaign: utmCampaign ?? null,
        utmContent: utmContent ?? null,
        utmTerm: utmTerm ?? null,
        metadata: metadata ?? null,
      },
    });

    return NextResponse.json({
      status: 'ok',
      event: {
        id: event.id,
        eventType: event.eventType,
        eventName: event.eventName,
        createdAt: event.createdAt,
      },
      visitor: {
        visitorId: visitor.visitorId,
        siteId: visitor.siteId,
        leadId: visitor.leadId,
        firstSeenAt: visitor.firstSeenAt,
        lastSeenAt: visitor.lastSeenAt,
      },
    });
  } catch (error) {
    console.error('[Tracking/Server] Error processing server event:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}