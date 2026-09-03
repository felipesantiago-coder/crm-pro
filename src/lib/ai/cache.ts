/**
 * cache.ts — Cache de capacidades de IA com invalidação por evento
 * (prompt v1.0 §8.3).
 *
 * Chave canônica: `{capability}:{scopeId}:{dataHash}:{promptVersion}:{model}`
 *  - `dataHash` é SHA-256 do JSON normalizado dos dados RELEVANTES — quando
 *    os dados mudam (nova interação, estágio novo, documento novo), a chave
 *    muda: invalidação por evento de domínio, não por tempo.
 *  - TTL é defesa adicional (memória/custo), não fonte de verdade.
 *  - Sem compartilhamento cruzado: o `scopeId` contém o id do recurso e, onde
 *    permissão pode divergir, o userId entra no scope (o CRM não tem multi-
 *    organização; isolamento é por papel/propriedade).
 *  - Deduplicação: chamadas concorrentes para a mesma chave compartilham a
 *    mesma Promise em andamento.
 */
import { createHash } from 'crypto';

export interface CacheEntry<T> {
  value: T;
  createdAt: number;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 min — defesa, não consistência
const MAX_ENTRIES = 500;

const store = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

/** SHA-256 de JSON com chaves ordenadas — estável entre requests. */
export function computeDataHash(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${parts.join(',')}}`;
}

export function buildCacheKey(params: {
  capability: string;
  scopeId: string;
  dataHash: string;
  promptVersion: string;
  modelId: string;
}): string {
  return `${params.capability}:${params.scopeId}:${params.dataHash}:${params.promptVersion}:${params.modelId}`;
}

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() >= entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): void {
  // Evict simples quando cheio (FIFO via ordem de inserção do Map).
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (!oldest.done) store.delete(oldest.value);
  }
  store.set(key, { value, createdAt: Date.now(), expiresAt: Date.now() + ttlMs });
}

/**
 * Invalidação por evento de domínio: remove todas as entradas da capacidade
 * (e opcionalmente de um escopo). Chamado quando um dado relevante muda —
 * ex.: nova interação no cliente, documento de empreendimento substituído.
 */
export function invalidateCapability(capability: string, scopeId?: string): void {
  const prefix = scopeId ? `${capability}:${scopeId}:` : `${capability}:`;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/**
 * Executa `producer` com cache + deduplicação de chamadas concorrentes.
 * Se houver promise idêntica em andamento, aguarda a mesma (dedup).
 */
export async function cachedRun<T>(
  key: string,
  ttlMs: number,
  producer: () => Promise<T>,
): Promise<{ value: T; cacheHit: boolean; deduplicated: boolean }> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return { value: hit, cacheHit: true, deduplicated: false };

  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return { value: await pending, cacheHit: false, deduplicated: true };

  const promise = (async () => producer())()
    .then((value) => {
      cacheSet(key, value, ttlMs);
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    }) as Promise<T>;

  inFlight.set(key, promise as Promise<unknown>);
  return { value: await promise, cacheHit: false, deduplicated: false };
}

/** Visível para testes. */
export function __clearCacheForTests(): void {
  store.clear();
  inFlight.clear();
}
