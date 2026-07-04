import type { Metadata } from 'next';
import { db } from '@/lib/db';
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
        name: true,
        landingTitle: true,
        landingDescription: true,
        imageUrl: true,
        cachedInfo: true,
        images: {
          select: { url: true },
          orderBy: { sortOrder: 'asc' },
          take: 1,
        },
      },
    });

    if (enterprise) {
      const info = enterprise.cachedInfo as Record<string, any> | null;
      enterpriseName = enterprise.landingTitle || enterprise.name;
      enterpriseDescription = enterprise.landingDescription
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