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

export default function EmpreendimentosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Pixel de tracking — usa next/script em vez de <script> JSX
          porque o SessionProviderWrapper usa ssr:false, o que impede
          que <script> JSX seja renderizado no HTML inicial. O next/script
          injeta o script diretamente no <head> via seu próprio loader. */}
      <Script
        src="/pixel.js"
        data-site-id="default"
        data-debug="true"
        strategy="afterInteractive"
      />
      {children}
    </>
  );
}
