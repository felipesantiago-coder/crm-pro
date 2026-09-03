'use client';

/**
 * assistant-suggestions-client.ts — Bridge do catálogo determinístico (v2.0 §10)
 * para o bundle do cliente: resolve label/prompt por locale via i18n e expõe
 * seletores de abertura por view. Zero chamada de IA.
 */
import { getAssistantMessages, type AssistantMessages } from './assistant-messages';
import {
  ASSISTANT_SUGGESTION_CATALOG,
  selectOpeningSuggestions,
  type AssistantSuggestion,
} from '@/lib/ai-assistant/suggestion-catalog';
import type { AssistantContextView } from './assistant.types';

export type { AssistantSuggestion };

interface CatalogShape {
  catalog?: Record<string, { label?: string; prompt?: string }>;
}

function catalogOf(t: AssistantMessages): Record<string, { label: string; prompt: string }> {
  const maybe = t as unknown as CatalogShape;
  const out: Record<string, { label: string; prompt: string }> = {};
  for (const entry of ASSISTANT_SUGGESTION_CATALOG) {
    const localized = maybe.catalog?.[entry.id];
    out[entry.id] = {
      label: localized?.label ?? entry.id,
      prompt: localized?.prompt ?? localized?.label ?? entry.id,
    };
  }
  return out;
}

export interface ClientSuggestion {
  id: string;
  label: string;
  prompt: string;
  /** Ação local (navegação) — não envia pergunta ao modelo. */
  action?: AssistantSuggestion['action'];
}

/** Sugestões de abertura por tela (máx. 4; determinístico). */
export function getOpeningSuggestionsForView(options: {
  view: AssistantContextView;
  role?: string;
  entity?: { type: 'client' | 'enterprise'; id: string } | null;
  tagCount?: number;
}): ClientSuggestion[] {
  const t = getAssistantMessages();
  const catalog = catalogOf(t);
  return selectOpeningSuggestions(options).map((s) => ({
    id: s.id,
    label: catalog[s.id]?.label ?? s.id,
    prompt: catalog[s.id]?.prompt ?? '',
    action: s.action,
  }));
}

/** Sugestões pós-resposta vindas do servidor (v2) já contêm label/prompt. */
export function toClientSuggestions(
  replies: Array<{ id: string; label: string; prompt: string }>,
): ClientSuggestion[] {
  return replies.map((r) => ({ id: r.id, label: r.label, prompt: r.prompt }));
}
