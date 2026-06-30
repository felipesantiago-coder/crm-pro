import type { Metadata } from 'next';

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
      {children}
      <script src="/pixel.js" data-site-id="default" async />
    </>
  );
}
