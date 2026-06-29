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
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email.trim().toLowerCase();
        const password = credentials.password;

        // Validação de tamanho mínimo da senha (rejeitar antes de consultar DB)
        if (password.length < 6) {
          return null;
        }

        type UserType = {
          id: string;
          name: string;
          email: string;
          passwordHash: string;
          role: string;
          mustChangePassword: boolean;
        };

        let user: UserType | null = null;

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
            break; // DB query succeeded
          } catch (err) {
            console.error(`[AUTH] DB attempt ${attempt}/3 failed`);
            if (attempt < 3) {
              // Wait 3s between attempts to give Supabase time to wake up
              await new Promise(resolve => setTimeout(resolve, 3000));
            }
          }
        }

        if (!user || !user.passwordHash) {
          // Falha na autenticação (log genérico, não expõe se usuário existe)
          console.log('[AUTH] Falha na autenticação');
          return null;
        }

        const isValid = await verifyPassword(password, user.passwordHash);
        if (!isValid) {
          return null;
        }

        // Login bem-sucedido
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
