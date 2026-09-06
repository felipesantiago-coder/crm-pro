/**
 * Idempotência de entrega (§17.2): impede notificação duplicada pelo
 * mesmo evento para o mesmo destinatário, inclusive na corrida entre
 * webhook e polling em instâncias serverless diferentes.
 *
 * Estratégia: o INSERT da linha com status 'sending' É o lock — a
 * UNIQUE constraint no dedupKey rejeita a segunda instância. Não há
 * dependência de memória de processo. Locks 'sending' travados por
 * falha de processo são retomáveis após TTL curto.
 *
 * dedupKey = `${kind}:${ingestion}:${eventId}:${recipientUserId}`
 * (nenhum dado pessoal entra na chave — ids opacos apenas).
 */

import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import type { TelegramDeliveryResult } from './types';

/** Após quanto tempo um lock 'sending' órfão pode ser retomado. */
const STALE_LOCK_MS = 5 * 60_000;

export interface DeliverySlotInput {
  dedupKey: string;
  kind: string;
  ingestionMethod?: string | null;
  recipientUserId?: string | null;
  clientId?: string | null;
}

export type DeliverySlot = 'acquired' | 'duplicate';

/**
 * Tenta adquirir o slot de entrega. Retorna 'duplicate' quando já
 * existe entrega concluída (ou em andamento e recente) para a chave.
 */
export async function acquireDeliverySlot(input: DeliverySlotInput): Promise<DeliverySlot> {
  try {
    await db.telegramDeliveryLog.create({
      data: {
        dedupKey: input.dedupKey,
        status: 'sending',
        kind: input.kind,
        ingestionMethod: input.ingestionMethod || null,
        recipientUserId: input.recipientUserId || null,
        clientId: input.clientId || null,
      },
    });
    return 'acquired';
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
      // Falha de DB não pode travar o fluxo do lead; sem log, sem dedup.
      console.warn(
        '[Lead Notify] Log de entrega indisponível — idempotência degradada:',
        err instanceof Error ? err.message : err,
      );
      return 'acquired';
    }
  }

  // Conflito de chave: decide entre duplicado real e lock órfão
  try {
    const existing = await db.telegramDeliveryLog.findUnique({
      where: { dedupKey: input.dedupKey },
      select: { status: true, updatedAt: true },
    });

    if (!existing) return 'duplicate'; // apagado na corrida — conservador

    const stale =
      existing.status === 'sending' &&
      Date.now() - existing.updatedAt.getTime() > STALE_LOCK_MS;
    const finished = existing.status === 'delivered' || existing.status === 'partial';

    if (finished || (existing.status === 'sending' && !stale)) {
      return 'duplicate';
    }

    // failed | skipped_duplicate | sending órfão → retoma o slot
    await db.telegramDeliveryLog.update({
      where: { dedupKey: input.dedupKey },
      data: { status: 'sending', errorCode: null, messageIds: null, attempts: 0 },
    });
    return 'acquired';
  } catch (err) {
    console.warn(
      '[Lead Notify] Falha ao avaliar slot de entrega — tratando como duplicado:',
      err instanceof Error ? err.message : err,
    );
    return 'duplicate';
  }
}

/** Persiste o resultado final (auditoria sem PII). */
export async function finalizeDelivery(
  dedupKey: string,
  result: TelegramDeliveryResult,
  latencyMs: number,
): Promise<void> {
  try {
    const messageIds = result.messages
      .filter((m) => m.delivered && m.messageId)
      .map((m) => m.messageId);
    const firstError = result.messages.find((m) => !m.delivered)?.errorCode;

    await db.telegramDeliveryLog.updateMany({
      where: { dedupKey },
      data: {
        status: result.status,
        attempts: result.attempts,
        messageIds: messageIds.length > 0 ? JSON.stringify(messageIds) : null,
        errorCode: firstError || null,
        latencyMs,
      },
    });
  } catch (err) {
    console.warn(
      '[Lead Notify] Falha ao registrar resultado de entrega:',
      err instanceof Error ? err.message : err,
    );
  }
}
