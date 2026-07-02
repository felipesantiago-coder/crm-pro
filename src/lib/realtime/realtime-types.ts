/**
 * Tipos compartilhados entre o servidor Socket.io, o emitter (API routes) e o cliente.
 *
 * Fluxo:
 *   API Route → realtimeEmitter() → PostgreSQL NOTIFY
 *   PostgreSQL → Socket.io Server (LISTEN) → Socket.io emit → Browser
 */

// --- Tabelas monitoradas ---
export type RealtimeTable =
  | 'clients'
  | 'tags'
  | 'client_tags'
  | 'reminders'
  | 'user_settings'
  | 'interactions'
  | 'schedules'
  | 'enterprises'
  | 'lead_queues'
  | 'users';

// --- Tipo de evento do banco ---
export type RealtimeEventType = 'INSERT' | 'UPDATE' | 'DELETE';

// --- Payload completo do evento ---
export interface RealtimeEvent {
  table: RealtimeTable;
  eventType: RealtimeEventType;
  /** ID do registro afetado */
  recordId: string;
  /** Dados úteis para o toast (nome, título, etc.) */
  label?: string;
  /** Quem disparou a mudança (userId ou 'system') */
  actorId?: string;
  /** Timestamp ISO */
  timestamp: string;
}

// --- Canais PostgreSQL NOTIFY/LISTEN ---
// Formato: crm_realtime:<table>
export function pgChannel(table: RealtimeTable): string {
  return `crm_realtime:${table}`;
}

// --- Nome do evento Socket.io ---
// Todos os eventos chegam pelo mesmo canal 'crm:change'
export const SOCKET_EVENT = 'crm:change';

// --- Payload do NOTIFY do PostgreSQL ---
// O PostgreSQL NOTIFY aceita apenas string (max ~8000 bytes)
// Serializamos o RealtimeEvent como JSON
export function serializeEvent(event: RealtimeEvent): string {
  return JSON.stringify(event);
}

export function deserializeEvent(raw: string): RealtimeEvent {
  try {
    return JSON.parse(raw) as RealtimeEvent;
  } catch {
    // Fallback seguro se o payload for corrompido
    return {
      table: 'clients',
      eventType: 'UPDATE',
      recordId: 'unknown',
      timestamp: new Date().toISOString(),
    };
  }
}