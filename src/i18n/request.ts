import { getRequestConfig } from 'next-intl/server';
import { headers } from 'next/headers';
import { isValidLocale, type Locale, defaultLocale } from './config';

export default getRequestConfig(async () => {
  // Read locale set by middleware (x-locale header)
  const headersList = await headers();
  const xLocale = headersList.get('x-locale');
  const locale: Locale = xLocale && isValidLocale(xLocale) ? xLocale : defaultLocale;

  // Dynamically import the correct locale file
  const messages = (await import(`./locales/${locale}.json`)).default;

  return {
    locale,
    messages,
  };
});
