import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * POST /api/lp-view — beacon público de visita da landing de WhatsApp.
 * Chamado pelo client de /lp/{slug} no mount (navigator.sendBeacon).
 * Falha em silêncio SEMPRE: métrica não pode atrapalhar a experiência.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const slug = typeof body?.slug === 'string' ? body.slug.slice(0, 200) : '';
    if (slug) {
      await db.whatsAppLanding
        .update({ where: { slug }, data: { views: { increment: 1 } } })
        .catch(() => {});
    }
  } catch {
    /* silencioso por design */
  }
  return new NextResponse(null, { status: 204 });
}
