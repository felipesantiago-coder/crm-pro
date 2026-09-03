'use client';

/**
 * useAiChat — estado, concorrência e resiliência da conversa (prompt §20).
 *
 * Máquina de estados explícita (prompt §7):
 *   idle ⇄ listening → thinking → speaking → success → idle
 *                                   ↘ error/offline (com retry)
 *
 * Garantias (v2.0):
 *   - envio duplicado prevenido (uma requisição por vez);
 *   - resposta antiga nunca sobrescreve conversa nova (requestId);
 *   - AbortController real para cancelamento e desmontagem;
 *   - pergunta preservada em falha e no cancelamento (§7.9);
 *   - contexto estruturado da tela enviado em cada pergunta (§8);
 *   - resposta v2: sugestões, ações, contexto usado e avisos tipados (§19);
 *   - loading por intent (§7.8) resolvido no cliente — sem chamada de IA;
 *   - nenhum setState após unmount;
 *   - conversa vive apenas na memória da sessão (sem localStorage).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HISTORY_LIMIT,
  LISTENING_IDLE_TIMEOUT_MS,
  SPEAKING_DURATION_MS,
  SUCCESS_DURATION_MS,
} from './assistant.constants';
import type {
  AssistantVisualState,
  AssistantContextUsed,
  AssistantNavigationAction,
  ChatMessage,
  PendingRetry,
  RequestErrorKind,
} from './assistant.types';
import { resolveIntent, type AssistantIntent } from '@/lib/ai-assistant/intent-resolver';
import { INTENT_LOADING_KEY } from '@/lib/ai-assistant/intent-resolver';
import {
  getEffectiveContext,
} from './assistant-context-store';
import { getAssistantLocale } from './assistant-messages';

export interface AiChatController {
  messages: ChatMessage[];
  visualState: AssistantVisualState;
  /** Estado `thinking` ou `speaking` — bloqueia novos envios. */
  isBusy: boolean;
  /** Há pergunta preservada que aceita retry (prompt §14.4). */
  canRetry: boolean;
  errorKind: RequestErrorKind | null;
  input: string;
  setInput: (value: string) => void;
  /** Notifica atividade de digitação/foco (transição idle → listening). */
  notifyTyping: () => void;
  send: (text: string) => void;
  retry: () => void;
  cancel: () => void;
  /** Cancelamento confirmado — pergunta preservada com ações (§7.9). */
  cancelledQuestion: { question: string; questionId: string } | null;
  /** "Editar pergunta": devolve o texto ao composer e limpa o aviso. */
  resumeEditingCancelled: () => void;
  startNewConversation: () => ChatMessage[];
  restoreConversation: (previous: ChatMessage[]) => void;
  dismissError: () => void;
  /** Sugestões pós-resposta vindas do servidor (v2 — determinísticas). */
  suggestedReplies: Array<{ id: string; label: string; prompt: string }>;
  /** Intent da última pergunta — seleciona loading e continuidade (§7.8). */
  activeIntent: AssistantIntent | null;
}

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `nexo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Classifica o erro HTTP/fetch em kind específico (prompt §14.4/§16). */
function classifyFailure(err: unknown, httpStatus?: number): RequestErrorKind {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return 'unknown'; // tratado à parte — nunca exibido
  }
  if (httpStatus === 401) return 'session';
  if (httpStatus === 429) return 'rate_limit';
  if (httpStatus === 503) return 'unavailable';
  if (httpStatus === 504) return 'timeout';
  if (err instanceof TypeError) return 'network';
  return 'unknown';
}

interface ResponseV2Shape {
  reply?: unknown;
  intent?: unknown;
  contextUsed?: unknown;
  suggestedReplies?: unknown;
  navigationActions?: unknown;
  warnings?: unknown;
}

function parseV2(data: unknown): {
  reply: string;
  contextUsed?: AssistantContextUsed;
  suggestedReplies: Array<{ id: string; label: string; prompt: string }>;
  navigationActions: AssistantNavigationAction[];
  warnings: Array<'partial_data' | 'stale_context'>;
} {
  const fallback = { reply: '', suggestedReplies: [], navigationActions: [], warnings: [] as Array<'partial_data' | 'stale_context'> };
  if (typeof data !== 'object' || data === null) return fallback;
  const shape = data as ResponseV2Shape;

  const reply = typeof shape.reply === 'string' ? shape.reply : '';

  const contextUsed =
    typeof shape.contextUsed === 'object' && shape.contextUsed !== null
      ? (() => {
          const cu = shape.contextUsed as Record<string, unknown>;
          if (typeof cu.view !== 'string' || typeof cu.label !== 'string') return undefined;
          return {
            view: cu.view,
            entityType: cu.entityType === 'client' || cu.entityType === 'enterprise' ? cu.entityType : undefined,
            label: cu.label,
            resolvedAt: typeof cu.resolvedAt === 'string' ? cu.resolvedAt : new Date().toISOString(),
          } satisfies AssistantContextUsed;
        })()
      : undefined;

  const suggestedReplies = Array.isArray(shape.suggestedReplies)
    ? shape.suggestedReplies
        .filter((s): s is { id: string; label: string; prompt: string } =>
          Boolean(s) && typeof s === 'object' &&
          typeof (s as Record<string, unknown>).id === 'string' &&
          typeof (s as Record<string, unknown>).label === 'string' &&
          typeof (s as Record<string, unknown>).prompt === 'string')
        .slice(0, 4)
    : [];

  const navigationActions = Array.isArray(shape.navigationActions)
    ? shape.navigationActions
        .filter((a): a is AssistantNavigationAction => {
          if (!a || typeof a !== 'object') return false;
          const rec = a as Record<string, unknown>;
          if (typeof rec.label !== 'string') return false;
          if (rec.type === 'NAVIGATE_VIEW') return typeof rec.view === 'string';
          if (rec.type === 'OPEN_CLIENT') return typeof rec.clientId === 'string';
          if (rec.type === 'OPEN_ENTERPRISE') return typeof rec.enterpriseId === 'string';
          if (rec.type === 'APPLY_CLIENT_FILTER') {
            return typeof rec.stage === 'string' || Array.isArray(rec.tagIds);
          }
          return false;
        })
        .slice(0, 3)
    : [];

  const warnings = Array.isArray(shape.warnings)
    ? shape.warnings.filter((w): w is 'partial_data' | 'stale_context' => w === 'partial_data' || w === 'stale_context')
    : [];

  return { reply, contextUsed, suggestedReplies, navigationActions, warnings };
}

export function useAiChat(): AiChatController {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [visualState, setVisualState] = useState<AssistantVisualState>('idle');
  const [errorKind, setErrorKind] = useState<RequestErrorKind | null>(null);
  const [input, setInput] = useState('');
  const [suggestedReplies, setSuggestedReplies] = useState<Array<{ id: string; label: string; prompt: string }>>([]);
  const [activeIntent, setActiveIntent] = useState<AssistantIntent | null>(null);
  const [cancelledQuestion, setCancelledQuestion] = useState<{ question: string; questionId: string } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const timersRef = useRef<number[]>([]);
  const listeningTimeoutRef = useRef<number | null>(null);
  const pendingRetryRef = useRef<PendingRetry | null>(null);
  const [pendingRetry, setPendingRetry] = useState<PendingRetry | null>(null);

  // Espelho de messages para leitura síncrona em callbacks (cancel).
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      for (const id of timersRef.current) window.clearTimeout(id);
      if (listeningTimeoutRef.current !== null) {
        window.clearTimeout(listeningTimeoutRef.current);
      }
    };
  }, []);

  const schedule = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timersRef.current = timersRef.current.filter((t) => t !== id);
      if (mountedRef.current) fn();
    }, ms);
    timersRef.current.push(id);
  }, []);

  const setRetry = useCallback((retry: PendingRetry | null) => {
    pendingRetryRef.current = retry;
    setPendingRetry(retry);
  }, []);

  /** Requisição real — compartilhada por send() e retry(). */
  const request = useCallback(
    async (
      question: string,
      history: ChatMessage[],
      questionId: string | null,
    ) => {
      if (!mountedRef.current) return;
      const requestId = ++requestIdRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setErrorKind(null);
      setCancelledQuestion(null);
      setVisualState('thinking');
      setActiveIntent(resolveIntent(question));

      const payloadMessages = [
        ...history,
        { role: 'user' as const, content: question },
      ].slice(-HISTORY_LIMIT)
        .map((m) => ({ role: m.role, content: m.content }));

      // Contexto estruturado da tela (§8) — fixação e supressão honradas.
      const context = getEffectiveContext();
      const locale = getAssistantLocale();

      try {
        const res = await fetch('/api/ai-assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: payloadMessages,
            ...(context ? { context: { ...context, version: 1 as const } } : {}),
            locale,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const kind = classifyFailure(null, res.status);
          if (!mountedRef.current || requestIdRef.current !== requestId) return;
          if (questionId) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === questionId ? { ...m, status: 'error' } : m,
              ),
            );
          }
          setRetry({ history, question, questionId });
          setVisualState(kind === 'unavailable' ? 'offline' : 'error');
          setErrorKind(kind);
          return;
        }

        const data: unknown = await res.json();
        if (!mountedRef.current || requestIdRef.current !== requestId) return;

        const parsed = parseV2(data);

        if (!parsed.reply.trim()) {
          if (questionId) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === questionId ? { ...m, status: 'error' } : m,
              ),
            );
          }
          setRetry({ history, question, questionId });
          setVisualState('error');
          setErrorKind('unknown');
          return;
        }

        if (questionId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === questionId ? { ...m, status: 'sent' } : m,
            ),
          );
        }
        setMessages((prev) => [
          ...prev,
          {
            id: createId(),
            role: 'assistant',
            content: parsed.reply,
            createdAt: new Date().toISOString(),
            status: 'sent',
            ...(parsed.contextUsed ? { contextUsed: parsed.contextUsed } : {}),
            ...(parsed.warnings.length > 0 ? { warnings: parsed.warnings } : {}),
            ...(parsed.navigationActions.length > 0 ? { navigationActions: parsed.navigationActions } : {}),
          },
        ]);
        setSuggestedReplies(parsed.suggestedReplies);
        setRetry(null);
        setVisualState('speaking');
        schedule(() => setVisualState('success'), SPEAKING_DURATION_MS);
        schedule(() => setVisualState('idle'), SPEAKING_DURATION_MS + SUCCESS_DURATION_MS);
      } catch (err) {
        if (!mountedRef.current || requestIdRef.current !== requestId) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (questionId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === questionId ? { ...m, status: 'error' } : m,
            ),
          );
        }
        setRetry({ history, question, questionId });
        setVisualState('error');
        setErrorKind(classifyFailure(err));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [schedule, setRetry],
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (visualState === 'thinking' || visualState === 'speaking') return; // duplicado
      if (visualState === 'offline') return; // composer desabilitado quando offline

      const userMessage: ChatMessage = {
        id: createId(),
        role: 'user',
        content: trimmed,
        createdAt: new Date().toISOString(),
        status: 'sending',
      };
      const history = messages;
      setMessages([...messages, userMessage]);
      setInput('');
      setCancelledQuestion(null);

      // Sinaliza "enviando" e dispara a requisição após o re-render.
      schedule(() => {
        void request(trimmed, history, userMessage.id);
      }, 0);
    },
    [messages, request, schedule, visualState],
  );

  const retry = useCallback(() => {
    const retryState = pendingRetryRef.current;
    if (!retryState) return;
    if (visualState === 'thinking' || visualState === 'speaking') return;
    void request(
      retryState.question,
      retryState.history,
      retryState.questionId,
    );
  }, [request, visualState]);

  /**
   * Cancelamento com pergunta preservada (prompt v2.0 §7.9/§16).
   * A mensagem do usuário permanece; o aviso oferece retry/edição.
   */
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRetry(null);
    setErrorKind(null);
    setVisualState('idle');
    // Pergunta ainda em voo: preserva a última do usuário para retry/edição.
    const lastUser = [...messagesRef.current].reverse().find((m) => m.role === 'user');
    if (lastUser) {
      setCancelledQuestion({ question: lastUser.content, questionId: lastUser.id });
      setMessages(
        messagesRef.current.map((m) =>
          m.id === lastUser.id ? { ...m, status: 'sent' as const } : m,
        ),
      );
    }
  }, [setRetry]);

  const resumeEditingCancelled = useCallback(() => {
    setCancelledQuestion((current) => {
      if (current) {
        setInput(current.question);
        // Remove a mensagem preservada — o usuário reenviará a versão editada.
        setMessages((prev) => prev.filter((m) => m.id !== current.questionId));
      }
      return null;
    });
  }, []);

  const startNewConversation = useCallback((): ChatMessage[] => {
    abortRef.current?.abort();
    abortRef.current = null;
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
    pendingRetryRef.current = null;
    setPendingRetry(null);
    setErrorKind(null);
    setInput('');
    setVisualState('idle');
    setSuggestedReplies([]);
    setActiveIntent(null);
    setCancelledQuestion(null);
    const previous = messages;
    setMessages([]);
    return previous;
  }, [messages]);

  const restoreConversation = useCallback((previous: ChatMessage[]) => {
    setMessages(previous);
  }, []);

  const dismissError = useCallback(() => {
    setErrorKind(null);
    setVisualState((prev) => (prev === 'error' ? 'idle' : prev));
  }, []);

  const notifyTyping = useCallback(() => {
    if (listeningTimeoutRef.current !== null) {
      window.clearTimeout(listeningTimeoutRef.current);
    }
    setVisualState((prev) => {
      if (
        prev === 'thinking' ||
        prev === 'speaking' ||
        prev === 'error' ||
        prev === 'offline'
      ) {
        return prev;
      }
      return 'listening';
    });
    // Inatividade curta volta a idle (prompt §7 — sem timers agressivos).
    listeningTimeoutRef.current = window.setTimeout(() => {
      listeningTimeoutRef.current = null;
      setVisualState((prev) => (prev === 'listening' ? 'idle' : prev));
    }, LISTENING_IDLE_TIMEOUT_MS);
  }, []);

  const setInputWithActivity = useCallback(
    (value: string) => {
      setInput(value);
      notifyTyping();
    },
    [notifyTyping],
  );

  return {
    messages,
    visualState,
    isBusy: visualState === 'thinking' || visualState === 'speaking',
    canRetry: pendingRetry !== null,
    errorKind,
    input,
    setInput: setInputWithActivity,
    notifyTyping,
    send,
    retry,
    cancel,
    cancelledQuestion,
    resumeEditingCancelled,
    startNewConversation,
    restoreConversation,
    dismissError,
    suggestedReplies,
    activeIntent,
  };
}
