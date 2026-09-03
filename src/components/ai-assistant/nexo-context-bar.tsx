'use client';

/**
 * NexoContextBar — barra de contexto da tela (prompt v2.0 §8.3).
 *
 * Mostra "Contexto: {tela}" ou a entidade selecionada, com ações de fixar
 * ("Manter este contexto") e remover ("Não usar este contexto"). Fixação e
 * remoção são operáveis por teclado; a mudança é anunciada uma única vez
 * pela região viva do widget. Nunca cria mensagem no histórico.
 */
import React from 'react';
import { Pin, PinOff, EyeOff } from 'lucide-react';
import { getAssistantMessages, formatMessage } from './assistant-messages';
import { useAssistantContextStore } from './assistant-context-store';
import type { AssistantPageContext } from './assistant.types';
import { cn } from '@/lib/utils';

export function NexoContextBar({ compact }: { compact?: boolean }) {
  const t = getAssistantMessages();
  const pageContext = useAssistantContextStore((s) => s.pageContext);
  const pinnedContext = useAssistantContextStore((s) => s.pinnedContext);
  const suppressed = useAssistantContextStore((s) => s.suppressed);
  const pinEntityContext = useAssistantContextStore((s) => s.pinEntityContext);
  const unpinEntityContext = useAssistantContextStore((s) => s.unpinEntityContext);
  const suppressContext = useAssistantContextStore((s) => s.suppressContext);
  const resumeContext = useAssistantContextStore((s) => s.resumeContext);

  const hasEntity = Boolean(pageContext.entity) || Boolean(pinnedContext);
  if (suppressed) {
    return (
      <div
        role="status"
        aria-label={t.context.ariaLabel}
        className={cn(
          'flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-1.5',
          compact && 'py-1',
        )}
      >
        <span className="truncate text-[10px] text-muted-foreground">
          {t.messages.contextRemoved}
        </span>
        <button
          type="button"
          onClick={resumeContext}
          className="inline-flex h-7 flex-shrink-0 items-center rounded-md px-2 text-[10px] font-medium text-primary transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nexo-cyan-bright)]"
        >
          {t.context.remove.replace('Não ', 'Usar ')}
        </button>
      </div>
    );
  }

  // Rótulo do contexto efetivo: entidade fixada > entidade da tela > tela.
  const viewLabel =
    t.context.views[pageContext.view as keyof typeof t.context.views] ??
    pageContext.view;
  let labelText = formatMessage(t.context.view, { view: viewLabel });
  if (pinnedContext?.type === 'client') labelText = t.context.client;
  else if (pinnedContext?.type === 'enterprise') labelText = t.context.enterprise;
  else if (pageContext.entity?.type === 'client') labelText = t.context.client;
  else if (pageContext.entity?.type === 'enterprise') labelText = t.context.enterprise;

  const canPin = Boolean(pageContext.entity) && !pinnedContext;

  return (
    <div
      role="group"
      aria-label={t.context.ariaLabel}
      className={cn(
        'flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-1.5',
        compact && 'py-1',
      )}
    >
      <span className="inline-flex min-w-0 items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
        <span aria-hidden className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--nexo-cyan)]" />
        <span className="truncate">{labelText}</span>
      </span>

      <div className="flex flex-shrink-0 items-center gap-0.5">
        {canPin && (
          <button
            type="button"
            onClick={pinEntityContext}
            aria-label={t.context.pin}
            title={t.context.pin}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nexo-cyan-bright)]"
          >
            <Pin className="h-3 w-3" aria-hidden />
          </button>
        )}
        {pinnedContext && (
          <button
            type="button"
            onClick={unpinEntityContext}
            aria-label={t.context.unpin}
            title={t.context.unpin}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nexo-cyan-bright)]"
          >
            <PinOff className="h-3 w-3" aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={suppressContext}
          aria-label={t.context.remove}
          title={t.context.remove}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nexo-cyan-bright)]"
        >
          <EyeOff className="h-3 w-3" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** Rótulo seguro do contexto efetivo — usado no metadado da resposta. */
export function effectiveContextLabel(context: AssistantPageContext | null): string | null {
  if (!context) return null;
  if (context.entity?.type === 'client') return 'client';
  if (context.entity?.type === 'enterprise') return 'enterprise';
  return context.view;
}
