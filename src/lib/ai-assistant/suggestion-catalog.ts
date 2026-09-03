/**
 * suggestion-catalog.ts — Catálogo determinístico de sugestões (prompt v2.0 §10-§12).
 *
 * Módulo puro (sem imports de servidor ou cliente React) — compartilhado pelo
 * suggestion-engine (servidor) e pelo widget (cliente). Textos visíveis vivem
 * em i18n sob `aiAssistant.catalog.{id}` (label + prompt); este arquivo carrega
 * apenas estrutura estável: id, intent, categoria, views, prioridade e gating.
 *
 * Regras do catálogo:
 *  - Máximo de quatro sugestões na abertura (aplicado no seletor).
 *  - Nunca prometer "todos" — prompts falam em "amostra recente" quando
 *    a consulta do backend é truncada.
 *  - Sugestões ADMIN só aparecem para papel ADMIN.
 *  - requiresEntity só aparece com a entidade presente no contexto.
 *  - 'tags.first' só sem tags (requiresNoTags).
 */
import type { AssistantIntent } from './intent-resolver.ts';
import type { AssistantContextView } from './context-schema.ts';

export type SuggestionCategory = 'consult' | 'learn' | 'prioritize' | 'navigate';

export interface AssistantSuggestion {
  id: string;
  intent: AssistantIntent;
  category: SuggestionCategory;
  /** Views onde a sugestão aparece na abertura ([] = só via continuidade). */
  views: AssistantContextView[];
  priority: number;
  requiredRole?: 'ADMIN';
  requiresEntity?: 'client' | 'enterprise';
  /** Só aparece quando NÃO há tags registradas (ex.: tags.first). */
  requiresNoTags?: boolean;
  /** Sugestões de navegação executam ação local — não chamam o modelo. */
  action?:
    | { type: 'NAVIGATE_VIEW'; view: AssistantContextView }
    | { type: 'OPEN_CLIENT' }
    | { type: 'OPEN_ENTERPRISE' };
}

export const ASSISTANT_SUGGESTION_CATALOG: AssistantSuggestion[] = [
  // ── Dashboard ───────────────────────────────────────────────────────────
  { id: 'dashboard.today_summary', intent: 'report_summary', category: 'prioritize', views: ['dashboard'], priority: 10 },
  { id: 'dashboard.followups', intent: 'client_summary', category: 'consult', views: ['dashboard'], priority: 20 },
  { id: 'dashboard.schedules', intent: 'today_schedule', category: 'consult', views: ['dashboard'], priority: 30 },
  { id: 'dashboard.reminders', intent: 'reminders', category: 'consult', views: ['dashboard'], priority: 40 },
  { id: 'dashboard.explain', intent: 'feature_help', category: 'learn', views: ['dashboard'], priority: 50 },

  // ── Clientes ────────────────────────────────────────────────────────────
  { id: 'clients.filtered_summary', intent: 'client_summary', category: 'consult', views: ['clients'], priority: 10 },
  { id: 'clients.stale', intent: 'client_summary', category: 'consult', views: ['clients'], priority: 20 },
  { id: 'clients.filters_help', intent: 'feature_help', category: 'learn', views: ['clients'], priority: 30 },
  { id: 'clients.funnel_help', intent: 'funnel_help', category: 'learn', views: ['clients'], priority: 40 },
  { id: 'clients.create_help', intent: 'feature_help', category: 'learn', views: ['clients'], priority: 50 },
  { id: 'clients.by_stage', intent: 'client_summary', category: 'consult', views: [], priority: 60 },
  { id: 'clients.next_stage_help', intent: 'funnel_help', category: 'learn', views: [], priority: 61 },
  { id: 'navigate.clients', intent: 'feature_help', category: 'navigate', views: [], priority: 62, action: { type: 'NAVIGATE_VIEW', view: 'clients' } },

  // ── Ficha do cliente ────────────────────────────────────────────────────
  { id: 'client.summary', intent: 'client_summary', category: 'consult', views: ['clients'], priority: 5, requiresEntity: 'client' },
  { id: 'client.last_interaction', intent: 'client_summary', category: 'consult', views: ['clients'], priority: 15, requiresEntity: 'client' },
  { id: 'client.commitments', intent: 'today_schedule', category: 'consult', views: ['clients'], priority: 25, requiresEntity: 'client' },
  { id: 'client.next_contact', intent: 'report_summary', category: 'prioritize', views: ['clients'], priority: 35, requiresEntity: 'client' },
  { id: 'client.stage_help', intent: 'funnel_help', category: 'learn', views: ['clients'], priority: 45, requiresEntity: 'client' },
  { id: 'client.missing_fields', intent: 'client_summary', category: 'consult', views: ['clients'], priority: 55, requiresEntity: 'client' },
  { id: 'client.history', intent: 'client_summary', category: 'consult', views: [], priority: 56, requiresEntity: 'client' },
  { id: 'navigate.client', intent: 'feature_help', category: 'navigate', views: [], priority: 57, requiresEntity: 'client', action: { type: 'OPEN_CLIENT' } },

  // ── Negócios Finalizados ────────────────────────────────────────────────
  { id: 'closed.summary', intent: 'report_summary', category: 'consult', views: ['closed-deals'], priority: 10 },
  { id: 'closed.won_count', intent: 'report_summary', category: 'consult', views: ['closed-deals'], priority: 20 },
  { id: 'closed.recent', intent: 'client_summary', category: 'consult', views: ['closed-deals'], priority: 30 },
  { id: 'closed.explain', intent: 'feature_help', category: 'learn', views: ['closed-deals'], priority: 40 },

  // ── Tags ────────────────────────────────────────────────────────────────
  { id: 'tags.organize', intent: 'feature_help', category: 'learn', views: ['tags'], priority: 10 },
  { id: 'tags.most_used', intent: 'client_summary', category: 'consult', views: ['tags'], priority: 20 },
  { id: 'tags.filter_help', intent: 'feature_help', category: 'learn', views: ['tags'], priority: 30 },
  { id: 'tags.first', intent: 'feature_help', category: 'learn', views: ['tags'], priority: 5, requiresNoTags: true },

  // ── Lembretes ───────────────────────────────────────────────────────────
  { id: 'reminders.overdue', intent: 'reminders', category: 'consult', views: ['reminders'], priority: 10 },
  { id: 'reminders.today', intent: 'reminders', category: 'consult', views: ['reminders', 'dashboard'], priority: 20 },
  { id: 'reminders.upcoming', intent: 'reminders', category: 'consult', views: ['reminders'], priority: 30 },
  { id: 'reminders.create_help', intent: 'feature_help', category: 'learn', views: ['reminders'], priority: 40 },
  { id: 'reminders.calendar_help', intent: 'feature_help', category: 'learn', views: ['reminders', 'settings'], priority: 50 },
  { id: 'reminders.next_7_days', intent: 'reminders', category: 'consult', views: [], priority: 51 },
  { id: 'schedule.tomorrow', intent: 'today_schedule', category: 'consult', views: [], priority: 52 },
  { id: 'navigate.reminders', intent: 'feature_help', category: 'navigate', views: [], priority: 53, action: { type: 'NAVIGATE_VIEW', view: 'reminders' } },
  { id: 'navigate.schedules', intent: 'feature_help', category: 'navigate', views: [], priority: 54, action: { type: 'NAVIGATE_VIEW', view: 'reminders' } },

  // ── Empreendimentos ─────────────────────────────────────────────────────
  { id: 'enterprise.region_search', intent: 'enterprise_summary', category: 'consult', views: ['enterprises'], priority: 10 },
  { id: 'enterprise.types_help', intent: 'feature_help', category: 'learn', views: ['enterprises'], priority: 20 },
  { id: 'enterprise.search_help', intent: 'feature_help', category: 'learn', views: ['enterprises'], priority: 30 },
  { id: 'enterprise.summary', intent: 'enterprise_summary', category: 'consult', views: ['enterprises'], priority: 5, requiresEntity: 'enterprise' },
  { id: 'enterprise.differentials', intent: 'enterprise_summary', category: 'consult', views: ['enterprises'], priority: 15, requiresEntity: 'enterprise' },
  { id: 'enterprise.layouts', intent: 'enterprise_summary', category: 'consult', views: ['enterprises'], priority: 25, requiresEntity: 'enterprise' },
  { id: 'enterprise.location', intent: 'enterprise_summary', category: 'consult', views: ['enterprises'], priority: 35, requiresEntity: 'enterprise' },
  { id: 'enterprise.missing', intent: 'enterprise_summary', category: 'consult', views: ['enterprises'], priority: 45, requiresEntity: 'enterprise' },
  { id: 'navigate.enterprise', intent: 'feature_help', category: 'navigate', views: [], priority: 46, requiresEntity: 'enterprise', action: { type: 'OPEN_ENTERPRISE' } },

  // ── Relatórios ──────────────────────────────────────────────────────────
  { id: 'reports.summary', intent: 'report_summary', category: 'consult', views: ['reports'], priority: 10 },
  { id: 'reports.stage_distribution', intent: 'client_summary', category: 'consult', views: ['reports'], priority: 20 },
  { id: 'reports.won_lost', intent: 'report_summary', category: 'consult', views: ['reports'], priority: 30 },
  { id: 'reports.attention', intent: 'report_summary', category: 'prioritize', views: ['reports'], priority: 40 },
  { id: 'reports.explain', intent: 'feature_help', category: 'learn', views: ['reports'], priority: 50 },
  { id: 'navigate.reports', intent: 'feature_help', category: 'navigate', views: [], priority: 51, action: { type: 'NAVIGATE_VIEW', view: 'reports' } },

  // ── Anúncios Meta — ADMIN ───────────────────────────────────────────────
  { id: 'meta.summary', intent: 'report_summary', category: 'consult', views: ['meta-ads'], priority: 10, requiredRole: 'ADMIN' },
  { id: 'meta.campaigns', intent: 'report_summary', category: 'consult', views: ['meta-ads'], priority: 20, requiredRole: 'ADMIN' },
  { id: 'meta.conversion', intent: 'report_summary', category: 'learn', views: ['meta-ads'], priority: 30, requiredRole: 'ADMIN' },
  { id: 'meta.sources', intent: 'client_summary', category: 'consult', views: ['meta-ads'], priority: 40, requiredRole: 'ADMIN' },
  { id: 'meta.queues', intent: 'feature_help', category: 'learn', views: ['meta-ads'], priority: 50, requiredRole: 'ADMIN' },

  // ── Administração — ADMIN ───────────────────────────────────────────────
  { id: 'admin.overview', intent: 'feature_help', category: 'learn', views: ['admin'], priority: 10, requiredRole: 'ADMIN' },
  { id: 'admin.create_user', intent: 'feature_help', category: 'learn', views: ['admin'], priority: 20, requiredRole: 'ADMIN' },
  { id: 'admin.roles', intent: 'feature_help', category: 'learn', views: ['admin'], priority: 30, requiredRole: 'ADMIN' },
  { id: 'admin.integrations', intent: 'feature_help', category: 'learn', views: ['admin'], priority: 40, requiredRole: 'ADMIN' },

  // ── Configurações ───────────────────────────────────────────────────────
  { id: 'settings.calendar', intent: 'feature_help', category: 'learn', views: ['settings'], priority: 10 },
  { id: 'settings.telegram', intent: 'feature_help', category: 'learn', views: ['settings'], priority: 20 },
  { id: 'settings.profile', intent: 'feature_help', category: 'learn', views: ['settings'], priority: 30 },
  { id: 'settings.theme', intent: 'feature_help', category: 'learn', views: ['settings'], priority: 40 },

  // ── Ajuda genérica (continuidade) ───────────────────────────────────────
  { id: 'navigate.relevant_view', intent: 'feature_help', category: 'navigate', views: [], priority: 90 },
  { id: 'help.another_question', intent: 'feature_help', category: 'learn', views: [], priority: 91 },
  { id: 'help.home', intent: 'feature_help', category: 'learn', views: [], priority: 92, action: { type: 'NAVIGATE_VIEW', view: 'dashboard' } },
];

/** Mapeamento de continuidade por intent (§12) — ids do catálogo acima. */
export const FOLLOW_UP_SUGGESTIONS: Record<AssistantIntent, string[]> = {
  today_schedule: ['schedule.tomorrow', 'reminders.today', 'navigate.schedules'],
  reminders: ['reminders.overdue', 'reminders.next_7_days', 'navigate.reminders'],
  client_summary: ['client.history', 'client.commitments', 'navigate.client'],
  funnel_help: ['clients.by_stage', 'clients.next_stage_help', 'navigate.clients'],
  enterprise_summary: ['enterprise.differentials', 'enterprise.layouts', 'navigate.enterprise'],
  report_summary: ['reports.won_lost', 'reports.stage_distribution', 'navigate.reports'],
  feature_help: ['navigate.relevant_view', 'help.another_question', 'help.home'],
};

/**
 * Fallback CONTEXTUAL quando a continuidade exigir entidade ausente (§12 —
 * "fallback contextual, não fallback global repetitivo"). Só ids sem
 * requiresEntity, do mesmo domínio do intent.
 */
export const FOLLOW_UP_FALLBACKS: Partial<Record<AssistantIntent, string[]>> = {
  client_summary: ['clients.by_stage', 'navigate.clients'],
  enterprise_summary: ['enterprise.region_search', 'enterprise.types_help'],
};

export interface SuggestionFilterOptions {
  view: AssistantContextView;
  role?: string;
  entity?: { type: 'client' | 'enterprise'; id: string } | null;
  tagCount?: number;
  limit?: number;
}

/**
 * Seleção determinística para a abertura do painel:
 * filtra por view/papel/entidade, ordena por prioridade, deduplica e limita.
 */
export function selectOpeningSuggestions(options: SuggestionFilterOptions): AssistantSuggestion[] {
  const { view, role, entity, tagCount, limit = 4 } = options;
  const seen = new Set<string>();
  const result: AssistantSuggestion[] = [];

  const eligible = ASSISTANT_SUGGESTION_CATALOG.filter((s) => {
    if (!s.views.includes(view)) return false;
    if (s.requiredRole && s.requiredRole !== role) return false;
    if (s.requiresEntity && (!entity || entity.type !== s.requiresEntity)) return false;
    if (s.requiresNoTags && (tagCount ?? 0) > 0) return false;
    return true;
  });

  eligible.sort((a, b) => a.priority - b.priority);

  for (const suggestion of eligible) {
    // Dedupe semântica: um único item por intent na abertura (§10 — evitar repetição).
    if (seen.has(suggestion.intent)) continue;
    seen.add(suggestion.intent);
    result.push(suggestion);
    if (result.length >= limit) break;
  }
  return result;
}

/**
 * Continuidade pós-resposta: 2-3 sugestões do intent respondido (§12).
 * Sem entidade disponível, usa fallback contextual do mesmo domínio.
 */
export function selectFollowUpSuggestions(
  intent: AssistantIntent,
  options: { role?: string; entity?: { type: 'client' | 'enterprise'; id: string } | null } = {},
): AssistantSuggestion[] {
  const { role, entity } = options;
  const ids = FOLLOW_UP_SUGGESTIONS[intent] ?? [];
  const result: AssistantSuggestion[] = [];

  const eligible = (id: string): AssistantSuggestion | null => {
    const suggestion = ASSISTANT_SUGGESTION_CATALOG.find((s) => s.id === id);
    if (!suggestion) return null;
    if (suggestion.requiredRole && suggestion.requiredRole !== role) return null;
    if (suggestion.requiresEntity && (!entity || entity.type !== suggestion.requiresEntity)) return null;
    return suggestion;
  };

  for (const id of ids) {
    const suggestion = eligible(id);
    if (suggestion) result.push(suggestion);
  }

  // Continuidade aceita 2-3 itens — não força 4.
  if (result.length >= 2) return result.slice(0, 3);

  // Fallback contextual (nunca global repetitivo).
  for (const id of FOLLOW_UP_FALLBACKS[intent] ?? []) {
    if (result.length >= 3) break;
    const suggestion = eligible(id);
    if (suggestion && !result.some((r) => r.id === suggestion.id)) {
      result.push(suggestion);
    }
  }
  return result.slice(0, 3);
}

export function getSuggestionsByIds(ids: string[]): AssistantSuggestion[] {
  return ids
    .map((id) => ASSISTANT_SUGGESTION_CATALOG.find((s) => s.id === id))
    .filter((s): s is AssistantSuggestion => Boolean(s));
}
