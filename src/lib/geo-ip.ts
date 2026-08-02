// ============================================================
// Geo-IP Resolution — lightweight, cached, serverless-safe
// Uses ip-api.com free tier (no API key, 45 req/min)
// ============================================================

interface GeoResult {
  country: string | null;
  city: string | null;
}

const cache = new Map<string, { result: GeoResult; ts: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — IPs rarely change location
const MAX_CACHE_SIZE = 5000;

export async function resolveGeoIP(ip: string): Promise<GeoResult> {
  // Skip private/local IPs
  if (!ip || ip === 'unknown' || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.')) {
    return { country: null, city: null };
  }

  // Check cache
  const cached = cache.get(ip);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.result;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000); // 3s timeout

    const res = await fetch(`http://ip-api.com/json/${ip}?fields=country,city,status&lang=pt-BR`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);

    if (!res.ok) return { country: null, city: null };

    const data = await res.json();

    if (data.status !== 'success') return { country: null, city: null };

    const result: GeoResult = {
      country: data.country || null,
      city: data.city || null,
    };

    // Evict old entries if cache is too large
    if (cache.size >= MAX_CACHE_SIZE) {
      const now = Date.now();
      for (const [key, val] of cache) {
        if (now - val.ts > CACHE_TTL_MS) cache.delete(key);
      }
    }

    cache.set(ip, { result, ts: Date.now() });
    return result;
  } catch {
    return { country: null, city: null };
  }
}
