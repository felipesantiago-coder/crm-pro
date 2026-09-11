import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { buildLandingWhatsappUrl, resolveLandingMessage } from '@/lib/whatsapp-landing';

/**
 * GET /lp/{slug}/go — redirect contabilizado do botão da landing.
 *
 * Rota PÚBLICA (clique do anúncio). Incrementa a métrica de cliques e
 * redireciona (302) para wa.me com a mensagem pré-preenchida. A métrica
 * NUNCA bloqueia o lead: se o update falhar, o redirect segue igual.
 */
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { slug } = await ctx.params;
  const landing = await db.whatsAppLanding
    .findUnique({ where: { slug } })
    .catch(() => null);

  if (!landing || !landing.active) {
    // Landing inexistente/inativa: volta para a própria landing (que 404a
    // com a página de erro padrão) — sem redirect externo enganoso.
    return NextResponse.redirect(new URL(`/lp/${slug}`, req.nextUrl.origin), 302);
  }

  db.whatsAppLanding
    .update({ where: { id: landing.id }, data: { clicks: { increment: 1 } } })
    .catch(() => {});

  const waUrl = buildLandingWhatsappUrl(
    landing.phone,
    resolveLandingMessage(landing.message, landing.region),
  );
  return NextResponse.redirect(waUrl, 302);
}
