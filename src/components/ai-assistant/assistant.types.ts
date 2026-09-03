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

/** Erros classificados pelo cliente para mensagens específicas (prompt §14.4). */
export type RequestErrorKind =
  | 'network'
  | 'rate_limit'
  | 'session'
  | 'unavailable'
  | 'unknown';

/** Modelo de mensagem (prompt §20). */
export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  status?: 'sending' | 'sent' | 'error';
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
