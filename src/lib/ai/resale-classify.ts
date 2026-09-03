/**
 * resale-classify.ts — Classificação determinística do importador de revenda
 * (prompt v1.0 §13 — o parser continua 100% determinístico; aqui apenas
 * classificamos cada registro ANTES de gravar, para revisão humana).
 *
 * Status por registro (§13.2):
 *  - novo: código não existe no banco.
 *  - alterado: existe e ao menos um campo comparável difere (diff anexado).
 *  - inalterado: existe e nada difere.
 *  - duplicado: código repetido no MESMO arquivo (1ª ocorrência prevalece).
 *  - erro: registro inválido (sem código).
 *
 * Nenhuma IA generativa aqui — comparação campo a campo com normalização
 * mínima (trim e case em strings, comparação numérica em valores).
 */

export interface ResaleRecord {
  code: string;
  sortOrder?: number;
  name?: string | null;
  region?: string | null;
  category?: string | null;
  typology?: string | null;
  bedrooms?: number | null;
  area?: number | string | null;
  address?: string | null;
  captor?: string | null;
  appointment?: string | null;
  phone?: string | null;
  phoneDigits?: string | null;
  price?: number | string | null;
  condo?: number | string | null;
  iptu?: number | string | null;
  notes?: string | null;
  acceptsFinancing?: boolean | null;
  acceptsFgts?: boolean | null;
  url?: string | null;
  dataNote?: string | null;
  sourcePage?: number | null;
}

export type ResaleRecordStatus = 'novo' | 'alterado' | 'inalterado' | 'duplicado' | 'erro';

export interface ClassifiedRecord<T extends ResaleRecord = ResaleRecord> {
  record: T;
  status: ResaleRecordStatus;
  /** campo → { de, para } apenas quando status = alterado */
  diff: Array<{ field: string; from: string; to: string }>;
  reason?: string;
}

/** Campos comparáveis (§13.3 — diff campo a campo). Campos de metadados
 *  (sortOrder, sourcePage, dataNote, phoneDigits) não entram no diff. */
const COMPARED_FIELDS: Array<keyof ResaleRecord> = [
  'name', 'region', 'category', 'typology', 'bedrooms', 'area', 'address',
  'captor', 'appointment', 'phone', 'price', 'condo', 'iptu', 'notes', 'url',
  'acceptsFinancing', 'acceptsFgts',
];

function normStr(v: unknown): string {
  return (v ?? '').toString().trim();
}

function diffRecord(existing: ResaleRecord, incoming: ResaleRecord): ClassifiedRecord['diff'] {
  const diff: ClassifiedRecord['diff'] = [];
  for (const field of COMPARED_FIELDS) {
    const a = normStr(existing[field]);
    const b = normStr(incoming[field]);
    if (a !== b) {
      diff.push({ field: String(field), from: a || '(vazio)', to: b || '(vazio)' });
    }
  }
  return diff;
}

export function classifyRecords<T extends ResaleRecord>(
  incoming: T[],
  existingByCode: Map<string, ResaleRecord>,
): ClassifiedRecord<T>[] {
  const seenCodes = new Set<string>();
  const result: ClassifiedRecord<T>[] = [];

  for (const rec of incoming) {
    const code = normStr(rec.code);
    if (!code) {
      result.push({
        record: rec,
        status: 'erro',
        diff: [],
        reason: 'Registro sem código — não é possível importar com segurança.',
      });
      continue;
    }
    if (seenCodes.has(code)) {
      result.push({
        record: rec,
        status: 'duplicado',
        diff: [],
        reason: `Código ${code} aparece mais de uma vez no arquivo — apenas a primeira ocorrência seria importada.`,
      });
      continue;
    }
    seenCodes.add(code);

    const existing = existingByCode.get(code);
    if (!existing) {
      result.push({ record: rec, status: 'novo', diff: [] });
      continue;
    }
    const diff = diffRecord(existing, rec);
    result.push(
      diff.length === 0
        ? { record: rec, status: 'inalterado', diff: [] }
        : { record: rec, status: 'alterado', diff },
    );
  }

  return result;
}

/** Resumo do impacto antes da gravação (§13.3). */
export function summarizeClassification<T extends ResaleRecord>(records: ClassifiedRecord<T>[]): {
  novo: number; alterado: number; inalterado: number; duplicado: number; erro: number; total: number;
} {
  const acc = { novo: 0, alterado: 0, inalterado: 0, duplicado: 0, erro: 0, total: records.length };
  for (const r of records) acc[r.status]++;
  return acc;
}
