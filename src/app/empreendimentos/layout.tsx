import type { Metadata } from 'next';
import Script from 'next/script';

export const metadata: Metadata = {
  title: {
    default: 'Empreendimentos | Imóveis de Alto Padrão',
    template: '%s | Empreendimentos',
  },
  description: 'Conheça nossos empreendimentos imobiliários de alto padrão. Plantas exclusivas, lazer completo, localização privilegiada e condições especiais de investimento.',
  keywords: ['empreendimentos', 'imóveis', 'alto padrão', 'apartamentos de luxo', 'investimento imobiliário', 'plantas exclusivas'],
  openGraph: {
    title: 'Empreendimentos | Imóveis de Alto Padrão',
    description: 'Conheça nossos empreendimentos imobiliários de alto padrão. Plantas exclusivas, lazer completo, localização privilegiada.',
    type: 'website',
    locale: 'pt_BR',
    siteName: 'Empreendimentos',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Empreendimentos | Imóveis de Alto Padrão',
    description: 'Conheça nossos empreendimentos imobiliários de alto padrão.',
  },
  robots: {
    index: true,
    follow: true,
  },
};

/** Meta Pixel — loads only if NEXT_PUBLIC_META_PIXEL_ID is set */
const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

export default function EmpreendimentosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Meta Pixel (Facebook) — fires PageView on load */}
      {META_PIXEL_ID && (
        <>
          <Script
            id="meta-pixel-init"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `
                !function(f,b,e,v,n,t,s)
                {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
                n.callMethod.apply(n,arguments):n.queue.push(arguments)};
                if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
                n.queue=[];t=b.createElement(e);t.async=!0;
                t.src='https://connect.facebook.net/en_US/fbevents.js';
                s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window, document,'script');
                fbq('init', '${META_PIXEL_ID}');
                fbq('track', 'PageView');
              `,
            }}
          />
          {/* Meta Pixel noscript fallback */}
          <noscript>
            <img
              height="1"
              width="1"
              style={{ display: 'none' }}
              src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
              alt=""
            />
          </noscript>
        </>
      )}

      {/* CRM Tracking Pixel */}
      <Script
        src="/pixel.js"
        data-site-id="default"
        strategy="afterInteractive"
      />
      {children}
    </>
  );
}
