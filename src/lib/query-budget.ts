// ============================================================
// query-budget — Fase 6 (tracking/relatórios, otimização Vercel)
//
// Orçamento de concorrência para rotas de dashboard/report:
//  - runInWaves: executa fábricas de promise em ONDAS de tamanho
//    máximo fixo (substitui o Promise.all de ~34 consultas paralelas
//    sem orçamento — exigência do prompt da Fase 6). Preserva a
//    SEMÂNTICA do Promise.all: resultados na MESMA ordem das fábricas
//    e rejeição propagada (as rotas já embrulham cada consulta com
//    `safe()`, que engole falhas individuais).
//  - TtlCache: cache curto em memória por instância para o payload
//    AGREGADO e NÃO SENSÍVEL do dashboard, com chave por
//    usuário/escopo/período (exigência do prompt). Métricas com PII
//    (recentLeads) ficam FORA do cache — buscadas a cada request.
//
// Serverless-safe: sem timers (evicção lazy), sem dependências.
// ============================================================

/** Tamanho máximo de onda para as rotas de tracking (dashboard/report). */
export const QUERY_WAVE_SIZE = 6;

/**
 * Executa as fábricas em ondas de `waveSize`, aguardando cada onda
 * terminar antes de iniciar a próxima. A tipagem espelha Promise.all:
 * a tupla de entrada é inferida e o retorno mantém o tipo resolvido
 * de cada elemento na mesma posição.
 */
export async function runInWaves<T extends readonly (() => unknown)[] | []>(
  factories: T,
  waveSize: number = QUERY_WAVE_SIZE,
): Promise<{ -readonly [K in keyof T]: T[K] extends () => infer U ? Awaited<U> : never }> {
  const out: unknown[] = [];
  const size = Number.isFinite(waveSize) && waveSize >= 1 ? Math.floor(waveSize) : QUERY_WAVE_SIZE;
  for (let i = 0; i < factories.length; i += size) {
    // Cast isolado de PLUMBING genérico (a tupla T já garante que cada
    // elemento é () => unknown) — os call sites permanecem sem casts.
    const wave = factories.slice(i, i + size) as Array<() => unknown>;
    const values = await Promise.all(wave.map((factory) => factory()));
    out.push(...values);
  }
  return out as { -readonly [K in keyof T]: T[K] extends () => infer U ? Awaited<U> : never };
}

export interface TtlCacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
}

/**
 * Cache TTL em memória com teto de entradas (evicção do mais antigo).
 * `now` injetável para testes; sem timers (evicção lazy no acesso).
 */
export class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  // Campos explícitos (sem parameter properties — node --test usa
  // type-stripping, que rejeita sintaxe que exige transformação)
  constructor(ttlMs: number, maxEntries: number = 50, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
  }

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (this.now() >= entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
    // Refresca a posição de inserção (LRU por acesso)
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits++;
    return entry.value;
  }

  set(key: string, value: V): void {
    // Evicção lazy: expirados primeiro, depois os mais antigos
    if (this.store.size >= this.maxEntries) {
      const now = this.now();
      for (const [k, entry] of this.store) {
        if (now >= entry.expiresAt) {
          this.store.delete(k);
          this.evictions++;
        }
      }
      while (this.store.size >= this.maxEntries) {
        const oldest = this.store.keys().next().value;
        if (oldest === undefined) break;
        this.store.delete(oldest);
        this.evictions++;
      }
    }
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  stats(): TtlCacheStats {
    return { size: this.store.size, hits: this.hits, misses: this.misses, evictions: this.evictions };
  }

  clear(): void {
    this.store.clear();
  }
}
