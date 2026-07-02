/**
 * Validação de sessão para conexões Socket.io.
 *
 * Quando um cliente se conecta, ele envia seu session token.
 * Este módulo valida o token chamando a API do CRM.
 *
 * Se a validação falhar, a conexão é rejeitada.
 */

const CRM_API_URL = process.env.CRM_API_URL || 'http://localhost:3000';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

/**
 * Valida um token de sessão NextAuth contra a API do CRM.
 * Retorna o usuário se válido, null caso contrário.
 */
export async function validateSession(
  token: string
): Promise<SessionUser | null> {
  try {
    const res = await fetch(`${CRM_API_URL}/api/auth/session`, {
      headers: {
        Cookie: `next-auth.session-token=${token}`,
        'User-Agent': 'crm-socket-server/1.0',
      },
      cache: 'no-store',
    });

    if (!res.ok) return null;

    const session = await res.json();
    if (!session?.user?.id) return null;

    return {
      id: session.user.id,
      email: session.user.email || '',
      name: session.user.name || '',
      role: (session.user as Record<string, string>)?.role || 'USER',
    };
  } catch {
    // Em caso de erro de rede, recusa a conexão (fail-closed)
    return null;
  }
}