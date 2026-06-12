import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { ensureDbConnection } from '@/lib/db';
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
        let lastError: unknown;

        // Retry up to 3 times with delays to survive Supabase cold starts.
        // The DB can take 5-10 seconds to wake up after being paused.
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            console.log(`[AUTH] DB attempt ${attempt}/3 for:`, email);
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
          console.log('[AUTH] User not found after all retries:', email);
          if (lastError) console.error('[AUTH] Last DB error:', lastError);
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
  secret: process.env.NEXTAUTH_SECRET!,
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/login',
  },
};