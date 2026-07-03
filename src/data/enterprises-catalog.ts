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
    floors: 13,
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

  // ── Quattre Torre Istambul ──────────────────────────────
  'quattre-istambul': {
    location: {
      address: 'Quadra 02, Conjunto B-8, Projeção A',
      neighborhood: 'Sobradinho I',
      city: 'Brasília',
      state: 'DF',
      region: 'Sobradinho',
      additionalInfo: 'Segunda torre do complexo Quattre — primeiro Residencial Boutique de Sobradinho',
    },
    builder: 'MC Engenharia',
    architecture: 'MKZ Arquitetura + Jonas Birger Arquitetura',
    landscaping: 'Paisagismo com espécies nativas',
    status: 'Em Construção',
    deliveryDate: 'Novembro de 2027',
    price: null,
    totalUnits: 72,
    floors: 6,
    parkingSpots: null,
    differentials: [
      'Primeiro Residencial Boutique de Sobradinho',
      'Áreas comuns decoradas e mobiliadas sem custo adicional',
      '4 elevadores (3 sociais + 1 de serviço) para 72 unidades',
      'Rooftop com piscina adulto/infantil, borda infinita e deck',
      'Spa hot springs, sauna e 2 ofurôs de madeira',
      'Terraço gourmet e 2 churrasqueiras',
      'Solarium com vista panorâmica',
      'Salão de festas climatizado (AC)',
      'Brinquedoteca, academia completa e playground',
      '72 vagas de bicicletário',
      'Porcelanato 90x90 retificado acetinado',
      'Forro de gesso, granito polido, ralo linear',
      'Vidros laminados com proteção UV',
      'Tratamento acústico (Sintese Acústica Arquitetônica)',
      'Consultoria térmica (Ambiente Eficiente)',
      'Infra para AC Inverter, máquina de lavar louças e filtro',
      'Fechadura eletrônica',
      'CFTV 24h, biometria opcional e monitoramento remoto',
      'Reservatório de reuso de água',
      'Ventilação natural nos subsolos',
      'Fachada Eco-Granito + Porcelanato Portinari Tavola BE HARD',
      'Elevador de serviço dedicado',
      'Portaria com banheiro',
    ],
    apartmentTypes: [
      {
        name: '2 Quartos (1 suíte)',
        area: '66-69m²',
        bedrooms: '2 quartos (1 suíte)',
        description: '48 unidades com 1 vaga de garagem no subsolo',
        price: null,
      },
      {
        name: '3 Quartos (1 suíte)',
        area: '100m²',
        bedrooms: '3 quartos (1 suíte)',
        description: '24 unidades com 1 a 2 vagas de garagem no subsolo',
        price: null,
      },
    ],
    summary: 'Quattre Torre Istambul — 72 unidades exclusivas em Sobradinho I, Brasília. Primeiro Residencial Boutique da região com rooftop completo (piscina, spa hot springs, sauna, ofurôs), áreas comuns decoradas e mobiliadas, 4 elevadores, consultorias acústica e térmica. Entrega em novembro de 2027 pela MC Engenharia (desde 1985).',
  },

  // ── Add more enterprises below ──────────────────────────
  // 'outro-empreendimento': { ... },

};

export default enterprisesCatalog;
