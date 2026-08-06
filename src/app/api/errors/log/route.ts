import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';

/**
 * Lightweight client-side error logger.
 * Receives JS errors from landing pages via fetch or sendBeacon.
 * No authentication required (public endpoint) — rate-limited by IP.
 */

interface ErrorPayload {
  type: 'js_error' | 'promise_rejection' | 'react_error';
  message: string;
  source?: string;
  lineNumber?: number;
  colNumber?: number;
  stackTrace?: string;
  pageUrl?: string;
  userAgent?: string;
  slug?: string;
}

export async function POST(request: NextRequest) {
  // Rate limit: max 30 error logs per minute per IP
  const limited = rateLimit(request, {
    maxRequests: 30,
    windowSeconds: 60,
    keyPrefix: 'ERROR_LOG',
  });
  if (limited) {
    // Return 200 silently — don't give attackers feedback
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  try {
    let body: ErrorPayload;

    // sendBeacon sends as Blob — may need text parsing
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      body = await request.json();
    } else {
      // Fallback for sendBeacon with text/plain or other
      const text = await request.text();
      try {
        body = JSON.parse(text);
      } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
      }
    }

    // Basic validation
    if (!body.type || !body.message) {
      return NextResponse.json({ error: 'Missing type or message' }, { status: 400 });
    }

    const validTypes = ['js_error', 'promise_rejection', 'react_error'];
    if (!validTypes.includes(body.type)) {
      body.type = 'js_error';
    }

    await db.clientErrorLog.create({
      data: {
        type: body.type,
        message: String(body.message).substring(0, 2000),
        source: body.source ? String(body.source).substring(0, 500) : null,
        lineNumber: body.lineNumber ?? null,
        colNumber: body.colNumber ?? null,
        stackTrace: body.stackTrace ? String(body.stackTrace).substring(0, 5000) : null,
        pageUrl: body.pageUrl ? String(body.pageUrl).substring(0, 500) : null,
        userAgent: body.userAgent ? String(body.userAgent).substring(0, 500) : null,
        slug: body.slug ? String(body.slug).substring(0, 200) : null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[ErrorLog] Failed to persist error log:', error);
    // Always return 200 to not break the client
    return NextResponse.json({ ok: true });
  }
}
