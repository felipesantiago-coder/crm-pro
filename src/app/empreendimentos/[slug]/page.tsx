import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import {
  PUBLIC_ENTERPRISE_SELECT,
  buildPublicEnterprisePayload,
  resolveI18nString,
  type ComposableEnterprise,
} from '@/lib/public-enterprise-view';
import {
  servePublicEnterprise,
  createDbPublicSnapshotDeps,
} from '@/lib/public-snapshot';
import { resolvePublicEnterpriseInfo } from '@/lib/ai/enterprise-info';
import type { Enterprise as LandingEnterprise } from './landing-page-client';
import LandingPageClient from './landing-page-client';
import { LandingErrorBoundary } from './landing-error-boundary';
import { peekNextUser } from '@/lib/lead-queue';
import { locales, defaultLocale, isValidLocale, ogLocale, type Locale } from '@/i18n/config';
import ptBRMessages from '@/i18n/locales/pt-BR.json';
import enMessages from '@/i18n/locales/en.json';
import esMessages from '@/i18n/locales/es.json';

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
// leitura do banco a cada request.
//
// Fase 7: a leitura passa pelo snapshot público versionado
// (src/lib/public-snapshot.ts) — o frescor continua POR REQUEST (digital
// baseUpdatedAt/publishedVersion verificada a cada request; divergiu →
// recomposição IMEDIATA no mesmo request), mas o caminho feliz serve um
// payload pré-composto (2 queries leves em vez de 1 query pesada com
// pdfContent + 3 subselects). Fila (peekNextUser) fica FORA do snapshot —
// por request. Publish/restore/pdf/PATCH mudam updatedAt (@updatedAt) e/ou
// publishedVersion → digital diverge → recompute; mutações de tabelas
// filhas (imagens/plantas/formFields/slug) invalidam explicitamente.
export const dynamic = 'force-dynamic';

/**
 * Composição canônica (caminho de miss do snapshot) — mesma query da
 * pré-Fase 7, com a resolução delegada à lib view (fonte única de
 * composição; antes duplicada aqui e na API pública).
 */
async function fetchEnterpriseData(slug: string, locale: string) {
  const enterprise = await db.enterprise.findUnique({
    where: { slug },
    select: PUBLIC_ENTERPRISE_SELECT,
  });
  if (!enterprise) return null;
  return buildPublicEnterprisePayload(enterprise as ComposableEnterprise, locale);
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
      select: { name: true, landingTitle: true, landingDescription: true, imageUrl: true, pdfContent: true, publishedInfo: true, publishedAt: true, publishedVersion: true, verifiedInfo: true, verifiedInfoAt: true, images: { select: { url: true }, orderBy: { sortOrder: 'asc' }, take: 1 } },
    });
    if (enterprise) {
      // §12-v2 rev. Task 41: sem info aprovada com base presente, a página
      // pública NÃO EXISTE (notFound no body) — metadados coerentes: título
      // de não-encontrado + noindex. Nada do empreendimento vaza (nem nome,
      // nem descrição curada, nem resumo da cadeia órfã).
      const resolved = resolvePublicEnterpriseInfo(enterprise, { requireBaseDocument: true });
      if (resolved.source === 'none') {
        return {
          title: seo.notFoundTitle || 'Empreendimento não encontrado',
          robots: { index: false, follow: false },
        };
      }
      const info = resolved.info as Record<string, any> | null;
      // Casts locais: colunas Json do Prisma (landingTitle/Description) —
      // resolveI18nString da lib view tipa estritamente Record<string,string>.
      enterpriseName =
        resolveI18nString(enterprise.landingTitle as Record<string, string> | null, locale) ||
        enterprise.name;
      enterpriseDescription =
        info?.summary ||
        resolveI18nString(enterprise.landingDescription as Record<string, string> | null, locale) ||
        null;
      imageUrl = enterprise.imageUrl || enterprise.images[0]?.url || null;
    }
  } catch {}
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
  const [served, queueUserData] = await Promise.all([
    servePublicEnterprise(createDbPublicSnapshotDeps(db), { slug, locale }).catch((err) => {
      console.error('[LandingPage] servePublicEnterprise failed for slug', slug, err);
      return null;
    }),
    // Fila NUNCA é cacheada — atribuição dinâmica por request (§Fase 7).
    peekNextUser({ slug }).catch(() => null),
  ]);
  // §12-v2 rev. Task 41 ("ela somente exiba as informações da extração e
  // edição mais recente das informações da base de dados"): sem extração
  // aprovada COM base documental, a página pública do empreendimento NÃO
  // EXISTE — 404 por request (renderização dinâmica: o administrador publica
  // e a página volta no próximo acesso; remove a base e ela some).
  // Fase 7: o gate fica na compose — served null cobre slug inexistente E
  // info 'none' (antes: slugs inexistentes renderizavam página vazia; agora
  // 404, coerente com a API pública e com o generateMetadata).
  const initialData = served?.payload ?? null;
  if (!initialData) {
    notFound();
  }
  const initialQueueUser = queueUserData ? { userId: queueUserData.userId, userPhone: queueUserData.userPhone } : null;
  return (
    <LandingErrorBoundary>
      {/* Cast de fronteira: o payload do snapshot é Record<string, unknown>
          (JSON puro da fonte única public-enterprise-view); o client tipa
          localmente a shape que consome. Equivalente tipado do
          JSON.parse(...): any que servia o initialData antes da Fase 7. */}
      <LandingPageClient
        params={params}
        initialData={initialData as unknown as LandingEnterprise}
        initialQueueUser={initialQueueUser}
      />
    </LandingErrorBoundary>
  );
}
