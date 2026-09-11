/**
 * public-enterprise-view.ts — composição ÚNICA do payload público do
 * empreendimento (Fase 7 da otimização Vercel).
 *
 * Antes desta lib, a mesma composição (gate §12-v2 → resolução i18n →
 * merge de tradução) existia DUPLICADA na landing SSR
 * (/empreendimentos/[slug]/page.tsx) e na API pública
 * (/api/enterprises/public/[slug]) — com divergências (a API vaza
 * pdfContent; a SSR mantém pdfContent no initialData). Com o snapshot
 * versionado, a composição passou a ter UM terceiro consumidor (o
 * builder do snapshot) — duplicação em 3 lugares é divergência
 * garantida. Toda superfície pública consome `buildPublicEnterprisePayload`.
 *
 * GARANTIAS do payload (§Fase 7 do prompt):
 *   - NUNCA inclui: pdfContent (documento interno — hoje vaza no
 *     initialData e na resposta da API), extractionDraft (rascunho),
 *     publishedInfo/verifiedInfo brutos, cachedInfoI18n (i18n interno),
 *     documentHash, PII de contato, dados de fila (peekNextUser fica
 *     FORA do payload — por request na SSR).
 *   - SEMPRE resolve i18n por locale com fallback pt-BR (landingTitle/
 *     Subtitle/Description + mergePublicInfoI18n da ficha).
 *   - Mantém o gate §12-v2: sem info aprovada com base documental
 *     presente → null (a chamadora aplica 404).
 */
import {
  resolvePublicEnterpriseInfo,
  mergePublicInfoI18n,
  type PublicEnterpriseSource,
} from '@/lib/ai/enterprise-info';

/** Locales suportados pelas superfícies públicas (src/i18n/config.ts). */
export const PUBLIC_LOCALES = ['pt-BR', 'en', 'es'] as const;
export type PublicLocale = (typeof PUBLIC_LOCALES)[number];

export function isValidPublicLocale(value: string): value is PublicLocale {
  return (PUBLIC_LOCALES as readonly string[]).includes(value);
}

/**
 * Resolução de string i18n ({ "pt-BR": "...", "en": "..." } → string).
 * Fallback: locale pedido → pt-BR → primeiro valor disponível.
 * DEDUPE: havia uma cópia byte a byte na SSR e outra na API pública.
 */
export function resolveI18nString(
  field: Record<string, string> | null | undefined,
  locale: string,
): string | null {
  if (!field || typeof field !== 'object') {
    return typeof field === 'string' ? (field as string) : null;
  }
  return field[locale] || field['pt-BR'] || Object.values(field)[0] || null;
}

/**
 * Select canônico da composição — o MESMO que SSR e API pública usavam
 * (com _count, imagens, plantas e formFields ativos ordenados).
 * pdfContent entra no SELECT porque o gate §12-v2 precisa da presença da
 * base documental — mas NUNCA sai no payload (buildPublicEnterprisePayload).
 */
export const PUBLIC_ENTERPRISE_SELECT = {
  id: true,
  name: true,
  slug: true,
  region: true,
  imageUrl: true,
  landingTitle: true,
  landingSubtitle: true,
  landingDescription: true,
  cachedInfo: true,
  mapLatitude: true,
  mapLongitude: true,
  createdAt: true,
  // Gate (presença) — removido do payload.
  pdfContent: true,
  // Fonte da info pública + digital de frescor.
  publishedInfo: true,
  publishedAt: true,
  publishedVersion: true,
  verifiedInfo: true,
  verifiedInfoAt: true,
  // Traduções da ficha (merge por locale) — removidas do payload.
  cachedInfoI18n: true,
  _count: { select: { clients: true } },
  images: {
    select: { id: true, url: true, altText: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' as const },
  },
  floorPlans: {
    select: {
      id: true, url: true, altText: true, sortOrder: true, name: true,
      area: true, bedrooms: true, suites: true, hasBalcony: true,
      isGarden: true, isPenthouse: true, description: true,
    },
    orderBy: { sortOrder: 'asc' as const },
  },
  formFields: {
    where: { isActive: true },
    select: {
      id: true,
      label: true,
      fieldType: true,
      placeholder: true,
      options: true,
      required: true,
      sortOrder: true,
    },
    orderBy: { sortOrder: 'asc' as const },
  },
} as const;

/** Forma aceita pela composição (payload Prisma com Date ou ISO strings). */
export type ComposableEnterprise = PublicEnterpriseSource & {
  id?: string;
  name?: string;
  slug?: string | null;
  region?: string | null;
  imageUrl?: string | null;
  landingTitle?: unknown;
  landingSubtitle?: unknown;
  landingDescription?: unknown;
  cachedInfo?: unknown;
  cachedInfoI18n?: unknown;
  mapLatitude?: number | null;
  mapLongitude?: number | null;
  createdAt?: Date | string | null;
  _count?: { clients: number };
  images?: unknown[];
  floorPlans?: unknown[];
  formFields?: unknown[];
};

/**
 * Compõe o payload público FINAL (mesma shape consumida pela landing e
 * pela API pública). Retorna null quando o empreendimento não tem info
 * pública exibível (source 'none' — gate §12-v2): a chamadora aplica 404.
 *
 * Este retorno é EXATAMENTE o que vai no snapshot (payload) — JSON puro,
 * sem Date (createdAt/publishedAt viram ISO string na referência).
 */
export function buildPublicEnterprisePayload(
  enterprise: ComposableEnterprise,
  locale: string,
): Record<string, unknown> | null {
  // Gate §12-v2 (revisão Task 41): público consome APENAS publicado →
  // verificado, e SOMENTE com base documental presente. Sem isso, a
  // página pública NÃO EXISTE → a chamadora aplica 404.
  const resolved = resolvePublicEnterpriseInfo(
    enterprise as Record<string, unknown> & { id: string },
    { requireBaseDocument: true },
  );
  if (resolved.source === 'none') return null;

  const info = resolved.info as Record<string, unknown> | null;

  // i18n de campos curados: { locale → string } com fallback pt-BR.
  const landingTitle = resolveI18nString(
    enterprise.landingTitle as Record<string, string> | null,
    locale,
  );
  const landingSubtitle = resolveI18nString(
    enterprise.landingSubtitle as Record<string, string> | null,
    locale,
  );
  const landingDescription = resolveI18nString(
    enterprise.landingDescription as Record<string, string> | null,
    locale,
  );

  // i18n da ficha: tradução do locale sobre a base APROVADA — a tradução
  // NUNCA ressuscita dado (info null → merge devolve null).
  const mergedInfo = mergePublicInfoI18n(
    info,
    enterprise.cachedInfoI18n,
    locale,
  );

  return {
    id: enterprise.id ?? null,
    name: enterprise.name ?? null,
    slug: enterprise.slug ?? null,
    region: enterprise.region ?? null,
    imageUrl: enterprise.imageUrl ?? null,
    landingTitle,
    landingSubtitle,
    landingDescription,
    // cachedInfo é a camada de compatibilidade consumida pelo client
    // (histórico: painel legado e fallback público).
    cachedInfo: mergedInfo,
    mapLatitude: enterprise.mapLatitude ?? null,
    mapLongitude: enterprise.mapLongitude ?? null,
    createdAt: enterprise.createdAt
      ? new Date(enterprise.createdAt).toISOString()
      : null,
    _count: enterprise._count ?? { clients: 0 },
    images: enterprise.images ?? [],
    floorPlans: enterprise.floorPlans ?? [],
    formFields: enterprise.formFields ?? [],
    infoSource: resolved.source,
    infoReferenceDate: resolved.referenceDate,
    // NOTA: pdfContent/publishedInfo/verifiedInfo/cachedInfoI18n/
    // extractionDraft/documentHash DELIBERADAMENTE ausentes — ver
    // GARANTIAS no cabeçalho deste arquivo.
  };
}
