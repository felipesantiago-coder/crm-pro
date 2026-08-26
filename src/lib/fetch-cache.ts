/**
 * Lightweight in-memory fetch cache.
 * Avoids re-fetching identical URLs within a TTL window.
 * Reduces Supabase egress and Vercel function invocations.
 */

const cache = new Map<string, { data: any; ts: number }>();
const DEFAULT_TTL = 30_000; // 30s — good balance for CRM data

export function getCached<T>(url: string, fetcher: () => Promise<T>, ttl = DEFAULT_TTL): Promise<T> {
  const now = Date.now();
  const entry = cache.get(url);

  if (entry && now - entry.ts < ttl) {
    return Promise.resolve(entry.data as T);
  }

  return fetcher().then(data => {
    cache.set(url, { data, ts: now });
    // Prune stale entries if cache grows too large
    if (cache.size > 200) {
      for (const [key, val] of cache) {
        if (now - val.ts > ttl * 3) cache.delete(key);
      }
    }
    return data;
  });
}

/** Invalidate cache entries matching a prefix (e.g. after mutation) */
export function invalidateCache(prefix?: string) {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}