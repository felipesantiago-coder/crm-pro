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
    price: 'A consultar',
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
    summary: 'Residencial Vitta — 291 unidades de 32m² a 105m² em Ceilândia Sul. Entrega em abril de 2029.',
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

  // ── Moment Noroeste ────────────────────────────────────
  'moment-noroeste': {
    location: {
      address: 'SHCNW Trecho 2 F',
      neighborhood: 'Setor Noroeste',
      city: 'Brasília',
      state: 'DF',
      region: 'Noroeste',
      additionalInfo: 'Central de vendas: CRNW 511, Bloco A (mesmo local do Union 511)',
    },
    builder: 'Apex Engenharia (desde 1976, +100 empreendimentos entregues) em parceria com Jarjour Empreendimentos',
    architecture: null,
    landscaping: null,
    status: 'Em Construção',
    deliveryDate: 'Fevereiro de 2028',
    price: null,
    totalUnits: null,
    floors: null,
    parkingSpots: null,
    differentials: [
      'Localizado no bairro mais valorizado de Brasília',
      'Cobertura lazer com +500m² (piscina climatizada adulto/infantil, sauna, espaço gourmet, churrasqueira)',
      'Lazer no pilotis (brinquedoteca, jogos, salão de festas, academia)',
      'Coberturas duplex de 175m² a 261m² com piscina privativa',
      'Automação residencial compatível com Alexa e Google Home',
      'Fechadura eletrônica',
      'Água aquecida no chuveiro e lavatório dos banheiros',
      'Paredes em alvenaria (isolamento acústico e térmico superior)',
      'Bancada do lavado em quartzito com cuba esculpida',
      'Esquadrias altas na sala (iluminação natural maximizada)',
      'Piso em porcelanato',
      'Cozinha com 2m de largura',
      'Lavabo em todas as unidades',
      'Closet/amplo espaço para armários na suíte master',
      'Bicicletário com Bike Wash',
      'Infraestrutura para carregador de veículo elétrico (1 vaga por unidade)',
      'Construtora com quase 50 anos de mercado e +100 empreendimentos entregues',
      'Obra em andamento — 49,98% concluída (fundação 100%, estrutura 99%)',
    ],
    apartmentTypes: [
      {
        name: 'Tipo 88m²',
        area: '88m²',
        bedrooms: '3 quartos (1 suíte)',
        description: '2 vagas de garagem, cozinha com 2m de largura, lavabo, closet na suíte master',
        price: null,
      },
      {
        name: 'Tipo 112m²',
        area: '112m²',
        bedrooms: '3 quartos (3 suítes)',
        description: '3 vagas de garagem, cozinha com 2m de largura, lavabo, closet na suíte master',
        price: null,
      },
      {
        name: 'Cobertura Duplex',
        area: '175-261m²',
        bedrooms: '3-4 quartos (3-4 suítes)',
        description: '3 a 5 vagas de garagem, piscina privativa na cobertura, experiência exclusiva de moradia',
        price: null,
      },
    ],
    summary: 'Moment Noroeste — empreendimento residencial vertical no coração do Setor Noroeste, o bairro mais valorizado de Brasília. Unidades de 88m² a 112m² (3 quartos, 1 a 3 suítes, 2 a 3 vagas) e coberturas duplex de 175m² a 261m² com piscina privativa. Lazer de cobertura com +500m², automação residencial (Alexa/Google), fechadura eletrônica, água aquecida. Pela Apex Engenharia (desde 1976) em parceria com Jarjour Empreendimentos. Entrega em fevereiro de 2028.',
  },

  // ── Union 511 Residence Mall ───────────────────────────
  'union-511': {
    location: {
      address: 'CRNW 511',
      neighborhood: 'Setor Noroeste',
      city: 'Brasília',
      state: 'DF',
      region: 'Noroeste',
      additionalInfo: 'Primeiro condomínio fechado residencial do Noroeste — conceito Residence Mall com 52 lojas no térreo',
    },
    builder: 'Apex Engenharia (desde 1976, +100 empreendimentos entregues) em parceria com Jarjour Empreendimentos',
    architecture: null,
    landscaping: null,
    status: 'Entregue',
    deliveryDate: 'Agosto de 2025',
    price: null,
    totalUnits: 336,
    floors: null,
    parkingSpots: 336,
    differentials: [
      'Primeiro condomínio fechado residencial do Noroeste',
      'Conceito Residence Mall — 52 lojas comerciais no térreo',
      'Ocupa toda a extensão da quadra 511 (4 blocos: A, B, C, D)',
      '+2.000m² de lazer, serviços e convivência',
      'Pronto para morar — último convite disponível',
      'Piscina climatizada (adulto e infantil)',
      'Sauna',
      'Sports Bar',
      'Salão de Festas',
      'Espaço Gourmet com churrasqueira integrada',
      'Coworking',
      'Rooftop com vista panorâmica',
      'Boulevard de convivência',
      'Academia completa e espaço funcional',
      'Brinquedoteca e playground',
      'Salão de Jogos / Games',
      'Pet Care',
      'Serviço de delivery integrado ao condomínio',
      'Gerador de energia para áreas comuns',
      'Cooktop de 4 bocas em todas as unidades',
      'Infraestrutura para ar-condicionado e automação residencial',
      'Condomínio estimado ~R$ 545/mês',
    ],
    apartmentTypes: [
      {
        name: 'Tipo 1 Quarto (34m²)',
        area: '34m²',
        bedrooms: '1 quarto',
        description: '1 banheiro, cozinha integrada, 1 vaga de garagem',
        price: null,
      },
      {
        name: 'Tipo 1 Quarto Ampliado (43m²)',
        area: '43m²',
        bedrooms: '1 quarto',
        description: '1 banheiro, mais espaço na sala, 1 vaga de garagem',
        price: null,
      },
      {
        name: 'Union Two (41-48m²)',
        area: '41-48m²',
        bedrooms: '2 quartos',
        description: 'Banheiro social, sala e cozinha integradas sem compartimentação, 1 vaga de garagem',
        price: null,
      },
      {
        name: 'Union Family (51m²)',
        area: '51m²',
        bedrooms: '2 quartos (1 suíte)',
        description: 'Suíte completa + 1 dormitório, banheiro social, sala e cozinha integradas, 1 vaga de garagem',
        price: null,
      },
    ],
    summary: 'Union 511 Residence Mall — primeiro condomínio fechado residencial do Noroeste, o bairro mais valorizado de Brasília. 336 unidades em 4 blocos (A, B, C, D) ocupando toda a quadra 511. Conceito Residence Mall com 52 lojas no térreo, +2.000m² de lazer (piscina climatizada, rooftop, sports bar, coworking, academia, pet care). Unidades de 34m² a 51m², todas com 1 vaga. Pronto para morar — entregue em agosto de 2025 pela Apex Engenharia (desde 1976).',
  },

  // ── Add more enterprises below ──────────────────────────
  // 'outro-empreendimento': { ... },

};

export default enterprisesCatalog;
