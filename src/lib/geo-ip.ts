// ============================================================
// Geo-IP Resolution — lightweight, cached, serverless-safe
// Primary: ip-api.com free tier (no API key, 45 req/min)
// Fallback: ipwho.is (HTTPS, 10k req/month free)
// Also uses timezone-based inference from client metadata
// ============================================================

interface GeoResult {
  country: string | null;
  city: string | null;
}

const cache = new Map<string, { result: GeoResult; ts: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — IPs rarely change location
const MAX_CACHE_SIZE = 5000;

// ── Timezone-to-country mapping for common Brazilian timezones ──
// Used as fallback when IP geo fails (e.g. IG In-App Browser masks real IP)
const TZ_COUNTRY_MAP: Record<string, string> = {
  'America/Sao_Paulo': 'Brasil',
  'America/Manaus': 'Brasil',
  'America/Belem': 'Brasil',
  'America/Fortaleza': 'Brasil',
  'America/Recife': 'Brasil',
  'America/Cuiaba': 'Brasil',
  'America/Porto_Velho': 'Brasil',
  'America/Rio_Branco': 'Brasil',
  'America/Boa_Vista': 'Brasil',
  'America/Araguaina': 'Brasil',
  'America/Noronha': 'Brasil',
  'America/Bahia': 'Brasil',
  'America/Maceio': 'Brasil',
  'America/Eirunepe': 'Brasil',
};

/**
 * Infer country from timezone string.
 * Covers all Brazilian IANA timezones.
 */
export function inferCountryFromTimezone(tz: string | null | undefined): string | null {
  if (!tz) return null;
  return TZ_COUNTRY_MAP[tz] || null;
}

/**
 * Attempt to resolve geo from ip-api.com (primary, HTTP, 45 req/min free).
 */
async function resolveFromIpApi(ip: string): Promise<GeoResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=country,city,status&lang=pt-BR`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);

    if (!res.ok) return { country: null, city: null };

    const data = await res.json();
    if (data.status !== 'success') return { country: null, city: null };

    return {
      country: data.country || null,
      city: data.city || null,
    };
  } catch {
    clearTimeout(timeout);
    return { country: null, city: null };
  }
}

/**
 * Attempt to resolve geo from ipwho.is (fallback, HTTPS, 10k req/month free).
 */
async function resolveFromIpWhoIs(ip: string): Promise<GeoResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const res = await fetch(`https://ipwho.is/${ip}`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);

    if (!res.ok) return { country: null, city: null };

    const data = await res.json();
    if (!data.success) return { country: null, city: null };

    return {
      country: data.country || null,
      city: data.city || null,
    };
  } catch {
    clearTimeout(timeout);
    return { country: null, city: null };
  }
}

export async function resolveGeoIP(ip: string, geoHint?: string | null): Promise<GeoResult> {
  // Skip private/local IPs
  if (!ip || ip === 'unknown' || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.')) {
    // Even for local IPs, try timezone-based inference
    if (geoHint) {
      const inferred = inferCountryFromTimezone(geoHint);
      if (inferred) return { country: inferred, city: null };
    }
    return { country: null, city: null };
  }

  // Check cache
  const cached = cache.get(ip);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.result;
  }

  // Try primary provider (ip-api.com)
  let result = await resolveFromIpApi(ip);

  // If primary failed, try fallback provider (ipwho.is)
  if (!result.country && !result.city) {
    result = await resolveFromIpWhoIs(ip);
  }

  // If both IP providers failed, use timezone-based inference as last resort
  if (!result.country && !result.city && geoHint) {
    const inferred = inferCountryFromTimezone(geoHint);
    if (inferred) {
      result = { country: inferred, city: null };
    }
  }

  // Evict old entries if cache is too large
  if (cache.size >= MAX_CACHE_SIZE) {
    const now = Date.now();
    for (const [key, val] of cache) {
      if (now - val.ts > CACHE_TTL_MS) cache.delete(key);
    }
  }

  cache.set(ip, { result, ts: Date.now() });
  return result;
}
