/**
 * markdown-parser.ts — Extração DETERMINÍSTICA (sem IA) de bases de dados
 * de empreendimentos escritas no padrão canônico estabelecido.
 *
 * Padrão reconhecido: template de 11 seções do prompt mestre ("Gerador de
 * Base de Dados de Empreendimento — Markdown Padrão de Extração"):
 * RESUMO, LOCALIZAÇÃO, STATUS DA OBRA E DATA DE ENTREGA, PREÇOS E VALORES,
 * TIPOLOGIAS, DIMENSIONAMENTO, CONSTRUTORA/ARQUITETURA/PAISAGISMO,
 * DIFERENCIAIS E COMODIDADES, INFORMAÇÕES COMPLEMENTARES, FONTES,
 * CONFLITOS E RESSALVAS.
 *
 * Decisão de produto (2026-09): as bases passam a ser fornecidas
 * EXCLUSIVAMENTE em markdown neste padrão — o parse determinístico remove a
 * dependência de IA no caminho principal (sem 502/504, sem custo, sem
 * latência de provedor, resultado idêntico a cada execução). Documentos
 * FORA do padrão (bases antigas, PDFs) seguem pelo pipeline de IA em
 * extraction.ts como fallback — nenhuma regressão.
 *
 * Reaproveita integralmente a camada já testada:
 *  - normalizeBlockOutput: sinônimos de status → enum canônico, inteiros,
 *    clamps aos limites do schema (valores válidos verbatim);
 *  - blockExtractionSchema: validação idêntica à da saída de IA;
 *  - consolidateBlocks: consolidação por campo, evidências, conflitos
 *    (multi-ocorrência divergente → 'conflicting', nunca resolvido em
 *    silêncio), merge de tipologias por nome, fallback de região do
 *    cadastro, needsReview.
 * Candidatos saem com method 'rule' (determinístico). O painel de revisão,
 * a política de críticos e a publicação permanecem INALTERADOS — o parser
 * alimenta o mesmo draft (rascunho → decisão humana → publicar).
 *
 * Lógica PURA — sem I/O; testável via node:test.
 */
import {
  consolidateBlocks,
  normalizeBlockOutput,
  type DocumentBlock,
} from './extraction-core';
import {
  blockExtractionSchema,
  type BlockExtraction,
  type ExtractionCandidate,
} from './contracts';

/** Identidade de auditoria do caminho determinístico (runs, dedup, telemetria). */
export const PARSER_MODEL_ID = 'markdown-parser';
export const PARSER_PROMPT_VERSION = 'md-parser-v1-2026-09-04';

/**
 * Seções canônicas mínimas (das 11) para tratar o documento como "no
 * padrão". O template completo tem 11; 6+ indica que o gerador seguiu o
 * padrão (estruturas antigas têm 0–1 títulos canônicos).
 */
export const SECTION_MATCH_THRESHOLD = 6;

// ── Normalização de títulos e rótulos ───────────────────────────────────────

/** lowercase, sem acentos, espaços colapsados — base para matching estável. */
function normText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove numeração inicial de títulos ("1.", "1)", "3 -", "5.1"). */
function normHeading(s: string): string {
  return normText(s).replace(/^\d+(\.\d+)*\s*[.):\-–—]*\s*/, '').trim();
}

type SectionKey =
  | 'resumo'
  | 'localizacao'
  | 'status'
  | 'precos'
  | 'tipologias'
  | 'dimensionamento'
  | 'construtora'
  | 'diferenciais'
  | 'complementares'
  | 'fontes'
  | 'conflitos';

/** Títulos canônicos (pós-normalização) e variantes toleradas. */
const SECTION_ALIASES: Array<{ key: SectionKey; aliases: string[] }> = [
  { key: 'resumo', aliases: ['resumo'] },
  { key: 'localizacao', aliases: ['localizacao', 'localizacao do empreendimento'] },
  {
    key: 'status',
    aliases: [
      'status da obra e data de entrega',
      'status da obra',
      'status e entrega',
      'status e data de entrega',
      'status',
    ],
  },
  { key: 'precos', aliases: ['precos e valores', 'precos', 'preco', 'precos e condicoes comerciais'] },
  { key: 'tipologias', aliases: ['tipologias', 'tipologia'] },
  { key: 'dimensionamento', aliases: ['dimensionamento'] },
  {
    key: 'construtora',
    aliases: [
      'construtora, arquitetura e paisagismo',
      'construtora e arquitetura',
      'construtora, arquitetura e paisagismo responsaveis',
      'construtora',
    ],
  },
  { key: 'diferenciais', aliases: ['diferenciais e comodidades', 'diferenciais', 'diferenciais e lazer'] },
  { key: 'complementares', aliases: ['informacoes complementares', 'informacoes adicionais'] },
  { key: 'fontes', aliases: ['fontes', 'fontes e referencias', 'referencias'] },
  { key: 'conflitos', aliases: ['conflitos e ressalvas', 'conflitos', 'ressalvas'] },
];

function sectionKeyOf(heading: string): SectionKey | null {
  const h = normHeading(heading);
  if (!h) return null;
  for (const { key, aliases } of SECTION_ALIASES) {
    if (aliases.includes(h)) return key;
  }
  return null;
}

// ── Fatiação do documento em seções canônicas ───────────────────────────────

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

/** Remove frontmatter YAML inicial e comentários HTML (nome de arquivo etc.). */
function stripIgnorable(content: string): string {
  let out = content ?? '';
  out = out.replace(/^<!--[\s\S]*?-->\s*/, '');
  if (out.trimStart().startsWith('---')) {
    out = out.replace(/^\s*---\s*\n[\s\S]*?\n---\s*(\n|$)/, '');
  }
  return out;
}

interface CanonicalSection {
  key: SectionKey;
  body: string[];
}

/**
 * Mapeia o documento para as seções canônicas (1ª ocorrência de cada título
 * vence — duplicatas são ignoradas).
 *
 * Sub-seções (heading mais profundo que a seção canônica atual, ex. "### 5.1
 * Torre A" dentro de TIPOLOGIAS) NÃO encerram a seção — viram linhas do
 * corpo (e são filtradas na leitura de campos). Headings desconhecidos de
 * nível igual/superior encerram a seção corrente.
 */
function collectSections(content: string): CanonicalSection[] {
  const byKey = new Map<SectionKey, string[]>();
  let current: { key: SectionKey; level: number } | null = null;
  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(HEADING_RE);
    if (heading) {
      const level = heading[1].length;
      const key = sectionKeyOf(heading[2]);
      if (key) {
        if (!byKey.has(key)) {
          byKey.set(key, []);
          current = { key, level };
        } else {
          current = null; // duplicata canônica → conteúdo seguinte ignorado
        }
        continue;
      }
      if (!current || level <= current.level) {
        current = null;
      } else {
        byKey.get(current.key)!.push(line);
      }
      continue;
    }
    if (current) byKey.get(current.key)!.push(line);
  }
  return [...byKey.entries()].map(([key, body]) => ({ key, body }));
}

/** Todas as seções canônicas presentes (distintas). */
function canonicalKeysOf(content: string): SectionKey[] {
  return collectSections(stripIgnorable(content)).map((s) => s.key);
}

// ── Rótulos de campo ("Label: valor") ───────────────────────────────────────

const BULLET_RE = /^\s*[-*•]\s+(.*)$/;
const NOT_INFORMED_RE =
  /^(nao informado|nao informada|nao informados|nao informadas|n\/?a|nao disponivel|indisponivel|sem informacao|—|–|-|--)$/;

/** Valor "Não informado" (ou marcador vazio) → ausente (nunca vira campo). */
function notInformed(value: string): boolean {
  return NOT_INFORMED_RE.test(normText(value).replace(/\.$/, ''));
}

/** Linha de campo: bullets "- X: y", "* X: y" ou linha solta "X: y". */
function asFieldLine(line: string): { label: string; value: string } | null {
  const bullet = line.match(BULLET_RE);
  const content = bullet ? bullet[1] : line.trim();
  if (!content || content.startsWith('|') || content.startsWith('#')) return null;
  const colon = content.indexOf(':');
  if (colon <= 0) return null;
  const label = normText(content.slice(0, colon));
  if (!label) return null;
  return { label, value: content.slice(colon + 1).trim() };
}

/** Primeiro número do valor ("123 unidades" → 123; "2 ou 3" → 2). */
function toInt(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = value.replace(/\s/g, '').match(/(\d{1,3}(?:[.,]\d{3})+|\d+)/);
  if (!m) return null;
  const n = parseInt(m[1].replace(/[.,]/g, ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// ── Tipologias ("Tipologia: Nome | Área: … | Dormitórios: … | …") ───────────

interface TypologyRaw {
  name: string;
  area: string | null;
  bedrooms: string | null;
  description: string | null;
  price: string | null;
}

function parseTypologySegments(raw: string): TypologyRaw | null {
  const segments = raw
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) return null;

  const t: TypologyRaw = { name: '', area: null, bedrooms: null, description: null, price: null };
  segments.forEach((seg, i) => {
    const colon = seg.indexOf(':');
    if (colon === -1) {
      // primeiro segmento sem rótulo é o NOME; segmentos soltos seguintes
      // são ignorados (nunca mapeados para campos por dedução)
      if (i === 0) t.name = seg;
      return;
    }
    const label = normText(seg.slice(0, colon));
    const value = seg.slice(colon + 1).trim();
    if (!value || notInformed(value)) return;
    if (label === 'nome' || (i === 0 && /^(tipologias?|tipos?)$/.test(label))) {
      if (!t.name) t.name = value;
    } else if (/^(area|metragem|m2)$/.test(label)) {
      t.area = value;
    } else if (/^(dormitorios|quartos|suites)$/.test(label)) {
      t.bedrooms = value;
    } else if (/^(preco|valor)$/.test(label)) {
      t.price = value;
    } else if (/^(descricao|detalhes|caracteristicas)$/.test(label)) {
      t.description = value;
    }
    // rótulos desconhecidos são ignorados por segurança
  });
  return t.name.trim() !== '' ? t : null;
}

// ── Coleta por seção ────────────────────────────────────────────────────────

const LOCATION_LABELS: Array<{ re: RegExp; field: string }> = [
  { re: /^endere[çc]o/, field: 'location.address' },
  { re: /^bairro/, field: 'location.neighborhood' },
  { re: /^cidade/, field: 'location.city' },
  { re: /^(estado|uf)$/, field: 'location.state' },
  { re: /^regi[ãa]o|^zona/, field: 'location.region' },
  { re: /^informa[çc][õo]es adicionais/, field: 'location.additionalInfo' },
];

const STATUS_LABELS: Array<{ re: RegExp; field: string }> = [
  { re: /^status( da obra)?$/, field: 'status' },
  { re: /^(data (de|prevista para) entrega|entrega|previs[ãa]o de entrega|data de entrega)$/, field: 'deliveryDate' },
];

const PRICE_LABELS: Array<{ re: RegExp; field: string }> = [
  { re: /^(pre[çc]o|pre[çc]os|pre[çc]o inicial|pre[çc]o a partir de|valor inicial|a partir de)$/, field: 'price' },
];

const DIMENSION_LABELS: Array<{ re: RegExp; field: string }> = [
  { re: /^(total de unidades|unidades|total de unidades residenciais|unidades residenciais)$/, field: 'totalUnits' },
  { re: /^(andares por torre|andares|pavimentos|pavimentos por torre)$/, field: 'floors' },
  { re: /^(vagas por unidade|vagas)$/, field: 'parkingSpots' },
];

const TEAM_LABELS: Array<{ re: RegExp; field: string }> = [
  { re: /^(construtora|incorporadora|incorpora[çc][ãa]o)$/, field: 'builder' },
  { re: /^(arquitetura|projeto de arquitetura|arquiteto)$/, field: 'architecture' },
  { re: /^(paisagismo|projeto paisag[íi]stico|paisagista)$/, field: 'landscaping' },
];

function matchLabel(
  labels: Array<{ re: RegExp; field: string }>,
  label: string,
): string | null {
  return labels.find((l) => l.re.test(label))?.field ?? null;
}

// ── Parse principal ─────────────────────────────────────────────────────────

export interface StandardMarkdownParse {
  fields: ExtractionCandidate[];
  needsReview: boolean;
  /** Seções canônicas reconhecidas (diagnóstico/limitações). */
  sectionsFound: string[];
  limitations: string[];
}

/**
 * Extrai campos de um documento no padrão canônico. Retorna `null` quando o
 * documento NÃO segue o padrão (poucas seções canônicas) — o chamador deve
 * cair para o pipeline de IA (extraction.ts).
 */
export function parseStandardMarkdown(
  content: string,
  opts: { fallbackRegion?: string | null } = {},
): StandardMarkdownParse | null {
  const cleaned = stripIgnorable(content ?? '');
  const sections = collectSections(cleaned);
  const foundKeys = [...new Set(sections.map((s) => s.key))];
  if (foundKeys.length < SECTION_MATCH_THRESHOLD) return null;

  // ocorrências por campo (ordem do documento) — multi-ocorrência divergente
  // vira conflito na consolidação (nunca resolvido em silêncio)
  const scalars = new Map<string, string[]>();
  const pushScalar = (field: string, value: string | null): void => {
    if (!value || notInformed(value)) return;
    const arr = scalars.get(field) ?? [];
    arr.push(value.trim());
    scalars.set(field, arr);
  };

  const typologies: TypologyRaw[] = [];
  const differentials: string[] = [];

  for (const section of sections) {
    switch (section.key) {
      case 'resumo': {
        // padrão: 1 frase. Tolerância: junta linhas/bullets da seção.
        const text = section.body
          .map((l) => l.replace(BULLET_RE, '$1').trim())
          .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('|'))
          .join(' ')
          .trim();
        if (text) pushScalar('summary', text);
        break;
      }
      case 'localizacao':
      case 'status':
      case 'precos':
      case 'dimensionamento':
      case 'construtora': {
        const table =
          section.key === 'localizacao'
            ? LOCATION_LABELS
            : section.key === 'status'
              ? STATUS_LABELS
              : section.key === 'precos'
                ? PRICE_LABELS
                : section.key === 'dimensionamento'
                  ? DIMENSION_LABELS
                  : TEAM_LABELS;
        for (const line of section.body) {
          const field = asFieldLine(line);
          if (!field) continue;
          const target = matchLabel(table, field.label);
          if (target) pushScalar(target, field.value);
        }
        break;
      }
      case 'tipologias': {
        for (const line of section.body) {
          const field = asFieldLine(line);
          if (!field) continue;
          if (/^(tipologias?|tipos?)$/.test(field.label)) {
            const t = parseTypologySegments(field.value);
            if (t) typologies.push(t);
          }
        }
        break;
      }
      case 'diferenciais': {
        for (const line of section.body) {
          const bullet = line.match(BULLET_RE);
          const item = (bullet ? bullet[1] : line.trim()).trim();
          if (item && !item.startsWith('#') && !item.startsWith('|') && !notInformed(item)) {
            differentials.push(item);
          }
        }
        break;
      }
      default:
        // complementares / fontes / conflitos: auditoria humana, sem campos
        break;
    }
  }

  // ── Blocos sintéticos (1 por ocorrência) → camada de IA reutilizada ──
  // Ocorrência j de cada campo escalar vai ao bloco j: valores únicos geram
  // 1 bloco; valores repetidos DIVERGENTES geram blocos distintos, e a
  // consolidação marca 'conflicting' com as variantes — o mesmo tratamento
  // de um documento livre.
  const maxOcc = Math.max(1, ...[...scalars.values()].map((a) => a.length));
  const syntheticBlocks: BlockExtraction[] = [];
  for (let j = 0; j < maxOcc; j++) {
    const nth = (field: string): string | null => scalars.get(field)?.[j] ?? null;
    const raw = {
      location: {
        address: nth('location.address'),
        neighborhood: nth('location.neighborhood'),
        city: nth('location.city'),
        state: nth('location.state'),
        region: nth('location.region'),
        additionalInfo: nth('location.additionalInfo'),
      },
      builder: nth('builder'),
      architecture: nth('architecture'),
      landscaping: nth('landscaping'),
      status: nth('status'),
      deliveryDate: nth('deliveryDate'),
      price: nth('price'),
      totalUnits: toInt(scalars.get('totalUnits')?.[j]),
      floors: toInt(scalars.get('floors')?.[j]),
      parkingSpots: toInt(scalars.get('parkingSpots')?.[j]),
      differentials: j === 0 ? differentials.slice(0, 10) : [],
      apartmentTypes:
        j === 0
          ? typologies.slice(0, 12).map((t) => ({
              name: t.name,
              area: t.area,
              bedrooms: t.bedrooms,
              description: t.description,
              price: t.price,
            }))
          : [],
      summary: nth('summary'),
    };
    const parsedBlock = blockExtractionSchema.safeParse(normalizeBlockOutput(raw));
    if (parsedBlock.success) syntheticBlocks.push(parsedBlock.data);
  }

  const meta: DocumentBlock[] = syntheticBlocks.map((_, i) => ({
    index: i,
    text: '',
    firstPage: null,
    lastPage: null,
    offset: 0,
  }));

  const consolidated = consolidateBlocks(syntheticBlocks, meta, opts.fallbackRegion ?? null);
  const fields = consolidated.fields.map((f) =>
    f.method === 'ai' ? { ...f, method: 'rule' as const } : f,
  );

  const limitations: string[] = [];
  if (foundKeys.length < 11) {
    limitations.push(
      `Parse determinístico: ${foundKeys.length} de 11 seções canônicas reconhecidas — campos sem seção correspondente ficam ausentes para revisão.`,
    );
  }
  if (typologies.length > 12) {
    limitations.push(`Tipologias limitadas a 12 pelo schema — o documento descreve ${typologies.length}.`);
  }
  if (differentials.length > 10) {
    limitations.push(`Diferenciais limitados a 10 pelo schema — o documento lista ${differentials.length}.`);
  }
  const summaryRaw = scalars.get('summary')?.[0];
  if (summaryRaw && summaryRaw.length > 300) {
    limitations.push('Resumo truncado a 300 caracteres (limite do schema).');
  }

  return {
    fields,
    needsReview: consolidated.needsReview,
    sectionsFound: foundKeys,
    limitations,
  };
}

/**
 * Detecção barata de "documento no padrão canônico" (≥ SECTION_MATCH_THRESHOLD
 * seções). Exportada para diagnóstico/telemetria.
 */
export function matchesStandardMarkdown(content: string): boolean {
  return canonicalKeysOf(content ?? '').length >= SECTION_MATCH_THRESHOLD;
}
