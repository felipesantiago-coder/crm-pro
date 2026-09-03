'use client';

/**
 * nexo-proactive-nudge.ts — Motor determinístico de nudges (prompt v2.0 §13).
 *
 * Regras implementadas:
 *  - Nunca autoabre o painel; nunca som/vibração.
 *  - Máximo um nudge por sessão (sessionStorage).
 *  - "Agora não" suprime o mesmo nudge por 24 h (localStorage sem PII:
 *    apenas { id genérico, timestamp }).
 *  - Prioridade: agenda (2 h) > lembretes vencidos/hoje > clientes
 *    desatualizados > educação > ajuda geral. Sem dado determinístico,
 *    nenhum nudge aparece.
 *  - Fatos vêm de sinais já carregados pela aplicação (store de lembretes) —
 *    nenhuma chamada de rede nem de IA.
 */
import {
  NUDGE_DISMISS_KEY,
  NUDGE_DISMISS_TTL_MS,
  NUDGE_SESSION_KEY,
} from './assistant.constants.ts';

export type NudgeKind = 'schedule_soon' | 'reminders_pending' | 'clients_stale' | 'enterprise_review';

export interface NudgeSignal {
  kind: NudgeKind;
  /** Quantidade para pluralização (reminders/clients) — nunca conteúdo. */
  count: number;
}

export interface NudgeDisplayState {
  shownThisSession: boolean;
  dismissedAt: Record<string, number>;
}

export function readNudgeState(): NudgeDisplayState {
  const shownThisSession = (() => {
    try {
      return sessionStorage.getItem(NUDGE_SESSION_KEY) === '1';
    } catch {
      return false;
    }
  })();
  const dismissedAt: Record<string, number> = (() => {
    try {
      const raw = localStorage.getItem(NUDGE_DISMISS_KEY);
      return raw ? (JSON.parse(raw) as Record<string, number>) : {};
    } catch {
      return {};
    }
  })();
  return { shownThisSession, dismissedAt };
}

/** "Agora não" — persiste apenas id genérico + timestamp (sem PII). */
export function dismissNudge(kind: NudgeKind): void {
  try {
    const raw = localStorage.getItem(NUDGE_DISMISS_KEY);
    const dismissed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    dismissed[kind] = Date.now();
    localStorage.setItem(NUDGE_DISMISS_KEY, JSON.stringify(dismissed));
  } catch {
    // Sem persistência — a sessão atual ainda suprime.
  }
  try {
    sessionStorage.setItem(NUDGE_SESSION_KEY, '1');
  } catch {
    // noop
  }
}

export function markNudgeShown(): void {
  try {
    sessionStorage.setItem(NUDGE_SESSION_KEY, '1');
  } catch {
    // noop
  }
}

function wasRecentlyDismissed(state: NudgeDisplayState, kind: NudgeKind): boolean {
  const at = state.dismissedAt[kind];
  return typeof at === 'number' && Date.now() - at < NUDGE_DISMISS_TTL_MS;
}

/** Há um modal nativo (Radix) bloqueando interação? Nudge não aparece. */
export function isModalOpen(): boolean {
  if (typeof document === 'undefined') return true;
  return Boolean(
    document.querySelector('[role="dialog"][aria-modal="true"], [data-state="open"][role="alertdialog"]'),
  );
}

/**
 * Seleciona no máximo um nudge pela ordem de prioridade (§13.3).
 * Sinais agendamento ("agenda nas próximas 2 h") só são conhecidos pelo
 * Dashboard; enquanto não houver sinal determinístico global, ele é omitido
 * — preferimos não mostrar a inventar fato.
 */
export function pickNudge(services: {
  pendingReminders?: number;
  overdueClients?: number;
  enterpriseReview?: number;
}, state: NudgeDisplayState): NudgeSignal | null {
  if (state.shownThisSession) return null;

  const reminders = services.pendingReminders ?? 0;
  if (reminders > 0) {
    const kind: NudgeKind = 'reminders_pending';
    if (!wasRecentlyDismissed(state, kind)) return { kind, count: reminders };
  }

  // Revisão documental (Fase 7): só existe sinal quando um administrador
  // carrega a vista de empreendimentos com extração pendente/conflito.
  const review = services.enterpriseReview ?? 0;
  if (review > 0) {
    const kind: NudgeKind = 'enterprise_review';
    if (!wasRecentlyDismissed(state, kind)) return { kind, count: review };
  }

  const stale = services.overdueClients ?? 0;
  if (stale > 0) {
    const kind: NudgeKind = 'clients_stale';
    if (!wasRecentlyDismissed(state, kind)) return { kind, count: stale };
  }

  return null;
}
