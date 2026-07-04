import 'next-auth';
import 'next-auth/jwt';

// Augment NextAuth types to include custom fields stored in the JWT token.
// This eliminates the need for `(session.user as any).role` casts throughout the codebase.

declare module 'next-auth' {
  interface User {
    role?: string;
    mustChangePassword?: boolean;
  }

  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      image?: string | null;
      role: string;
      mustChangePassword: boolean;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    role?: string;
    mustChangePassword?: boolean;
  }
}