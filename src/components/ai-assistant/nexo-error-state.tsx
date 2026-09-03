'use client';

/**
 * Estado de erro do Nexo (prompt §14.4).
 * Mensagens específicas por causa + retry apenas com tentativa real;
 * role="alert" reservado para falhas que exigem atenção imediata.
 */
import React from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import type { RequestErrorKind } from './assistant.types';
import { getAssistantMessages } from './assistant-messages';
import { cn } from '@/lib/utils';

export function NexoErrorState({
  kind,
  onRetry,
  canRetry,
}: {
  kind: RequestErrorKind;
  onRetry: () => void;
  canRetry: boolean;
}) {
  const t = getAssistantMessages();
  const text = t.errors[kind];

  return (
    <div
      role="alert"
      className={cn(
        'mx-4 mb-2 flex items-start gap-2.5 rounded-xl border border-destructive/30',
        'bg-destructive/5 px-3 py-2.5',
      )}
    >
      <span className="mt-0.5 text-destructive">
        <TriangleAlert className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-relaxed text-foreground">{text}</p>
        {canRetry && (
          <button
            type="button"
            onClick={onRetry}
            className={cn(
              'mt-1.5 inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5',
              'text-xs font-medium text-foreground transition-colors hover:bg-muted',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nexo-cyan-bright)]',
            )}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {t.errors.retry}
          </button>
        )}
      </div>
    </div>
  );
}
