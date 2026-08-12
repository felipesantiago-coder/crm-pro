'use client';

import React, { createContext, useContext, useCallback, useMemo } from 'react';
import { NextIntlClientProvider, useMessages as useNextMessages } from 'next-intl';
import type { Locale } from './config';
import { defaultLocale } from './config';

// Import all locale messages
import ptBR from './locales/pt-BR.json';
import en from './locales/en.json';
import es from './locales/es.json';

const messagesMap: Record<Locale, Record<string, unknown>> = {
  'pt-BR': ptBR,
  'en': en,
  'es': es,
};

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: defaultLocale,
  setLocale: () => {},
});

export function useLocaleContext() {
  return useContext(LocaleContext);
}

function getInitialLocale(): Locale {
  if (typeof window === 'undefined') return defaultLocale;
  try {
    const stored = document.cookie
      .split('; ')
      .find(row => row.startsWith('locale='));
    if (stored) {
      const val = stored.split('=')[1];
      if (val === 'pt-BR' || val === 'en' || val === 'es') return val;
    }
  } catch {}
  return defaultLocale;
}

export function LocaleProvider({ children, serverLocale }: {
  children: React.ReactNode;
  serverLocale?: Locale;
}) {
  const [locale, setLocaleState] = React.useState<Locale>(
    () => serverLocale || getInitialLocale()
  );

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    // Persist in cookie (7 days)
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = `locale=${newLocale};path=/;expires=${expires};SameSite=Lax`;
    // Update URL without full page reload
    const pathname = window.location.pathname;
    const currentPrefix = pathname.startsWith('/en/') ? '/en' : pathname.startsWith('/es/') ? '/es' : '';
    const cleanPath = currentPrefix ? pathname.slice(currentPrefix.length) : pathname;
    const newPrefix = newLocale === 'pt-BR' ? '' : `/${newLocale}`;
    const newPath = newPrefix + cleanPath + window.location.search + window.location.hash;
    window.history.replaceState(null, '', newPath);
  }, []);

  const messages = useMemo(() => messagesMap[locale], [locale]);

  const contextValue = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  return (
    <LocaleContext.Provider value={contextValue}>
      <NextIntlClientProvider locale={locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    </LocaleContext.Provider>
  );
}
