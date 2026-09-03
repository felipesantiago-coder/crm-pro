/**
 * navigation-actions.ts — Ações de navegação allowlisted (prompt v2.0 §20).
 *
 * O modelo NUNCA produz ações: elas são derivadas aqui, no servidor, a partir
 * do intent resolvido e do contexto autorizado. Só enums/IDs autorizados
 * passam; ação inválida é descartada silenciosamente. Nenhuma ação de escrita.
 */
import type { AssistantIntent } from './intent-resolver.ts';
import { isFunnelStage } from './intent-resolver.ts';

export type AssistantNavigationAction =
  | { type: 'NAVIGATE_VIEW'; view: string; label: string }
  | { type: 'OPEN_CLIENT'; clientId: string; label: string }
  | { type: 'OPEN_ENTERPRISE'; enterpriseId: string; label: string }
  | { type: 'APPLY_CLIENT_FILTER'; stage?: string; tagIds?: string[]; label: string };

/** Views navegáveis — espelho do CRMView do store. */
const NAVIGABLE_VIEWS = new Set([
  'dashboard',
  'enterprises',
  'clients',
  'closed-deals',
  'tags',
  'reminders',
  'reports',
  'meta-ads',
  'admin',
  'settings',
]);

export function isNavigableView(view: string): boolean {
  return NAVIGABLE_VIEWS.has(view);
}

export interface DeriveActionsInput {
  intent: AssistantIntent;
  isAdmin: boolean;
  view: string;
  entity?: { type: 'client' | 'enterprise'; id: string; accessible: boolean };
  filters?: { stage?: string; tagIds?: string[] };
  labels: {
    openView: (view: string) => string;
    openClient: string;
    openEnterprise: string;
    applyFilter: string;
  };
}

/**
 * Deriva no máximo duas ações seguras para a resposta atual.
 * A ordem reflete a utilidade provável do intent.
 */
export function deriveNavigationActions(input: DeriveActionsInput): AssistantNavigationAction[] {
  const { intent, isAdmin, view, entity, filters, labels } = input;
  const actions: AssistantNavigationAction[] = [];

  const pushView = (target: string) => {
    if (!isNavigableView(target)) return;
    if (target === view) return; // já está na tela — ação inútil
    if (actions.some((a) => a.type === 'NAVIGATE_VIEW' && a.view === target)) return;
    actions.push({ type: 'NAVIGATE_VIEW', view: target, label: labels.openView(target) });
  };

  switch (intent) {
    case 'reminders':
      pushView('reminders');
      break;
    case 'today_schedule':
      pushView('reminders');
      break;
    case 'funnel_help':
      pushView('clients');
      break;
    case 'report_summary':
      pushView('reports');
      break;
    case 'client_summary':
      if (entity?.type === 'client' && entity.accessible && entity.id) {
        actions.push({ type: 'OPEN_CLIENT', clientId: entity.id, label: labels.openClient });
      } else {
        pushView('clients');
      }
      break;
    case 'enterprise_summary':
      if (entity?.type === 'enterprise' && entity.accessible && entity.id) {
        actions.push({ type: 'OPEN_ENTERPRISE', enterpriseId: entity.id, label: labels.openEnterprise });
      } else {
        pushView('enterprises');
      }
      break;
    case 'feature_help':
      // Nenhuma tela é obviamente melhor aqui — sem ação espúria.
      break;
  }

  // Filtro de funil reversível, quando há estágio válido no contexto.
  if (
    (intent === 'funnel_help' || intent === 'client_summary') &&
    filters?.stage &&
    isFunnelStage(filters.stage)
  ) {
    actions.push({
      type: 'APPLY_CLIENT_FILTER',
      stage: filters.stage,
      label: labels.applyFilter,
    });
  }

  // meta-ads/admin só para ADMIN.
  if (!isAdmin) {
    return actions.filter((a) => a.type !== 'NAVIGATE_VIEW' || (a.view !== 'meta-ads' && a.view !== 'admin'));
  }

  return actions.slice(0, 2);
}

/** Sanidade final: descarta qualquer ação fora da allowlist. */
export function sanitizeActions(actions: unknown): AssistantNavigationAction[] {
  if (!Array.isArray(actions)) return [];
  const result: AssistantNavigationAction[] = [];
  for (const raw of actions) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;
    if (typeof a.label !== 'string' || a.label.length === 0 || a.label.length > 80) continue;
    switch (a.type) {
      case 'NAVIGATE_VIEW':
        if (typeof a.view === 'string' && isNavigableView(a.view)) {
          result.push({ type: 'NAVIGATE_VIEW', view: a.view, label: a.label });
        }
        break;
      case 'OPEN_CLIENT':
        if (typeof a.clientId === 'string' && a.clientId.length >= 1 && a.clientId.length <= 64) {
          result.push({ type: 'OPEN_CLIENT', clientId: a.clientId, label: a.label });
        }
        break;
      case 'OPEN_ENTERPRISE':
        if (typeof a.enterpriseId === 'string' && a.enterpriseId.length >= 1 && a.enterpriseId.length <= 64) {
          result.push({ type: 'OPEN_ENTERPRISE', enterpriseId: a.enterpriseId, label: a.label });
        }
        break;
      case 'APPLY_CLIENT_FILTER': {
        const stage = typeof a.stage === 'string' && isFunnelStage(a.stage) ? a.stage : undefined;
        const tagIds = Array.isArray(a.tagIds)
          ? a.tagIds.filter((t): t is string => typeof t === 'string' && t.length >= 1 && t.length <= 64).slice(0, 20)
          : undefined;
        if (stage || (tagIds && tagIds.length > 0)) {
          result.push({ type: 'APPLY_CLIENT_FILTER', stage, tagIds, label: a.label });
        }
        break;
      }
    }
  }
  return result.slice(0, 3);
}
