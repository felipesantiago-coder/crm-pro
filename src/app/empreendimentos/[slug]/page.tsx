import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { resolvePublicEnterpriseInfo, mergePublicInfoWithCatalog } from '@/lib/ai/enterprise-info';
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

// CORREÇÃO (2026-09, "seção pública desatualizada"): o ISR de 60s aqui era
// ilusório — o uso de headers() nesta rota já força renderização dinâmica —
// e, pior, não oferecia garantia de frescor caso a rota deixasse de ser
// dinâmica. Regra §12: atualização de base publicada deve refletir
// OBRIGATORIAMENTE nas superfícies públicas → renderização sempre dinâmica,
// leitura direta do banco a cada request.
export const dynamic = 'force-dynamic';

const ENTERPRISE_SELECT = {
  id: true, name: true, slug: true, region: true, imageUrl: true,
  landingTitle: true, landingSubtitle: true, landingDescription: true,
  cachedInfo: true, mapLatitude: true, mapLongitude: true, createdAt: true,
  publishedInfo: true, publishedAt: true, publishedVersion: true,
  verifiedInfo: true, verifiedInfoAt: true,
  _count: { select: { clients: true } },
  images: { select: { id: true, url: true, altText: true, sortOrder: true }, orderBy: { sortOrder: 'asc' } },
  floorPlans: { select: { id: true, url: true, altText: true, sortOrder: true, name: true, area: true, bedrooms: true, suites: true, hasBalcony: true, isGarden: true, isPenthouse: true, description: true }, orderBy: { sortOrder: 'asc' } },
  formFields: {
    where: { isActive: true },
    select: { id: true, label: true, fieldType: true, placeholder: true, options: true, required: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' },
  },
} as const;

// mergeCachedInfo foi unificado em mergePublicInfoWithCatalog
// (src/lib/ai/enterprise-info.ts) — mesma semântica para TODAS as superfícies
// públicas, sem risco de divergência entre listagem e landing.

function resolveI18nString(field: any, locale: string): string | null {
  if (!field || typeof field !== 'object') return typeof field === 'string' ? field : null;
  return field[locale] || field['pt-BR'] || Object.values(field)[0] || null;
}

async function fetchEnterpriseData(slug: string, locale: string) {
  const enterprise = await db.enterprise.findUnique({
    where: { slug },
    select: { ...ENTERPRISE_SELECT, cachedInfoI18n: true } as any,
  });
  if (!enterprise) return null;

  // ── Fase 5 (§12): o público consome publicado → verificado → legado.
  // Rascunhos (extractionDraft) NUNCA são públicos. O resultado é exposto
  // na propriedade `cachedInfo` como camada de compatibilidade temporária,
  // marcada com `infoSource` para telemetria de dependência legada.
  const resolved = resolvePublicEnterpriseInfo(enterprise as any);
  enterprise.cachedInfo = resolved.info as any;
  const infoSource = resolved.source;
  const infoReferenceDate = resolved.referenceDate;

  const catalog = enterprisesCatalog[slug];
  if (catalog) enterprise.cachedInfo = mergePublicInfoWithCatalog(enterprise.cachedInfo, catalog) as any;

  // Resolve i18n string fields → flat string for client
  const raw = enterprise as any;
  raw.landingTitle = resolveI18nString(raw.landingTitle, locale);
  raw.landingSubtitle = resolveI18nString(raw.landingSubtitle, locale);
  raw.landingDescription = resolveI18nString(raw.landingDescription, locale);

  // Resolve cachedInfo i18n: merge translated locale over base
  if (locale !== 'pt-BR' && raw.cachedInfoI18n && raw.cachedInfoI18n[locale]) {
    raw.cachedInfo = { ...(raw.cachedInfo || {}), ...raw.cachedInfoI18n[locale] };
  }
  delete raw.cachedInfoI18n;
  delete raw.publishedInfo;
  delete raw.verifiedInfo;
  raw.infoSource = infoSource;
  raw.infoReferenceDate = infoReferenceDate;

  return JSON.parse(JSON.stringify(raw));
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
      select: { name: true, landingTitle: true, landingDescription: true, cachedInfoI18n: true, imageUrl: true, cachedInfo: true, images: { select: { url: true }, orderBy: { sortOrder: 'asc' }, take: 1 } },
    });
    if (enterprise) {
      const info = enterprise.cachedInfo as Record<string, any> | null;
      enterpriseName = resolveI18nString(enterprise.landingTitle, locale) || enterprise.name;
      enterpriseDescription = resolveI18nString(enterprise.landingDescription, locale) || (locale !== 'pt-BR' && enterprise.cachedInfoI18n?.[locale] as any)?.summary || info?.summary || null;
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
  const headersList = await headers();
  const xLocale = headersList.get('x-locale');
  const locale: Locale = xLocale && isValidLocale(xLocale) ? xLocale : defaultLocale;
  const [initialData, queueUserData] = await Promise.all([
    fetchEnterpriseData(slug, locale).catch((err) => { console.error('[LandingPage] fetchEnterpriseData failed for slug', slug, err); return null; }),
    peekNextUser({ slug }).catch(() => null),
  ]);
  const initialQueueUser = queueUserData ? { userId: queueUserData.userId, userPhone: queueUserData.userPhone } : null;
  return (
    <LandingErrorBoundary>
      <LandingPageClient params={params} initialData={initialData} initialQueueUser={initialQueueUser} />
    </LandingErrorBoundary>
  );
}
