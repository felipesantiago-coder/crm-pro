/**
 * Flag central para alternar entre Supabase Realtime e Socket.io.
 *
 * Para ATIVAR o Socket.io:
 *   1. Defina a variável de ambiente NEXT_PUBLIC_SOCKET_URL no Vercel
 *      Ex: NEXT_PUBLIC_SOCKET_URL=https://seu-socket-server.onrender.com
 *
 * Para DESATIVAR (voltar ao Supabase Realtime):
 *   1. Remova ou deixe vazia a variável NEXT_PUBLIC_SOCKET_URL
 *
 * Esta flag é lida apenas no client-side (NEXT_PUBLIC_).
 */

export function isSocketRealtimeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(
    process.env.NEXT_PUBLIC_SOCKET_URL &&
    process.env.NEXT_PUBLIC_SOCKET_URL.length > 5
  );
}

/**
 * URL do servidor Socket.io (sem barra final).
 * Retorna null se não estiver configurado.
 */
export function getSocketUrl(): string | null {
  if (!isSocketRealtimeEnabled()) return null;
  const url = process.env.NEXT_PUBLIC_SOCKET_URL!;
  return url.endsWith('/') ? url.slice(0, -1) : url;
}