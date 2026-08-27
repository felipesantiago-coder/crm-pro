import { NextRequest } from 'next/server';
import crypto from 'crypto';
import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth-options';

/** Gera hash curto do User-Agent para session binding */
function hashUserAgent(ua: string): string {
  return crypto.createHash('sha256').update(ua).digest('hex').slice(0, 32);
}

// Wraps NextAuth to inject User-Agent hash into the JWT on sign-in.
// NextAuth's CredentialsProvider authorize() doesn't have access to
// the raw request, so we patch the user object here before JWT creation.
const handler = async (req: NextRequest) => {
  const ua = req.headers.get('user-agent') || '';

  // Monkey-patch jwt callback to inject uaHash on first sign-in
  const originalJwt = authOptions.callbacks!.jwt!;
  authOptions.callbacks!.jwt = async (args) => {
    // On sign-in (user exists), inject UA hash into token
    if (args.user) {
      args.token.uaHash = hashUserAgent(ua);
    }
    return originalJwt(args);
  };

  return NextAuth(authOptions)(req);
};

export { handler as GET, handler as POST };
