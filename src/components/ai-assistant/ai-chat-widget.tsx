'use client';

// ============================================================
// NEXO — ASSISTENTE DE IA DO CRM PRO (módulo isolado)
//
// Para remover completamente este assistente de IA:
//   1. Delete a pasta: src/components/ai-assistant/
//   2. Delete a pasta: src/app/api/ai-assistant/
//   3. Em src/app/page.tsx, remova a importação e o <AIChatWidget />
//   4. Delete os assets: public/brand/assistant/
//
// Reformulação v1.0 — identidade "Nexo" com os assets oficiais
// CRM_Pro_AI_Assistant_Assets_v1.0 (SVGs em public/brand/assistant/),
// máquina de estados explícita (use-ai-chat.ts), acessibilidade WCAG 2.2 AA
// e copy centralizada no namespace aiAssistant.
// ============================================================

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTheme } from 'next-themes';
import { useSession } from 'next-auth/react';
import { FocusScope } from '@radix-ui/react-focus-scope';
import { toast } from 'sonner';
import { NexoAvatar } from './nexo-avatar';
import { NexoComposer } from './nexo-composer';
import { NexoErrorState } from './nexo-error-state';
import { NexoHeader } from './nexo-header';
import { NexoLauncher } from './nexo-launcher';
import { NexoMessage, MessageErrorFlag } from './nexo-message';
import { NexoWelcome } from './nexo-welcome';
import { useAiChat } from './use-ai-chat';
import { getAssistantMessages } from './assistant-messages';
import { cn } from '@/lib/utils';

/**
 * Detecção de hidratação sem setState em efeito (react-hooks/set-state-in-effect):
 * snapshot do servidor = false, snapshot do cliente = true.
 */
const emptySubscribe = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/** Tema atual como variante de asset oficial (claro/escuro). */
function useAssistantTheme(): 'claro' | 'escuro' {
  const { resolvedTheme } = useTheme();
  const mounted = useMounted();
  if (!mounted) return 'claro'; // evita mismatch de hidratação
  return resolvedTheme === 'dark' ? 'escuro' : 'claro';
}

/** Viewport touch (mobile = painel modal em bottom sheet). */
function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)');
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return isMobile;
}

const CONTEXTUAL_KEYS = ['clients', 'agenda', 'reminders', 'help'] as const;

export function AIChatWidget() {
  const t = getAssistantMessages();
  const theme = useAssistantTheme();
  const isMobile = useIsMobileViewport();
  const { data: session } = useSession();
  const chat = useAiChat();

  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const composerFocusRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const firstName =
    typeof session?.user?.name === 'string' ? session.user.name : undefined;

  // Rola para a última mensagem quando a conversa muda ou entra em thinking.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, chat.visualState]);

  // Ao abrir: foco no composer após a transição do painel (prompt §16.1).
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => composerFocusRef.current?.focus(), 260);
    return () => window.clearTimeout(id);
  }, [open]);

  const closePanel = useCallback(() => {
    setOpen(false);
    // Restaura o foco no launcher (prompt §16.1).
    window.setTimeout(() => launcherRef.current?.focus(), 60);
  }, []);

  // Escape fecha o painel quando não há ação mais apropriada (prompt §16.1).
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (chat.isBusy) {
        // Durante o processamento, Escape cancela a resposta — ação explícita.
        chat.cancel();
        return;
      }
      closePanel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [chat, closePanel, open]);

  function handleNewConversation() {
    const previous = chat.startNewConversation();
    if (previous.length === 0) return;
    toast(t.messages.newChatCleared, {
      action: {
        label: t.messages.newChatUndo,
        onClick: () => chat.restoreConversation(previous),
      },
      duration: 6000,
    });
  }

  const hasMessages = chat.messages.length > 0;
  const showThinking = chat.visualState === 'thinking';
  const isOffline = chat.visualState === 'offline';
  const showErrorBanner =
    chat.errorKind !== null &&
    (chat.visualState === 'error' || chat.visualState === 'offline');

  return (
    <>
      {/* Launcher fechado */}
      <NexoLauncher
        open={open}
        theme={theme}
        onOpen={() => setOpen(true)}
        launcherRef={launcherRef}
      />

      {/* Painel — desktop/tablet: janela ancorada; mobile: bottom sheet modal */}
      <FocusScope trapped={open && isMobile}>
        <div
          role="dialog"
          aria-labelledby="nexo-panel-title"
          aria-modal={open && isMobile ? true : undefined}
          aria-hidden={!open || undefined}
          className={cn(
            'fixed z-50 flex flex-col overflow-hidden rounded-3xl border bg-card shadow-2xl',
            'transition-[opacity,transform] duration-[var(--nexo-motion-slow)] ease-[var(--nexo-ease-standard)]',
            // Posição
            'inset-x-2 bottom-2 sm:inset-x-auto sm:bottom-5 sm:right-5',
            // Mobile: sheet de 100dvh respeitando safe areas (prompt §11.3)
            'h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)]',
            // Desktop padrão 420 px; expandido 720 px (prompt §11.1)
            'sm:h-[min(680px,calc(100dvh-32px))] sm:w-[min(420px,calc(100vw-32px))]',
            expanded &&
              'sm:w-[min(720px,calc(100vw-32px))] sm:h-[min(680px,calc(100dvh-32px))]',
            // Sombra mais leve e difusa no tema escuro (prompt §18)
            'dark:shadow-[0_18px_48px_rgb(0_0_0/0.45)]',
            open
              ? 'pointer-events-auto translate-y-0 scale-100 opacity-100'
              : 'pointer-events-none translate-y-4 scale-[0.98] opacity-0',
          )}
        >
          <NexoHeader
            state={chat.visualState}
            expanded={expanded}
            hasMessages={hasMessages}
            onNewConversation={handleNewConversation}
            onToggleExpand={() => setExpanded((prev) => !prev)}
            onClose={closePanel}
          />

          {/* Corpo: boas-vindas ou conversa */}
          {hasMessages ? (
            <div
              ref={scrollRef}
              role="log"
              aria-label={t.messages.logLabel}
              aria-live="polite"
              aria-relevant="additions text"
              aria-busy={showThinking}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
            >
              {chat.messages.map((message) => (
                <React.Fragment key={message.id}>
                  <NexoMessage message={message} />
                  {message.role === 'user' && message.status === 'error' && (
                    <div className="flex justify-end">
                      <MessageErrorFlag />
                    </div>
                  )}
                </React.Fragment>
              ))}

              {showThinking && (
                <div className="flex items-start gap-2">
                  <NexoAvatar
                    state="thinking"
                    theme="transparente"
                    size={28}
                    decorative
                    className="mt-0.5 flex-shrink-0"
                  />
                  <div className="rounded-2xl rounded-bl-md border bg-card px-3.5 py-2.5 shadow-xs">
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span
                        className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--nexo-cyan)]"
                        aria-hidden
                      />
                      {t.states.thinking}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="min-h-0 flex-1">
              <NexoWelcome
                firstName={firstName}
                theme={theme}
                onSuggestion={(text) => chat.send(text)}
              />
            </div>
          )}

          {/* Estado de erro / indisponibilidade (prompt §14.4) */}
          {showErrorBanner && chat.errorKind && (
            <NexoErrorState
              kind={chat.errorKind}
              onRetry={chat.retry}
              canRetry={chat.canRetry && !chat.isBusy}
            />
          )}

          {/* Sugestões contextuais quando há conversa (prompt §11.4) */}
          {hasMessages && !chat.isBusy && !showErrorBanner && (
            <div className="flex flex-shrink-0 gap-1.5 overflow-x-auto border-t bg-muted/20 px-3 py-2">
              {CONTEXTUAL_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => chat.send(t.contextual[key])}
                  className={cn(
                    'flex-shrink-0 whitespace-nowrap rounded-full border bg-card px-2.5 py-2 text-[11px] text-muted-foreground',
                    'transition-colors hover:bg-muted hover:text-foreground',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nexo-cyan-bright)]',
                  )}
                >
                  {t.contextual[key]}
                </button>
              ))}
            </div>
          )}

          <NexoComposer
            value={chat.input}
            onChange={chat.setInput}
            onSubmit={() => chat.send(chat.input)}
            onFocus={chat.notifyTyping}
            onCancel={chat.cancel}
            busy={chat.isBusy}
            disabled={isOffline}
            focusRef={composerFocusRef}
          />
        </div>
      </FocusScope>

      {/* Região viva de status — anuncia cada mudança uma única vez */}
      <div aria-live="polite" className="sr-only">
        {open ? t.states[chat.visualState] : ''}
      </div>
    </>
  );
}
