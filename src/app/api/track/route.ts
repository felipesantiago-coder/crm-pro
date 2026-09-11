import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveGeoIP } from '@/lib/geo-ip';
import { isLikelyBot } from '@/lib/bot-detector';
import {
  TRACK_MAX_BODY_BYTES,
  TRACK_MAX_EVENTS_PER_BATCH,
  normalizeBatch,
  writeEventBatch,
} from '@/lib/track-ingest';
import { consumeRateLimit } from '@/lib/track-rate-limit';

// ============================================================
// Client-side Tracking Endpoint (PUBLIC — no auth required)
// Receives tracking events from the pixel JS on external landing pages.
// Supports both single events and batch payloads (sendBeacon).
//
// Fase 6 (otimização Vercel):
//  - limite de corpo por bytes (413) e de quantidade de eventos/lote;
//  - validação de tamanho de strings/metadata (lib track-ingest);
//  - escrita particionada com concorrência limitada (chunks sequenciais);
//  - rate limit DISTRIBUÍDO (tracking_rate_limit, statement atômico
//    pooler-safe) com fallback in-memory — lib track-rate-limit;
//  - Geo-IP assíncrono com timeout e cache limitado (lib geo-ip).
// Contratos preservados: sendBeacon (urlencoded data=), identify/UTM/
// consentimento, eventos válidos, {status:'ok'|'partial_error'}, 429.
// ============================================================

function extractIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
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

  // ── Limite de corpo por bytes (header + tamanho real lido) ──
  const declaredLength = Number(request.headers.get('content-length') || '0');
  if (Number.isFinite(declaredLength) && declaredLength > TRACK_MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: 'Payload too large' },
      { status: 413 },
    );
  }

  // Parse body — support both raw JSON and pixel's data=JSON (URL-encoded)
  let body: unknown;
  let rawLength = 0;
  const contentType = request.headers.get('content-type') || '';

  try {
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const rawBody = await request.text();
      rawLength = rawBody.length;
      const urlParams = new URLSearchParams(rawBody);
      const dataParam = urlParams.get('data');
      if (dataParam) {
        // urlParams.get() already decodes — do NOT double-decode
        body = JSON.parse(dataParam);
      } else {
        return NextResponse.json({ error: 'No data parameter' }, { status: 400 });
      }
    } else {
      const rawBody = await request.text();
      rawLength = rawBody.length;
      body = JSON.parse(rawBody);
    }
  } catch (parseErr) {
    console.error(`[Tracking] Parse error — ip=${ip} ct=${contentType} err=${parseErr instanceof Error ? parseErr.message : parseErr}`);
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  if (rawLength > TRACK_MAX_BODY_BYTES) {
    console.warn(`[Tracking] Body over byte limit — ip=${ip} bytes=${rawLength}`);
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  // ── Normalização + limites (eventos, strings, metadata) ──
  const { events: validEvents, stats } = normalizeBatch(body, TRACK_MAX_EVENTS_PER_BATCH);

  if (validEvents.length === 0) {
    console.warn(`[Tracking] No valid events after normalization — ip=${ip} rawCount=${stats.received}`);
    return NextResponse.json(
      { error: 'No valid events provided' },
      { status: 400 },
    );
  }

  if (stats.received > stats.kept) {
    console.warn(
      `[Tracking] Batch over event limit — ip=${ip} received=${stats.received} kept=${stats.kept}`,
    );
  }

  // ── Rate limit DISTRIBUÍDO por eventos consumidos (1 statement) ──
  const decision = await consumeRateLimit({ db }, ip, validEvents.length);
  if (decision.limited) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429 },
    );
  }

  const eventTypes = validEvents.map((e) => e.eventType);
  console.log(
    `[Tracking] Processing ${validEvents.length} event(s) — types=[${eventTypes.join(',')}] ip=${ip} siteId=${validEvents[0]?.siteId} mode=${decision.mode}`,
  );

  // ── Escrita particionada (chunks sequenciais, concorrência limitada) ──
  let written = 0;
  let failed = 0;
  try {
    const result = await writeEventBatch(validEvents, { db, ip, userAgent });
    written = result.written;
    failed = result.failed;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Tracking] DB error — ip=${ip} events=${validEvents.length} err=${errMsg}`, error);
    return NextResponse.json({ status: 'partial_error' });
  }

  if (failed > 0) {
    console.error(`[Tracking] Partial write failure — ip=${ip} written=${written} failed=${failed}`);
    return NextResponse.json({ status: 'partial_error' });
  }

  // Parse and extract geo_hint from first event's metadata for Geo-IP fallback
  const geoHint = validEvents[0]?.metadata as Record<string, unknown> | undefined;
  const geoHintTz = (geoHint?.geo_hint as string) || null;

  // ── Geo-IP resolve in background (fire-and-forget, timeout + cache
  // limitado na lib) — geo data is updated asynchronously. ──
  if (written > 0) {
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
  }

  // Campos aditivos (pixel só lê 2xx — contratos preservados)
  return NextResponse.json({
    status: 'ok',
    received: stats.received,
    accepted: stats.kept,
    ...(stats.truncatedMetadata > 0 ? { truncatedMetadata: stats.truncatedMetadata } : {}),
  });
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
      { status: 'error', error: errMsg, hint: 'As tabelas tracking_visitors e tracking_events podem nao existir. Execute a migracao no Supabase SQL Editor (dashboard.supabase.com) ou rode npm run db:deploy.' },
      { status: 500 },
    );
  }
}
