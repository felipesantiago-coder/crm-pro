'use client';

/**
 * NexoNavigationActions — botões de ação allowlisted (prompt v2.0 §20/§15).
 *
 * O servidor deriva as ações (nunca o modelo); o clique do usuário confirma.
 * Apenas navegação/filtro reversível. Rótulos vêm do i18n local por tipo de
 * ação — o texto do servidor é apenas fallback. Ao navegar, o painel fecha
 * sem perder a conversa e a mudança é anunciada (região viva do widget).
 */
import React from 'react';
import { ArrowRight, Filter, User, Building2 } from 'lucide-react';
import { getAssistantMessages, formatMessage } from './assistant-messages';
import type { AssistantNavigationAction } from './assistant.types';
import { cn } from '@/lib/utils';

export interface NexoNavigationActionsProps {
  actions: AssistantNavigationAction[];
  onAction: (action: AssistantNavigationAction) => void;
}

function labelFor(action: AssistantNavigationAction): string {
  const t = getAssistantMessages();
  switch (action.type) {
    case 'NAVIGATE_VIEW': {
      const view = t.context.views[action.view as keyof typeof t.context.views] ?? action.view;
      return formatMessage(t.navigation.openView, { view });
    }
    case 'OPEN_CLIENT':
      return t.navigation.openClient;
    case 'OPEN_ENTERPRISE':
      return t.navigation.openEnterprise;
    case 'APPLY_CLIENT_FILTER':
      return t.navigation.applyFilter;
  }
}

function iconFor(action: AssistantNavigationAction): React.ReactNode {
  switch (action.type) {
    case 'NAVIGATE_VIEW':
      return <ArrowRight className="h-3 w-3" aria-hidden />;
    case 'OPEN_CLIENT':
      return <User className="h-3 w-3" aria-hidden />;
    case 'OPEN_ENTERPRISE':
      return <Building2 className="h-3 w-3" aria-hidden />;
    case 'APPLY_CLIENT_FILTER':
      return <Filter className="h-3 w-3" aria-hidden />;
  }
}

export function NexoNavigationActions({ actions, onAction }: NexoNavigationActionsProps) {
  if (actions.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {actions.map((action, index) => (
        <button
          key={`${action.type}-${index}`}
          type="button"
          onClick={() => onAction(action)}
          className={cn(
            'inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5',
            'text-[11px] font-medium text-primary transition-colors hover:bg-muted',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nexo-cyan-bright)]',
          )}
        >
          {iconFor(action)}
          {labelFor(action)}
        </button>
      ))}
    </div>
  );
}
