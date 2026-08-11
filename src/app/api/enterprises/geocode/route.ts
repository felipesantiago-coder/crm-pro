import { NextResponse } from 'next/server';

// ── In-memory cache (survives for the lifetime of the serverless function) ──
const cache = new Map<string, { coords: [number, number]; ts: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Nominatim geocoder with progressive fallback.
 * Tries multiple query variations until one returns a result.
 */
async function geocode(query: string): Promise<[number, number] | null> {
  if (!query || query.trim().length < 2) return null;
  const trimmed = query.trim();

  // Check cache
  const cached = cache.get(trimmed.toLowerCase());
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.coords;
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(trimmed)}&limit=1&accept-language=pt-BR`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'CRM-Pro LandingPage/1.0 (geocoding)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const lat = parseFloat(data[0].lat);
    const lon = parseFloat(data[0].lon);
    if (isNaN(lat) || isNaN(lon)) return null;

    const coords: [number, number] = [lat, lon];
    cache.set(trimmed.toLowerCase(), { coords, ts: Date.now() });
    return coords;
  } catch {
    return null;
  }
}

/**
 * Build an ordered list of queries to try, from most specific to least.
 */
function buildQueries(location: {
  address?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  additionalInfo?: string | null;
}): string[] {
  const { address, neighborhood, city, state, additionalInfo } = location;
  const queries: string[] = [];

  const stateStr = state || '';
  const cityStr = city || '';
  const neighborhoodStr = neighborhood || '';

  // 1. Full address + city + state
  if (address) {
    const parts = [address, cityStr, stateStr].filter(Boolean);
    if (parts.length >= 2) queries.push(parts.join(', '));
  }

  // 2. Neighborhood + city + state
  if (neighborhoodStr && cityStr) {
    queries.push(`${neighborhoodStr}, ${cityStr}${stateStr ? ', ' + stateStr : ''}`);
  }

  // 3. Landmark from additionalInfo (e.g. "Em frente ao Hospital X") + city
  //    Often more precise than neighborhood alone
  if (additionalInfo) {
    const landmark = additionalInfo
      .replace(/^(em frente (ao|à|a|o)\s*)/i, '')
      .replace(/^(próximo (ao|à|a|o)\s*)/i, '')
      .replace(/^(ao lado (do|da|de)\s*)/i, '')
      .replace(/^(atrás (do|da|de)\s*)/i, '')
      .trim();
    if (landmark.length >= 3) {
      queries.push(`${landmark}${cityStr ? ', ' + cityStr : ''}${stateStr ? ', ' + stateStr : ''}`);
    }
  }

  // 4. City + state (broadest fallback)
  if (cityStr) {
    queries.push(`${cityStr}${stateStr ? ', ' + stateStr : ''}`);
  }

  return queries;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get('address');
  const neighborhood = searchParams.get('neighborhood');
  const city = searchParams.get('city');
  const state = searchParams.get('state');
  const additionalInfo = searchParams.get('additionalInfo');

  if (!city && !address && !neighborhood) {
    return NextResponse.json({ error: 'Informe ao menos cidade, endereço ou bairro' }, { status: 400 });
  }

  const queries = buildQueries({ address, neighborhood, city, state, additionalInfo });

  for (const query of queries) {
    const coords = await geocode(query);
    if (coords) {
      return NextResponse.json({ lat: coords[0], lng: coords[1], query });
    }
  }

  return NextResponse.json({ error: 'Nenhuma coordenada encontrada' }, { status: 404 });
}
