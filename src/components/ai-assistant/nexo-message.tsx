'use client';

/**
 * Mensagem do Nexo ou do usuário (prompt v2.0 §8.3/§14/§16/§22).
 *
 * Respostas em Markdown sanitizado; ação de cópia com feedback real e
 * visível em touch; metadado discreto do contexto usado ("Baseado em:
 * …"); avisos tipados (partial_data); ações de navegação allowlisted.
 * A mensagem enviada usa texto acessível — nunca apenas "…".
 */
import React, { useState } from 'react';
import { Check, Copy, TriangleAlert } from 'lucide-react';
import { NexoAvatar } from './nexo-avatar';
import { NexoMarkdown } from './nexo-markdown';
import { NexoNavigationActions } from './nexo-navigation-actions';
import { formatMessage, getAssistantMessages } from './assistant-messages';
import type { AssistantNavigationAction, ChatMessage } from './assistant.types';
import { cn } from '@/lib/utils';

function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const t = getAssistantMessages();

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard indisponível (permissão/contexto) — feedback de falha real.
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? t.messages.copied : t.messages.copy}
      title={copied ? t.messages.copied : t.messages.copy}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground',
        'transition-colors hover:bg-muted hover:text-foreground',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nexo-cyan-bright)]',
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function NexoMessage({
  message,
  onNavigationAction,
}: {
  message: ChatMessage;
  onNavigationAction?: (action: AssistantNavigationAction) => void;
}) {
  const t = getAssistantMessages();

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div
          className={cn(
            'max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5',
            'text-primary-foreground',
            message.status === 'error' && 'opacity-90',
          )}
        >
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {message.content}
          </p>
          {message.status === 'sending' && (
            // Texto acessível — nunca apenas "…" (prompt v2.0 §22).
            <p className="mt-1 text-right text-[10px] opacity-80">
              {t.composer.sending}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Metadado discreto do contexto usado (§8.3) — sem IDs, sem "fonte externa".
  const contextLabel = (() => {
    const cu = message.contextUsed;
    if (!cu) return null;
    if (cu.entityType === 'client') return t.context.client.replace('Contexto: ', '');
    if (cu.entityType === 'enterprise') return t.context.enterprise.replace('Contexto: ', '');
    const view = t.context.views[cu.view as keyof typeof t.context.views] ?? cu.view;
    return view;
  })();

  return (
    <div className="flex items-start gap-2">
      <NexoAvatar
        state="idle"
        theme="transparente"
        size={28}
        decorative
        className="mt-0.5 flex-shrink-0"
      />
      <div className="group min-w-0 max-w-[85%]">
        <div className="rounded-2xl rounded-bl-md border bg-card px-3.5 py-2.5 shadow-xs">
          <NexoMarkdown text={message.content} />
          {message.warnings?.includes('partial_data') && (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-muted/40 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground" role="note">
              <TriangleAlert className="mt-0.5 h-3 w-3 flex-shrink-0" aria-hidden />
              {t.errors.partial_data}
            </p>
          )}
          {onNavigationAction && message.navigationActions && message.navigationActions.length > 0 && (
            <NexoNavigationActions
              actions={message.navigationActions}
              onAction={onNavigationAction}
            />
          )}
        </div>
        <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100">
          <CopyButton content={message.content} />
          {contextLabel && (
            <span className="text-[10px] text-muted-foreground/80">
              {formatMessage(t.context.basedOn, { label: contextLabel })} · {t.context.basedOnJustNow}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Linha de status de falha anexada à mensagem do usuário que falhou. */
export function MessageErrorFlag() {
  const t = getAssistantMessages();
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-destructive">
      <TriangleAlert className="h-3 w-3" aria-hidden />
      {t.states.error}
    </span>
  );
}
