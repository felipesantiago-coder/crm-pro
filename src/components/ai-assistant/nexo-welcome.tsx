'use client';

/**
 * Boas-vindas do Nexo (prompt §13).
 * Copy obrigatória + três categorias com sugestões + limite visível.
 * Em telas pequenas as sugestões extras ficam atrás de uma seção
 * expansível (prompt §13.3 — seleção editorial, não carrossel).
 */
import React, { useState } from 'react';
import {
  CalendarDays,
  ChevronDown,
  GraduationCap,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { NexoAvatar } from './nexo-avatar';
import { getAssistantMessages } from './assistant-messages';
import { cn } from '@/lib/utils';

export interface NexoWelcomeProps {
  /** Primeiro nome legítimo da sessão (opcional — nunca inventado). */
  firstName?: string;
  theme: 'claro' | 'escuro';
  onSuggestion: (text: string) => void;
}

interface CategoryGroup {
  id: 'crm' | 'day' | 'learn';
  icon: React.ReactNode;
  suggestions: { key: 'attention' | 'leads' | 'scheduleToday' | 'reminders' | 'followUp' | 'funnel' | 'features' | 'closedDeals'; mobileVisible: boolean }[];
}

const CATEGORY_GROUPS: CategoryGroup[] = [
  {
    id: 'crm',
    icon: <Search className="h-3.5 w-3.5" aria-hidden />,
    suggestions: [
      { key: 'leads', mobileVisible: true },
      { key: 'followUp', mobileVisible: false },
      { key: 'closedDeals', mobileVisible: false },
    ],
  },
  {
    id: 'day',
    icon: <CalendarDays className="h-3.5 w-3.5" aria-hidden />,
    suggestions: [
      { key: 'scheduleToday', mobileVisible: true },
      { key: 'reminders', mobileVisible: true },
    ],
  },
  {
    id: 'learn',
    icon: <GraduationCap className="h-3.5 w-3.5" aria-hidden />,
    suggestions: [
      { key: 'funnel', mobileVisible: false },
      { key: 'features', mobileVisible: false },
      { key: 'attention', mobileVisible: false },
    ],
  },
];

export function NexoWelcome({ firstName, theme, onSuggestion }: NexoWelcomeProps) {
  const t = getAssistantMessages();
  const [showAll, setShowAll] = useState(false);
  const trimmedName = firstName?.trim().split(/\s+/)[0];

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto px-4 pb-2 pt-4">
      {/* Hero — primeira apresentação obrigatória (prompt §4.1) */}
      <div className="flex flex-col items-center gap-2 pb-1 text-center">
        <NexoAvatar
          state="idle"
          theme={theme}
          size={64}
          decorative
          className="rounded-2xl"
        />
        <div>
          <p className="text-sm font-semibold">
            {trimmedName
              ? t.greetingWithName.replace('{name}', trimmedName)
              : t.greeting}
          </p>
          <p className="mx-auto mt-1 max-w-[300px] text-xs leading-relaxed text-muted-foreground">
            {t.welcomeDescription}
          </p>
        </div>
      </div>

      {/* Limite visível (prompt §5.3 / §13.1) */}
      <div className="flex items-start gap-2 rounded-xl border bg-muted/40 px-3 py-2">
        <ShieldCheck
          className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-success"
          aria-hidden
        />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {t.welcomeLimit}
        </p>
      </div>

      {/* Categorias (máximo três — prompt §13.2) */}
      <div className="flex flex-col gap-2.5">
        {CATEGORY_GROUPS.map((group) => {
          const category = t.categories[group.id];
          return (
            <div key={group.id}>
              <div className="mb-1 flex items-center gap-1.5 px-0.5">
                <span className="text-primary">{group.icon}</span>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {category.title}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {group.suggestions.map((suggestion) => (
                  <button
                    key={suggestion.key}
                    type="button"
                    onClick={() => onSuggestion(t.suggestions[suggestion.key])}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-left text-xs',
                      'transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nexo-cyan-bright)]',
                      !showAll && !suggestion.mobileVisible && 'hidden sm:flex',
                    )}
                  >
                    <span className="line-clamp-2">{t.suggestions[suggestion.key]}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Expansão editorial no mobile (prompt §13.3) */}
      <button
        type="button"
        onClick={() => setShowAll((prev) => !prev)}
        aria-expanded={showAll}
        className={cn(
          'mx-auto inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-primary',
          'transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nexo-cyan-bright)]',
          'sm:hidden',
        )}
      >
        <ChevronDown
          className={cn('h-3.5 w-3.5 transition-transform', showAll && 'rotate-180')}
          aria-hidden
        />
        {showAll ? '–' : '+'}
      </button>

      <p className="pb-1 text-center text-[10px] text-muted-foreground/70">
        {t.welcomeHint}
      </p>
    </div>
  );
}
