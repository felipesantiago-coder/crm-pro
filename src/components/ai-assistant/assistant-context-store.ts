'use client';

/**
 * assistant-context-store.ts — Área de contexto do assistente (prompt v2.0 §8.1).
 *
 * Store Zustand isolado do CRM store:
 *  - pageContext: o que a view atual publica (enum, IDs, filtros estruturados,
 *    contagens não sensíveis). Nunca texto livre de busca, nunca DOM.
 *  - pinnedContext: entidade fixada explicitamente pelo usuário ("Manter este
 *    contexto") — sobrevive à troca de tela.
 *  - suppressed: usuário pediu "Não usar este contexto" para a próxima pergunta.
 *  - proactiveSuggestionsEnabled: preferência persistida (não sensível).
 *
 * Nenhuma chamada à IA acontece aqui — apenas estado determinístico.
 */
import { create } from 'zustand';
import {
  PROACTIVITY_KEY,
} from './assistant.constants';
import type { AssistantPageContext } from './assistant.types';

const EMPTY_CONTEXT: AssistantPageContext = { version: 1, view: 'dashboard' };

function readProactivityPreference(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(PROACTIVITY_KEY) !== '0';
  } catch {
    return true;
  }
}

interface AssistantContextState {
  pageContext: AssistantPageContext;
  pinnedContext: AssistantPageContext['entity'] | null;
  /** "Não usar este contexto" — vale até a próxima troca de view/entidade. */
  suppressed: boolean;
  proactiveSuggestionsEnabled: boolean;
  /**
   * Sinais proativos globais não sensíveis (§13) — contagens publicadas pelas
   * views (Dashboard/Lembretes). Sobrevivem à troca de tela; nunca contêm PII.
   */
  proactiveSignals: { pendingReminders?: number; overdueClients?: number; scheduleSoonMinutes?: number };
  /**
   * Contador de pedido de abertura externa (ex.: "Perguntar ao Nexo sobre este
   * cliente" no resumo). O widget observa e abre o painel — sempre por clique.
   */
  openRequestId: number;
  setPageContext: (context: AssistantPageContext) => void;
  patchPageContext: (patch: Partial<Omit<AssistantPageContext, 'version'>>) => void;
  clearEntityContext: () => void;
  pinEntityContext: () => void;
  unpinEntityContext: () => void;
  suppressContext: () => void;
  resumeContext: () => void;
  setProactiveSuggestionsEnabled: (enabled: boolean) => void;
  setProactiveSignals: (signals: AssistantContextState['proactiveSignals']) => void;
  requestOpenPanel: () => void;
}

export const useAssistantContextStore = create<AssistantContextState>((set, get) => ({
  pageContext: EMPTY_CONTEXT,
  pinnedContext: null,
  suppressed: false,
  proactiveSuggestionsEnabled: true,
  proactiveSignals: {},
  openRequestId: 0,

  setPageContext: (context) =>
    set({
      pageContext: context,
      // Contexto novo: "Não usar" expira quando a tela/entidade muda (§8.3).
      suppressed: false,
      // Fixação só sobrevive se continuar fazendo sentido (mesma entidade).
      pinnedContext:
        get().pinnedContext &&
        context.entity &&
        context.entity.id === get().pinnedContext?.id &&
        context.entity.type === get().pinnedContext?.type
          ? get().pinnedContext
          : null,
    }),

  patchPageContext: (patch) =>
    set((state) => ({
      pageContext: { ...state.pageContext, ...patch, version: 1 },
    })),

  clearEntityContext: () =>
    set((state) => ({
      pageContext: { ...state.pageContext, entity: undefined },
    })),

  pinEntityContext: () =>
    set((state) => ({ pinnedContext: state.pageContext.entity ?? null })),

  unpinEntityContext: () => set({ pinnedContext: null }),

  suppressContext: () => set({ suppressed: true }),
  resumeContext: () => set({ suppressed: false }),

  setProactiveSuggestionsEnabled: (enabled) => {
    set({ proactiveSuggestionsEnabled: enabled });
    try {
      window.localStorage.setItem(PROACTIVITY_KEY, enabled ? '1' : '0');
    } catch {
      // Sem persistência — a preferência vale para a sessão.
    }
  },

  setProactiveSignals: (signals) =>
    set((state) => {
      const changed =
        state.proactiveSignals.pendingReminders !== signals.pendingReminders ||
        state.proactiveSignals.overdueClients !== signals.overdueClients ||
        state.proactiveSignals.scheduleSoonMinutes !== signals.scheduleSoonMinutes;
      return changed ? { proactiveSignals: signals } : state;
    }),

  // Abertura externa: apenas incrementa o pedido — o clique veio do usuário.
  requestOpenPanel: () => set((state) => ({ openRequestId: state.openRequestId + 1 })),
}));

/** Preferência inicial (hidratação segura — cliente apenas). */
export function initProactivityPreference(): void {
  if (typeof window === 'undefined') return;
  const enabled = readProactivityPreference();
  useAssistantContextStore.setState({ proactiveSuggestionsEnabled: enabled });
}

/** Contexto efetivo para a próxima pergunta, honrando fixação e supressão. */
export function getEffectiveContext(): AssistantPageContext | null {
  const state = useAssistantContextStore.getState();
  if (state.suppressed) return null;
  const base = state.pageContext;
  if (state.pinnedContext) {
    return { ...base, entity: state.pinnedContext };
  }
  return base;
}
