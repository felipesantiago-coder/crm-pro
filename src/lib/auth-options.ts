import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { ensureDbConnection } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';

// ── Rate limiting in-memory para o authorize ──────────────────
// Não temos acesso ao NextRequest dentro do callback do NextAuth,
// então usamos um mapa simples por email. Em serverless (Vercel),
// cada instância tem seu próprio mapa — não é perfeito mas bloqueia
// ataques de força bruta dentro da mesma instância.
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 60 * 1000; // 1 minuto
let lastCleanup = Date.now();

function cleanupLoginAttempts() {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  for (const [key, entry] of loginAttempts) {
    if (now >= entry.resetAt) loginAttempts.delete(key);
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credenciais',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Senha', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email.trim().toLowerCase();
        const password = credentials.password;

        // ── Rate limiting por email ────────────────────────
        cleanupLoginAttempts();
        const now = Date.now();
        let attempt = loginAttempts.get(email);
        if (!attempt || now >= attempt.resetAt) {
          attempt = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
          loginAttempts.set(email, attempt);
        }
        attempt.count++;
        if (attempt.count > LOGIN_MAX_ATTEMPTS) {
          console.warn('[AUTH] Rate limited:', email, 'attempts:', attempt.count);
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
        } catch (err) {
          console.error('[AUTH] DB connection failed:', err);
          return null;
        }

        if (!user || !user.passwordHash) {
          return null;
        }

        const isValid = await verifyPassword(password, user.passwordHash);
        if (!isValid) {
          return null;
        }

        // Login bem-sucedido — limpa tentativas
        loginAttempts.delete(email);

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
      } else if (token.id) {
        try {
          const client = await ensureDbConnection(2);
          const fresh = await client.user.findUnique({
            where: { id: token.id as string },
            select: { mustChangePassword: true, role: true },
          });
          if (fresh) {
            token.mustChangePassword = fresh.mustChangePassword;
            token.role = fresh.role;
          } else {
            console.warn('[AUTH] User not found during token refresh, invalidating session:', token.id);
            return {} as typeof token;
          }
        } catch {
          // Falha silenciosa — não bloqueia a sessão por causa disso
        }
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
    maxAge: 8 * 60 * 60, // 8 horas
  },
  pages: {
    signIn: '/login',
  },
};
