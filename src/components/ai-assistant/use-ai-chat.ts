'use client';

/**
 * useAiChat — estado, concorrência e resiliência da conversa (prompt §20).
 *
 * Máquina de estados explícita (prompt §7):
 *   idle ⇄ listening → thinking → speaking → success → idle
 *                                   ↘ error/offline (com retry)
 *
 * Garantias:
 *   - envio duplicado prevenido (uma requisição por vez);
 *   - resposta antiga nunca sobrescreve conversa nova (requestId);
 *   - AbortController real para cancelamento e desmontagem;
 *   - pergunta preservada em falha para retry sem duplicar mensagens;
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
  ChatMessage,
  PendingRetry,
  RequestErrorKind,
} from './assistant.types';

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
  startNewConversation: () => ChatMessage[];
  restoreConversation: (previous: ChatMessage[]) => void;
  dismissError: () => void;
}

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `nexo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Classifica o erro HTTP/fetch em kind específico (prompt §14.4). */
function classifyFailure(err: unknown, httpStatus?: number): RequestErrorKind {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return 'unknown'; // tratado à parte — nunca exibido
  }
  if (httpStatus === 401) return 'session';
  if (httpStatus === 429) return 'rate_limit';
  if (httpStatus === 503) return 'unavailable';
  if (err instanceof TypeError) return 'network';
  return 'unknown';
}

export function useAiChat(): AiChatController {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [visualState, setVisualState] = useState<AssistantVisualState>('idle');
  const [errorKind, setErrorKind] = useState<RequestErrorKind | null>(null);
  const [input, setInput] = useState('');

  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const timersRef = useRef<number[]>([]);
  const listeningTimeoutRef = useRef<number | null>(null);
  const pendingRetryRef = useRef<PendingRetry | null>(null);
  const [pendingRetry, setPendingRetry] = useState<PendingRetry | null>(null);

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
      setVisualState('thinking');

      const payloadMessages = [
        ...history,
        { role: 'user' as const, content: question },
      ].slice(-HISTORY_LIMIT)
        .map((m) => ({ role: m.role, content: m.content }));

      try {
        const res = await fetch('/api/ai-assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: payloadMessages }),
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

        const reply =
          typeof data === 'object' &&
          data !== null &&
          'reply' in data &&
          typeof (data as { reply: unknown }).reply === 'string'
            ? (data as { reply: string }).reply
            : '';

        if (!reply.trim()) {
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
            content: reply,
            createdAt: new Date().toISOString(),
            status: 'sent',
          },
        ]);
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

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRetry(null);
    setErrorKind(null);
    setVisualState('idle');
  }, [setRetry]);

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
    startNewConversation,
    restoreConversation,
    dismissError,
  };
}
