'use client';

/**
 * NexoSuggestionList — chips de sugestões determinísticas (prompt v2.0 §10/§22).
 *
 * Regras:
 *  - `button` real (nunca div clicável), alvo mínimo 44 px;
 *  - mobile: duas prioritárias + "Ver mais sugestões" com aria-expanded
 *    e aria-controls (nunca "+" ou "–" como único texto);
 *  - sugestões com ação local executam navegação — não chamam o modelo;
 *  - lista vertical em mobile (sem scroll horizontal invisível).
 */
import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { getAssistantMessages } from './assistant-messages';
import type { ClientSuggestion } from './assistant-suggestions-client';
import { cn } from '@/lib/utils';

export interface NexoSuggestionListProps {
  suggestions: ClientSuggestion[];
  onSelect: (suggestion: ClientSuggestion) => void;
  /** Quantidade visível no mobile antes do "Ver mais". */
  mobileVisible?: number;
  /** Lista compacta para o espaço pós-resposta. */
  dense?: boolean;
  className?: string;
}

export function NexoSuggestionList({
  suggestions,
  onSelect,
  mobileVisible = 2,
  dense,
  className,
}: NexoSuggestionListProps) {
  const t = getAssistantMessages();
  const [expanded, setExpanded] = useState(false);
  const listId = React.useId();
  if (suggestions.length === 0) return null;

  const visible = expanded
    ? suggestions
    : suggestions.slice(0, mobileVisible);
  const hiddenCount = suggestions.length - mobileVisible;
  const needsToggle = hiddenCount > 0 && suggestions.length > mobileVisible;

  return (
    <div className={cn('flex flex-col', className)}>
      <div
        id={listId}
        role="list"
        aria-label={t.suggestionsUI.listLabel}
        className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:gap-1.5"
      >
        {visible.map((suggestion, index) => (
          <button
            key={suggestion.id}
            type="button"
            role="listitem"
            onClick={() => onSelect(suggestion)}
            className={cn(
              'min-h-[44px] whitespace-normal rounded-full border bg-card px-3 py-2 text-left text-[11px] text-muted-foreground',
              'transition-colors hover:bg-muted hover:text-foreground',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nexo-cyan-bright)]',
              dense && 'min-h-[40px] py-1.5',
              // Mobile: além das prioritárias, esconde até expandir.
              index >= mobileVisible && !expanded && 'hidden sm:inline-block',
            )}
          >
            <span className="line-clamp-2">{suggestion.label}</span>
          </button>
        ))}
      </div>

      {needsToggle && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          aria-controls={listId}
          className={cn(
            'mt-0.5 inline-flex min-h-[44px] items-center gap-1 self-start rounded-lg px-2 text-[11px] font-medium text-primary',
            'transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nexo-cyan-bright)]',
            'sm:hidden',
          )}
        >
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')}
            aria-hidden
          />
          {expanded ? t.suggestionsUI.less : t.suggestionsUI.more}
        </button>
      )}
    </div>
  );
}
