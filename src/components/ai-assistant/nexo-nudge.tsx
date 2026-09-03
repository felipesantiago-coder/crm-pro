'use client';

/**
 * NexoProactiveNudge — rótulo contextual junto ao launcher (prompt v2.0 §13).
 *
 * Aparece no máximo uma vez por sessão, apenas com fato determinístico
 * (sinais publicados pelas views), nunca autoabre o painel, nunca toca som.
 * "Agora não" suprime o mesmo nudge por 24 h — persiste apenas id genérico
 * e timestamp, sem PII. Respeita a preferência "Sugestões proativas".
 *
 * Sem setState em corpo de efeito: a elegibilidade é DERIVADA de storage +
 * sinais; a marcação de "exibido" é escrita de sistema externo; a dispensa
 * acontece em callback de clique.
 */
import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { BellRing, RefreshCw } from 'lucide-react';
import {
  dismissNudge,
  markNudgeShown,
  pickNudge,
  readNudgeState,
  type NudgeKind,
  type NudgeSignal,
} from './nexo-proactive-nudge';
import { formatMessage, getAssistantMessages } from './assistant-messages';
import { useAssistantContextStore } from './assistant-context-store';
import { cn } from '@/lib/utils';

const emptySubscribe = () => () => {};

function nudgeText(signal: NudgeSignal): string {
  const t = getAssistantMessages();
  switch (signal.kind) {
    case 'reminders_pending':
      return signal.count === 1
        ? t.proactive.remindersOne
        : formatMessage(t.proactive.remindersMany, { count: signal.count });
    case 'clients_stale':
      return signal.count === 1
        ? t.proactive.clientsOne
        : formatMessage(t.proactive.clientsMany, { count: signal.count });
    case 'enterprise_review':
      return signal.count === 1
        ? t.proactive.enterpriseOne
        : formatMessage(t.proactive.enterpriseMany, { count: signal.count });
    case 'schedule_soon':
      return formatMessage(t.proactive.scheduleSoon, { time: '' });
  }
}

export function NexoProactiveNudge({
  onReview,
  panelOpen,
}: {
  onReview: () => void;
  panelOpen: boolean;
}) {
  const t = getAssistantMessages();
  const enabled = useAssistantContextStore((s) => s.proactiveSuggestionsEnabled);
  const signals = useAssistantContextStore((s) => s.proactiveSignals);
  const [dismissedNow, setDismissedNow] = useState<NudgeKind | null>(null);

  // Hidratação segura: server snapshot = false (igual ao padrão do widget).
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  // Elegibilidade derivada — determinística, sem chamada de rede nem IA (§13).
  const nudge = useMemo<NudgeSignal | null>(() => {
    if (!mounted || !enabled || panelOpen || dismissedNow) return null;
    const state = readNudgeState();
    if (state.shownThisSession) return null;
    return pickNudge(
      {
        pendingReminders: signals.pendingReminders,
        overdueClients: signals.overdueClients,
        enterpriseReview: signals.enterpriseReview,
      },
      state,
    );
  }, [mounted, enabled, panelOpen, dismissedNow, signals]);

  // Marcação de "exibido nesta sessão" — escrita em sistema externo.
  useEffect(() => {
    if (nudge) markNudgeShown();
  }, [nudge]);

  if (!mounted || !enabled || panelOpen || !nudge) return null;

  return (
    <div
      role="status"
      className="nexo-discovery-label relative mb-1 max-w-[240px] rounded-xl border bg-card px-3 py-2 shadow-md"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-primary" aria-hidden>
          {nudge.kind === 'reminders_pending' ? (
            <BellRing className="h-3.5 w-3.5" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium leading-snug">{nudgeText(nudge)}</p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                dismissNudge(nudge.kind);
                setDismissedNow(nudge.kind);
                onReview();
              }}
              className={cn(
                'inline-flex min-h-[36px] items-center rounded-lg bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground',
                'transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nexo-cyan-bright)]',
              )}
            >
              {t.proactive.cta}
            </button>
            <button
              type="button"
              onClick={() => {
                dismissNudge(nudge.kind);
                setDismissedNow(nudge.kind);
              }}
              className={cn(
                'inline-flex min-h-[36px] items-center rounded-lg px-2 py-1 text-[11px] text-muted-foreground',
                'transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nexo-cyan-bright)]',
              )}
            >
              {t.proactive.dismiss}
            </button>
          </div>
        </div>
      </div>
      {/* Nenhum nome de cliente e nenhum dado — apenas contagens (§13.4). */}
    </div>
  );
}
