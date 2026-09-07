/**
 * ============================================================
 * PERGUNTAS/RESPOSTAS OBSERVADAS POR FORMULÁRIO
 * ============================================================
 * Agrega, a partir de Client.metaFormData dos leads já capturados,
 * as perguntas do formulário e as respostas mais comuns — usadas
 * pelo painel (Anúncios Meta > Temperatura) para o admin pontuar
 * com base no que o formulário realmente pergunta e pela
 * validação cruzada da importação de regras em markdown.
 *
 * Dados de contato do Meta (nome, e-mail, telefone, CEP...) e
 * campos de rastreamento (utm_*, placement...) NUNCA aparecem —
 * apenas perguntas são consideradas.
 */

import { db } from '@/lib/db';
import { isMetaContactField, isMetaTrackingField, isUnresolvedMetaParam } from '@/lib/meta-lead-utils';

/** Quantidade de respostas distintas devolvida por pergunta (top mais comuns). */
export const MAX_OBSERVED_ANSWERS = 60;
/** Leads examinados por formulário ao agregar perguntas/respostas observadas. */
export const MAX_OBSERVED_LEADS = 2000;

export interface ObservedQuestionSummary {
  key: string;
  count: number;
  answers: Array<{ text: string; count: number }>;
  othersCount: number;
}

/**
 * Agrega PERGUNTAS/respostas observadas nos leads do formulário
 * (a partir de Client.metaFormData).
 */
export async function getObservedQuestions(formId: string): Promise<ObservedQuestionSummary[]> {
  const clients = await db.client.findMany({
    where: { metaFormId: formId, metaFormData: { not: null } },
    select: { metaFormData: true },
    orderBy: { createdAt: 'desc' },
    take: MAX_OBSERVED_LEADS,
  });

  interface ObservedAnswer { text: string; count: number }
  interface ObservedQuestion { key: string; count: number; answers: Map<string, ObservedAnswer> }
  const questions = new Map<string, ObservedQuestion>();

  for (const client of clients) {
    if (!client.metaFormData) continue;
    let parsed: Array<{ key?: string; values?: string[] }>;
    try {
      parsed = JSON.parse(client.metaFormData);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;

    for (const answer of parsed) {
      // Dados de contato (nome, e-mail, telefone, CEP...) e rastreamento
      // (utm_*, placement...) não são perguntas — leads gravados antes do
      // filtro podem tê-los no metaFormData
      if (!answer?.key || isMetaContactField(answer.key) || isMetaTrackingField(answer.key)) continue;
      let question = questions.get(answer.key);
      if (!question) {
        question = { key: answer.key, count: 0, answers: new Map() };
        questions.set(answer.key, question);
      }
      question.count += 1;
      for (const value of answer.values || []) {
        const text = String(value);
        // "{{campaign.name}}" etc. = parâmetro dinâmico não resolvido — sem informação
        if (!text || isUnresolvedMetaParam(text)) continue;
        const existing = question.answers.get(text);
        if (existing) existing.count += 1;
        else question.answers.set(text, { text, count: 1 });
      }
    }
  }

  return Array.from(questions.values()).map((question) => {
    const answers = Array.from(question.answers.values()).sort((a, b) => b.count - a.count);
    const top = answers.slice(0, MAX_OBSERVED_ANSWERS);
    const othersCount = answers.slice(MAX_OBSERVED_ANSWERS).reduce((acc, a) => acc + a.count, 0);
    return {
      key: question.key,
      count: question.count,
      answers: top,
      othersCount,
    };
  });
}
