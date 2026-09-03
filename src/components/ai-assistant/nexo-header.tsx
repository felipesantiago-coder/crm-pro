'use client';

/**
 * Cabeçalho do painel do Nexo (prompt §12).
 * Avatar de 40 px, título, subtítulo e indicador textual de estado;
 * ações de nova conversa, expandir/restaurar e fechar — todas com
 * aria-label e alvos de toque de 44 px.
 */
import React from 'react';
import { Maximize2, Minimize2, RotateCcw, X } from 'lucide-react';
import { NexoAvatar } from './nexo-avatar';
import { getAssistantMessages } from './assistant-messages';
import type { AssistantVisualState } from './assistant.types';
import { cn } from '@/lib/utils';

export interface NexoHeaderProps {
  state: AssistantVisualState;
  expanded: boolean;
  hasMessages: boolean;
  onNewConversation: () => void;
  onToggleExpand: () => void;
  onClose: () => void;
}

export function NexoHeader({
  state,
  expanded,
  hasMessages,
  onNewConversation,
  onToggleExpand,
  onClose,
}: NexoHeaderProps) {
  const t = getAssistantMessages();
  const statusText = t.states[state];

  return (
    <div
      className="flex flex-shrink-0 items-center justify-between gap-2 border-b bg-primary px-4 py-3 text-primary-foreground"
      style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <NexoAvatar
          state={state}
          theme="transparente"
          size={40}
          decorative
          className="flex-shrink-0"
        />
        <div className="min-w-0">
          <h2
            id="nexo-panel-title"
            className="truncate text-sm font-semibold leading-tight"
          >
            {t.name}
          </h2>
          <p className="truncate text-[10px] leading-tight opacity-80">
            {t.header.subtitle}
          </p>
          <p className="truncate text-[10px] font-medium leading-tight text-[var(--nexo-cyan-bright)]">
            {statusText}
          </p>
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center">
        <button
          type="button"
          onClick={onNewConversation}
          disabled={!hasMessages}
          aria-disabled={!hasMessages}
          aria-label={t.header.newChat}
          title={t.header.newChat}
          className={cn(
            'inline-flex h-11 w-11 items-center justify-center rounded-lg transition-colors',
            'hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--nexo-cyan-bright)]',
            !hasMessages && 'cursor-not-allowed opacity-40 hover:bg-transparent',
          )}
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onToggleExpand}
          aria-label={expanded ? t.header.restore : t.header.expand}
          title={expanded ? t.header.restore : t.header.expand}
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--nexo-cyan-bright)]"
        >
          {expanded ? (
            <Minimize2 className="h-4 w-4" aria-hidden />
          ) : (
            <Maximize2 className="h-4 w-4" aria-hidden />
          )}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.header.close}
          title={t.header.close}
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--nexo-cyan-bright)]"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
