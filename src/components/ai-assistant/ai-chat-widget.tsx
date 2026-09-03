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
// Reformulação v2.0 — interações proativas: contexto estruturado por tela
// (§8), sugestões determinísticas por view/intent (§10-§12), proatividade
// controlada com nudge único por sessão (§13), resposta v2 com ações de
// navegação allowlisted (§19-§20) e acessibilidade WCAG 2.2 AA (§22).
// ============================================================

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTheme } from 'next-themes';
import { useSession } from 'next-auth/react';
import { FocusScope } from '@radix-ui/react-focus-scope';
import { toast } from 'sonner';
import { NexoAvatar } from './nexo-avatar';
import { NexoComposer } from './nexo-composer';
import { NexoContextBar } from './nexo-context-bar';
import { NexoErrorState } from './nexo-error-state';
import { NexoHeader } from './nexo-header';
import { NexoLauncher } from './nexo-launcher';
import { NexoMessage, MessageErrorFlag } from './nexo-message';
import { NexoNavigationActions } from './nexo-navigation-actions';
import { NexoSuggestionList } from './nexo-suggestion-list';
import { NexoWelcome } from './nexo-welcome';
import { NexoProactiveNudge } from './nexo-nudge';
import { useAiChat } from './use-ai-chat';
import { getAssistantMessages, formatMessage } from './assistant-messages';
import { getOpeningSuggestionsForView, toClientSuggestions, type ClientSuggestion } from './assistant-suggestions-client';
import { useAssistantContextStore } from './assistant-context-store';
import { ONBOARDING_KEY } from './assistant.constants';
import type { AssistantNavigationAction, AssistantContextView } from './assistant.types';
import { useCRMStore } from '@/store/crm-store';
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

/** Hint exibido uma única vez (prompt §14 — persistido sem PII). */
function readOnceFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function writeOnceFlag(key: string): void {
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    // Sem persistência — vale apenas para esta sessão.
  }
}

export function AIChatWidget() {
  const t = getAssistantMessages();
  const theme = useAssistantTheme();
  const isMobile = useIsMobileViewport();
  const { data: session } = useSession();
  const chat = useAiChat();
  const setCurrentView = useCRMStore((s) => s.setCurrentView);
  const requestOpenClient = useCRMStore((s) => s.requestOpenClient);
  const requestOpenEnterprise = useCRMStore((s) => s.requestOpenEnterprise);
  const requestApplyClientFilter = useCRMStore((s) => s.requestApplyClientFilter);

  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const composerFocusRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Contexto reativo da tela atual (bridge nas views — §8).
  const pageContext = useAssistantContextStore((s) => s.pageContext);
  const suppressed = useAssistantContextStore((s) => s.suppressed);
  const pinnedContext = useAssistantContextStore((s) => s.pinnedContext);

  // Abertura externa ("Perguntar ao Nexo sobre este cliente"): assinatura do
  // store — setState em callback de sistema externo, não em corpo de efeito.
  useEffect(() => {
    return useAssistantContextStore.subscribe((state, prev) => {
      if (state.openRequestId !== prev.openRequestId && state.openRequestId > 0) {
        setOpen(true);
      }
    });
  }, []);

  const firstName =
    typeof session?.user?.name === 'string' ? session.user.name : undefined;
  const userRole =
    (session?.user as { role?: string } | undefined)?.role ?? 'USER';

  // Dica pós-primeira resposta (§14): exibida exatamente uma vez por navegador —
  // derivada (sem setState em efeito) e persistida por efeito de escrita.
  const assistantCount = chat.messages.filter((m) => m.role === 'assistant').length;
  const showPostFirstAnswerTip = assistantCount === 1 && !readOnceFlag(ONBOARDING_KEY);
  useEffect(() => {
    if (showPostFirstAnswerTip) writeOnceFlag(ONBOARDING_KEY);
  }, [showPostFirstAnswerTip]);

  // Rola para a última mensagem quando a conversa muda ou entra em thinking.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, chat.visualState]);

  // Ao abrir: foco no composer via callback de transição (§22 — sem timer fixo).
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const textarea = composerFocusRef.current;
    if (!panel || !textarea) return;
    let fallbackId = 0;
    const focusComposer = () => {
      textarea.focus();
      panel.removeEventListener('transitionend', onTransitionEnd);
      window.clearTimeout(fallbackId);
    };
    function onTransitionEnd(event: TransitionEvent) {
      if (event.target === panel) focusComposer();
    }
    panel.addEventListener('transitionend', onTransitionEnd);
    // Fallback curto caso a transição não dispare (reduced motion).
    fallbackId = window.setTimeout(focusComposer, 400);
    return () => {
      panel.removeEventListener('transitionend', onTransitionEnd);
      window.clearTimeout(fallbackId);
    };
  }, [open]);

  const closePanel = useCallback(() => {
    setOpen(false);
    // Restaura o foco no launcher (prompt §22).
    window.setTimeout(() => launcherRef.current?.focus(), 60);
  }, []);

  // Escape fecha o painel quando não há ação mais apropriada (prompt §22).
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

  /** Ações allowlisted — navegação local, nunca escrita (prompt §20). */
  function handleNavigationAction(action: AssistantNavigationAction) {
    switch (action.type) {
      case 'NAVIGATE_VIEW': {
        const view = action.view as AssistantContextView;
        const label = t.context.views[view as keyof typeof t.context.views] ?? view;
        setCurrentView(view as never);
        if (isMobile) closePanel();
        toast(formatMessage(t.navigation.navigateAnnounce, { view: label }), {
          duration: 2500,
        });
        break;
      }
      case 'OPEN_CLIENT':
        requestOpenClient(action.clientId);
        if (isMobile) closePanel();
        break;
      case 'OPEN_ENTERPRISE':
        requestOpenEnterprise(action.enterpriseId);
        if (isMobile) closePanel();
        break;
      case 'APPLY_CLIENT_FILTER':
        requestApplyClientFilter(action.stage, action.tagIds);
        setCurrentView('clients');
        if (isMobile) closePanel();
        break;
    }
  }

  /** Sugestão com ação local executa navegação sem chamar o modelo (§10). */
  function handleSuggestionSelect(suggestion: ClientSuggestion) {
    if (suggestion.action?.type === 'NAVIGATE_VIEW') {
      handleNavigationAction({ type: 'NAVIGATE_VIEW', view: suggestion.action.view, label: '' });
      return;
    }
    chat.send(suggestion.prompt || suggestion.label);
  }

  // Sugestões de abertura: catálogo determinístico por view/papel/entidade (§10).
  const effectiveEntity = pinnedContext ?? pageContext.entity ?? null;
  const openingSuggestions = getOpeningSuggestionsForView({
    view: pageContext.view,
    role: userRole,
    entity: effectiveEntity,
  });
  // Pós-resposta: sugestões do servidor (continuidade por intent — §12).
  const postResponseSuggestions = chat.suggestedReplies.length
    ? toClientSuggestions(chat.suggestedReplies)
    : openingSuggestions;

  const hasMessages = chat.messages.length > 0;
  const showThinking = chat.visualState === 'thinking';
  const isOffline = chat.visualState === 'offline';
  const showErrorBanner =
    chat.errorKind !== null &&
    (chat.visualState === 'error' || chat.visualState === 'offline');

  // Texto de processamento por intent (§7.8) — nunca "Analisando seus dados…" genérico.
  const loadingText = chat.activeIntent
    ? t.states.loading[chat.activeIntent === 'client_summary' ? 'clients'
        : chat.activeIntent === 'today_schedule' ? 'schedules'
        : chat.activeIntent === 'reminders' ? 'reminders'
        : chat.activeIntent === 'enterprise_summary' ? 'enterprise'
        : chat.activeIntent === 'report_summary' ? 'reports'
        : 'help']
    : t.states.thinking;

  return (
    <>
      {/* Launcher fechado + nudge proativo (nunca autoabre — §13) */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end">
        <NexoProactiveNudge panelOpen={open} onReview={() => setOpen(true)} />
        <NexoLauncher
          open={open}
          theme={theme}
          onOpen={() => setOpen(true)}
          launcherRef={launcherRef}
        />
      </div>

      {/* Painel — desktop/tablet: janela ancorada; mobile: bottom sheet modal.
          Fechado: `inert` real impede foco nos descendentes (§7.10/§22). */}
      <FocusScope trapped={open && isMobile}>
        <div
          ref={panelRef}
          role="dialog"
          aria-labelledby="nexo-panel-title"
          aria-modal={open && isMobile ? true : undefined}
          inert={!open || undefined}
          className={cn(
            'fixed z-50 flex flex-col overflow-hidden rounded-3xl border bg-card shadow-2xl',
            'transition-[opacity,transform] duration-[var(--nexo-motion-slow)] ease-[var(--nexo-ease-standard)]',
            // Posição
            'inset-x-2 bottom-2 sm:inset-x-auto sm:bottom-5 sm:right-5',
            // Mobile: sheet de 100dvh respeitando safe areas (prompt §22)
            'h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)]',
            // Desktop padrão 420 px; expandido 720 px
            'sm:h-[min(680px,calc(100dvh-32px))] sm:w-[min(420px,calc(100vw-32px))]',
            expanded &&
              'sm:w-[min(720px,calc(100vw-32px))] sm:h-[min(680px,calc(100dvh-32px))]',
            // Sombra mais leve e difusa no tema escuro
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

          {/* Barra de contexto da tela atual (§8.3) — sem criar mensagens */}
          {open && <NexoContextBar compact />}

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
                  <NexoMessage message={message} onNavigationAction={handleNavigationAction} />
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
                      {loadingText}
                    </p>
                  </div>
                </div>
              )}

              {/* Cancelamento com pergunta preservada (§7.9) */}
              {chat.cancelledQuestion && !chat.isBusy && (
                <div
                  role="status"
                  className="flex flex-col gap-1.5 rounded-xl border bg-muted/40 px-3 py-2.5"
                >
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t.messages.cancelled}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={chat.retry}
                      className={cn(
                        'inline-flex min-h-[36px] items-center rounded-lg border px-2.5 text-[11px] font-medium text-foreground',
                        'transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nexo-cyan-bright)]',
                      )}
                    >
                      {t.messages.cancelledRetry}
                    </button>
                    <button
                      type="button"
                      onClick={chat.resumeEditingCancelled}
                      className={cn(
                        'inline-flex min-h-[36px] items-center rounded-lg border px-2.5 text-[11px] font-medium text-foreground',
                        'transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nexo-cyan-bright)]',
                      )}
                    >
                      {t.messages.cancelledEdit}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="min-h-0 flex-1">
              <NexoWelcome
                firstName={firstName}
                theme={theme}
                view={pageContext.view}
                onSuggestion={(text) => chat.send(text)}
                openingSuggestions={openingSuggestions}
                onSuggestionSelect={handleSuggestionSelect}
              />
            </div>
          )}

          {/* Estado de erro / indisponibilidade (§16) */}
          {showErrorBanner && chat.errorKind && (
            <NexoErrorState
              kind={chat.errorKind}
              onRetry={chat.retry}
              canRetry={chat.canRetry && !chat.isBusy}
            />
          )}

          {/* Sugestões pós-resposta (continuidade por intent — §12) */}
          {hasMessages && !chat.isBusy && !showErrorBanner && (
            <div className="flex-shrink-0 border-t bg-muted/20 px-3 py-2">
              {!suppressed && showPostFirstAnswerTip && (
                <p className="mb-1.5 rounded-lg bg-muted/40 px-2.5 py-1.5 text-[10px] leading-relaxed text-muted-foreground" role="note">
                  {t.onboarding.postFirstAnswer}
                </p>
              )}
              <NexoSuggestionList
                suggestions={postResponseSuggestions}
                onSelect={handleSuggestionSelect}
                dense
              />
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
            view={pageContext.view}
            entity={effectiveEntity}
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
