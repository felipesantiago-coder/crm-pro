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
      address: 'QNM 29, Área Especial C',
      neighborhood: 'Ceilândia Sul',
      city: 'Brasília',
      state: 'DF',
      region: 'Ceilândia',
      additionalInfo: 'Em frente ao Hospital Regional de Ceilândia',
    },
    builder: 'Grupo Attos, Habitar Empreendimentos, HC Construtora',
    architecture: null,
    landscaping: null,
    status: 'Lançamento',
    deliveryDate: 'Abril de 2029',
    price: 'Aceita FGTS — enquadramento Minha Casa Minha Vida',
    totalUnits: 291,
    floors: 19,
    parkingSpots: null,
    differentials: [
      'Piscina',
      'Academia equipada',
      'Coworking',
      '3 salões de jogos',
      'Brinquedoteca',
      'Pet place',
      'Salão de festas',
      'Churrasqueira',
      'Medição individual de água e energia',
      '6 lojas comerciais no térreo',
    ],
    apartmentTypes: [
      {
        name: '1 Quarto',
        area: '32m²',
        bedrooms: '1 quarto',
        description: 'Sala, cozinha, 1 quarto, 1 banheiro, área de serviço',
        price: null,
      },
      {
        name: '2 Quartos',
        area: '48m²',
        bedrooms: '2 quartos',
        description: 'Sala, cozinha, 2 quartos, 1 banheiro, área de serviço',
        price: null,
      },
      {
        name: '2 Quartos Suíte + Varanda',
        area: '52m²',
        bedrooms: '2 quartos (1 suíte)',
        description: 'Sala, cozinha, 2 quartos com 1 suíte, varanda, banheiro social, área de serviço',
        price: null,
      },
      {
        name: 'Garden',
        area: '105m²',
        bedrooms: null,
        description: 'Unidade no térreo com área privativa de solo adjacente',
        price: null,
      },
    ],
    summary: 'Residencial Vitta — 291 unidades de 32m² a 105m² em Ceilândia Sul, Brasília. Aceita FGTS. Entrega em abril de 2029.',
  },

  // ── Add more enterprises below ──────────────────────────
  // 'outro-empreendimento': { ... },

};

export default enterprisesCatalog;