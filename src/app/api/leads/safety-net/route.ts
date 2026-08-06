import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';

/**
 * PUBLIC — no auth required.
 * Safety net endpoint for sendBeacon (page close) and retry queue.
 * Stores raw form data so the admin can recover leads that failed to register.
 *
 * Accepts both JSON (from retry queue) and FormData/URL-encoded (from sendBeacon).
 */
export async function POST(request: NextRequest) {
  // Rate limit: 30 per minute per IP (beacon + retries)
  const rateLimitResult = rateLimit(request, { maxRequests: 30, windowSeconds: 60, keyPrefix: 'safety-net' });
  if (rateLimitResult) return rateLimitResult;

  try {
    let name: string | undefined;
    let phone: string | undefined;
    let email: string | undefined;
    let slug: string | undefined;
    let source = 'beacon';
    let formData: Record<string, unknown> | undefined;
    let utmSource: string | undefined;
    let utmMedium: string | undefined;
    let utmCampaign: string | undefined;
    let utmContent: string | undefined;
    let utmTerm: string | undefined;

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      // From retry queue or fetch
      const body = await request.json();
      name = typeof body.name === 'string' ? body.name.slice(0, 200) : undefined;
      phone = typeof body.phone === 'string' ? body.phone.slice(0, 20) : undefined;
      email = typeof body.email === 'string' ? body.email.slice(0, 254) : undefined;
      slug = typeof body.slug === 'string' ? body.slug.slice(0, 100) : undefined;
      source = typeof body.source === 'string' ? body.source.slice(0, 50) : 'retry_queue';
      formData = body.formData && typeof body.formData === 'object' ? body.formData : undefined;
      utmSource = typeof body.utmSource === 'string' ? body.utmSource.slice(0, 200) : undefined;
      utmMedium = typeof body.utmMedium === 'string' ? body.utmMedium.slice(0, 100) : undefined;
      utmCampaign = typeof body.utmCampaign === 'string' ? body.utmCampaign.slice(0, 200) : undefined;
      utmContent = typeof body.utmContent === 'string' ? body.utmContent.slice(0, 200) : undefined;
      utmTerm = typeof body.utmTerm === 'string' ? body.utmTerm.slice(0, 200) : undefined;
    } else {
      // From sendBeacon (typically URL-encoded or FormData)
      const text = await request.text();
      // Try to parse as URL-encoded
      const params = new URLSearchParams(text);
      name = params.get('name')?.slice(0, 200) || undefined;
      phone = params.get('phone')?.slice(0, 20) || undefined;
      email = params.get('email')?.slice(0, 254) || undefined;
      slug = params.get('slug')?.slice(0, 100) || undefined;
      source = params.get('source')?.slice(0, 50) || 'beacon';
      utmSource = params.get('utmSource')?.slice(0, 200) || undefined;
      utmMedium = params.get('utmMedium')?.slice(0, 100) || undefined;
      utmCampaign = params.get('utmCampaign')?.slice(0, 200) || undefined;
      utmContent = params.get('utmContent')?.slice(0, 200) || undefined;
      utmTerm = params.get('utmTerm')?.slice(0, 200) || undefined;

      // If formData was sent as JSON string in a param
      const formDataStr = params.get('formData');
      if (formDataStr) {
        try { formData = JSON.parse(formDataStr); } catch { /* ignore */ }
      }
    }

    // Only store if there's at least some useful data
    if (!name && !email && !phone) {
      return NextResponse.json({ saved: false, reason: 'no_data' });
    }

    const userAgent = request.headers.get('user-agent')?.slice(0, 500) || null;

    await db.lostLead.create({
      data: {
        name: name || null,
        phone: phone || null,
        email: email || null,
        slug: slug || null,
        source,
        formData: formData ? JSON.parse(JSON.stringify(formData)) : undefined,
        userAgent,
        utmSource,
        utmMedium,
        utmCampaign,
        utmContent,
        utmTerm,
      },
    });

    return NextResponse.json({ saved: true });
  } catch (error) {
    console.error('[Safety Net] Erro:', error);
    return NextResponse.json({ saved: false, error: 'Erro interno' }, { status: 500 });
  }
}
