import type { Metadata } from 'next';
import Script from 'next/script';
import { headers } from 'next/headers';
import { LocaleProvider } from '@/i18n/LocaleProvider';
import { isValidLocale, type Locale, defaultLocale } from '@/i18n/config';

// Layout NO LONGER force-dynamic — allows child ISR (revalidate=60) to cache HTML.
// Previously this flag caused every landing page request to hit the DB, defeating ISR.

/** Meta Pixel — loads only if NEXT_PUBLIC_META_PIXEL_ID is set */
const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

export default async function EmpreendimentosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Read locale from middleware header (still available during ISR revalidation).
  // When the cached page is served, the layout portion re-executes with the original
  // request headers stored by Next.js, so this works correctly with ISR.
  let serverLocale: Locale = defaultLocale;
  try {
    const headersList = await headers();
    const xLocale = headersList.get('x-locale');
    if (xLocale && isValidLocale(xLocale)) serverLocale = xLocale;
  } catch {
    // headers() can throw during static generation — fall back to default
  }

  const metaPixelHtml = META_PIXEL_ID
    ? `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src='https://connect.facebook.net/en_US/fbevents.js';s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script');try{fbq('init','${META_PIXEL_ID}');fbq('track','PageView')}catch(e){}`
    : '';

  return (
    <>
      {/* Preconnect: resolve DNS/TLS early for Meta Pixel */}
      <link rel="preconnect" href="https://connect.facebook.net" />
      {/* Preconnect: WhatsApp — hero CTA and floating button link */}
      <link rel="preconnect" href="https://wa.me" />
      {/* Preconnect: Supabase Storage — serves all landing page images (hero, gallery, floor plans) */}
      <link rel="preconnect" href="https://bxkpvzdqjokqshqmnwqr.supabase.co" crossorigin />

      {/* Set lang attribute dynamically */}
      <script
        dangerouslySetInnerHTML={{
          __html: `try{document.documentElement.lang="${serverLocale === 'pt-BR' ? 'pt-BR' : serverLocale}"}catch(e){}`,
        }}
      />

      <LocaleProvider serverLocale={serverLocale}>
        {children}
      </LocaleProvider>

      {/* Meta Pixel (Facebook) — fires PageView on load */}
      {META_PIXEL_ID && (
        <Script
          id="meta-pixel-init"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{ __html: metaPixelHtml }}
        />
      )}

      {/* CRM Tracking Pixel — lazyOnload to avoid blocking first paint */}
      <Script
        src="/pixel.js"
        data-site-id="default"
        strategy="lazyOnload"
      />
    </>
  );
}
