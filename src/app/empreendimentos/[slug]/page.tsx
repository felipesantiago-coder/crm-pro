import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import LandingPageClient from './landing-page-client';
import { LandingErrorBoundary } from './landing-error-boundary';
import { peekNextUser } from '@/lib/lead-queue';
import { locales, defaultLocale, isValidLocale, ogLocale, type Locale } from '@/i18n/config';
import ptBRMessages from '@/i18n/locales/pt-BR.json';
import enMessages from '@/i18n/locales/en.json';
import esMessages from '@/i18n/locales/es.json';

// ── Static data for known slugs (fallback when DB lookup fails) ──
import enterprisesCatalog from '@/data/enterprises-catalog';

const messagesMap: Record<string, Record<string, any>> = {
  'pt-BR': ptBRMessages,
  'en': enMessages,
  'es': esMessages,
};

interface PageProps {
  params: Promise<{ slug: string }>;
}

export const dynamic = 'force-dynamic';

const ENTERPRISE_SELECT = {
  id: true, name: true, slug: true, region: true, imageUrl: true,
  landingTitle: true, landingSubtitle: true, landingDescription: true,
  cachedInfo: true, mapLatitude: true, mapLongitude: true, createdAt: true,
  _count: { select: { clients: true } },
  images: { select: { id: true, url: true, altText: true, sortOrder: true }, orderBy: { sortOrder: 'asc' } },
  floorPlans: { select: { id: true, url: true, altText: true, sortOrder: true, name: true, area: true, bedrooms: true, suites: true, hasBalcony: true, isGarden: true, isPenthouse: true, description: true }, orderBy: { sortOrder: 'asc' } },
  formFields: {
    where: { isActive: true },
    select: { id: true, label: true, fieldType: true, placeholder: true, options: true, required: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' },
  },
} as const;

function mergeCachedInfo(dbCachedInfo: any, catalog: any): any {
  if (!catalog || Object.keys(catalog).length === 0) return dbCachedInfo;
  const base = dbCachedInfo || {};
  const merged: any = { ...base };
  for (const key of ['builder', 'architecture', 'landscaping', 'status', 'deliveryDate', 'price', 'totalUnits', 'floors', 'parkingSpots', 'summary'] as const) {
    if ((merged[key] === null || merged[key] === undefined) && catalog[key] !== undefined && catalog[key] !== null) merged[key] = catalog[key];
  }
  if (catalog.location) {
    merged.location = { ...(base.location || {}) };
    for (const locKey of ['address', 'neighborhood', 'city', 'state', 'region', 'additionalInfo'] as const) {
      if ((merged.location[locKey] === null || merged.location[locKey] === undefined) && catalog.location[locKey] !== undefined) merged.location[locKey] = catalog.location[locKey];
    }
  }
  if (!Array.isArray(merged.differentials) || merged.differentials.length === 0) {
    if (Array.isArray(catalog.differentials) && catalog.differentials.length > 0) merged.differentials = catalog.differentials;
  }
  if (!Array.isArray(merged.apartmentTypes) || merged.apartmentTypes.length === 0) {
    if (Array.isArray(catalog.apartmentTypes) && catalog.apartmentTypes.length > 0) merged.apartmentTypes = catalog.apartmentTypes;
  }
  return merged;
}

async function fetchEnterpriseData(slug: string) {
  const enterprise = await db.enterprise.findUnique({
    where: { slug },
    select: ENTERPRISE_SELECT,
  });
  if (!enterprise) return null;
  const catalog = enterprisesCatalog[slug];
  if (catalog) enterprise.cachedInfo = mergeCachedInfo(enterprise.cachedInfo, catalog);
  return JSON.parse(JSON.stringify(enterprise));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;

  // Detect locale from middleware header
  const headersList = await headers();
  const xLocale = headersList.get('x-locale');
  const locale: Locale = xLocale && isValidLocale(xLocale) ? xLocale : defaultLocale;
  const msgs = messagesMap[locale];
  const seo = msgs?.seo || {};

  let enterpriseName: string | null = null;
  let enterpriseDescription: string | null = null;
  let imageUrl: string | null = null;
  try {
    const enterprise = await db.enterprise.findUnique({
      where: { slug },
      select: { name: true, landingTitle: true, landingDescription: true, imageUrl: true, cachedInfo: true, images: { select: { url: true }, orderBy: { sortOrder: 'asc' }, take: 1 } },
    });
    if (enterprise) {
      const info = enterprise.cachedInfo as Record<string, any> | null;
      enterpriseName = enterprise.landingTitle || enterprise.name;
      enterpriseDescription = enterprise.landingDescription || info?.summary || null;
      imageUrl = enterprise.imageUrl || enterprise.images[0]?.url || null;
    }
  } catch {}
  if (!enterpriseName) {
    const catalog = enterprisesCatalog[slug];
    if (catalog) { enterpriseName = catalog.summary?.split('—')[0].trim() || slug; enterpriseDescription = catalog.summary || null; }
  }
  if (!enterpriseName) return { title: seo.notFoundTitle || 'Empreendimento não encontrado' };

  const titleTemplate = seo.titleTemplate || '{name} | Empreendimentos';
  const title = titleTemplate.replace('{name}', enterpriseName);
  const descTemplate = seo.descriptionTemplate || '';
  const description = enterpriseDescription || descTemplate.replace('{name}', enterpriseName);

  // Build hreflang alternate links
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_VERCEL_URL || '';
  const path = `/empreendimentos/${slug}`;
  const alternateLanguages: Record<string, string> = {};
  for (const l of locales) {
    const prefix = l === defaultLocale ? '' : `/${l}`;
    alternateLanguages[l === 'pt-BR' ? 'pt-BR' : l] = `${baseUrl}${prefix}${path}`;
  }
  alternateLanguages['x-default'] = `${baseUrl}${path}`;

  return {
    title, description,
    alternates: {
      canonical: `${baseUrl}${path}`,
      languages: alternateLanguages,
    },
    openGraph: {
      title, description: description.slice(0, 200), type: 'website',
      locale: ogLocale[locale],
      siteName: seo.listingOgSiteName || 'Empreendimentos',
      ...(imageUrl ? { images: [{ url: imageUrl, width: 1200, height: 630, alt: enterpriseName }] } : {}),
    },
    twitter: { card: 'summary_large_image', title, description: description.slice(0, 200), ...(imageUrl ? { images: [imageUrl] } : {}) },
    robots: { index: true, follow: true },
  };
}

export default async function LandingPage({ params }: PageProps) {
  const { slug } = await params;
  const [initialData, queueUserData] = await Promise.all([
    fetchEnterpriseData(slug).catch((err) => { console.error('[LandingPage] fetchEnterpriseData failed for slug', slug, err); return null; }),
    peekNextUser({ slug }).catch(() => null),
  ]);
  const initialQueueUser = queueUserData ? { userId: queueUserData.userId, userPhone: queueUserData.userPhone } : null;
  return (
    <LandingErrorBoundary>
      <LandingPageClient params={params} initialData={initialData} initialQueueUser={initialQueueUser} />
    </LandingErrorBoundary>
  );
}
