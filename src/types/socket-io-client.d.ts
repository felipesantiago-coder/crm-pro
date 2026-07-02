/**
 * Stub de tipos para socket.io-client.
 *
 * Este arquivo existe para que o TypeScript não gere erros de build
 * quando o pacote socket.io-client ainda NÃO foi instalado.
 *
 * Quando ativar o Socket.io (npm install socket.io-client), este arquivo
 * pode ser removido — os tipos reais do pacote prevalecerão.
 */

declare module 'socket.io-client' {
  export interface Socket {
    connected: boolean;
    id: string;
    auth: Record<string, unknown>;
    on(event: string, callback: (...args: unknown[]) => void): this;
    off(event: string, callback?: (...args: unknown[]) => void): this;
    emit(event: string, ...args: unknown[]): this;
    connect(): this;
    disconnect(): this;
  }

  export interface ConnectOpts {
    auth?: Record<string, unknown>;
    transports?: string[];
    reconnection?: boolean;
    reconnectionAttempts?: number;
    reconnectionDelay?: number;
    reconnectionDelayMax?: number;
    timeout?: number;
  }

  export function io(url: string, opts?: ConnectOpts): Socket;
}