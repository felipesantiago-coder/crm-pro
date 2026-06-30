/**
 * Hook que intercepta erros 401 em chamadas fetch e redireciona
 * automaticamente para o login, limpando a sessão stale.
 *
 * Uso: chamar `useSessionGuard()` uma vez no componente raiz do CRM.
 */

import { useEffect, useCallback, useRef } from 'react';
import { signOut } from 'next-auth/react';

export function useSessionGuard() {
  const redirecting = useRef(false);

  const handleUnauthorized = useCallback(() => {
    if (redirecting.current) return;
    redirecting.current = true;

    // Limpa tudo e manda para login
    // window.location.href em vez de router.push para contornar
    // qualquer cache do Next Router
    signOut({ redirect: false }).then(() => {
      window.location.href = '/login';
    }).catch(() => {
      window.location.href = '/login';
    });
  }, []);

  useEffect(() => {
    const originalFetch = window.fetch;

    window.fetch = async (input, init) => {
      try {
        const response = await originalFetch(input, init);

        // Se qualquer API retornar 401, redireciona
        if (response.status === 401 && typeof input === 'string' && input.startsWith('/api/')) {
          handleUnauthorized();
        }

        return response;
      } catch (error) {
        return Promise.reject(error);
      }
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [handleUnauthorized]);
}