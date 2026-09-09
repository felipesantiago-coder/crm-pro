// ============================================================
// Meta Dataset Quality API — métricas REAIS do Events Manager.
//
// Endpoint: GET https://graph.facebook.com/v26.0/dataset_quality
// Doc: developers.facebook.com/docs/marketing-api/conversions-api/dataset-quality-api
//
// Retorna por evento: EMQ (Event Match Quality, nota 0-10 real calculada
// pela Meta), cobertura de cada match key, event coverage (7d) e
// diagnostics (problemas identificados pela Meta com recomendações).
//
// Diferença crucial vs. sendTestCapEvent: o teste do raio só confirma
// RECEBIMENTO de um evento sintético; estas métricas refletem o tráfego
// REAL e só existem após ~24-48h de envios.
// ============================================================

export const DATASET_QUALITY_FIELDS_FULL =
  'web{event_name,event_match_quality{composite_score,match_key_feedback{identifier,coverage{percentage}},diagnostics{name,description,solution,percentage,affected_event_count,total_event_count}},event_coverage{percentage,goal_percentage}}';

export const DATASET_QUALITY_FIELDS_MINIMAL =
  'web{event_name,event_match_quality{composite_score,match_key_feedback{identifier,coverage{percentage}}}}';

// ────────────────────────────────────────────────────────────
// Tipos normalizados (o que o painel consome)
// ────────────────────────────────────────────────────────────

export interface QualityMatchKey {
  identifier: string;
  percentage: number | null;
}

export interface QualityDiagnostic {
  name: string;
  description?: string | null;
  solution?: string | null;
  percentage?: number | null;
  affectedEventCount?: number | null;
  totalEventCount?: number | null;
}

export interface QualityEvent {
  eventName: string;
  /** EMQ real (composite_score 0-10) ou null se a Meta não calculou. */
  emq: number | null;
  matchKeys: QualityMatchKey[];
  coverage: { percentage: number | null; goal: number | null } | null;
  diagnostics: QualityDiagnostic[];
}

export interface ParsedDatasetQuality {
  events: QualityEvent[];
}

export type EmqTone = 'good' | 'mid' | 'low' | 'none';

/** Faixa visual do EMQ: ≥7 bom (verde), 4-6.9 médio (âmbar), <4 fraco (vermelho). Pura. */
export function emqTone(score: number | null | undefined): EmqTone {
  if (score == null || typeof score !== 'number' || isNaN(score)) return 'none';
  if (score >= 7) return 'good';
  if (score >= 4) return 'mid';
  return 'low';
}

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return isNaN(n) ? null : n;
}

function parseMatchKeys(feedback: unknown): QualityMatchKey[] {
  if (!Array.isArray(feedback)) return [];
  return feedback
    .filter((f) => f && typeof f === 'object' && typeof (f as any).identifier === 'string')
    .map((f: any) => ({
      identifier: f.identifier,
      percentage: toNumber(f?.coverage?.percentage),
    }));
}

function parseDiagnostics(diagnostics: unknown): QualityDiagnostic[] {
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics
    .filter((d) => d && typeof d === 'object' && typeof (d as any).name === 'string')
    .map((d: any) => ({
      name: d.name,
      description: typeof d.description === 'string' ? d.description : null,
      solution: typeof d.solution === 'string' ? d.solution : null,
      percentage: toNumber(d.percentage),
      affectedEventCount: toNumber(d.affected_event_count),
      totalEventCount: toNumber(d.total_event_count),
    }));
}

/**
 * Normaliza a resposta crua do dataset_quality para o formato do painel.
 * Defensiva: campos ausentes/tipos inesperados viram null/array vazio
 * (a Meta varia o shape entre versões e tipos de dataset). Pura — testável.
 */
export function parseDatasetQuality(raw: unknown): ParsedDatasetQuality {
  const web = (raw as any)?.web;
  if (!Array.isArray(web)) return { events: [] };
  const events: QualityEvent[] = web
    .filter((e) => e && typeof e === 'object')
    .map((e: any) => {
      const emqBlock = e.event_match_quality ?? {};
      const coverage = e.event_coverage ?? null;
      return {
        eventName: typeof e.event_name === 'string' ? e.event_name : '(sem nome)',
        emq: toNumber(emqBlock.composite_score),
        matchKeys: parseMatchKeys(emqBlock.match_key_feedback),
        coverage:
          coverage && typeof coverage === 'object'
            ? {
                percentage: toNumber(coverage.percentage),
                goal: toNumber(coverage.goal_percentage),
              }
            : null,
        diagnostics: parseDiagnostics(emqBlock.diagnostics),
      };
    });
  return { events };
}

// ────────────────────────────────────────────────────────────
// Fetch (server-side) — chamada Graph com fallback de fields
// ────────────────────────────────────────────────────────────

export interface DatasetQualityResult {
  ok: boolean;
  /** Mensagem de erro amigável para o admin. */
  error?: string;
  /** true quando o erro parece ser token inválido/expirado (Graph 190). */
  tokenInvalid?: boolean;
  /** true quando a Meta respondeu sem dados (dataset novo/sem tráfego). */
  empty?: boolean;
  parsed?: ParsedDatasetQuality;
  raw?: unknown;
}

/**
 * Busca as métricas de qualidade de um dataset. Tenta o conjunto completo
 * de fields; se a Meta rejeitar algum campo (erro de field desconhecido em
 * versões/tipos de dataset diferentes), repete com o conjunto mínimo.
 */
export async function fetchDatasetQuality(
  accessToken: string,
  datasetId: string
): Promise<DatasetQualityResult> {
  const call = async (fields: string) => {
    const url =
      `https://graph.facebook.com/v26.0/dataset_quality` +
      `?dataset_id=${encodeURIComponent(datasetId)}` +
      `&fields=${encodeURIComponent(fields)}` +
      `&access_token=${encodeURIComponent(accessToken)}`;
    const response = await fetch(url, { method: 'GET' });
    const body = await response.json().catch(() => null);
    return { response, body };
  };

  const toError = (body: any): DatasetQualityResult => {
    const graphError = body?.error;
    const code = graphError?.code;
    const message = graphError?.message || 'Erro desconhecido na Graph API';
    return {
      ok: false,
      tokenInvalid: code === 190,
      error: message,
    };
  };

  try {
    let { response, body } = await call(DATASET_QUALITY_FIELDS_FULL);

    // Field desconhecido (code 100 subcode ...) → tenta o mínimo documentado.
    if (!response.ok && body?.error?.code === 100) {
      ({ response, body } = await call(DATASET_QUALITY_FIELDS_MINIMAL));
    }

    if (!response.ok) return toError(body);
    if (body?.error) return toError(body);

    const parsed = parseDatasetQuality(body);
    return {
      ok: true,
      parsed,
      empty: parsed.events.length === 0,
      raw: body,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Falha de rede ao consultar a Meta',
    };
  }
}
