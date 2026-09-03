/**
 * suggestion-engine.ts — Sugestões pós-resposta do servidor (prompt v2.0 §12/§19).
 *
 * Servidor resolve labels/prompts do catálogo por locale (pt-BR fonte
 * semântica; en/es paritários). O modelo não participa — zero custo de IA,
 * zero alucinação de sugestão.
 */
import {
  selectFollowUpSuggestions,
  type AssistantSuggestion,
} from './suggestion-catalog';
import type { AssistantIntent } from './intent-resolver';
import ptBR from '@/i18n/locales/assistant/pt-BR.json';
import en from '@/i18n/locales/assistant/en.json';
import es from '@/i18n/locales/assistant/es.json';

type CatalogEntry = { label: string; prompt: string };

interface CatalogMessages {
  aiAssistant: {
    catalog?: Record<string, CatalogEntry>;
    followUpNavigation?: Record<string, string>;
    navigation?: { applyFilter?: string };
  };
}

const LOCALE_MESSAGES: Record<string, CatalogMessages> = {
  'pt-BR': ptBR as CatalogMessages,
  en: en as CatalogMessages,
  es: es as CatalogMessages,
};

export type SupportedLocale = 'pt-BR' | 'en' | 'es';

export function getCatalogMessages(locale: string | undefined): CatalogMessages {
  return LOCALE_MESSAGES[locale ?? 'pt-BR'] ?? LOCALE_MESSAGES['pt-BR'];
}

function entryFor(suggestion: AssistantSuggestion, locale: string | undefined): { label: string; prompt: string } | null {
  const messages = getCatalogMessages(locale);
  const entry = messages.aiAssistant.catalog?.[suggestion.id];
  if (entry?.label) {
    return { label: entry.label, prompt: entry.prompt ?? '' };
  }
  return null;
}

/**
 * Sugestões de continuidade enviadas na resposta v2.
 * `view` é usado quando o follow-up pede navegação contextual
 * ("navigate.relevant_view" → leva à tela atual em que o usuário está).
 */
export function buildSuggestedReplies(params: {
  intent: AssistantIntent;
  locale: string | undefined;
  role?: string;
  entity?: { type: 'client' | 'enterprise'; id: string } | null;
  currentView: string;
}): Array<{ id: string; label: string; prompt: string }> {
  const { intent, locale, role, entity, currentView } = params;
  const suggestions = selectFollowUpSuggestions(intent, { role, entity });

  const result: Array<{ id: string; label: string; prompt: string }> = [];
  const messages = getCatalogMessages(locale);

  for (const suggestion of suggestions) {
    const entry = entryFor(suggestion, locale);
    if (!entry) continue;

    // Sugestões de navegação viram prompt leve — o servidor também deriva
    // navigationActions; o texto orienta o usuário sobre o que o clique faz.
    let prompt = entry.prompt;
    if (suggestion.action?.type === 'NAVIGATE_VIEW') {
      const target = suggestion.action.view;
      const label = messages.aiAssistant.followUpNavigation?.[target] ?? messages.aiAssistant.followUpNavigation?.[currentView] ?? entry.label;
      prompt = label || prompt;
    }
    result.push({ id: suggestion.id, label: entry.label, prompt });
  }
  return result;
}

/** Rótulos das views para a barra de contexto e contextUsed (por locale). */
export function getViewLabels(locale: string | undefined): Record<string, string> {
  const messages = getCatalogMessages(locale);
  return (messages.aiAssistant as unknown as {
    context?: { views?: Record<string, string> };
  }).context?.views ?? {};
}
