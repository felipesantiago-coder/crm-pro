/**
 * Tipos do Nexo — Assistente de IA do CRM Pro.
 * Fonte de verdade da máquina de estados e do modelo de mensagens.
 */

/** Estados visuais/comportamentais do personagem (pacote de assets v1.0). */
export type AssistantVisualState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'success'
  | 'error'
  | 'offline';

/** Variante de fundo do asset (claro/escuro = com fundo; transparente = sem). */
export type AssistantTheme = 'claro' | 'escuro' | 'transparente';

/** Erros classificados pelo cliente para mensagens específicas (prompt v2.0 §16). */
export type RequestErrorKind =
  | 'network'
  | 'rate_limit'
  | 'session'
  | 'unavailable'
  | 'timeout'
  | 'partial_data'
  | 'unknown';

/** Modelo de mensagem (prompt §20). */
export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  status?: 'sending' | 'sent' | 'error';
  /** Metadado discreto do contexto usado (prompt v2.0 §8.3). */
  contextUsed?: AssistantContextUsed;
  /** Avisos tipados do servidor (prompt v2.0 §19 — ex.: partial_data). */
  warnings?: AssistantResponseV2['warnings'];
  /** Ações de navegação allowlisted derivadas no servidor (prompt v2.0 §20). */
  navigationActions?: AssistantResponseV2['navigationActions'];
};

/** Pergunta preservada para retry (prompt §20 — retry não duplica mensagens). */
export type PendingRetry = {
  /** Histórico enviado na tentativa que falhou (sem a pergunta). */
  history: ChatMessage[];
  /** Texto exato da pergunta que falhou. */
  question: string;
  /** Id da mensagem do usuário correspondente (para repor status em retry). */
  questionId: string | null;
};

// ── Contexto estruturado da tela (prompt v2.0 §8) ─────────────────────────

export type AssistantContextView =
  | 'dashboard'
  | 'enterprises'
  | 'clients'
  | 'closed-deals'
  | 'tags'
  | 'reminders'
  | 'reports'
  | 'meta-ads'
  | 'admin'
  | 'settings';

export type AssistantSubview =
  | 'default'
  | 'kanban'
  | 'analytics'
  | 'launches'
  | 'resale'
  | 'client-detail';

export type AssistantPageContext = {
  version: 1;
  view: AssistantContextView;
  subview?: AssistantSubview;
  entity?: {
    type: 'client' | 'enterprise';
    id: string;
  };
  filters?: {
    stage?: string;
    region?: string;
    tagIds?: string[];
    reportPeriod?: 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'custom';
    reportFrom?: string;
    reportTo?: string;
    enterpriseType?: 'LANCAMENTO' | 'REVENDA';
  };
  signals?: {
    visibleCount?: number;
    pendingReminders?: number;
    overdueFollowUps?: number;
    todaySchedules?: number;
    upcomingSchedules?: number;
    tagCount?: number;
  };
};

/** Metadado do contexto usado, devolvido pelo servidor e exibido na resposta. */
export type AssistantContextUsed = {
  view: string;
  entityType?: 'client' | 'enterprise';
  label: string;
  resolvedAt: string;
};

/** Ações de navegação allowlisted (prompt v2.0 §20) — nunca geradas pelo modelo. */
export type AssistantNavigationAction =
  | { type: 'NAVIGATE_VIEW'; view: AssistantContextView; label: string }
  | { type: 'OPEN_CLIENT'; clientId: string; label: string }
  | { type: 'OPEN_ENTERPRISE'; enterpriseId: string; label: string }
  | { type: 'APPLY_CLIENT_FILTER'; stage?: string; tagIds?: string[]; label: string };

/** Resposta v2 (prompt v2.0 §19) — retrocompatível com { reply }. */
export type AssistantResponseV2 = {
  version: 2;
  reply: string;
  intent: string;
  contextUsed?: AssistantContextUsed;
  suggestedReplies: Array<{ id: string; label: string; prompt: string }>;
  navigationActions: AssistantNavigationAction[];
  warnings?: Array<'partial_data' | 'stale_context'>;
};
