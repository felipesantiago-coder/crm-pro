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
