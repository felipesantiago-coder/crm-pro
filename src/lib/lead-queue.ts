import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

export interface AssignResult {
  assigned: boolean;
  userId?: string;
  userName?: string;
  userPhone?: string | null;
  queueId?: string;
  message?: string;
}

/**
 * Assigns the next user in the queue via atomic round-robin.
 * This is the shared service function — call it directly instead of via HTTP.
 *
 * @param opts.leadId - Optional client ID to link to the assignment
 * @param opts.queueId - Specific queue ID (uses default if omitted)
 * @param opts.source - Source label (e.g. 'landing_form:slug', 'meta_ads:campaign')
 * @returns The assigned user info, or { assigned: false } if no queue/members
 */
export async function assignLeadToUser(opts: {
  leadId?: string;
  queueId?: string;
  source?: string;
} = {}): Promise<AssignResult> {
  const { leadId, queueId, source } = opts;

  // Find the queue
  const queue = await db.leadQueue.findFirst({
    where: {
      ...(queueId ? { id: queueId } : { isDefault: true }),
      isActive: true,
    },
    select: { id: true },
  });

  if (!queue) {
    return { assigned: false, message: 'Nenhuma fila ativa encontrada' };
  }

  // Retry logic for Serializable transaction failures
  const MAX_RETRIES = 3;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await db.$transaction(async (tx) => {
        const freshQueue = await tx.leadQueue.findUniqueOrThrow({
          where: { id: queue.id },
          select: { currentIdx: true },
        });

        const activeMembers = await tx.leadQueueMember.findMany({
          where: { queueId: queue.id, isActive: true },
          include: { user: { select: { id: true, name: true, phone: true } } },
          orderBy: { order: 'asc' },
        });

        if (activeMembers.length === 0) {
          return null;
        }

        const idx = freshQueue.currentIdx % activeMembers.length;
        const member = activeMembers[idx];

        await tx.leadQueue.update({
          where: { id: queue.id },
          data: { currentIdx: { increment: 1 } },
        });

        await tx.leadQueueAssignment.create({
          data: {
            queueId: queue.id,
            userId: member.userId,
            leadId: leadId || null,
            source: source || 'api',
          },
        });

        return {
          userId: member.userId,
          userName: member.user.name,
          userPhone: member.user.phone,
          queueId: queue.id,
        };
      }, {
        isolationLevel: 'Serializable',
        timeout: 10000,
      });

      if (!result) {
        return { assigned: false, message: 'Nenhum membro ativo na fila' };
      }

      return { assigned: true, ...result };
    } catch (error) {
      lastError = error;
      // Retry on serialization failures (Postgres error code 40001)
      const isSerializationError =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2028';
      if (isSerializationError && attempt < MAX_RETRIES - 1) {
        // Small delay before retry (exponential backoff)
        await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }

  console.error('[Lead Queue] Falha após retries:', lastError);
  return { assigned: false, message: 'Erro interno na atribuição' };
}

/**
 * Peek at the next user in the queue WITHOUT advancing the counter.
 * Used by landing pages to display the agent's info.
 */
export async function peekNextUser(opts: { queueId?: string } = {}) {
  const { queueId } = opts;

  const queue = await db.leadQueue.findFirst({
    where: {
      ...(queueId ? { id: queueId } : { isDefault: true }),
      isActive: true,
    },
    include: {
      members: {
        where: { isActive: true },
        include: { user: { select: { id: true, name: true, phone: true } } },
        orderBy: { order: 'asc' },
      },
    },
  });

  if (!queue || queue.members.length === 0) {
    return null;
  }

  const idx = queue.currentIdx % queue.members.length;
  const member = queue.members[idx];

  return {
    userId: member.userId,
    userName: member.user.name,
    userPhone: member.user.phone || null,
    queueId: queue.id,
  };
}
