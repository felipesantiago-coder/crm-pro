'use client';

/**
 * Composer do Nexo (prompt §15).
 * Enter envia; Shift+Enter quebra linha; IME respeitado (isComposing);
 * AbortController real habilita cancelamento; contador perto do limite.
 */
import React, { useEffect, useRef } from 'react';
import { Send, X } from 'lucide-react';
import {
  CHAR_COUNTER_THRESHOLD,
  MAX_INPUT_CHARS,
} from './assistant.constants';
import { formatMessage, getAssistantMessages } from './assistant-messages';
import type { AssistantPageContext } from './assistant.types';
import { cn } from '@/lib/utils';

export interface NexoComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onFocus?: () => void;
  onCancel: () => void;
  busy: boolean;
  disabled: boolean;
  /** Foco programático (ao abrir o painel). */
  focusRef: React.RefObject<HTMLTextAreaElement | null>;
  /** View atual — seleciona o placeholder contextual (prompt v2.0 §16). */
  view?: AssistantPageContext['view'];
  /** Entidade fixada/selecionada — placeholder da ficha/empreendimento. */
  entity?: AssistantPageContext['entity'] | null;
}

const MIN_HEIGHT_PX = 44;
const MAX_HEIGHT_PX = 132; // ≈ 5 linhas

export function NexoComposer({
  value,
  onChange,
  onSubmit,
  onFocus,
  onCancel,
  busy,
  disabled,
  focusRef,
  view = 'dashboard',
  entity,
}: NexoComposerProps) {
  const t = getAssistantMessages();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Placeholder por contexto (prompt v2.0 §16 — composer por contexto).
  const placeholder = (() => {
    if (entity?.type === 'client') return t.composer.placeholderClient;
    if (entity?.type === 'enterprise') return t.composer.placeholderEnterprise;
    switch (view) {
      case 'clients': return t.composer.placeholderClients;
      case 'reports': return t.composer.placeholderReports;
      case 'settings': return t.composer.placeholderSettings;
      default: return t.composer.placeholder;
    }
  })();

  // Auto-expansão até o limite visual (transform-only não se aplica aqui:
  // redimensionar textarea exige height; limitado e sem animação de layout).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, MIN_HEIGHT_PX), MAX_HEIGHT_PX)}px`;
  }, [value]);

  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !busy && !disabled;
  const nearLimit = value.length > CHAR_COUNTER_THRESHOLD;

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    // IME: não enviar durante composição (prompt §15).
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (canSend) onSubmit();
  }

  return (
    <div
      className="border-t bg-card/80 p-3 backdrop-blur-sm"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <textarea
            ref={(node) => {
              textareaRef.current = node;
              focusRef.current = node;
            }}
            value={value}
            onChange={(e) => onChange(e.target.value.slice(0, MAX_INPUT_CHARS))}
            onKeyDown={handleKeyDown}
            onFocus={onFocus}
            placeholder={placeholder}
            aria-label={placeholder}
            rows={1}
            maxLength={MAX_INPUT_CHARS}
            disabled={disabled}
            aria-disabled={disabled}
            className={cn(
              'w-full resize-none rounded-xl border bg-background px-3.5 py-2.5 text-sm',
              'placeholder:text-muted-foreground',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--nexo-cyan-bright)]',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          />
          {nearLimit && (
            <span
              className={cn(
                'absolute -top-5 right-1 text-[10px]',
                value.length >= MAX_INPUT_CHARS ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {formatMessage(t.composer.charCounter, {
                count: value.length,
                max: MAX_INPUT_CHARS,
              })}
            </span>
          )}
        </div>

        {busy ? (
          <button
            type="button"
            onClick={onCancel}
            className={cn(
              'inline-flex h-11 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium',
              'text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nexo-cyan-bright)]',
            )}
          >
            <X className="h-4 w-4" aria-hidden />
            {t.composer.cancel}
          </button>
        ) : (
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSend}
            aria-label={t.composer.send}
            aria-disabled={!canSend}
            className={cn(
              'inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl',
              'bg-primary text-primary-foreground shadow-sm',
              'transition-all duration-[var(--nexo-motion-fast)]',
              canSend
                ? 'hover:bg-primary/90 active:scale-95'
                : 'cursor-not-allowed opacity-50',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nexo-cyan-bright)]',
            )}
          >
            <Send className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      <p className="mt-1.5 px-1 text-[10px] text-muted-foreground/70">
        {t.composer.enterHint}
      </p>
    </div>
  );
}
