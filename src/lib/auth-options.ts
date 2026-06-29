import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { ensureDbConnection } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import { loginRateLimit } from '@/lib/rate-limit';
import { NextRequest } from 'next/server';

// Contador de tentativas de login (in-memory, por IP+email)
const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutos

function checkLoginLockout(identifier: string): boolean {
  const entry = loginAttempts.get(identifier);
  if (!entry) return false;
  if (Date.now() >= entry.lockedUntil) {
    loginAttempts.delete(identifier);
    return false;
  }
  return entry.count >= MAX_LOGIN_ATTEMPTS;
}

function recordFailedLogin(identifier: string) {
  const entry = loginAttempts.get(identifier);
  if (entry && Date.now() < entry.lockedUntil) {
    entry.count++;
  } else {
    loginAttempts.set(identifier, {
      count: 1,
      lockedUntil: Date.now() + LOCKOUT_DURATION_MS,
    });
  }
}

function resetLoginAttempts(identifier: string) {
  loginAttempts.delete(identifier);
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credenciais',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Senha', type: 'password' },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email.trim().toLowerCase();
        const password = credentials.password;

        // Brute-force protection: 5 tentativas por minuto por email+IP
        const req = new NextRequest(request?.url || '/', { headers: request?.headers as HeadersInit });
        const rateLimitHit = loginRateLimit(req, email);
        if (rateLimitHit) {
          console.warn(`[AUTH] Rate limit atingido para: ${email}`);
          return null;
        }
        const loginId = email; // Identificador para lockout

        // Verificar lockout por tentativas excessivas
        if (checkLoginLockout(loginId)) {
          console.warn(`[AUTH] Login bloqueado por excesso de tentativas: ${email}`);
          return null;
        }

        // Validação de tamanho mínimo da senha (rejeitar antes de consultar DB)
        if (password.length < 6) {
          return null;
        }

        let user: {
          id: string;
          name: string;
          email: string;
          passwordHash: string;
          role: string;
          mustChangePassword: boolean;
        } | null = null;
        let lastError: unknown;

        // Retry up to 3 times with delays to survive Supabase cold starts.
        // The DB can take 5-10 seconds to wake up after being paused.
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const client = await ensureDbConnection(3);
            user = await client.user.findUnique({
              where: { email },
              select: {
                id: true,
                name: true,
                email: true,
                passwordHash: true,
                role: true,
                mustChangePassword: true,
              },
            });
            console.log('[AUTH] DB query succeeded on attempt', attempt);
            break;
          } catch (err) {
            lastError = err;
            console.error(`[AUTH] DB attempt ${attempt}/3 failed:`, err);
            if (attempt < 3) {
              // Wait 3s between attempts to give Supabase time to wake up
              const delay = 3000;
              console.log(`[AUTH] Waiting ${delay}ms before retry...`);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }

        if (!user || !user.passwordHash) {
          // Log genérico sem expor se o usuário existe ou não
          console.log('[AUTH] Falha na autenticação');
          recordFailedLogin(loginId);
          return null;
        }

        const isValid = await verifyPassword(password, user.passwordHash);
        if (!isValid) {
          recordFailedLogin(loginId);
          return null;
        }

        // Login bem-sucedido — resetar contagem
        resetLoginAttempts(loginId);

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.name = user.name;
        token.role = (user as { role: string }).role;
        token.mustChangePassword = (user as { mustChangePassword: boolean }).mustChangePassword;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.email = token.email as string;
        session.user.name = token.name as string;
        (session.user as { role: string }).role = token.role as string;
        (session.user as { mustChangePassword: boolean }).mustChangePassword = token.mustChangePassword as boolean;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET!,
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/login',
  },
};
