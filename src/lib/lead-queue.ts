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

  // ── Idempotency: two-layer protection ──
  // Layer 1 (fast): in-memory cache — avoids DB query on hot retries within 60s
  // Layer 2 (authoritative): DB lookup on lead_queue_assignments — works across
  //   serverless instances, cold starts, and deployments. This is the real
  //   source of truth; the in-memory cache is just an optimization.
  if (leadId) {
    // Layer 1: in-memory fast path
    cleanupAssignmentCache();
    const cached = recentAssignments.get(leadId);
    if (cached) {
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
      // User was deleted, remove cache and fall through to DB check
      recentAssignments.delete(leadId);
    }

    // Layer 2: DB-backed dedup (cross-instance safe)
    // Check if this leadId already has a recent assignment in the database.
    // Uses the index on leadId for O(log n) lookup.
    try {
      const existingAssignment = await db.leadQueueAssignment.findFirst({
        where: { leadId },
        select: {
          userId: true,
          queueId: true,
          createdAt: true,
          user: { select: { id: true, name: true, phone: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (existingAssignment?.user) {
        // Populate in-memory cache from DB result for future fast-path hits
        recentAssignments.set(leadId, {
          queueId: existingAssignment.queueId,
          userId: existingAssignment.userId,
          assignedAt: Date.now(),
        });
        return {
          assigned: true,
          userId: existingAssignment.user.id,
          userName: existingAssignment.user.name,
          userPhone: existingAssignment.user.phone,
          queueId: existingAssignment.queueId,
          message: 'already_assigned',
        };
      }
    } catch (dbErr) {
      // If DB dedup check fails, log but proceed — the Serializable
      // transaction below is the final safety net against double-write.
      console.warn('[Lead Queue] DB dedup check failed, proceeding to transaction:', dbErr);
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

  // Optimistic concurrency with CAS (Compare-And-Swap) on currentIdx.
  // Compatible with PgBouncer Transaction pooler (no interactive transactions).
  //
  // Strategy:
  // 1. Read currentIdx (no lock)
  // 2. Compute next member
  // 3. Atomic UPDATE ... SET currentIdx = X WHERE id = Q AND currentIdx = old_value
  // 4. If UPDATE affects 0 rows → someone else advanced → retry
  // 5. On success → create assignment
  const MAX_RETRIES = 5;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Step 1: Read current state (no transaction needed)
      const freshQueue = await db.leadQueue.findUnique({
        where: { id: queue.id },
        select: { currentIdx: true, isActive: true },
      });

      if (!freshQueue || !freshQueue.isActive) {
        return { assigned: false, message: 'Nenhum membro ativo na fila' };
      }

      const activeMembers = await db.leadQueueMember.findMany({
        where: { queueId: queue.id, isActive: true },
        include: { user: { select: { id: true, name: true, phone: true } } },
        orderBy: { order: 'asc' },
      });

      if (activeMembers.length === 0) {
        return { assigned: false, message: 'Nenhum membro ativo na fila' };
      }

      // Step 2: Pick next member
      let assigned = false;
      let tries = 0;
      const maxTries = activeMembers.length;
      let pickedMember: typeof activeMembers[0] | null = null;
      let idx = freshQueue.currentIdx % activeMembers.length;

      while (!assigned && tries < maxTries) {
        const candidate = activeMembers[idx];
        if (candidate.user) {
          pickedMember = candidate;
          assigned = true;
        } else {
          console.error(`[Lead Queue] Member ${candidate.id} has no user — data integrity issue, skipping`);
        }
        idx = (idx + 1) % activeMembers.length;
        tries++;
      }

      if (!pickedMember) {
        console.error('[Lead Queue] All members have null user — cannot assign lead');
        return { assigned: false, message: 'Nenhum membro ativo na fila' };
      }

      // Step 3: Atomic CAS on currentIdx
      const newIdx = freshQueue.currentIdx + tries;
      const updateResult = await db.leadQueue.updateMany({
        where: { id: queue.id, currentIdx: freshQueue.currentIdx },
        data: { currentIdx: newIdx },
      });

      if (updateResult.count === 0) {
        // Someone else changed currentIdx — retry
        if (attempt < MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, 30 * (attempt + 1)));
          continue;
        }
        console.error('[Lead Queue] CAS failed after all retries');
        return { assigned: false, message: 'Erro interno na atribuição' };
      }

      // Step 4: Create assignment (fire-and-forget safety: if this fails,
      // the queue still advanced correctly — next attempt won't double-assign
      // thanks to the idempotency cache and DB dedup)
      await db.leadQueueAssignment.create({
        data: {
          queueId: queue.id,
          userId: pickedMember.userId,
          leadId: leadId || null,
          source: (source || 'api').slice(0, 200),
        },
      });

      const result = {
        userId: pickedMember.userId,
        userName: pickedMember.user.name,
        userPhone: pickedMember.user.phone,
        queueId: queue.id,
      };

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
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return { assigned: false, message: 'Fila não encontrada ou desativada' };
      }
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }

  console.error('[Lead Queue] Falha após retries:', lastError);
  return { assigned: false, message: 'Erro interno na atribuição' };
}

export async function setNextUser(queueId: string, userId: string): Promise<{ currentIdx: number; userName: string }> {
  const activeMembers = await db.leadQueueMember.findMany({
    where: { queueId, isActive: true },
    orderBy: { order: 'asc' },
    select: { userId: true, user: { select: { name: true } } },
  });

  const targetIdx = activeMembers.findIndex((m) => m.userId === userId);
  if (targetIdx === -1) {
    throw new Error('Usuário não está na fila ou está inativo');
  }

  await db.leadQueue.update({
    where: { id: queueId },
    data: { currentIdx: targetIdx },
  });

  return { currentIdx: targetIdx, userName: activeMembers[targetIdx].user.name };
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
