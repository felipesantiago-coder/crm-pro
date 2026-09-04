/**
 * enterprise-info.ts — Fonte única de dados de empreendimento para
 * superfícies públicas (prompt v1.0 §12 — Fase 5, rev. 2026 §12-v2).
 *
 * POLÍTICA §12-v2 ("a base de dados é a única fonte da verdade pública"):
 *   1. publishedInfo  — extração + edição mais recente APROVADA e publicada;
 *   2. verifiedInfo   — aprovada no admin, ainda não publicada;
 *   NADA MAIS é público:
 *   - cachedInfo legado NUNCA mais alimenta superfícies públicas (eram dados
 *     de extrações antigas/edição manual desconectada — fonte do bug
 *     "preço público ≠ base enviada");
 *   - o catálogo estático (@/data/enterprises-catalog) NUNCA mais preenche
 *     campos públicos (valores hardcodados antigos);
 *   - SEM base documental (pdfContent), NADA é exibido publicamente — mesmo
 *     com publishedInfo remanescente no banco (a base foi a fonte daqueles
 *     dados; removida a fonte, removem-se os dados do público).
 *
 * O rascunho de extração (extractionDraft) NUNCA é público.
 */
import { enterpriseInfoSchema, type EnterpriseInfo } from './contracts';

export type PublicInfoSource = 'published' | 'verified' | 'none';

export interface ResolvedPublicInfo {
  info: EnterpriseInfo | null;
  source: PublicInfoSource;
  /** Data de referência para campos voláteis (§12: "Valores consultados em …"). */
  referenceDate: string | null;
  version: number;
}

/** Forma flexível — aceita payloads Prisma (Date|null) e objetos SSR. */
export interface PublicEnterpriseSource {
  id?: string;
  /** Conteúdo da base documental (PDF/Markdown/TXT) — gate da visibilidade pública. */
  pdfContent?: string | null;
  publishedInfo?: unknown;
  publishedAt?: Date | string | null;
  publishedVersion?: number | null;
  verifiedInfo?: unknown;
  verifiedInfoAt?: Date | string | null;
}

export interface ResolvePublicInfoOptions {
  /**
   * §12-v2: quando true (SUPERFÍCIES PÚBLICAS), exige base documental
   * presente (pdfContent). Base removida → nada é público. Padrão: false
   * (uso interno/administrativo, ex. metadados de preview).
   */
  requireBaseDocument?: boolean;
}

/**
 * Gate §12-v2 — presença real de base documental. String vazia/só espaços
 * conta como ausente. Fonte única para o resolver público, a restauração de
 * versões e o painel administrativo (mesma régua em toda a aplicação).
 */
export function hasBaseDocument(pdfContent: unknown): boolean {
  return typeof pdfContent === 'string' && pdfContent.trim().length > 0;
}

export function resolvePublicEnterpriseInfo(
  enterprise: PublicEnterpriseSource,
  options: ResolvePublicInfoOptions = {},
): ResolvedPublicInfo {
  const none: ResolvedPublicInfo = { info: null, source: 'none', referenceDate: null, version: 0 };

  // Gate §12-v2: sem base documental, o público não exibe NADA — mesmo que
  // publishedInfo/verifiedInfo permaneçam no banco (eram derivados da base).
  if (options.requireBaseDocument && !hasBaseDocument(enterprise.pdfContent)) {
    return none;
  }

  // 1. Publicado — extração + edição mais recente aprovada pelo admin
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
    console.warn('[Enterprise Info] verifiedInfo inválido — nada público é exibido (política §12-v2)');
  }

  return none;
}

/** Campos voláteis que recebem data de referência no público (§12). */
export const VOLATILE_PUBLIC_FIELDS = ['price', 'deliveryDate'] as const;
