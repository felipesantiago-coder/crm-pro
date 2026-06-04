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
        const t0 = Date.now();
        try {
          console.log('[AUTH] Login attempt started at', new Date().toISOString());

          // Defensive: ensure credentials exist
          if (!credentials?.email || !credentials?.password) {
            console.log('[AUTH] Missing credentials. Received:', {
              hasEmail: !!credentials?.email,
              hasPassword: !!credentials?.password,
              credKeys: credentials ? Object.keys(credentials) : 'null',
              credType: typeof credentials,
            });
            return null;
          }

          const email = credentials.email.trim().toLowerCase();
          const password = credentials.password;

          console.log('[AUTH] Looking up user:', email, '(elapsed:', Date.now() - t0, 'ms)');

          const user = await db.user.findUnique({
            where: { email },
          });

          console.log('[AUTH] DB lookup completed. User found:', !!user, '(elapsed:', Date.now() - t0, 'ms)');

          if (!user) {
            console.log('[AUTH] User not found for:', email);
            return null;
          }

          if (!user.passwordHash) {
            console.error('[AUTH] CRITICAL: User found but passwordHash is empty for:', email);
            return null;
          }

          console.log('[AUTH] Verifying password... (elapsed:', Date.now() - t0, 'ms)');
          const isValid = await verifyPassword(password, user.passwordHash);

          console.log('[AUTH] Password valid:', isValid, '(elapsed:', Date.now() - t0, 'ms)');

          if (!isValid) {
            console.log('[AUTH] Invalid password for:', email);
            return null;
          }

          console.log('[AUTH] Login successful:', user.email, 'role:', user.role, '(total:', Date.now() - t0, 'ms)');
          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            mustChangePassword: user.mustChangePassword,
          };
        } catch (error) {
          console.error('[AUTH] ERROR in authorize after', Date.now() - t0, 'ms:', error);
          return null;
        }
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
