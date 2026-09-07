/**
 * ============================================================
 * CLASSIFICAÇÃO DO LEAD — rótulos e orientação de tratativa
 * ============================================================
 * Fonte ÚNICA da apresentação da temperatura do lead (QUENTE /
 * MORNO / FRIO) usada por DOIS pontos de contato:
 *   1. Cartão Telegram (lead-notify/present.ts + composer.ts);
 *   2. Perfil do lead no CRM (client-detail.tsx) e cartão na lista.
 *
 * Garante paridade entre o que o atendente vê no CRM e o que
 * recebe no Telegram, e centraliza os textos de orientação de
 * tratativa — escritos em Português do Brasil, revisados em
 * concordância, regência, crase e pontuação. Módulo PURO: sem
 * rede, sem DB, sem imports de servidor (pode ser usado no
 * client components).
 */

export type LeadTemperatureClassification = 'QUENTE' | 'MORNO' | 'FRIO';

export interface LeadTemperatureGuidance {
  classification: LeadTemperatureClassification;
  /** Rótulo curto ("Quente"). */
  label: string;
  /** Emoji do cartão/badge (alinhado ao painel de Temperatura). */
  emoji: string;
  /** Título da orientação — indica a prioridade da tratativa. */
  headline: string;
  /** Explicação curta do que a classificação significa. */
  description: string;
  /** Passos objetivos de tratativa (3 por classificação). */
  steps: string[];
}

/**
 * Orientação de tratativa POR CLASSIFICAÇÃO.
 *
 * Concordância e regência revisadas (PT-BR):
 * - "o lead" (substantivo masculino) em todo o texto;
 * - crase correta em "Responda à solicitação" (responder A + A solicitação);
 * - imperativo consistente (trata o atendente no positivo e no singular);
 * - sem estrangeirismos evitáveis; "follow-up" é termo consagrado de
 *   vendas e CRM no Brasil.
 */
const GUIDANCE: Record<LeadTemperatureClassification, LeadTemperatureGuidance> = {
  QUENTE: {
    classification: 'QUENTE',
    label: 'Quente',
    emoji: '🔥',
    headline: 'Prioridade máxima: fale com o lead o quanto antes.',
    description:
      'Este lead demonstrou alto interesse e tem grandes chances de conversão. O primeiro contato em poucos minutos faz toda a diferença.',
    steps: [
      'Ligue para o lead ou inicie a conversa no WhatsApp agora.',
      'Apresente as opções do empreendimento e convide o lead para uma visita.',
      'Registre cada interação no CRM e atualize a etapa no mesmo dia.',
    ],
  },
  MORNO: {
    classification: 'MORNO',
    label: 'Morno',
    emoji: '🌤️',
    headline: 'Qualifique o lead ainda no primeiro contato.',
    description:
      'Este lead demonstrou interesse, mas ainda não está pronto para decidir. Descubra as necessidades dele e mantenha o relacionamento ativo.',
    steps: [
      'Envie uma mensagem personalizada sobre o empreendimento.',
      'Faça perguntas para entender as necessidades, o prazo e as condições do lead.',
      'Programe um follow-up e retome a conversa no prazo combinado.',
    ],
  },
  FRIO: {
    classification: 'FRIO',
    label: 'Frio',
    emoji: '❄️',
    headline: 'Cultive o relacionamento com paciência.',
    description:
      'Este lead demonstrou interesse inicial, mas ainda não está no momento de compra. Mantenha o contato com informações úteis e acompanhe a evolução do lead.',
    steps: [
      'Responda à solicitação e envie informações claras sobre o empreendimento.',
      'Inclua o lead na rotina de follow-ups e faça novos contatos periodicamente.',
      'Reavalie o nível de interesse a cada interação e atualize a etapa no CRM.',
    ],
  },
};

/**
 * Orientação da classificação informada (case-insensitive).
 * Retorna null para valores inválidos ou ausentes — quem chama
 * decide omitir a seção (nunca inventa classificação).
 */
export function getLeadTemperatureGuidance(
  raw: string | null | undefined,
): LeadTemperatureGuidance | null {
  const key = String(raw || '').trim().toUpperCase() as LeadTemperatureClassification;
  return GUIDANCE[key] ?? null;
}

/**
 * "1 pt" / "12 pts" / "-2 pts"; null quando não há pontuação.
 * Fonte única usada pelo cartão Telegram e pelo perfil do CRM.
 */
export function formatLeadScoreLabel(score: number | null | undefined): string | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  const truncated = Math.trunc(score);
  return truncated === 1 ? '1 pt' : `${truncated} pts`;
}
