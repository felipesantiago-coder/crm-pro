export const locales = ['pt-BR', 'en', 'es'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'pt-BR';

export const localeNames: Record<Locale, string> = {
  'pt-BR': 'Português',
  'en': 'English',
  'es': 'Español',
};

export const localeFlags: Record<Locale, string> = {
  'pt-BR': 'BR',
  'en': 'US',
  'es': 'ES',
};

export const htmlLang: Record<Locale, string> = {
  'pt-BR': 'pt-BR',
  'en': 'en',
  'es': 'es',
};

export const ogLocale: Record<Locale, string> = {
  'pt-BR': 'pt_BR',
  'en': 'en_US',
  'es': 'es',
};

export function isValidLocale(locale: string): locale is Locale {
  return locales.includes(locale as Locale);
}
