/**
 * Mensagens do Nexo sob o namespace `aiAssistant` (prompt §21).
 *
 * Os textos vivem em src/i18n/locales/assistant/{pt-BR,en,es}.json — um
 * arquivo por idioma contendo apenas este namespace, para não carregar os
 * JSON completos da landing page no bundle do CRM (mesma estratégia do
 * LocaleProvider). pt-BR é o idioma primário; en/es têm traduções próprias.
 */
import type { Locale } from '@/i18n/config';
import { defaultLocale, isValidLocale } from '@/i18n/config';
import ptBRJson from '@/i18n/locales/assistant/pt-BR.json';
import enJson from '@/i18n/locales/assistant/en.json';
import esJson from '@/i18n/locales/assistant/es.json';

export type AssistantMessages = typeof ptBRJson.aiAssistant;

export const ASSISTANT_MESSAGES: Record<Locale, AssistantMessages> = {
  'pt-BR': ptBRJson.aiAssistant,
  en: enJson.aiAssistant,
  es: esJson.aiAssistant,
};

/** Mesmo mecanismo de locale do repositório: cookie `locale=` (LocaleProvider). */
export function getAssistantLocale(): Locale {
  if (typeof document === 'undefined') return defaultLocale;
  try {
    const stored = document.cookie
      .split('; ')
      .find((row) => row.startsWith('locale='))
      ?.split('=')[1];
    return stored && isValidLocale(stored) ? stored : defaultLocale;
  } catch {
    return defaultLocale;
  }
}

export function getAssistantMessages(locale?: Locale): AssistantMessages {
  return ASSISTANT_MESSAGES[locale ?? getAssistantLocale()];
}

/** Interpolação simples de {token} para as mensagens parametrizadas. */
export function formatMessage(
  template: string,
  params: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in params ? String(params[key]) : `{${key}}`,
  );
}
