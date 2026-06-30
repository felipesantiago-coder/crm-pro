import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Empreendimentos',
  description: 'Conheça nossos empreendimentos imobiliários. Plantas, lazer, localização privilegiada e muito mais.',
  openGraph: {
    title: 'Empreendimentos',
    description: 'Conheça nossos empreendimentos imobiliários.',
    type: 'website',
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