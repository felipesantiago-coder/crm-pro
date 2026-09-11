import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { WhatsAppLandingView } from './whatsapp-landing-view';

/**
 * Landing pública "Clique para Entrar" — /lp/{slug}
 *
 * Rota PÚBLICA (tráfego de anúncios Meta, sem login). A configuração
 * (região, número, mensagem) é feita pelo admin na tab Landing Pages
 * do painel Anúncios Meta. Dinâmica por natureza: mudou no admin,
 * reflete na próxima visita (proxy já envia Cache-Control must-revalidate).
 */
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

async function getLanding(slug: string) {
  try {
    return await db.whatsAppLanding.findUnique({ where: { slug } });
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const landing = await getLanding(slug);
  if (!landing || !landing.active) return { title: 'Página não encontrada' };
  return {
    title: `Clique para Entrar — Oportunidades em ${landing.region}`,
    description: `Fale agora no WhatsApp e conheça outras oportunidades na região ${landing.region}.`,
  };
}

export default async function WhatsAppLandingPage({ params }: Props) {
  const { slug } = await params;
  const landing = await getLanding(slug);
  // Landing inativa ou inexistente → 404 (o link do anúncio morre suavemente)
  if (!landing || !landing.active) notFound();
  return <WhatsAppLandingView slug={landing.slug} region={landing.region} />;
}
