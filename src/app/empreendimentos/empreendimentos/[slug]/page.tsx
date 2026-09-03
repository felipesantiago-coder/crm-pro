import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { resolvePublicEnterpriseInfo } from '@/lib/ai/enterprise-info';
import LandingPageClient from './landing-page-client';

// ── Static data for known slugs (fallback when DB lookup fails) ──
import enterprisesCatalog from '@/data/enterprises-catalog';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;

  let enterpriseName: string | null = null;
  let enterpriseDescription: string | null = null;
  let imageUrl: string | null = null;

  try {
    const enterprise = await db.enterprise.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        landingTitle: true,
        landingDescription: true,
        imageUrl: true,
        cachedInfo: true,
        publishedInfo: true,
        publishedAt: true,
        publishedVersion: true,
        verifiedInfo: true,
        verifiedInfoAt: true,
        images: {
          select: { url: true },
          orderBy: { sortOrder: 'asc' },
          take: 1,
        },
      },
    });

    if (enterprise) {
      // Fase 5 (§12): metadados também consomem somente publicado/verificado.
      const resolved = resolvePublicEnterpriseInfo(enterprise);
      const info = resolved.info as Record<string, any> | null;
      // landingTitle/landingDescription are now JSONB { locale: string }
      const titleObj = typeof enterprise.landingTitle === 'object' && enterprise.landingTitle
        ? enterprise.landingTitle as Record<string, string> : null;
      const descObj = typeof enterprise.landingDescription === 'object' && enterprise.landingDescription
        ? enterprise.landingDescription as Record<string, string> : null;
      enterpriseName = titleObj?.['pt-BR'] || Object.values(titleObj || {})[0] || enterprise.name;
      enterpriseDescription = descObj?.['pt-BR'] || Object.values(descObj || {})[0]
        || info?.summary
        || null;
      imageUrl = enterprise.imageUrl
        || enterprise.images[0]?.url
        || null;
    }
  } catch {
    // Fallback to static catalog
  }

  // Fallback to static catalog if DB lookup failed
  if (!enterpriseName) {
    const catalog = enterprisesCatalog[slug];
    if (catalog) {
      enterpriseName = catalog.summary?.split('—')[0].trim() || slug;
      enterpriseDescription = catalog.summary || null;
    }
  }

  if (!enterpriseName) {
    return { title: 'Empreendimento não encontrado' };
  }

  const title = `${enterpriseName} | Empreendimentos`;
  const description = enterpriseDescription
    || `Conheça o empreendimento ${enterpriseName}. Plantas exclusivas, lazer completo e condições especiais. Cadastre-se e fale com um consultor.`;

  const metadata: Metadata = {
    title,
    description,
    openGraph: {
      title,
      description: description.slice(0, 200),
      type: 'website',
      locale: 'pt_BR',
      siteName: 'Empreendimentos',
      ...(imageUrl ? { images: [{ url: imageUrl, width: 1200, height: 630, alt: enterpriseName }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: description.slice(0, 200),
      ...(imageUrl ? { images: [imageUrl] } : {}),
    },
    robots: { index: true, follow: true },
  };

  return metadata;
}

export default function LandingPage({ params }: PageProps) {
  return <LandingPageClient params={params} />;
}