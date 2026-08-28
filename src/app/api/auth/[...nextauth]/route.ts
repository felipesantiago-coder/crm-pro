import { NextRequest } from 'next/server';
import crypto from 'crypto';
import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth-options';

/** Gera hash curto do User-Agent para session binding */
function hashUserAgent(ua: string): string {
  return crypto.createHash('sha256').update(ua).digest('hex').slice(0, 32);
}

/**
 * Handler do NextAuth com injeção de User-Agent no JWT.
 *
 * Cria uma cópia local de authOptions com o callback jwt sobrescrito
 * para injetar o uaHash no token durante o sign-in, sem mutar o
 * authOptions compartilhado entre requisições.
 *
 * IMPORTANTE: ambos os argumentos (req E context) devem ser passados
 * ao NextAuth. Sem o context, ele não consegue determinar a ação
 * (session, signin, etc.) e retorna 500.
 */
async function handler(
  req: NextRequest,
  context: { params: { nextauth: string[] } },
) {
  const ua = req.headers.get('user-agent') || '';
  const uaHash = hashUserAgent(ua);

  // Cria cópia local com jwt callback que injeta uaHash no sign-in
  const originalJwt = authOptions.callbacks!.jwt!;
  const localOptions = {
    ...authOptions,
    callbacks: {
      ...authOptions.callbacks,
      jwt: async (args: any) => {
        // No sign-in (user existe), injeta o hash do User-Agent
        if (args.user) {
          args.token.uaHash = uaHash;
        }
        // Delega para o callback original (role, mustChangePassword, etc.)
        return originalJwt(args);
      },
    },
  };

  // Passa req E context — sem o context o NextAuth retorna 500
  return NextAuth(localOptions)(req, context);
}

export { handler as GET, handler as POST };
