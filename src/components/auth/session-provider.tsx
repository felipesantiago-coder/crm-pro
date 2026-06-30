'use client';

import { SessionProvider as NextAuthSessionProvider } from 'next-auth/react';

/**
 * Wrapper do SessionProvider com configurações de segurança:
 * - refetchOnWindowFocus: ao reabrir a aba, revalida a sessão com o servidor.
 *   Isso garante que se o JWT expirou ou foi invalidado, o usuário
 *   será redirecionado ao login imediatamente.
 */
export function SessionProviderWrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextAuthSessionProvider
      refetchOnWindowFocus={true}
      refetchInterval={15 * 60 * 1000} // revalida a cada 15 minutos em background
    >
      {children}
    </NextAuthSessionProvider>
  );
}