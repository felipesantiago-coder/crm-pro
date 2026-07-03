/**
 * Enterprises Catalog — Static data source for landing pages
 *
 * This file is the PRIMARY source for the "Ficha Técnica" section.
 * It eliminates dependency on AI extraction (Gemini/Groq) which is
 * unreliable in serverless environments.
 *
 * HOW IT WORKS:
 * - The public API (`/api/enterprises/public/[slug]`) merges this data
 *   into the response. If a field is null here, the DB's cachedInfo
 *   is used as fallback (for backward compatibility).
 * - To update: edit this file and redeploy. Changes propagate to the
 *   landing page, public API, and any other consumer automatically.
 *
 * STRUCTURE:
 * - Key = enterprise slug (must match the `slug` column in the DB)
 * - Value = partial ExtractedInfo (only fields you want to override)
 * - Null fields are ignored (DB fallback applies)
 */

export interface EnterpriseCatalogEntry {
  location?: {
    address?: string | null;
    neighborhood?: string | null;
    city?: string | null;
    state?: string | null;
    region?: string | null;
    additionalInfo?: string | null;
  };
  builder?: string | null;
  architecture?: string | null;
  landscaping?: string | null;
  status?: 'Lançamento' | 'Em Construção' | 'Entregue' | null;
  deliveryDate?: string | null;
  price?: string | null;
  totalUnits?: number | null;
  floors?: number | null;
  parkingSpots?: number | null;
  differentials?: string[];
  apartmentTypes?: Array<{
    name: string;
    area?: string | null;
    bedrooms?: string | null;
    description?: string | null;
    price?: string | null;
  }>;
  summary?: string | null;
}

// ════════════════════════════════════════════════════════════════
//  ENTERPRISE DATA — Edit below to update landing pages
// ════════════════════════════════════════════════════════════════

const enterprisesCatalog: Record<string, EnterpriseCatalogEntry> = {

  // ── Residencial Vitta ────────────────────────────────────
  'residencial-vitta': {
    location: {
      address: null,          // ex: "Rua Exemplo, 123"
      neighborhood: null,     // ex: "Centro"
      city: null,             // ex: "São Paulo"
      state: null,            // ex: "SP"
      region: null,           // ex: "Zona Sul"
      additionalInfo: null,   // ex: "Próximo ao parque X"
    },
    builder: null,            // ex: "Incorporadora XYZ"
    architecture: null,       // ex: "Escritório Arq. Silva"
    landscaping: null,        // ex: "Paisagismo & Cia"
    status: null,             // "Lançamento" | "Em Construção" | "Entregue"
    deliveryDate: null,       // ex: "Dezembro/2026", "2º semestre de 2027"
    price: null,              // ex: "a partir de R$ 350.000"
    totalUnits: null,         // ex: 48
    floors: null,             // ex: 12
    parkingSpots: null,       // ex: 96
    differentials: [],        // ex: ["Piscina aquecida", "Arena 50m", "Coworking"]
    apartmentTypes: [],       // ex: [{ name: "Tipo 1", area: "65m²", bedrooms: "2 quartos", price: null }]
    summary: null,            // ex: "Residencial Vitta — 2 a 3 quartos a partir de R$ 500.000"
  },

  // ── Add more enterprises below ──────────────────────────
  // 'outro-empreendimento': { ... },

};

export default enterprisesCatalog;