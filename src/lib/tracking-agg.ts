// ============================================================
// tracking-agg — Fase 6 (tracking/relatórios, otimização Vercel)
//
// Pós-processamento puro dos resultados das agregações SQL das rotas
// de tracking (dashboard + report). A Fase 6 trocou 5 consultas
// quase idênticas de breakdown UTM (5 scans de tracking_events) por
// UMA consulta com GROUPING SETS + GROUPING() — esta lib divide as
// linhas de volta nas 5 estruturas originais, preservando os
// contratos byte a byte (rótulos default, ordenação por visitors
// desc, shapes de resposta).
//
// Puro — testável sem banco (regra 2 do prompt).
// ============================================================

/** Linha produzida pela consulta GROUPING SETS (uma por dimensão). */
export interface UtmGroupingSetRow {
  dimension: 'campaign' | 'source' | 'content' | 'medium' | 'term';
  label: string;
  visitors: bigint | number;
  leads: bigint | number;
}

export interface UtmBreakdownRows {
  byCampaign: Array<{ campaign: string; visitors: bigint | number; leads: bigint | number }>;
  bySource: Array<{ source: string; visitors: bigint | number; leads: bigint | number }>;
  byContent: Array<{ content: string; visitors: bigint | number; leads: bigint | number }>;
  byMedium: Array<{ medium: string; visitors: bigint | number; leads: bigint | number }>;
  byTerm: Array<{ term: string; visitors: bigint | number; leads: bigint | number }>;
}

function byVisitorsDesc<T extends { visitors: bigint | number }>(a: T, b: T): number {
  return Number(b.visitors) - Number(a.visitors);
}

/**
 * Divide as linhas do GROUPING SETS nos 5 breakdowns originais,
 * com os MESMOS rótulos default das consultas individuais:
 *   campaign → '(sem campanha)', source → '(orgânico/direto)',
 *   content → '(sem conteúdo)', medium/term → '(não definido)'.
 * Linhas de dimensão ausentes (banco vazio) viram arrays vazios —
 * igual ao comportamento das consultas individuais com safe().
 */
export function splitUtmGroupingRows(rows: UtmGroupingSetRow[]): UtmBreakdownRows {
  const out: UtmBreakdownRows = {
    byCampaign: [],
    bySource: [],
    byContent: [],
    byMedium: [],
    byTerm: [],
  };
  for (const row of rows ?? []) {
    switch (row.dimension) {
      case 'campaign':
        out.byCampaign.push({ campaign: row.label, visitors: row.visitors, leads: row.leads });
        break;
      case 'source':
        out.bySource.push({ source: row.label, visitors: row.visitors, leads: row.leads });
        break;
      case 'content':
        out.byContent.push({ content: row.label, visitors: row.visitors, leads: row.leads });
        break;
      case 'medium':
        out.byMedium.push({ medium: row.label, visitors: row.visitors, leads: row.leads });
        break;
      case 'term':
        out.byTerm.push({ term: row.label, visitors: row.visitors, leads: row.leads });
        break;
    }
  }
  out.byCampaign.sort(byVisitorsDesc);
  out.bySource.sort(byVisitorsDesc);
  out.byContent.sort(byVisitorsDesc);
  out.byMedium.sort(byVisitorsDesc);
  out.byTerm.sort(byVisitorsDesc);
  return out;
}

/** Linha única do funil de formulário (COUNT FILTER por estágio). */
export interface FormFunnelScanRow {
  form_view: bigint | number;
  form_focus: bigint | number;
  form_submit_attempt: bigint | number;
  form_submit: bigint | number;
  form_submit_error: bigint | number;
}

/**
 * Converte o scan único do funil de formulário na MESMA forma da
 * consulta original (GROUP BY stage sobre UNION ALL): apenas estágios
 * com count > 0, ordenados por count desc — estágio sem eventos nem
 * aparecia na resposta original.
 */
export function formFunnelFromScan(row: FormFunnelScanRow | undefined): Array<{ stage: string; count: bigint | number }> {
  if (!row) return [];
  return [
    { stage: 'form_view', count: row.form_view },
    { stage: 'form_focus', count: row.form_focus },
    { stage: 'form_submit_attempt', count: row.form_submit_attempt },
    { stage: 'form_submit', count: row.form_submit },
    { stage: 'form_submit_error', count: row.form_submit_error },
  ]
    .map((r) => ({ stage: r.stage, count: r.count }))
    .filter((r) => Number(r.count) > 0)
    .sort((a, b) => Number(b.count) - Number(a.count));
}
