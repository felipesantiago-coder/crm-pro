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

        // Find a valid member by scanning from currentIdx.
        // This skips members whose user was deleted (data integrity issue).
        // In practice this shouldn't happen due to FK constraints + Cascade,
        // but defensive coding prevents silent assignment failure.
        let assignedMember: typeof activeMembers[0] | null = null;
        let scanOffset = 0;
        while (scanOffset < activeMembers.length) {
          const idx = (freshQueue.currentIdx + scanOffset) % activeMembers.length;
          const candidate = activeMembers[idx];
          if (candidate.user) {
            assignedMember = candidate;
            break;
          }
          console.error(`[Lead Queue] Member ${candidate.id} has no user — skipping`);
          scanOffset++;
        }

        if (!assignedMember) {
          console.error(`[Lead Queue] All ${activeMembers.length} active members have no user`);
          return null;
        }

        await tx.leadQueue.update({
          where: { id: queue.id },
          data: { currentIdx: { increment: 1 + scanOffset } },
        });

        await tx.leadQueueAssignment.create({
          data: {
            queueId: queue.id,
            userId: assignedMember.userId,
            leadId: leadId || null,
            source: (source || 'api').slice(0, 200),
          },
        });

        return {
          userId: assignedMember.userId,
          userName: assignedMember.user.name,
          userPhone: assignedMember.user.phone,
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

  // Defensive: scan members starting from idx to find one with a valid user
  // This handles the edge case where a user was deleted but the member row
  // wasn't cleaned up (shouldn't happen with Cascade, but defensive)
  for (let offset = 0; offset < queue.members.length; offset++) {
    const candidate = queue.members[(idx + offset) % queue.members.length];
    if (candidate?.user) {
      return {
        userId: candidate.userId,
        userName: candidate.user.name,
        userPhone: candidate.user.phone || null,
        queueId: queue.id,
      };
    }
  }

  return null;
}
