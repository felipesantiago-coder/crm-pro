/**
 * ============================================================
 * LEAD TEMPERATURE — Temperatura do lead POR FORMULÁRIO Meta
 * ============================================================
 * Cada formulário Meta Ads (formId) tem a SUA própria configuração
 * de pontuação, criada pelo ADMINISTRADOR:
 *   - um valor INTEIRO por resposta de cada pergunta;
 *   - (opcional) nota fixa para perguntas dissertativas — qualquer
 *     resposta recebe a nota da pergunta;
 *   - limiares warmMin/hotMin ESPECÍFICOS do formulário.
 * Ao chegar um lead, o sistema SOMA as notas das respostas dadas e
 * classifica com o limiar do formulário de origem:
 *   score >= hotMin  → QUENTE
 *   score >= warmMin → MORNO
 *   score <  warmMin → FRIO
 * Nada aqui é genérico: sem configuração para o formulário, o lead
 * não recebe temperatura.
 *
 * Usado por: webhook meta-leads, import-manual, import-by-form,
 * cron fetch-meta-leads, APIs /api/meta-ads/temperature e painel
 * Anúncios Meta > Temperatura.
 */

import { db } from '@/lib/db';
import type { RawLeadAnswer } from '@/lib/meta-lead-utils';

// ─────────────────────────────────────────────
// Tipos públicos
// ─────────────────────────────────────────────

export type LeadTemperature = 'FRIO' | 'MORNO' | 'QUENTE';

/** Nota inteira de UMA resposta de uma pergunta do formulário. */
export interface ScoringAnswer {
  /** Texto da resposta exatamente como o Meta envia (case-insensitive no match). */
  text: string;
  /** Valor inteiro atribuído pelo administrador (pode ser negativo ou zero). */
  score: number;
}

/** Configuração de uma pergunta do formulário. */
export interface ScoringQuestion {
  /** Nome do campo no field_data do Meta (pergunta). */
  key: string;
  /** Rótulo legível — por padrão o próprio key. */
  label?: string;
  /** Perguntas dissertativas: se configurado, QUALQUER resposta recebe
   *  esta nota quando nenhuma resposta específica casar. Ignorado quando
   *  uma resposta configurada casar (evita pontuação dupla). */
  questionScore?: number;
  /** Notas por resposta (múltipla escolha / dropdown / checkboxes). */
  answers: ScoringAnswer[];
}

export interface ParsedScoringConfig {
  questions: ScoringQuestion[];
}

/** Item do detalhamento da pontuação de um lead (auditoria no painel). */
export interface ScoreBreakdownItem {
  /** Pergunta (nome do campo). */
  key: string;
  /** Resposta(s) dada(s) pelo lead (valores concatenados p/ exibição). */
  answer: string;
  /** true = nota configurada aplicada; false = resposta sem nota (0). */
  matched: boolean;
  /** Pontos contribuídos por esta resposta. */
  score: number;
}

export interface LeadScoreResult {
  /** Soma das notas das respostas do lead. */
  score: number;
  /** Classificação final — null quando o formulário está sem config ativa. */
  temperature: LeadTemperature | null;
  /** Detalhamento pergunta a pergunta (transparência do cálculo). */
  breakdown: ScoreBreakdownItem[];
  /** true quando a config do formulário existe e está ativa. */
  configured: boolean;
}

export interface FormScoringSnapshot {
  formId: string;
  formName: string | null;
  enabled: boolean;
  warmMin: number;
  hotMin: number;
  config: ParsedScoringConfig | null;
}

// ─────────────────────────────────────────────
// Normalização (alinhada com meta-lead-utils)
// ─────────────────────────────────────────────

/** Mesma normalização dos nomes de campos do Meta (meta-lead-utils). */
export function normalizeQuestionKey(key: string): string {
  return String(key).toLowerCase().replace(/[_\s-]/g, '');
}

/** Chave de match de resposta: trim + minúsculas (mantém acentos —
 *  respostas do Meta são texto exibido ao usuário). */
function normalizeAnswerText(text: string): string {
  return String(text).trim().toLowerCase();
}

// ─────────────────────────────────────────────
// Config (parse + validação)
// ─────────────────────────────────────────────

/**
 * Faz o parse do JSON de config armazenado em LeadFormScoring.config.
 * Retorna null quando vazio/inválido — config corrompida nunca derruba
 * a ingestão de leads.
 */
export function parseScoringConfig(configJson: string | null | undefined): ParsedScoringConfig | null {
  if (!configJson) return null;
  try {
    const parsed = JSON.parse(configJson);
    if (!parsed || !Array.isArray(parsed.questions)) return null;

    const questions: ScoringQuestion[] = [];
    for (const q of parsed.questions) {
      if (!q || typeof q.key !== 'string' || !q.key.trim()) continue;
      const answers: ScoringAnswer[] = Array.isArray(q.answers)
        ? q.answers
            .filter((a: unknown): a is ScoringAnswer =>
              !!a && typeof (a as ScoringAnswer).text === 'string' && !!(a as ScoringAnswer).text.trim())
            .map((a: ScoringAnswer) => ({ text: a.text, score: Math.trunc(Number(a.score) || 0) }))
        : [];
      const hasQuestionScore = q.questionScore !== undefined && q.questionScore !== null && Number.isFinite(Number(q.questionScore));
      questions.push({
        key: q.key,
        ...(typeof q.label === 'string' && q.label.trim() ? { label: q.label } : {}),
        ...(hasQuestionScore ? { questionScore: Math.trunc(Number(q.questionScore)) } : {}),
        answers,
      });
    }
    return { questions };
  } catch {
    return null;
  }
}

/** Classificação pelo limiar do formulário (puro — usado em testes). */
export function classifyScore(score: number, warmMin: number, hotMin: number): LeadTemperature {
  if (score >= hotMin) return 'QUENTE';
  if (score >= warmMin) return 'MORNO';
  return 'FRIO';
}

// ─────────────────────────────────────────────
// Motor de pontuação (puro — sem DB, testável)
// ─────────────────────────────────────────────

/**
 * Soma as notas das respostas de um lead a partir da config parseada.
 * Regras:
 *   - match de pergunta por chave normalizada (igual meta-lead-utils);
 *   - match de resposta case-insensitive (trim);
 *   - múltipla escolha: TODOS os valores selecionados somam;
 *   - questionScore aplica apenas quando NENHUMA resposta configurada casar;
 *   - respostas não configuradas somam 0 (aparecem no breakdown com matched=false).
 */
export function computeLeadScoreFromConfig(
  rawAnswers: RawLeadAnswer[],
  scoring: Pick<FormScoringSnapshot, 'enabled' | 'warmMin' | 'hotMin' | 'config'>,
): LeadScoreResult {
  const empty: LeadScoreResult = { score: 0, temperature: null, breakdown: [], configured: false };
  if (!scoring?.enabled || !scoring.config) return empty;

  // Índice por chave normalizada da pergunta
  const questionIndex = new Map<string, ScoringQuestion>();
  for (const q of scoring.config.questions) {
    questionIndex.set(normalizeQuestionKey(q.key), q);
  }

  const breakdown: ScoreBreakdownItem[] = [];
  let score = 0;

  for (const raw of rawAnswers) {
    const question = questionIndex.get(normalizeQuestionKey(raw.key));
    // Pergunta sem configuração → resposta entra no breakdown como 0
    if (!question) {
      breakdown.push({ key: raw.key, answer: raw.values.join(', '), matched: false, score: 0 });
      continue;
    }

    const answerIndex = new Map<string, number>();
    for (const a of question.answers) {
      answerIndex.set(normalizeAnswerText(a.text), a.score);
    }

    let questionPoints = 0;
    let anyMatched = false;
    const matchedValues: string[] = [];

    for (const value of raw.values) {
      const hit = answerIndex.get(normalizeAnswerText(value));
      if (hit !== undefined) {
        anyMatched = true;
        matchedValues.push(value);
        questionPoints += hit;
      }
    }

    if (anyMatched) {
      // Resposta(s) configurada(s) casaram — nota delas vence o questionScore
      score += questionPoints;
      breakdown.push({ key: raw.key, answer: matchedValues.join(', '), matched: true, score: questionPoints });
    } else if (question.questionScore !== undefined && raw.values.length > 0) {
      // Dissertativa (ou fallback): qualquer resposta recebe a nota da pergunta
      score += question.questionScore;
      breakdown.push({ key: raw.key, answer: raw.values.join(', '), matched: true, score: question.questionScore });
    } else {
      breakdown.push({ key: raw.key, answer: raw.values.join(', '), matched: false, score: 0 });
    }
  }

  return {
    score,
    temperature: classifyScore(score, scoring.warmMin, scoring.hotMin),
    breakdown,
    configured: true,
  };
}

// ─────────────────────────────────────────────
// Cache de config (evita query por lead)
// ─────────────────────────────────────────────

const SCORING_CACHE_TTL_MS = 60_000;
const scoringCache = new Map<string, { expires: number; snapshot: FormScoringSnapshot | null }>();

/** Invalida o cache — chamado ao salvar/remover config no painel. */
export function invalidateScoringCache(formId?: string): void {
  if (formId) scoringCache.delete(formId);
  else scoringCache.clear();
}

/**
 * Snapshot da config do formulário (cache 60s). null = formulário sem config.
 * Falhas de leitura retornam null (ingestão nunca deve quebrar por isso).
 */
export async function getFormScoring(formId: string | null | undefined): Promise<FormScoringSnapshot | null> {
  if (!formId) return null;
  const cached = scoringCache.get(formId);
  if (cached && cached.expires > Date.now()) return cached.snapshot;

  try {
    const row = await db.leadFormScoring.findUnique({ where: { formId } });
    const snapshot: FormScoringSnapshot | null = row
      ? {
          formId: row.formId,
          formName: row.formName,
          enabled: row.enabled,
          warmMin: row.warmMin,
          hotMin: row.hotMin,
          config: parseScoringConfig(row.config),
        }
      : null;
    scoringCache.set(formId, { expires: Date.now() + SCORING_CACHE_TTL_MS, snapshot });
    return snapshot;
  } catch (err) {
    console.warn('[Lead Temperature] Falha ao ler config do formulário:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ─────────────────────────────────────────────
// Integração na ingestão de leads
// ─────────────────────────────────────────────

/**
 * Pontua as respostas de um lead com a config do formulário.
 * Retorna null quando o formulário está sem config ATIVA —
 * o lead continua sendo criado, apenas sem temperatura.
 */
export async function scoreLeadAnswers(
  formId: string | null | undefined,
  rawAnswers: RawLeadAnswer[],
): Promise<{ score: number; temperature: LeadTemperature } | null> {
  if (!formId) return null;
  const snapshot = await getFormScoring(formId);
  if (!snapshot || !snapshot.enabled) return null;
  const result = computeLeadScoreFromConfig(rawAnswers, snapshot);
  if (!result.configured) return null;
  return { score: result.score, temperature: result.temperature! };
}

/**
 * Campos prontos para spread em client.create / client.update:
 *   - metaFormId + metaFormData: SEMPRE gravados (mesmo sem config) —
 *     permitem configurar a temperatura depois e reclassificar retroativamente;
 *   - metaScore + metaTemperature: apenas com config ativa.
 * objeto vazio quando não é lead de formulário Meta (sem formId).
 */
export async function buildLeadTemperatureFields(
  formId: string | null | undefined,
  rawAnswers: RawLeadAnswer[],
): Promise<Partial<{ metaFormId: string; metaFormData: string; metaScore: number; metaTemperature: string }>> {
  if (!formId) return {};
  const fields: Partial<{ metaFormId: string; metaFormData: string; metaScore: number; metaTemperature: string }> = {
    metaFormId: formId,
  };
  if (rawAnswers.length > 0) {
    try {
      fields.metaFormData = JSON.stringify(rawAnswers);
    } catch {
      // Serialização improvável de falhar — segue sem metaFormData
    }
  }
  const scored = await scoreLeadAnswers(formId, rawAnswers);
  if (scored) {
    fields.metaScore = scored.score;
    fields.metaTemperature = scored.temperature;
  }
  return fields;
}

// ─────────────────────────────────────────────
// Reclassificação retroativa
// ─────────────────────────────────────────────

export interface ReclassifyResult {
  /** Leads do formulário examinados (clients com metaFormId = formId). */
  total: number;
  /** Leads com pontuação calculada (config ativa e dados disponíveis). */
  scored: number;
  quente: number;
  morno: number;
  frio: number;
  /** Sem pontuação após a reclassificação (config inativa, sem dados antigos…). */
  semPontuacao: number;
}

/**
 * Reclassifica TODOS os leads (clients) do formulário usando a config ATUAL.
 *   - config ativa: recalcula metaScore/metaTemperature a partir de metaFormData;
 *   - config inativa/ausente: LIMPA metaScore/metaTemperature (sem classificação
 *     obsoleta no painel);
 *   - leads antigos sem metaFormData (capturados antes da funcionalidade) não
 *     podem ser pontuados retroativamente — contam em semPontuacao.
 */
export async function reclassifyFormLeads(formId: string): Promise<ReclassifyResult> {
  const snapshot = await getFormScoring(formId);
  const active = !!snapshot?.enabled && !!snapshot?.config;

  const result: ReclassifyResult = { total: 0, scored: 0, quente: 0, morno: 0, frio: 0, semPontuacao: 0 };
  const BATCH = 200;
  let cursor: string | undefined;

  // Loop em lotes ordenados por id — seguro para grandes volumes
  for (;;) {
    const batch = await db.client.findMany({
      where: { metaFormId: formId },
      select: { id: true, metaFormData: true, metaScore: true, metaTemperature: true },
      orderBy: { id: 'asc' },
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      take: BATCH,
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;

    for (const client of batch) {
      result.total += 1;

      let nextScore: number | null = null;
      let nextTemp: string | null = null;

      if (active && client.metaFormData) {
        try {
          const rawAnswers = JSON.parse(client.metaFormData) as RawLeadAnswer[];
          if (Array.isArray(rawAnswers) && rawAnswers.length > 0) {
            const computed = computeLeadScoreFromConfig(rawAnswers, snapshot!);
            if (computed.configured) {
              nextScore = computed.score;
              nextTemp = computed.temperature!;
            }
          }
        } catch {
          // metaFormData corrompido → lead fica sem pontuação
        }
      }

      const changed = client.metaScore !== nextScore || client.metaTemperature !== nextTemp;
      if (changed) {
        await db.client.update({
          where: { id: client.id },
          data: { metaScore: nextScore, metaTemperature: nextTemp },
          select: { id: true },
        }).catch(() => {});
      }

      if (nextTemp === 'QUENTE') result.quente += 1;
      else if (nextTemp === 'MORNO') result.morno += 1;
      else if (nextTemp === 'FRIO') result.frio += 1;
      else result.semPontuacao += 1;
      if (nextTemp) result.scored += 1;
    }
  }

  if (active) {
    await db.leadFormScoring.updateMany({
      where: { formId },
      data: { reclassifiedAt: new Date() },
    }).catch(() => {});
  }

  console.log(`[Lead Temperature] Reclassificação form=${formId}: total=${result.total}, quente=${result.quente}, morno=${result.morno}, frio=${result.frio}, semPontuacao=${result.semPontuacao}`);
  return result;
}
