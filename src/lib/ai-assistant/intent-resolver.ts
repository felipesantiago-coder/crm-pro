/**
 * intent-resolver.ts — Detecção determinística de intenção (prompt v2.0 §7.4/§12).
 *
 * Regras:
 *  - Nenhuma regex com flag `g` usada com .test() (lastIndex mutável causava
 *    falha intermitente). Todas as regex aqui são sem `g`.
 *  - Pura: sem estado global, sem efeito colateral, testável.
 *  - Mapeia intent → estado de carregamento visível (§7.8).
 */

export type AssistantIntent =
  | 'today_schedule'
  | 'reminders'
  | 'client_summary'
  | 'funnel_help'
  | 'enterprise_summary'
  | 'report_summary'
  | 'feature_help';

/** Ordem = prioridade de detecção (primeiro match vence). */
const INTENT_PATTERNS: Array<{ intent: AssistantIntent; pattern: RegExp }> = [
  // Empreendimento antes de cliente ("empreendimento" contém "endimento", mas
  // as palavras são distintas — padrão específico primeiro).
  {
    intent: 'enterprise_summary',
    pattern: /empreendiment|lan[çc]amento|revenda|tipologia|planta|diferencial/i,
  },
  {
    intent: 'today_schedule',
    pattern: /agendament|visita|agenda|hor[áa]rio|hoje|amanh[ãa]|pr[óo]xim[oa]s? dias?/i,
  },
  {
    intent: 'reminders',
    pattern: /lembrete|lembrar|vencid|prazo|pend[êe]ncia|alerta/i,
  },
  // Explicação do funil ANTES de consulta de cliente — senão a palavra
  // "funil" (presente no padrão de cliente) captura a pergunta educativa
  // e a continuidade de funnel_help nunca dispara.
  {
    intent: 'funnel_help',
    pattern: /explic\w+\s+(as\s+)?etapas|etapas do funil|como funciona (o funil|o pipeline|as etapas)|funil de (vendas|clientes)|pipeline do crm|o que (é|significa) (o funil|cada etapa)/i,
  },
  {
    intent: 'client_summary',
    pattern: /cliente|lead|prospect|contato|ficha|hist[óo]ric|intera[çc][ãa]o|perfil|funil|pipeline|est[áa]gio|etapa|fase/i,
  },
  {
    intent: 'report_summary',
    pattern: /relat[óo]rio|indicador|per[íi]odo|convers[ãa]o|ganho|perdid|fechado|m[ée]trica|taxa/i,
  },
];

/** Perguntas de ajuda/configuração/navegação — fallback determinístico. */
const FEATURE_HELP_PATTERN =
  /como (usar|criar|cadastrar|configurar|conectar|filtrar|mudar|alterar|exportar)|onde (cadastro|encontro|configuro|crio)|o que (é|significa)|calend[áa]rio|telegram|tag|senha|perfil|tema|integra/i;

export function resolveIntent(message: string): AssistantIntent {
  const text = (message || '').trim();
  if (!text) return 'feature_help';

  for (const { intent, pattern } of INTENT_PATTERNS) {
    if (pattern.test(text)) return intent;
  }
  if (FEATURE_HELP_PATTERN.test(text)) return 'feature_help';
  return 'feature_help';
}

/** Estado de carregamento visível por intent (§7.8/§16 — nada de "Analisando seus dados…" genérico). */
export const INTENT_LOADING_KEY: Record<AssistantIntent, string> = {
  client_summary: 'clients',
  today_schedule: 'schedules',
  reminders: 'reminders',
  enterprise_summary: 'enterprise',
  report_summary: 'reports',
  funnel_help: 'help',
  feature_help: 'help',
};

/** Labels factuais do funil — usados em contexto de filtro. */
export const FUNNEL_STAGES = [
  'LEAD',
  'PROSPECT',
  'VISITA_AGENDADA',
  'VISITA_REALIZADA',
  'CARTA_PROPOSTA',
  'CONTRATO_GERADO',
  'FECHADO_GANHO',
  'FECHADO_PERDIDO',
] as const;

export function isFunnelStage(value: string): value is (typeof FUNNEL_STAGES)[number] {
  return (FUNNEL_STAGES as readonly string[]).includes(value);
}
