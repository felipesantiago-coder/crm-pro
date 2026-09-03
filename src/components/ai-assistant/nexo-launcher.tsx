'use client';

/**
 * Launcher fechado do Nexo (prompt §10).
 * Personagem idle animado (56 px desktop / 52 px mobile), área mínima de
 * toque de 48 px, rótulo de descoberta não modal na primeira visita e
 * nome acessível completo.
 */
import React, { useState, useSyncExternalStore } from 'react';
import { NexoAvatar } from './nexo-avatar';
import { DISCOVERY_DISMISSED_KEY } from './assistant.constants';
import { getAssistantMessages } from './assistant-messages';
import { cn } from '@/lib/utils';

/** Assinatura de store estática (a elegibilidade não muda por subscription). */
const emptySubscribe = () => () => {};

export interface NexoLauncherProps {
  open: boolean;
  theme: 'claro' | 'escuro';
  onOpen: () => void;
  /** Ref para restauração de foco ao fechar o painel (prompt §16.1). */
  launcherRef: React.RefObject<HTMLButtonElement | null>;
}

export function NexoLauncher({ open, theme, onOpen, launcherRef }: NexoLauncherProps) {
  const t = getAssistantMessages();
  const [dismissed, setDismissed] = useState(false);

  // Elegibilidade lida via useSyncExternalStore (hidratação segura, sem
  // setState em efeito): server snapshot = false; client = sessionStorage.
  const eligibleBySession = useSyncExternalStore(
    emptySubscribe,
    () => {
      try {
        return !sessionStorage.getItem(DISCOVERY_DISMISSED_KEY);
      } catch {
        return false;
      }
    },
    () => false,
  );
  const showDiscovery = eligibleBySession && !dismissed && !open;

  function dismissDiscovery() {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISCOVERY_DISMISSED_KEY, '1');
    } catch {
      // Sem persistência — o estado local já suprime nesta sessão.
    }
  }

  function handleClick() {
    dismissDiscovery();
    onOpen();
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex items-end gap-2.5">
      {/* Rótulo de descoberta — não modal, não bloqueia conteúdo */}
      {showDiscovery && (
        <div className="nexo-discovery-label relative mb-1 max-w-[220px] rounded-xl border bg-card px-3 py-2 shadow-md">
          <p className="text-xs font-semibold leading-tight">
            {t.launcher.discoveryTitle}
          </p>
          <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
            {t.launcher.discoverySubtitle}
          </p>
          <button
            type="button"
            onClick={dismissDiscovery}
            aria-label={t.header.close}
            className="absolute -right-1.5 -top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-xs transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nexo-cyan-bright)]"
          >
            <span aria-hidden className="text-[10px] leading-none">✕</span>
            <span className="sr-only">{t.header.close}</span>
          </button>
        </div>
      )}

      <button
        ref={launcherRef}
        type="button"
        onClick={handleClick}
        aria-label={t.launcher.open}
        title={t.fullName}
        aria-hidden={open || undefined}
        tabIndex={open ? -1 : 0}
        className={cn(
          'nexo-launcher flex items-center justify-center border shadow-lg',
          'min-h-[48px] min-w-[48px]',
          'transition-[opacity,transform] duration-[var(--nexo-motion-base)]',
          open && 'pointer-events-none scale-0 opacity-0',
        )}
      >
        <NexoAvatar
          state="idle"
          theme={theme}
          size={56}
          decorative
          className="h-full w-full rounded-[inherit] object-cover"
        />
      </button>
    </div>
  );
}
