/**
 * enterprise-info.ts — Fonte única de dados de empreendimento para
 * superfícies públicas (prompt v1.0 §12 — Fase 5).
 *
 * Cadeia de consumo:
 *   1. publishedInfo  — versão publicada (canônica, com data de referência);
 *   2. verifiedInfo   — aprovada no admin, ainda não publicada;
 *   3. cachedInfo     — LEGADO (rascunhos antigos/edição manual). Nunca
 *      expõe rascunho de extração (extractionDraft NUNCA é público).
 *
 * O consumo legado é sinalizado para telemetria (identificar páginas ainda
 * dependentes do legado — §12 migração segura item 5).
 */
import { enterpriseInfoSchema, type EnterpriseInfo } from './contracts';

export type PublicInfoSource = 'published' | 'verified' | 'legacy_cached' | 'none';

export interface ResolvedPublicInfo {
  info: EnterpriseInfo | null;
  source: PublicInfoSource;
  /** Data de referência para campos voláteis (§12: "Valores consultados em …"). */
  referenceDate: string | null;
  version: number;
}

/** Throttle de telemetria legada por processo (1 por empreendimento/hora). */
const legacyLogThrottle = new Map<string, number>();
const LEGACY_LOG_TTL_MS = 60 * 60 * 1000;

/** Forma flexível — aceita payloads Prisma (Date|null) e objetos SSR. */
export interface PublicEnterpriseSource {
  id?: string;
  publishedInfo?: unknown;
  publishedAt?: Date | string | null;
  publishedVersion?: number | null;
  verifiedInfo?: unknown;
  verifiedInfoAt?: Date | string | null;
  cachedInfo?: unknown;
}

export function resolvePublicEnterpriseInfo(enterprise: PublicEnterpriseSource): ResolvedPublicInfo {
  // 1. Publicado
  if (enterprise.publishedInfo) {
    const parsed = enterpriseInfoSchema.safeParse(enterprise.publishedInfo);
    if (parsed.success) {
      return {
        info: parsed.data,
        source: 'published',
        referenceDate: enterprise.publishedAt ? new Date(enterprise.publishedAt).toISOString() : null,
        version: enterprise.publishedVersion ?? 0,
      };
    }
    console.warn('[Enterprise Info] publishedInfo inválido — caindo para verified (nada público é corrompido)');
  }

  // 2. Verificado
  if (enterprise.verifiedInfo) {
    const parsed = enterpriseInfoSchema.safeParse(enterprise.verifiedInfo);
    if (parsed.success) {
      return {
        info: parsed.data,
        source: 'verified',
        referenceDate: enterprise.verifiedInfoAt ? new Date(enterprise.verifiedInfoAt).toISOString() : null,
        version: 0,
      };
    }
    console.warn('[Enterprise Info] verifiedInfo inválido — caindo para legado');
  }

  // 3. Legado (com telemetria throttled)
  if (enterprise.cachedInfo) {
    const parsed = enterpriseInfoSchema.safeParse(enterprise.cachedInfo);
    if (parsed.success) {
      const key = enterprise.id ?? 'unknown';
      const now = Date.now();
      const last = legacyLogThrottle.get(key);
      if (!last || now - last > LEGACY_LOG_TTL_MS) {
        legacyLogThrottle.set(key, now);
        console.info(`[Enterprise Info] LEGADO em uso (published/verified ausentes) enterpriseId=${key} — revise e publique a versão verificada`);
      }
      return {
        info: parsed.data,
        source: 'legacy_cached',
        referenceDate: null,
        version: 0,
      };
    }
  }

  return { info: null, source: 'none', referenceDate: null, version: 0 };
}

/** Campos voláteis que recebem data de referência no público (§12). */
export const VOLATILE_PUBLIC_FIELDS = ['price', 'deliveryDate'] as const;

/**
 * Subconjunto estrutural do catálogo estático (@/data/enterprises-catalog).
 * Declarado aqui (em vez de importar o módulo de dados) para manter esta
 * lib livre de dependência de dados e testável isoladamente.
 */
export interface CatalogFallbackEntry {
  location?: {
    address?: string | null;
    neighborhood?: string | null;
    city?: string | null;
    state?: string | null;
    region?: string | null;
    additionalInfo?: string | null;
  };
  builder?: string | null;
  architecture?: string | null;
  landscaping?: string | null;
  status?: string | null;
  deliveryDate?: string | null;
  price?: string | null;
  totalUnits?: number | null;
  floors?: number | null;
  parkingSpots?: number | null;
  differentials?: string[];
  apartmentTypes?: Array<{
    name: string;
    area?: string | null;
    bedrooms?: string | null;
    description?: string | null;
    price?: string | null;
  }>;
  summary?: string | null;
}

/**
 * mergePublicInfoWithCatalog — fallback ÚNICO do catálogo estático, compartilhado
 * por TODAS as superfícies públicas (landing SSR, API /public/[slug] e listagem
 * /public-list). Semântica: o dado do banco (publicado → verificado → legado) é
 * SEMPRE a fonte primária; o catálogo preenche APENAS campos nulos/ausentes.
 *
 * Regra §12 ("atualização de base reflete obrigatoriamente no público"): como o
 * valor do banco vence quando existe, nenhuma edição publicada pode ser
 * mascarada pelo catálogo estático.
 */
export function mergePublicInfoWithCatalog(
  info: unknown,
  catalog: CatalogFallbackEntry | null | undefined,
): Record<string, unknown> | null {
  if (!catalog || Object.keys(catalog).length === 0) {
    return (info && typeof info === 'object' ? (info as Record<string, unknown>) : (info as null));
  }

  const base: Record<string, unknown> = (info && typeof info === 'object' ? { ...(info as Record<string, unknown>) } : {});
  const merged: Record<string, unknown> = { ...base };

  // Campos simples — o valor do banco vence quando não-nulo; catálogo preenche nulos
  for (const key of ['builder', 'architecture', 'landscaping', 'status', 'deliveryDate', 'price', 'totalUnits', 'floors', 'parkingSpots', 'summary'] as const) {
    if ((merged[key] === null || merged[key] === undefined) && catalog[key] !== undefined && catalog[key] !== null) {
      merged[key] = catalog[key];
    }
  }

  // Location — preenchimento campo a campo
  if (catalog.location) {
    const baseLoc = (base.location && typeof base.location === 'object' ? base.location : {}) as Record<string, unknown>;
    const mergedLocation: Record<string, unknown> = { ...baseLoc };
    for (const locKey of ['address', 'neighborhood', 'city', 'state', 'region', 'additionalInfo'] as const) {
      if ((mergedLocation[locKey] === null || mergedLocation[locKey] === undefined) && catalog.location[locKey] !== undefined && catalog.location[locKey] !== null) {
        mergedLocation[locKey] = catalog.location[locKey];
      }
    }
    merged.location = mergedLocation;
  }

  // Arrays — catálogo entra somente se o banco não tiver arranjo não-vazio
  if (!Array.isArray(merged.differentials) || merged.differentials.length === 0) {
    if (Array.isArray(catalog.differentials) && catalog.differentials.length > 0) {
      merged.differentials = catalog.differentials;
    }
  }
  if (!Array.isArray(merged.apartmentTypes) || merged.apartmentTypes.length === 0) {
    if (Array.isArray(catalog.apartmentTypes) && catalog.apartmentTypes.length > 0) {
      merged.apartmentTypes = catalog.apartmentTypes;
    }
  }

  return merged;
}
