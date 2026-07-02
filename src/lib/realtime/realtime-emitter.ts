/**
 * Emitter para API routes — envia eventos de realtime via PostgreSQL NOTIFY.
 *
 * Uso nas API routes (após cada mutação Prisma):
 *
 *   import { realtimeEmit } from '@/lib/realtime/realtime-emitter';
 *
 *   // Após db.client.create(...)
 *   await realtimeEmit({
 *     table: 'clients',
 *     eventType: 'INSERT',
 *     recordId: newClient.id,
 *     label: newClient.name,
 *     actorId: session.user.id,
 *   });
 *
 * O emitter usa Prisma $executeRawUnsafe para executar NOTIFY,
 * que é capturado pelo servidor Socket.io (LISTEN).
 *
 * Isso NÃO interfere no Supabase Realtime — ambas as soluções
 * podem coexistir. Quando o Socket.io estiver ativo, basta
 * remover o SupabaseRealtimeProvider do layout.
 */

import { db as prisma } from '@/lib/db';
import {
  type RealtimeTable,
  type RealtimeEventType,
  type RealtimeEvent,
  pgChannel,
  serializeEvent,
} from './realtime-types';

export interface RealtimeEmitOptions {
  table: RealtimeTable;
  eventType: RealtimeEventType;
  recordId: string;
  label?: string;
  actorId?: string;
}

/**
 * Emite um evento de realtime via PostgreSQL NOTIFY.
 * Fire-and-forget: erros são silenciados para não quebrar a API route principal.
 */
export async function realtimeEmit(options: RealtimeEmitOptions): Promise<void> {
  // Só emite se o Socket.io estiver configurado
  if (!process.env.NEXT_PUBLIC_SOCKET_URL) return;

  try {
    const event: RealtimeEvent = {
      ...options,
      timestamp: new Date().toISOString(),
    };

    const channel = pgChannel(options.table);
    const payload = serializeEvent(event);

    // Escapa aspas simples no payload para evitar SQL injection
    const safePayload = payload.replace(/'/g, "''");

    // NOTIFY usa o formato: NOTIFY channel_name, 'payload'
    // O PostgreSQL trunca o payload em ~8000 bytes, o que é suficiente
    await prisma.$executeRawUnsafe(
      `SELECT pg_notify('${channel}', '${safePayload}')`
    );
  } catch {
    // Fire-and-forget: não quebra a API route principal
    // Em desenvolvimento, descomente a linha abaixo para debug:
    // console.warn('[realtime-emitter] Falha ao emitir evento:', error);
  }
}

/**
 * Helpers por tabela para uso rápido nas API routes.
 * Cada função já predefine o `table`.
 */

export function emitClientChange(
  eventType: RealtimeEventType,
  recordId: string,
  label?: string,
  actorId?: string
) {
  return realtimeEmit({ table: 'clients', eventType, recordId, label, actorId });
}

export function emitTagChange(
  eventType: RealtimeEventType,
  recordId: string,
  label?: string,
  actorId?: string
) {
  return realtimeEmit({ table: 'tags', eventType, recordId, label, actorId });
}

export function emitReminderChange(
  eventType: RealtimeEventType,
  recordId: string,
  label?: string,
  actorId?: string
) {
  return realtimeEmit({ table: 'reminders', eventType, recordId, label, actorId });
}

export function emitInteractionChange(
  eventType: RealtimeEventType,
  recordId: string,
  label?: string,
  actorId?: string
) {
  return realtimeEmit({ table: 'interactions', eventType, recordId, label, actorId });
}

export function emitScheduleChange(
  eventType: RealtimeEventType,
  recordId: string,
  label?: string,
  actorId?: string
) {
  return realtimeEmit({ table: 'schedules', eventType, recordId, label, actorId });
}

export function emitEnterpriseChange(
  eventType: RealtimeEventType,
  recordId: string,
  label?: string,
  actorId?: string
) {
  return realtimeEmit({ table: 'enterprises', eventType, recordId, label, actorId });
}

export function emitUserSettingsChange(actorId?: string) {
  return realtimeEmit({
    table: 'user_settings',
    eventType: 'UPDATE',
    recordId: actorId || 'unknown',
    actorId,
  });
}