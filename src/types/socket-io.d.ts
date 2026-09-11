/**
 * Stub de tipos para socket.io (SERVER — self-host).
 *
 * Este arquivo existe para que o TypeScript não gere erros de build
 * enquanto o pacote socket.io NÃO está instalado. O servidor Socket.IO
 * do CRM Pro roda em infraestrutura PRÓPRIA (não na Vercel — Functions
 * não suportam WebSocket server), por isso a dependência fica fora do
 * package.json do deploy e este arquivo mantém o módulo self-host
 * compilável.
 *
 * Quando ativar o servidor (npm install socket.io), este arquivo pode
 * ser removido — os tipos reais do pacote prevalecerão.
 */

declare module 'socket.io' {
  export interface Handshake {
    auth: Record<string, unknown>;
    headers: Record<string, unknown> & { authorization?: string };
    address?: unknown;
    time?: string;
    query?: Record<string, unknown>;
  }

  export interface SocketData {
    user?: unknown;
    [key: string]: unknown;
  }

  export interface Socket {
    id: string;
    handshake: Handshake;
    data: SocketData;
    connected: boolean;
    on(event: string, listener: (...args: never[]) => void): this;
    emit(event: string, ...args: unknown[]): boolean;
    join(rooms: string | string[]): this;
    leave(rooms: string | string[]): this;
    disconnect(close?: boolean): this;
  }

  export interface Engine {
    clientsCount: number;
  }

  export interface ServerOptions {
    cors?: Record<string, unknown>;
    [key: string]: unknown;
  }

  export class Server {
    constructor(port?: number, opts?: ServerOptions);
    constructor(httpServer?: unknown, opts?: ServerOptions);
    engine: Engine;
    use(middleware: (socket: Socket, next: (err?: Error) => void) => void | Promise<void>): this;
    on(event: 'connection', listener: (socket: Socket) => void): this;
    on(event: string, listener: (...args: never[]) => void): this;
    emit(event: string, ...args: unknown[]): boolean;
    to(rooms: string | string[]): this;
    close(): void;
  }
}
