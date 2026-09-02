'use client';

import dynamic from 'next/dynamic';

/**
 * SessionProvider carregado dinamicamente (ssr: false).
 * Isso evita que o next-auth/react seja incluído no bundle
 * principal do Turbopack, prevenindo erros de inicialização (TDZ)
 * em páginas públicas como as landing pages.
 */
const SessionProvider = dynamic(
  () => import('next-auth/react').then(mod => mod.SessionProvider),
  { ssr: false },
);

/**
 * Wrapper do SessionProvider com configurações de segurança:
 * - refetchOnWindowFocus: ao reabrir a aba, revalida a sessão com o servidor.
 * - refetchInterval: revalida a cada 15 minutos em background.
 */
export function SessionProviderWrapper({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider
      refetchOnWindowFocus={true}
      refetchInterval={15 * 60 * 1000}
    >
      {children}
    </SessionProvider>
  );
}
