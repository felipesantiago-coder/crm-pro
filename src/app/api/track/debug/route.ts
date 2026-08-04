// ============================================================
// Debug / self-test endpoint for tracking pipeline (PUBLIC, no auth)
// POST: simulates a pixel event and returns detailed diagnostics
// GET:  returns a lightweight health summary (table counts + last event)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
  const ua = request.headers.get('user-agent') || 'none';
  const ct = request.headers.get('content-type') || '';

  const diagnostics: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    ip,
    userAgent: ua.substring(0, 120),
    contentType: ct,
    steps: [],
  };

  // Step 1: Parse body (same logic as main track route)
  let body: unknown;
  try {
    if (ct.includes('application/x-www-form-urlencoded')) {
      const rawBody = await request.text();
      diagnostics.rawBodyLength = rawBody.length;
      const urlParams = new URLSearchParams(rawBody);
      const dataParam = urlParams.get('data');
      if (dataParam) {
        body = JSON.parse(dataParam);
        diagnostics.parsedDataSample = JSON.stringify(body).substring(0, 500);
      } else {
        diagnostics.steps.push('FAIL: No data= parameter in URL-encoded body');
        return NextResponse.json({ status: 'error', diagnostics });
      }
    } else {
      body = await request.json();
      diagnostics.parsedDataSample = JSON.stringify(body).substring(0, 500);
    }
    diagnostics.steps.push('OK: Body parsed successfully');
  } catch (err) {
    diagnostics.steps.push(`FAIL: Parse error - ${err instanceof Error ? err.message : err}`);
    return NextResponse.json({ status: 'error', diagnostics });
  }

  // Step 2: Normalize (same logic as main track route)
  const rawEvents: unknown[] = Array.isArray(body) ? body : [body];
  const e = rawEvents[0] as Record<string, unknown> | undefined;
  const normalized = {
    visitorId: (e?.visitorId as string) || (e?.vid as string) || '',
    siteId: (e?.siteId as string) || (e?.site_id as string) || '',
    eventType: (e?.eventType as string) || (e?.event as string) || '',
    sessionId: (e?.sessionId as string) || (e?.sid as string) || '',
  };
  diagnostics.normalized = normalized;

  if (!normalized.visitorId || !normalized.siteId) {
    diagnostics.steps.push(`FAIL: Validation failed - visitorId="${normalized.visitorId}" siteId="${normalized.siteId}"`);
    return NextResponse.json({ status: 'error', diagnostics });
  }
  diagnostics.steps.push('OK: Validation passed');

  // Step 3: DB write
  try {
    await db.trackingVisitor.upsert({
      where: { visitorId: normalized.visitorId },
      create: {
        visitorId: normalized.visitorId,
        siteId: normalized.siteId,
        ip,
        userAgent: ua,
        country: null,
        city: null,
      },
      update: { ip, userAgent },
    });
    diagnostics.steps.push('OK: Visitor upserted');

    await db.trackingEvent.create({
      data: {
        visitorId: normalized.visitorId,
        sessionId: normalized.sessionId || 'debug-session',
        siteId: normalized.siteId,
        eventType: normalized.eventType || 'debug_test',
        eventName: null,
        pageUrl: '/api/track/debug',
        referrer: null,
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        utmContent: null,
        utmTerm: null,
      },
    });
    diagnostics.steps.push('OK: Event created');

    // Verify
    const [vCount, eCount] = await Promise.all([
      db.trackingVisitor.count(),
      db.trackingEvent.count(),
    ]);
    diagnostics.steps.push(`OK: Verified - ${vCount} visitors, ${eCount} events in DB`);

    return NextResponse.json({ status: 'success', diagnostics });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    diagnostics.steps.push(`FAIL: DB error - ${errMsg}`);
    return NextResponse.json({ status: 'db_error', diagnostics });
  }
}

// GET: lightweight public health (no auth required)
export async function GET() {
  try {
    const [vCount, eCount, latest] = await Promise.all([
      db.trackingVisitor.count(),
      db.trackingEvent.count(),
      db.trackingEvent.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { id: true, eventType: true, createdAt: true, visitorId: true },
      }),
    ]);
    return NextResponse.json({
      status: 'ok',
      tables: { visitors: vCount, events: eCount },
      latestEvent: latest,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { status: 'error', error: errMsg, hint: 'Tables may not exist. Run migration in Neon SQL Editor.' },
      { status: 500 },
    );
  }
}
