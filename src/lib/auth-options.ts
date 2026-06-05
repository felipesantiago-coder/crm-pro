import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { db, ensureDbConnection } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';

// Auth configuration — last updated: fix intermittent DB connection issues
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

        // CRITICAL: Use select to avoid querying missing columns (e.g. phone)
        let user: Awaited<ReturnType<typeof db.user.findUnique>> | null = null;

        // First attempt — ensure DB connection is alive
        try {
          await ensureDbConnection();
          user = await db.user.findUnique({
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
        } catch (firstErr) {
          console.error('[AUTH] First DB attempt failed, retrying...', firstErr);
          // Second attempt — DB may have been paused (Supabase free tier)
          try {
            await ensureDbConnection();
            user = await db.user.findUnique({
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
          } catch (retryErr) {
            console.error('[AUTH] Second DB attempt failed:', retryErr);
            return null;
          }
        }

        if (!user || !user.passwordHash) {
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
  secret: process.env.NEXTAUTH_SECRET || 'crm-pro-fallback-secret-v1',
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/login',
  },
};
