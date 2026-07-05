import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';

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

        let user: {
          id: string;
          name: string;
          email: string;
          passwordHash: string;
          role: string;
          mustChangePassword: boolean;
        } | null = null;

        // Retry is automatic via Prisma client extension in db.ts
        try {
          console.log('[AUTH] Authenticating:', email);
          user = await db.user.findUnique( {
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
          console.log('[AUTH] User not found or no passwordHash:', email);
          return null;
        }

        const isValid = await verifyPassword(password, user.passwordHash);
        if (!isValid) {
          return null;
        }

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
        // Primeiro login: popula o token com dados frescos do DB
        token.id = user.id;
        token.email = user.email;
        token.name = user.name;
        token.role = (user as { role: string }).role;
        token.mustChangePassword = (user as { mustChangePassword: boolean }).mustChangePassword;
      } else if (token.id) {
        // Refresh de token (sem `user`): consulta o DB para obter
        // o valor atual de mustChangePassword, evitando que um valor
        // antigo congelado no JWT prenda o usuário na tela de troca de senha.
        try {
          const fresh = await db.user.findUnique( {
            where: { id: token.id as string },
            select: { mustChangePassword: true, role: true },
          });
          if (fresh) {
            token.mustChangePassword = fresh.mustChangePassword;
            token.role = fresh.role;
          } else {
            // Usuário não existe mais no DB — invalida a sessão
            // retornando um token vazio, o que força o logout.
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
    maxAge: 8 * 60 * 60, // 8 horas — sessão expira e o usuário precisa relogar
  },
  pages: {
    signIn: '/login',
  },
};