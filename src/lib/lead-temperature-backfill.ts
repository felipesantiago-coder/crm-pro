/**
 * ============================================================
 * LEAD TEMPERATURE — BACKFILL de formulários/leads ANTIGOS
 * ============================================================
 * Leads importados ANTES do recurso de temperatura não têm
 * metaFormId nem metaFormData — mas guardam, no texto de
 * Client.notes, o formulário de origem e as respostas
 * recebidas ("Respostas do formulário: • pergunta: resposta").
 *
 * Este módulo recupera ESSES dados já recebidos, sem depender
 * de novos leads e sem chamadas externas ao Meta:
 *   1. parsers puros (testáveis) extraem formId/formName e as
 *      respostas do texto das notes;
 *   2. discoverLegacyForms agrupa leads ainda não vinculados
 *      por formulário detectado;
 *   3. backfillFormLeads vincula os leads a um formId e reconstrói
 *      metaFormData — a partir daí perguntas/respostas aparecem
 *      no painel Temperatura e a reclassificação retroativa
 *      funciona para leads antigos.
 *
 * Formatos de notes produzidos pelas rotas de ingestão:
 *   import-by-form / import-manual:
 *     "[Meta Ads] Lead importado por formulário e período.\nLead ID: X\nForm ID: 123..."
 *   webhook:
 *     "[Meta Ads] Lead recebido automaticamente.\n...Formulário: Nome (ID: 123)\nLead ID: X..."
 *   (todos) respostas:
 *     "\n\nRespostas do formulário:\n  • pergunta: resposta\n  • ..."
 */

import { db } from '@/lib/db';
import type { RawLeadAnswer } from '@/lib/meta-lead-utils';

// ─────────────────────────────────────────────
// Parsers puros (texto das notes → dados)
// ─────────────────────────────────────────────

/** "Form ID: 123456789" (import-manual / import-by-form). */
const RE_FORM_ID_EXPLICIT = /Form ID:\s*(\d+)/i;
/** "Formulário: Villa Bianco (ID: 123456789)" (webhook). */
const RE_FORM_ID_INLINE = /Formul[áa]rio:[^\n]*?\(ID:\s*(\d+)\)/i;
/** Nome do formulário no padrão do webhook (para sugerir no painel). */
const RE_FORM_NAME_INLINE = /Formul[áa]rio:\s*(.*?)\s*\(ID:\s*\d+\)/i;
/** Bloco de respostas gravado por formatCustomAnswersText(). */
const RE_ANSWERS_HEADER = /Respostas do formul[áa]rio:\s*\n/i;
/** Linha "  • pergunta: resposta" dentro do bloco. */
const RE_ANSWER_LINE = /^\s*[•\-*]\s*(.+?)\s*:\s?(.*)$/;
/** Tag de origem gravada pela importação por formulário. */
const UTM_IMPORT_PREFIX = 'import_by_form:';

/** Extrai o formId das notes — null quando não há referência. */
export function parseNotesFormId(notes: string | null | undefined): string | null {
  if (!notes) return null;
  return notes.match(RE_FORM_ID_EXPLICIT)?.[1] || notes.match(RE_FORM_ID_INLINE)?.[1] || null;
}

/** Extrai o nome do formulário das notes (padrão webhook) — pode ser null. */
export function parseNotesFormName(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const name = notes.match(RE_FORM_NAME_INLINE)?.[1]?.trim();
  return name ? name : null;
}

/**
 * Extrai as respostas do bloco "Respostas do formulário:" das notes.
 *   - valor é o texto APÓS o primeiro ":" da linha (respostas podem conter ":");
 *   - chaves repetidas acumulam valores (defesa);
 *   - o bloco termina na primeira linha fora do padrão (nunca engole o resto
 *     das notes — cabeçalhos, Lead ID etc.);
 *   - campos padrão (nome/email/telefone/cidade) NUNCA aparecem no bloco
 *     (formatCustomAnswersText já os exclui na origem).
 */
export function parseNotesAnswers(notes: string | null | undefined): RawLeadAnswer[] {
  if (!notes) return [];

  const header = notes.match(RE_ANSWERS_HEADER);
  if (!header || header.index === undefined) return [];

  const block = notes.slice(header.index + header[0].length);
  const answers: RawLeadAnswer[] = [];
  const byKey = new Map<string, RawLeadAnswer>();

  for (const line of block.split('\n')) {
    if (!line.trim()) continue;
    const match = line.match(RE_ANSWER_LINE);
    if (!match) break; // fim do bloco

    const key = match[1].trim();
    const value = match[2].trim();
    if (!key || !value) continue;

    const existing = byKey.get(key);
    if (existing) {
      if (!existing.values.includes(value)) existing.values.push(value);
      continue;
    }
    const answer: RawLeadAnswer = { key, values: [value] };
    byKey.set(key, answer);
    answers.push(answer);
  }

  return answers;
}

/** true quando as notes/utm sugerem que o lead veio do formId informado. */
export function notesMatchForm(
  notes: string | null | undefined,
  utmCampaign: string | null | undefined,
  formId: string,
): boolean {
  const parsed = parseNotesFormId(notes);
  if (parsed) return parsed === formId;
  // Fallback: leads reimportados por formulário ganham
  // utmCampaign = "import_by_form:{formId}" mesmo sem notes atualizadas
  return String(utmCampaign || '').startsWith(`${UTM_IMPORT_PREFIX}${formId}`);
}

// ─────────────────────────────────────────────
// Descoberta (somente leitura)
// ─────────────────────────────────────────────

export interface LegacyFormInfo {
  formId: string;
  formName: string | null;
  /** Leads antigos detectados para o formulário. */
  leadCount: number;
  /** Destes, quantos têm respostas recuperáveis das notes. */
  withAnswers: number;
}

export interface DiscoveryResult {
  forms: LegacyFormInfo[];
  /** Leads antigos (metaLeadgenId, sem metaFormId) examinados. */
  scanned: number;
  /** true quando o teto de varredura interrompeu a busca. */
  truncated: boolean;
}

/** Teto de varredura por execução (defesa contra bases enormes). */
export const DISCOVERY_SCAN_LIMIT = 10_000;
const BATCH = 500;

/**
 * Varre leads de Meta ainda sem metaFormId e agrupa pelos formulários
 * detectados nas notes/utm. Somente leitura — nunca grava.
 */
export async function discoverLegacyForms(): Promise<DiscoveryResult> {
  const byForm = new Map<string, LegacyFormInfo>();
  let scanned = 0;
  let truncated = false;
  let cursor: string | undefined;

  for (;;) {
    const batch = await db.client.findMany({
      where: { metaLeadgenId: { not: null }, metaFormId: null },
      select: { id: true, notes: true, utmCampaign: true },
      orderBy: { id: 'asc' },
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      take: BATCH,
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;

    for (const client of batch) {
      scanned += 1;
      const formId = parseNotesFormId(client.notes);
      if (formId) {
        const entry = byForm.get(formId) || { formId, formName: null, leadCount: 0, withAnswers: 0 };
        entry.leadCount += 1;
        if (parseNotesAnswers(client.notes).length > 0) entry.withAnswers += 1;
        if (!entry.formName) entry.formName = parseNotesFormName(client.notes);
        byForm.set(formId, entry);
        continue;
      }
      // Sem formId nas notes: conta via tag de importação (sem respostas)
      const utm = String(client.utmCampaign || '');
      if (utm.startsWith(UTM_IMPORT_PREFIX)) {
        const utmFormId = utm.slice(UTM_IMPORT_PREFIX.length).trim();
        if (utmFormId) {
          const entry = byForm.get(utmFormId) || { formId: utmFormId, formName: null, leadCount: 0, withAnswers: 0 };
          entry.leadCount += 1;
          byForm.set(utmFormId, entry);
        }
      }
    }

    if (scanned >= DISCOVERY_SCAN_LIMIT) {
      truncated = true;
      break;
    }
  }

  const forms = Array.from(byForm.values())
    .map((f) => ({ ...f, formName: f.formName || null }))
    .sort((a, b) => b.leadCount - a.leadCount);

  return { forms, scanned, truncated };
}

// ─────────────────────────────────────────────
// Backfill (grava metaFormId / metaFormData)
// ─────────────────────────────────────────────

export interface BackfillResult {
  /** Leads antigos do formulário examinados. */
  total: number;
  /** Leads vinculados agora (metaFormId preenchido). */
  linked: number;
  /** Destes, quantos tiveram respostas reconstruídas em metaFormData. */
  withAnswers: number;
  /** Leads já vinculados antes desta execução (idempotência). */
  alreadyLinked: number;
}

/**
 * Vincula os leads antigos ao formId e reconstrói metaFormData a partir
 * das notes. IDEMPOTENTE: leads já vinculados não são tocados.
 * Nunca altera metaScore/metaTemperature — isso cabe à reclassificação,
 * que o admin dispara ao salvar a config no painel.
 */
export async function backfillFormLeads(formId: string): Promise<BackfillResult> {
  const result: BackfillResult = { total: 0, linked: 0, withAnswers: 0, alreadyLinked: 0 };
  if (!formId) return result;

  // Idempotência: quantos leads deste formulário já estavam vinculados
  result.alreadyLinked = await db.client.count({ where: { metaFormId: formId } }).catch(() => 0);

  let cursor: string | undefined;

  for (;;) {
    const batch = await db.client.findMany({
      where: {
        metaLeadgenId: { not: null },
        metaFormId: null,
        OR: [
          { notes: { contains: `Form ID: ${formId}` } },
          { notes: { contains: `(ID: ${formId})` } },
          { utmCampaign: { startsWith: `${UTM_IMPORT_PREFIX}${formId}` } },
        ],
      },
      select: { id: true, notes: true, utmCampaign: true, metaFormData: true },
      orderBy: { id: 'asc' },
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      take: BATCH,
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;

    for (const client of batch) {
      result.total += 1;
      // Confirmação defensiva: o texto tem que citar ESTE formulário
      if (!notesMatchForm(client.notes, client.utmCampaign, formId)) continue;

      const answers = parseNotesAnswers(client.notes);
      await db.client.update({
        where: { id: client.id },
        data: {
          metaFormId: formId,
          ...(answers.length > 0 && !client.metaFormData ? { metaFormData: JSON.stringify(answers) } : {}),
        },
        select: { id: true },
      }).catch(() => {});

      result.linked += 1;
      if (answers.length > 0) result.withAnswers += 1;
    }
  }

  console.log(
    `[Lead Temperature] Backfill form=${formId}: examinados=${result.total}, vinculados=${result.linked}, comRespostas=${result.withAnswers}`,
  );
  return result;
}
