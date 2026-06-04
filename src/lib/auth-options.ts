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
        try {
          console.log('[AUTH] Login attempt for:', credentials?.email);

          if (!credentials?.email || !credentials?.password) {
            console.log('[AUTH] Missing credentials');
            return null;
          }

          const user = await db.user.findUnique({
            where: { email: credentials.email },
          });

          if (!user) {
            console.log('[AUTH] User not found:', credentials.email);
            return null;
          }

          console.log('[AUTH] User found, verifying password...');
          const isValid = await verifyPassword(credentials.password, user.passwordHash);

          if (!isValid) {
            console.log('[AUTH] Invalid password for:', credentials.email);
            return null;
          }

          console.log('[AUTH] Login successful:', user.email, 'role:', user.role);
          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            mustChangePassword: user.mustChangePassword,
          };
        } catch (error) {
          console.error('[AUTH] ERROR in authorize:', error);
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
