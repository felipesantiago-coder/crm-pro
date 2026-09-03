'use client';

/**
 * Mensagem do Nexo ou do usuário (prompt §14).
 * Respostas em Markdown sanitizado; ação de cópia com feedback local;
 * sem telemetria simulada e sem exposição do provedor (prompt §22).
 */
import React, { useState } from 'react';
import { Check, Copy, TriangleAlert } from 'lucide-react';
import { NexoAvatar } from './nexo-avatar';
import { NexoMarkdown } from './nexo-markdown';
import { getAssistantMessages } from './assistant-messages';
import type { ChatMessage } from './assistant.types';
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
      // Clipboard indisponível (permissão/contexto) — sem feedback falso.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? t.messages.copied : t.messages.copy}
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

export function NexoMessage({ message }: { message: ChatMessage }) {
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
            <p className="mt-1 text-right text-[10px] opacity-70">…</p>
          )}
        </div>
      </div>
    );
  }

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
        </div>
        <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <CopyButton content={message.content} />
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
