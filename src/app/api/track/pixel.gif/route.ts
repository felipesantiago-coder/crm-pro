import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ============================================================
// Pixel Tracking Endpoint (GET)
// Returns a 1×1 transparent GIF.
// Used for email open tracking and basic image-pixel tracking.
//
// Query params:
//   v   = visitorId (required)
//   s   = siteId    (required)
//   e   = eventType (optional, defaults to "pageview")
//   c   = utmCampaign (optional)
//   sid = sessionId  (optional)
//
// The event is recorded asynchronously — the GIF is returned
// immediately to avoid delaying the caller.
// ============================================================

// 1×1 transparent GIF — 43 bytes
// Pre-computed base64 of the RLE-encoded GIF89a header + transparent pixel
const TRANSPARENT_GIF_BUFFER = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const visitorId = searchParams.get('v');
  const siteId = searchParams.get('s');
  const eventType = searchParams.get('e') || 'pageview';
  const utmCampaign = searchParams.get('c') || null;
  const sessionId = searchParams.get('sid') || null;

  // Fire-and-forget: record event asynchronously so the GIF
  // response is returned immediately without blocking.
  if (visitorId && siteId) {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      null;

    // Use setImmediate-style fire-and-forget (no await)
    recordPixelEvent({
      visitorId,
      siteId,
      sessionId,
      eventType,
      utmCampaign,
      ip,
    }).catch((err) => {
      // Swallow errors — pixel tracking is best-effort
      console.error('[Tracking/Pixel] Error recording pixel event:', err);
    });
  }

  return new NextResponse(TRANSPARENT_GIF_BUFFER, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(TRANSPARENT_GIF_BUFFER.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}

// --- Helper: upsert visitor + create event (no rate limiting for pixels) ---
async function recordPixelEvent({
  visitorId,
  siteId,
  sessionId,
  eventType,
  utmCampaign,
  ip,
}: {
  visitorId: string;
  siteId: string;
  sessionId: string | null;
  eventType: string;
  utmCampaign: string | null;
  ip: string | null;
}) {
  await db.trackingVisitor.upsert({
    where: { visitorId },
    create: {
      visitorId,
      siteId,
      ip: ip ?? undefined,
      userAgent: 'pixel',
    },
    update: {
      ip: ip ?? undefined,
      userAgent: 'pixel',
    },
  });

  await db.trackingEvent.create({
    data: {
      visitorId,
      sessionId: sessionId ?? `pixel-${Date.now()}`,
      siteId,
      eventType,
      utmCampaign,
    },
  });
}