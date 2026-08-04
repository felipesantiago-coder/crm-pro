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

// In-memory cache of recently assigned leadIds to prevent double-assignment
// Maps leadId -> { queueId, userId, assignedAt }
const recentAssignments = new Map<string, { queueId: string; userId: string; assignedAt: number }>();
const ASSIGNMENT_CACHE_TTL = 60_000; // 1 minute
let lastCacheCleanup = Date.now();

function cleanupAssignmentCache() {
  const now = Date.now();
  if (now - lastCacheCleanup < ASSIGNMENT_CACHE_TTL) return;
  lastCacheCleanup = now;
  for (const [key, val] of recentAssignments) {
    if (now - val.assignedAt > ASSIGNMENT_CACHE_TTL) recentAssignments.delete(key);
  }
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

  // Idempotency: if this leadId was already assigned recently, return cached result
  // This prevents double-assignment from Meta webhook retries or double-clicks
  if (leadId) {
    cleanupAssignmentCache();
    const cached = recentAssignments.get(leadId);
    if (cached) {
      // Verify the user still exists and is valid
      const user = await db.user.findUnique({
        where: { id: cached.userId },
        select: { id: true, name: true, phone: true },
      });
      if (user) {
        return {
          assigned: true,
          userId: user.id,
          userName: user.name,
          userPhone: user.phone,
          queueId: cached.queueId,
          message: 'already_assigned',
        };
      }
      // User was deleted, remove cache and proceed with new assignment
      recentAssignments.delete(leadId);
    }
  }

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

        // Safety: if member's user was somehow deleted, skip to next
        // This should not happen due to FK constraints, but defensive coding
        if (!member.user) {
          console.error(`[Lead Queue] Member ${member.id} has no user — data integrity issue`);
          // Still increment to avoid infinite loop on this index
          await tx.leadQueue.update({
            where: { id: queue.id },
            data: { currentIdx: { increment: 1 } },
          });
          return null;
        }

        await tx.leadQueue.update({
          where: { id: queue.id },
          data: { currentIdx: { increment: 1 } },
        });

        await tx.leadQueueAssignment.create({
          data: {
            queueId: queue.id,
            userId: member.userId,
            leadId: leadId || null,
            source: (source || 'api').slice(0, 200),
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

      // Cache successful assignment for idempotency
      if (leadId) {
        recentAssignments.set(leadId, {
          queueId: result.queueId,
          userId: result.userId,
          assignedAt: Date.now(),
        });
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
 *
 * Note: Uses READ COMMITTED (default) since this is a read-only peek.
 * The displayed agent may not be the exact one assigned if concurrent
 * assignments happen between peek and form submit — this is acceptable
 * since the WhatsApp number is informational and the actual assignment
 * happens atomically in assignLeadToUser().
 */
export async function peekNextUser(opts: { queueId?: string; slug?: string } = {}) {
  const { queueId, slug } = opts;

  // If a slug is provided, look for a queue linked to that enterprise
  // Currently all enterprises use the default queue, but this allows
  // future per-enterprise queue routing.
  let targetQueueId = queueId;
  if (!targetQueueId && slug) {
    // Future: could look up enterprise-specific queue here
    // For now, fall through to default queue logic below
  }

  const queue = await db.leadQueue.findFirst({
    where: {
      ...(targetQueueId ? { id: targetQueueId } : { isDefault: true }),
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

  // Defensive: member should always have a user due to FK, but check anyway
  if (!member?.user) {
    // Try next member if current one is invalid
    if (queue.members.length > 1) {
      const fallback = queue.members[(idx + 1) % queue.members.length];
      if (fallback?.user) {
        return {
          userId: fallback.userId,
          userName: fallback.user.name,
          userPhone: fallback.user.phone || null,
          queueId: queue.id,
        };
      }
    }
    return null;
  }

  return {
    userId: member.userId,
    userName: member.user.name,
    userPhone: member.user.phone || null,
    queueId: queue.id,
  };
}
