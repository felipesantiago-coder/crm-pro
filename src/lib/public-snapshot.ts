/**
 * public-snapshot.ts — snapshot público versionado da landing (Fase 7).
 *
 * PROMPT §Fase 7: "As páginas públicas devem continuar mostrando
 * publicação aprovada atualizada imediatamente. Implemente, se
 * comprovadamente seguro, um snapshot público versionado com tags por
 * slug/locale e invalidação no publish/unpublish. Nunca cacheie draft,
 * PII ou dados de fila."
 *
 * DESIGN — "invalidação por construção" (prova de cobertura):
 *   O snapshot carrega uma IMPRESSÃO DIGITAL de frescor capturada na
 *   composição: (baseUpdatedAt = Enterprise.updatedAt, version =
 *   publishedVersion). Toda mutação que afeta as superfícies públicas do
 *   empreendimento passa por db.enterprise.update — e o Prisma
 *   (@updatedAt) recarrega updatedAt AUTOMATICAMENTE, inclusive em rotas
 *   futuras/desconhecidas e em mutações administrativas diretas. A
 *   digital divergir → recomposição imediata no request seguinte:
 *     - publish (extraction/publish)      → updatedAt + publishedVersion
 *     - restore (extraction/restore)      → idem
 *     - upload/remoção de base ([id]/pdf) → updatedAt (e cadeia resetada
 *       quando primeira base → compose devolve null → 404 imediato)
 *     - PATCH [id] / catalog / web-enrich / update-cached-info → updatedAt
 *   Mutações de TABELAS FILHAS (não tocam updatedAt do pai) recebem
 *   INVALIDAÇÃO EXPLÍCITA via invalidatePublicSnapshotsForEnterprise:
 *     - images POST/PUT/DELETE (galeria/hero)
 *     - floor-plans CRUD + upload-image (plantas)
 *     - form-fields CRUD (campos do formulário público)
 *     - landing-slug (mudança de slug — espelho da chave de leitura)
 *   Rede de segurança: TTL (default 300s) — mesmo que uma invalidação
 *   escape, o snapshot expira e recomcompõe.
 *
 * DECISÃO EXPLÍCITA — revalidateTag/unstable_cache REJEITADOS: a leitura
 * pública é force-dynamic direto do banco (regra §12: frescor
 * obrigatório); o cache de dados do Next não cobre esse caminho sem
 * reescrever a renderização e não é verificável por contrato aqui. A
 * digital em BANCO é testável (node:test), observável e independe do
 * ciclo de vida do cache da plataforma.
 *
 * NUNCA cacheado: peekNextUser (fila — por request), draft, PII,
 * pdfContent (payload da compose já exclui — ver public-enterprise-view).
 *
 * DEGRADAÇÃO AUTOMÁTICA: tabela ausente (P2021/P2022) ou QUALQUER erro no
 * caminho do snapshot → composição dinâmica atual (comportamento pré-
 * Fase 7) com WARN único. A migration pode ser aplicada antes OU depois
 * do deploy — o release nunca quebra a página pública.
 *
 * REVERSÃO INSTANTÂNEA: PUBLIC_SNAPSHOT_V2=legacy (+ redeploy) desliga o
 * snapshot — composição dinâmica direta (doc/rollback.md §3).
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  PUBLIC_ENTERPRISE_SELECT,
  buildPublicEnterprisePayload,
  type ComposableEnterprise,
} from '@/lib/public-enterprise-view';

/** Snapshot LIGADO por default; PUBLIC_SNAPSHOT_V2=legacy desliga. */
export function isPublicSnapshotV2Enabled(): boolean {
  return process.env.PUBLIC_SNAPSHOT_V2 !== 'legacy';
}

/** TTL de segurança do snapshot (segundos) — clamp 30..3600, default 300. */
export function publicSnapshotTtlSeconds(): number {
  const raw = Number(process.env.PUBLIC_SNAPSHOT_TTL_SECONDS);
  if (!Number.isFinite(raw)) return 300;
  return Math.min(3600, Math.max(30, Math.round(raw)));
}

// ── Tipos do caminho de dados (DI estrutural — padrão MetaIngestDb/
//    AssignDb: sem cast, fakes de teste implementam a mesma shape) ──

/** Impressão digital de frescor lida do enterprise (1 query leve). */
export interface EnterpriseFreshness {
  id: string;
  updatedAt: Date;
  publishedVersion: number;
}

/** Linha do snapshot relevante ao serve (payload + digital + idade). */
export interface PublicSnapshotRow {
  payload: unknown;
  baseUpdatedAt: Date;
  version: number;
  refreshedAt: Date;
}

export interface SaveSnapshotInput {
  enterpriseId: string;
  slug: string;
  locale: string;
  version: number;
  baseUpdatedAt: Date;
  payload: Record<string, unknown>;
  now: Date;
}

export interface PublicSnapshotDeps {
  /** 1 query leve por (slug): updatedAt + publishedVersion. */
  findEnterpriseFreshness(slug: string): Promise<EnterpriseFreshness | null>;
  /** Snapshot atual por (slug, locale) — índice único. */
  findSnapshot(slug: string, locale: string): Promise<PublicSnapshotRow | null>;
  /** Composição canônica (caminho pré-Fase 7) — usada no miss/stale. */
  compose(slug: string, locale: string): Promise<Record<string, unknown> | null>;
  /** Persistência do snapshot — UPSERT (ON CONFLICT slug+locale). */
  saveSnapshot(input: SaveSnapshotInput): Promise<void>;
}

export interface ServePublicEnterpriseOptions {
  slug: string;
  locale: string;
  /** Clock injetável (testes); default Date.now(). */
  now?: Date;
}

export interface ServedPublicEnterprise {
  payload: Record<string, unknown>;
  /** true = servido do snapshot (caminho feliz de 2 queries leves). */
  fromSnapshot: boolean;
}

// WARN único de degradação (padrão das fases 3/4/6) — não polui o log.
let snapshotDegradedWarned = false;
let invalidationWarned = false;

/** Digital bate E snapshot dentro do TTL → serve sem recompor. */
function isSnapshotFresh(
  snap: PublicSnapshotRow,
  freshness: EnterpriseFreshness,
  now: Date,
  ttlMs: number,
): boolean {
  if (snap.baseUpdatedAt.getTime() !== freshness.updatedAt.getTime()) return false;
  if (snap.version !== freshness.publishedVersion) return false;
  return now.getTime() - snap.refreshedAt.getTime() <= ttlMs;
}

/**
 * Serve o payload público do empreendimento com snapshot versionado.
 * Retorna null quando a página pública NÃO EXISTE (slug inexistente ou
 * gate §12-v2: info 'none' — chamadora aplica 404, igual à API pública).
 *
 * Erros do caminho do snapshot (tabela ausente, etc.) degradam para a
 * composição canônica — NUNCA quebram a request pública.
 */
export async function servePublicEnterprise(
  deps: PublicSnapshotDeps,
  opts: ServePublicEnterpriseOptions,
): Promise<ServedPublicEnterprise | null> {
  const { slug, locale } = opts;
  const now = opts.now ?? new Date();

  // Flag legacy → composição direta (comportamento pré-Fase 7).
  if (!isPublicSnapshotV2Enabled()) {
    const payload = await deps.compose(slug, locale);
    return payload ? { payload, fromSnapshot: false } : null;
  }

  try {
    const freshness = await deps.findEnterpriseFreshness(slug);
    if (!freshness) return null; // slug inexistente → 404

    const snap = await deps.findSnapshot(slug, locale);
    if (snap && isSnapshotFresh(snap, freshness, now, publicSnapshotTtlSeconds() * 1000)) {
      // Cast de fronteira ÚNICO e documentado: payload veio de uma
      // compose anterior (buildPublicEnterprisePayload) — a shape é
      // Record<string, unknown> por construção (Prisma JsonValue).
      return { payload: snap.payload as Record<string, unknown>, fromSnapshot: true };
    }

    // Miss/stale → recomposição canônica (2 queries pesadas + resolve).
    const payload = await deps.compose(slug, locale);
    if (!payload) return null; // gate §12-v2 → 404 imediato

    // Persistência BEST-EFFORT: falha ao salvar snapshot não falha a
    // request pública (a próxima request recompõe e tenta de novo).
    try {
      await deps.saveSnapshot({
        enterpriseId: freshness.id,
        slug,
        locale,
        version: freshness.publishedVersion,
        baseUpdatedAt: freshness.updatedAt,
        payload,
        now,
      });
    } catch (saveErr) {
      if (!snapshotDegradedWarned) {
        snapshotDegradedWarned = true;
        console.warn(
          '[PublicSnapshot] falha ao persistir snapshot (seguindo com payload dinâmico):',
          saveErr instanceof Error ? saveErr.message : saveErr,
        );
      }
    }

    return { payload, fromSnapshot: false };
  } catch (pathErr) {
    // Tabela ausente (P2021/P2022), constraint, etc. → caminho canônico.
    if (!snapshotDegradedWarned) {
      snapshotDegradedWarned = true;
      console.warn(
        '[PublicSnapshot] caminho de snapshot indisponível (degradando para composição dinâmica):',
        pathErr instanceof Error ? pathErr.message : pathErr,
      );
    }
    const payload = await deps.compose(slug, locale);
    return payload ? { payload, fromSnapshot: false } : null;
  }
}

/**
 * Invalidação EXPLÍCITA das tabelas filhas (imagens/plantas/formFields/
 * slug) que não recarregam updatedAt do enterprise. Chame APÓS a mutação
 * principal ter sucesso. NUNCA falha a mutação (best-effort com WARN
 * único): invalidação perdida é coberta pelo TTL.
 */
export async function invalidatePublicSnapshotsForEnterprise(
  dbLike: {
    enterprisePublicSnapshot: {
      deleteMany(args: { where: { enterpriseId: string } }): Promise<unknown>;
    };
  },
  enterpriseId: string,
): Promise<void> {
  try {
    await dbLike.enterprisePublicSnapshot.deleteMany({ where: { enterpriseId } });
  } catch (err) {
    if (!invalidationWarned) {
      invalidationWarned = true;
      console.warn(
        '[PublicSnapshot] invalidação indisponível (TTL cobre a convergência):',
        err instanceof Error ? err.message : err,
      );
    }
  }
}

// ── Deps reais sobre o PrismaClient ─────────────────────────────────

/**
 * Monta PublicSnapshotDeps sobre o PrismaClient REAL (produção). Os testes
 * de contrato usam fakes da interface PublicSnapshotDeps diretamente — a
 * tipagem exata do Prisma fica confinada aqui (padrão das fases 3/4/6:
 * lib de domínio estrutural + fronteira única de binding).
 */
export function createDbPublicSnapshotDeps(db: PrismaClient): PublicSnapshotDeps {
  return {
    async findEnterpriseFreshness(slug) {
      // 1 query leve: 3 colunas por índice único (enterprises.slug).
      const row = await db.enterprise.findUnique({
        where: { slug },
        select: { id: true, updatedAt: true, publishedVersion: true },
      });
      return row;
    },
    async findSnapshot(slug, locale) {
      const row = await db.enterprisePublicSnapshot.findUnique({
        where: { slug_locale: { slug, locale } },
        select: { payload: true, baseUpdatedAt: true, version: true, refreshedAt: true },
      });
      // payload: Prisma.JsonValue → unknown é atribuição (sem cast).
      return row;
    },
    async compose(slug, locale) {
      // Composição canônica (caminho de miss): 1 query com subselects —
      // igual ao comportamento pré-Fase 7 — + resolve/gate/i18n da lib
      // view (fonte única de composição).
      const enterprise = await db.enterprise.findUnique({
        where: { slug },
        select: PUBLIC_ENTERPRISE_SELECT,
      });
      if (!enterprise) return null;
      // Cast de fronteira ÚNICO e documentado: o select canônico garante
      // os campos da ComposableEnterprise (JsonValue → unknown nas colunas
      // Json); Prisma resolve Date/String|null corretamente.
      return buildPublicEnterprisePayload(
        enterprise as unknown as ComposableEnterprise,
        locale,
      );
    },
    async saveSnapshot(input) {
      await db.enterprisePublicSnapshot.upsert({
        where: { slug_locale: { slug: input.slug, locale: input.locale } },
        create: {
          enterpriseId: input.enterpriseId,
          slug: input.slug,
          locale: input.locale,
          version: input.version,
          baseUpdatedAt: input.baseUpdatedAt,
          // Cast de fronteira ÚNICO documentado (padrão Fase 6): o payload
          // é Record<string, unknown> por construção (compose da lib view,
          // JSON puro serializável) — o Prisma tipa Json como InputJsonValue.
          payload: input.payload as unknown as Prisma.InputJsonValue,
        },
        update: {
          version: input.version,
          baseUpdatedAt: input.baseUpdatedAt,
          payload: input.payload as unknown as Prisma.InputJsonValue,
          refreshedAt: input.now,
        },
      });
    },
  };
}
