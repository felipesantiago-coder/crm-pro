'use client';

/**
 * Hook useSocketRealtime — substituto drop-in para o Supabase Realtime.
 *
 * Conecta ao servidor Socket.io, autentica via session token do NextAuth,
 * e escuta eventos de mudança em tempo real.
 *
 * Uso:
 *   const { connected } = useSocketRealtime({
 *     onEvent: (event) => { ... },
 *   });
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { getSocketUrl, isSocketRealtimeEnabled } from '@/lib/realtime/realtime-flag';
import { type RealtimeEvent, SOCKET_EVENT } from '@/lib/realtime/realtime-types';

export interface UseSocketRealtimeOptions {
  /** Callback quando um evento de mudança é recebido */
  onEvent?: (event: RealtimeEvent) => void;
  /** Callback quando a conexão é estabelecida */
  onConnect?: () => void;
  /** Callback quando a conexão cai */
  onDisconnect?: (reason: string) => void;
}

export interface UseSocketRealtimeReturn {
  /** Está conectado ao servidor Socket.io? */
  connected: boolean;
  /** O objeto Socket (para uso avançado) */
  socket: Socket | null;
}

/**
 * Extrai o session token do cookie do NextAuth.
 * O cookie pode ter nomes diferentes dependendo do ambiente.
 */
function getSessionToken(): string | null {
  if (typeof document === 'undefined') return null;

  // Em produção, o cookie é httpOnly e chamado __Secure-next-auth.session-token
  // Em desenvolvimento, é next-auth.session-token
  const cookieNames = [
    '__Secure-next-auth.session-token',
    'next-auth.session-token',
    'authjs.session-token',
  ];

  for (const name of cookieNames) {
    const match = document.cookie.match(
      new RegExp(`(?:^|;\\s*)${name}=([^;]*)`)
    );
    if (match && match[1]) return decodeURIComponent(match[1]);
  }

  return null;
}

export function useSocketRealtime(
  options: UseSocketRealtimeOptions = {}
): UseSocketRealtimeReturn {
  const { onEvent, onConnect, onDisconnect } = options;
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    const url = getSocketUrl();
    if (!url) return;

    // Não reconectar se já existe uma conexão ativa
    if (socketRef.current?.connected) return;

    const token = getSessionToken();
    if (!token) {
      // Tenta novamente em 3 segundos (a sessão pode ainda estar carregando)
      reconnectTimerRef.current = setTimeout(connect, 3000);
      return;
    }

    // Fecha conexão anterior se existir
    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    const socket = io(url, {
      // Autenticação via session token
      auth: { token },
      // Transports: tenta WebSocket primeiro, polling como fallback
      transports: ['websocket', 'polling'],
      // Reconexão automática
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      timeout: 10000,
    });

    socket.on('connect', () => {
      setConnected(true);
      onConnect?.();
    });

    socket.on('disconnect', (reason) => {
      setConnected(false);
      onDisconnect?.(reason);
    });

    socket.on('connect_error', (err) => {
      setConnected(false);
      console.warn('[Socket.io] Erro de conexão:', err.message);

      // Se o erro for de autenticação, não tenta reconectar imediatamente
      if (err.message.includes('Autenticação') || err.message.includes('Sessão')) {
        // Espera 10 segundos e tenta com um novo token
        // (o token pode ter sido renovado)
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          const newToken = getSessionToken();
          if (newToken) {
            socket.auth = { token: newToken };
            socket.connect();
          } else {
            reconnectTimerRef.current = setTimeout(connect, 5000);
          }
        }, 10000);
      }
    });

    // ─── Evento principal: crm:change ───
    socket.on(SOCKET_EVENT, (event: RealtimeEvent) => {
      onEvent?.(event);
    });

    // ─── Confirmação de conexão ───
    socket.on('crm:connected', (data) => {
      console.log(
        `[Socket.io] Conectado ao servidor. Usuário: ${data.user?.name}, Server time: ${data.serverTime}`
      );
    });

    // ─── Heartbeat ───
    socket.on('crm:pong', (data) => {
      // Silencioso — pode ser usado para mostrar latência no futuro
    });

    // Heartbeat periódico (a cada 60 segundos)
    const heartbeat = setInterval(() => {
      if (socket.connected) {
        socket.emit('crm:ping');
      }
    }, 60000);

    socketRef.current = socket;

    // Cleanup do heartbeat quando o socket morre
    socket.on('disconnect', () => {
      clearInterval(heartbeat);
    });
  }, [onEvent, onConnect, onDisconnect]);

  useEffect(() => {
    // Só conecta se o Socket.io estiver habilitado via env var
    if (!isSocketRealtimeEnabled()) return;

    // Pequeno delay para garantir que o DOM e cookies estão prontos
    const initTimer = setTimeout(connect, 500);

    return () => {
      clearTimeout(initTimer);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [connect]);

  // Se não está habilitado, connected é sempre false
  return {
    connected: isSocketRealtimeEnabled() ? connected : false,
    socket: socketRef.current,
  };
}