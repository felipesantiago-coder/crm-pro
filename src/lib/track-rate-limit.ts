// ============================================================
// track-rate-limit — Fase 6 (tracking/relatórios, otimização Vercel)
//
// Substitui o rate limit IN-MEMORY (Map por instância) do /api/track
// por mecanismo DISTRIBUÍDO compatível com a plataforma (exigência do
// prompt da Fase 6):
//
//  - Distribuído: 1 statement ATÔMICO em Postgres (INSERT ... ON
//    CONFLICT ... DO UPDATE com reset de janela via CASE + RETURNING)
//    — mesmo padrão pooler-safe da Fase 4 (sem transação interativa,
//    proibida com PgBouncer em src/lib/db.ts). A tabela
//    tracking_rate_limit guarda UMA linha por chave (ip).
//  - Fallback: in-memory por instância (lazy eviction, sem timers) —
//    usado quando TRACK_RATE_LIMIT_V2=legacy OU quando a tabela não
//    existe (P2021/P2022 — deploy antes do db:release/SQL) OU em
//    qualquer erro do statement. Disponibilidade > rigor em endpoint
//    público de tracking (o write em si já falha se o banco cair).
//  - Limpeza: linhas de janelas antigas são removidas de forma
//    oportunista (probabilidade baixa por request) — custo ~0 com PK.
//
// Semântica preservada do endpoint: janela de 60s, limite de eventos
// por IP, resposta 429 'Rate limit exceeded'.
// ============================================================

/** Janela do contador (ms). */
export const RATE_WINDOW_MS = 60_000;

/** Máximo de eventos por janela por chave (ip). */
export const RATE_LIMIT_MAX = 100;

/** Probabilidade de varredura de linhas expiradas por request. */
export const RATE_CLEANUP_PROBABILITY = 0.05;

/** Idade máxima de uma linha parada antes de virar lixo. */
export const RATE_STALE_ROW_MS = 10 * 60_000;

/** Teto do Map do fallback antes de varrer expirados (lazy). */
const MEMORY_SWEEP_THRESHOLD = 10_000;

export interface RateLimitDecision {
  limited: boolean;
  count: number;
  mode: 'distributed' | 'memory';
}

/**
 * Fatia estrutural do PrismaClient usada pelo limitador (DI p/ testes).
 * $queryRaw é tagged template — assinatura compatível.
 */
export interface RateLimitDb {
  $queryRaw(query: TemplateStringsArray, ...values: readonly unknown[]): Promise<unknown>;
}

// ── Fallback in-memory (por instância) ──────────────────────────

const memoryCounters = new Map<string, { count: number; windowStart: number }>();

function memoryConsume(key: string, units: number, now: number): RateLimitDecision {
  const entry = memoryCounters.get(key);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    memoryCounters.set(key, { count: units, windowStart: now });
    // Evicção lazy — sem timers (serverless/testes)
    if (memoryCounters.size > MEMORY_SWEEP_THRESHOLD) {
      for (const [k, e] of memoryCounters) {
        if (now - e.windowStart > RATE_WINDOW_MS) memoryCounters.delete(k);
      }
    }
    return { limited: false, count: units, mode: 'memory' };
  }
  entry.count += units;
  return { limited: entry.count > RATE_LIMIT_MAX, count: entry.count, mode: 'memory' };
}

/** Acesso de teste ao estado do fallback. */
export function __memoryRateStateForTests(): Map<string, { count: number; windowStart: number }> {
  return memoryCounters;
}

export function __resetMemoryRateForTests(): void {
  memoryCounters.clear();
}

// ── Limitador ───────────────────────────────────────────────────

let distributedWarned = false;

function isMissingTableError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'P2021' || code === 'P2022';
}

/**
 * Consome `units` da cota da janela corrente da chave (1 chamada =
 * 1 statement atômico distribuído). Em erro/flag, cai para o fallback
 * in-memory com WARN único.
 */
export async function consumeRateLimit(
  deps: { db: RateLimitDb },
  key: string,
  units: number,
  opts?: { random?: () => number; now?: () => number },
): Promise<RateLimitDecision> {
  const flag = process.env.TRACK_RATE_LIMIT_V2;
  if (flag === 'legacy') {
    return memoryConsume(key, units, opts?.now?.() ?? Date.now());
  }

  try {
    const rows = (await deps.db.$queryRaw`
      INSERT INTO "tracking_rate_limit" ("key", "windowStart", "count", "updatedAt")
      VALUES (${key}, now(), ${units}, now())
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "tracking_rate_limit"."windowStart" < now() - interval '60 seconds'
          THEN ${units}
          ELSE "tracking_rate_limit"."count" + ${units}
        END,
        "windowStart" = CASE
          WHEN "tracking_rate_limit"."windowStart" < now() - interval '60 seconds'
          THEN now()
          ELSE "tracking_rate_limit"."windowStart"
        END,
        "updatedAt" = now()
      RETURNING "count" AS count
    `) as Array<{ count: number | bigint }>;

    const count = Number(rows[0]?.count ?? units);

    // Limpeza oportunista de linhas paradas (fora do caminho crítico)
    const random = opts?.random ?? Math.random;
    if (random() < RATE_CLEANUP_PROBABILITY) {
      deps.db
        .$queryRaw`
        DELETE FROM "tracking_rate_limit"
        WHERE "windowStart" < now() - interval '600 seconds'`
        .catch(() => {});
    }

    return { limited: count > RATE_LIMIT_MAX, count, mode: 'distributed' };
  } catch (err) {
    if (!distributedWarned) {
      distributedWarned = true;
      const code = isMissingTableError(err) ? 'tabela ausente (P2021/P2022)' : (err as Error)?.message;
      console.warn(
        `[TrackRateLimit] Distribuído indisponível (${code}) — fallback in-memory por instância`,
      );
    }
    return memoryConsume(key, units, opts?.now?.() ?? Date.now());
  }
}
