'use client';

import React, { createContext, useContext, useCallback, useMemo, useState, useEffect } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import type { Locale } from './config';
import { defaultLocale } from './config';

// Only import the default locale statically — others load on demand.
// This saves ~27KB (2 locale files) from the initial JS bundle.
import ptBR from './locales/pt-BR.json';

// Dynamic import cache to avoid re-fetching
const localeCache = new Map<string, Record<string, unknown>>();

async function loadLocaleAsync(l: Locale): Promise<Record<string, unknown>> {
  const cached = localeCache.get(l);
  if (cached) return cached;
  const mod = await import(`./locales/${l}.json`);
  localeCache.set(l, mod.default);
  return mod.default;
}

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
  const [locale, setLocaleState] = useState<Locale>(
    () => serverLocale || getInitialLocale()
  );
  const [messages, setMessages] = useState<Record<string, unknown>>(
    () => (locale === 'pt-BR' ? ptBR : null)!
  );
  const [loading, setLoading] = useState(locale !== 'pt-BR');

  // Load non-default locale messages on mount or locale change
  useEffect(() => {
    if (locale === 'pt-BR') {
      setMessages(ptBR);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadLocaleAsync(locale).then((msgs) => {
      if (!cancelled) {
        setMessages(msgs);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    // Persist in cookie (7 days)
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = `locale=${newLocale};path=/;expires=${expires};SameSite=Lax;Secure`;
    // Update URL without full page reload
    const pathname = window.location.pathname;
    const currentPrefix = pathname.startsWith('/en/') ? '/en' : pathname.startsWith('/es/') ? '/es' : '';
    const cleanPath = currentPrefix ? pathname.slice(currentPrefix.length) : pathname;
    const newPrefix = newLocale === 'pt-BR' ? '' : `/${newLocale}`;
    const newPath = newPrefix + cleanPath + window.location.search + window.location.hash;
    window.history.replaceState(null, '', newPath);
  }, []);

  const contextValue = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  // Brief loading state while locale JSON loads — prevent flash of wrong language
  if (loading) {
    return null;
  }

  return (
    <LocaleContext.Provider value={contextValue}>
      <NextIntlClientProvider locale={locale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    </LocaleContext.Provider>
  );
}
