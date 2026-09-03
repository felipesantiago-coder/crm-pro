'use client';

/**
 * Boas-vindas do Nexo (prompt v2.0 §14/§15).
 *
 * Primeiro uso: apresentação + limite + pergunta inicial ("O que você quer
 * fazer primeiro?") com três opções e categorias com título e descrição.
 * Retorno: saudação por período do dia (horário local, uma vez por sessão)
 * + subtexto por tela. Sugestões vêm do catálogo determinístico por view.
 */
import React, { useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronDown,
  GraduationCap,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { NexoAvatar } from './nexo-avatar';
import { formatMessage, getAssistantMessages } from './assistant-messages';
import type { ClientSuggestion } from './assistant-suggestions-client';
import { ONBOARDING_KEY } from './assistant.constants';
import { cn } from '@/lib/utils';

export interface NexoWelcomeProps {
  /** Primeiro nome legítimo da sessão (opcional — nunca inventado). */
  firstName?: string;
  theme: 'claro' | 'escuro';
  /** View atual — seleciona o subtexto de retorno (§15). */
  view: string;
  onSuggestion: (text: string) => void;
  /** Catálogo determinístico da view atual (máx. 4 — §10). */
  openingSuggestions: ClientSuggestion[];
  onSuggestionSelect: (suggestion: ClientSuggestion) => void;
}

type Period = 'morning' | 'afternoon' | 'evening';

function currentPeriod(): Period {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}

/** Saudação por sessão — estável entre re-renders (zero custo). */
let sessionGreeting: Period | null = null;
function getGreetingPeriod(): Period {
  if (!sessionGreeting) {
    sessionGreeting = currentPeriod();
  }
  return sessionGreeting;
}

/** Primeiro uso vs retorno — onboarding concluído? (sem PII) */
function isFirstUse(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_KEY) !== '1';
  } catch {
    return true;
  }
}

const SUBTEXT_BY_VIEW: Record<string, 'subtextDashboard' | 'subtextClients' | 'subtextClientDetail' | 'subtextEnterprises' | 'subtextReports' | 'subtextSettings'> = {
  dashboard: 'subtextDashboard',
  clients: 'subtextClients',
  'client-detail': 'subtextClientDetail',
  enterprises: 'subtextEnterprises',
  reports: 'subtextReports',
  settings: 'subtextSettings',
};

export function NexoWelcome({
  firstName,
  theme,
  view,
  onSuggestion,
  openingSuggestions,
  onSuggestionSelect,
}: NexoWelcomeProps) {
  const t = getAssistantMessages();
  const [showAll, setShowAll] = useState(false);

  const trimmedName = firstName?.trim().split(/\s+/)[0];
  const firstUse = useMemo(() => isFirstUse(), []);
  const subtextKey = SUBTEXT_BY_VIEW[view] ?? 'subtextDashboard';

  // Primeiro uso: três opções fixas com prompts do catálogo (§14).
  const firstUseOptions = useMemo(() => {
    const find = (id: string) =>
      openingSuggestions.find((s) => s.id === id) ?? null;
    const day =
      find('dashboard.today_summary') ??
      find('reminders.today') ??
      openingSuggestions[0] ?? null;
    const clients =
      find('clients.filtered_summary') ??
      find('client.summary') ??
      find('clients.stale') ??
      openingSuggestions[1] ?? null;
    const learn =
      find('clients.funnel_help') ??
      find('dashboard.explain') ??
      openingSuggestions[2] ?? null;
    return [
      { key: 'day' as const, label: t.firstUseOptions.day, suggestion: day },
      { key: 'clients' as const, label: t.firstUseOptions.clients, suggestion: clients },
      { key: 'learn' as const, label: t.firstUseOptions.learn, suggestion: learn },
    ];
  }, [openingSuggestions, t]);

  const categories = [
    { id: 'crm' as const, icon: <Search className="h-3.5 w-3.5" aria-hidden /> },
    { id: 'day' as const, icon: <CalendarDays className="h-3.5 w-3.5" aria-hidden /> },
    { id: 'learn' as const, icon: <GraduationCap className="h-3.5 w-3.5" aria-hidden /> },
  ];

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto px-4 pb-2 pt-4">
      {/* Hero — primeiro uso ou saudação de retorno (§14/§15) */}
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
            {firstUse
              ? trimmedName
                ? formatMessage(t.greetingWithName, { name: trimmedName })
                : t.greeting
              : trimmedName
                ? formatMessage(t.returning[getGreetingPeriod()], { name: trimmedName })
                : t.returning[getGreetingPeriod()].replace(/, \{name\}/, '')}
          </p>
          <p className="mx-auto mt-1 max-w-[300px] text-xs leading-relaxed text-muted-foreground">
            {firstUse ? t.welcomeDescription : t.returning[subtextKey]}
          </p>
        </div>
      </div>

      {/* Limite visível (§14) */}
      <div className="flex items-start gap-2 rounded-xl border bg-muted/40 px-3 py-2">
        <ShieldCheck
          className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-success"
          aria-hidden
        />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {t.welcomeLimit}
        </p>
      </div>

      {firstUse ? (
        <>
          {/* Pergunta inicial + três opções (§14) */}
          <p className="px-0.5 text-xs font-semibold text-foreground">
            {t.firstUseQuestion}
          </p>
          <div className="flex flex-col gap-1.5">
            {firstUseOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => {
                  if (option.suggestion) {
                    onSuggestionSelect(option.suggestion);
                  } else if (option.key === 'day') {
                    onSuggestion(t.states.loading.schedules);
                  } else {
                    onSuggestion(option.label);
                  }
                }}
                className={cn(
                  'flex min-h-[44px] items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-left text-xs',
                  'transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nexo-cyan-bright)]',
                )}
              >
                <span className="line-clamp-2">{option.label}</span>
              </button>
            ))}
          </div>

          {/* Categorias com título E descrição (§7.7/§14) */}
          <div className="flex flex-col gap-1.5">
            {categories.map((category) => {
              const copy = t.categories[category.id];
              return (
                <div
                  key={category.id}
                  className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2"
                >
                  <span className="text-primary">{category.icon}</span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold">{copy.title}</p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {copy.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        /* Retorno: sugestões do catálogo por tela (§10) */
        <div className="flex flex-col gap-1.5">
          {openingSuggestions.slice(0, showAll ? openingSuggestions.length : 3).map((suggestion) => (
            <button
              key={suggestion.id}
              type="button"
              onClick={() => onSuggestionSelect(suggestion)}
              className={cn(
                'flex min-h-[44px] items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-left text-xs',
                'transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nexo-cyan-bright)]',
              )}
            >
              <span className="line-clamp-2">{suggestion.label}</span>
            </button>
          ))}
          {openingSuggestions.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAll((prev) => !prev)}
              aria-expanded={showAll}
              className={cn(
                'mx-auto inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-primary',
                'transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nexo-cyan-bright)]',
              )}
            >
              <ChevronDown
                className={cn('h-3.5 w-3.5 transition-transform', showAll && 'rotate-180')}
                aria-hidden
              />
              {showAll ? t.suggestionsUI.less : t.suggestionsUI.more}
            </button>
          )}
        </div>
      )}

      <p className="pb-1 text-center text-[10px] text-muted-foreground/70">
        {t.welcomeHint}
      </p>
    </div>
  );
}
