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

// ── Fase 4 (otimização Vercel): atribuição de fila atômica ──
// Flag de canário: LEAD_QUEUE_ATOMIC_V2=legacy volta ao CAS + create
// de 2 statements (comportamento pré-Fase 4). Default: atômico.
//
// O caminho atômico executa UM ÚNICO statement (CTE data-modifying):
//   1. target — valida fila ativa + guard de replay (leadId já atribuído)
//   2. member — escolhe o membro da vez (currentIdx % ativos, ordem preservada)
//   3. adv    — CAS no currentIdx (WHERE currentIdx = lido) — reserva
//   4. ins    — INSERT da atribuição SÓ se a reserva avançou,
//               ON CONFLICT (leadId) DO NOTHING (belt-and-braces)
// Crash/concorrência entre reserva e criação fica impossível por
// construção: um statement = tudo ou nada. Compatível com PgBouncer
// transaction pooler (sem transação interativa, sem conexão direta).
//
// Degradação automática (padrão da Fase 3): erro no statement (ex.:
// UNIQUE ainda não aplicado → "no unique or exclusion constraint",
// dialeto sqlite no dev) → caminho legado assume.
const atomicEnabled = () => process.env.LEAD_QUEUE_ATOMIC_V2 !== 'legacy';
let warnedAtomicFallback = false;

// Fatia estrutural satisfeita pelo PrismaClient (mesmo padrão do
// MetaIngestDb da Fase 3) — permite fakes completos nos testes.
export interface AssignDb {
  user: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; name: true; phone: true };
    }): Promise<{ id: string; name: string; phone: string | null } | null>;
  };
  leadQueue: {
    findFirst(args: {
      where: { id?: string; isDefault?: boolean; isActive: boolean };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    findUnique(args: {
      where: { id: string };
      select: { currentIdx: true; isActive: true };
    }): Promise<{ currentIdx: number; isActive: boolean } | null>;
    updateMany(args: {
      where: { id: string; currentIdx: number };
      data: { currentIdx: number };
    }): Promise<{ count: number }>;
  };
  leadQueueMember: {
    findMany(args: {
      where: { queueId: string; isActive: boolean };
      include: { user: { select: { id: true; name: true; phone: true } } };
      orderBy: { order: 'asc' };
    }): Promise<Array<{ id: string; userId: string; user: { id: string; name: string; phone: string | null } | null }>>;
    count(args: { where: { queueId: string; isActive: boolean } }): Promise<number>;
  };
  leadQueueAssignment: {
    findFirst(args: {
      where: { leadId: string };
      select: {
        userId: true;
        queueId: true;
        createdAt: true;
        user: { select: { id: true; name: true; phone: true } };
      };
      orderBy: { createdAt: 'desc' };
    }): Promise<{
      userId: string;
      queueId: string;
      createdAt: Date;
      user: { id: string; name: string; phone: string | null } | null;
    } | null>;
    create(args: {
      data: { queueId: string; userId: string; leadId: string | null; source: string };
    }): Promise<unknown>;
  };
  $queryRaw(strings: TemplateStringsArray, ...params: unknown[]): Promise<unknown[]>;
}

interface AtomicAssignRow {
  queueId: string;
  userId: string;
  userName: string;
  userPhone: string | null;
}

/**
 * Caminho atômico da Fase 4: reserva (CAS no currentIdx) + criação da
 * atribuição em UM statement. Retorna:
 *  - AssignResult (assigned: true)  → atribuição criada
 *  - 'already_assigned'             → replay do lead (devolve existente)
 *  - 'no_members'                   → fila sem membros ativos
 *  - 'exhausted'                    → CAS perdido em todas as tentativas
 * Lança erro em falha de infraestrutura (o chamador degrada p/ legado).
 */
async function atomicAssignLead(
  database: AssignDb,
  opts: { queueId: string; leadId?: string; source?: string }
): Promise<AssignResult> {
  const { queueId, leadId, source } = opts;
  const MAX_RETRIES = 5;
  // Contrato do legado preservado: default 'api' e corte em 200 chars
  const sourceParam = (source || 'api').slice(0, 200);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Contratos de mensagem do legado, preservados: fila/membros
    // revalidados a cada tentativa (como no CAS legado).
    const freshQueue = await database.leadQueue.findUnique({
      where: { id: queueId },
      select: { currentIdx: true, isActive: true },
    });
    if (!freshQueue || !freshQueue.isActive) {
      return { assigned: false, message: 'Nenhum membro ativo na fila' };
    }

    const memberCount = await database.leadQueueMember.count({
      where: { queueId, isActive: true },
    });
    if (memberCount === 0) {
      return { assigned: false, message: 'Nenhum membro ativo na fila' };
    }

    // ── O statement atômico ──
    // Um único round-trip: guard de replay + pick round-robin + CAS
    // + INSERT condicional à reserva + ON CONFLICT DO NOTHING.
    // Snapshot de statement: NOT EXISTS, CAS e INSERT enxergam o
    // mesmo estado; escritas concorrentes são resolvidas por lock
    // do UPDATE (reavaliação do WHERE) e pelo índice UNIQUE.
    const rows = (await database.$queryRaw`
      WITH guard AS (
        SELECT g.lead_id,
               EXISTS (
                 SELECT 1 FROM lead_queue_assignments a
                 WHERE a."leadId" = g.lead_id
               ) AS already
        FROM (SELECT CAST(${leadId ?? null} AS text) AS lead_id) g
      ),
      target AS (
        SELECT q.id AS queue_id, q."currentIdx" AS old_idx, g.lead_id
        FROM lead_queues q
        CROSS JOIN guard g
        WHERE q.id = ${queueId}
          AND q."isActive" = true
          AND g.already = false
      ),
      member AS (
        SELECT t.queue_id, t.old_idx, t.lead_id, picked."userId" AS user_id
        FROM target t
        JOIN LATERAL (
          SELECT am."userId",
                 ROW_NUMBER() OVER (ORDER BY am."order" ASC) AS rn,
                 COUNT(*) OVER () AS total
          FROM lead_queue_members am
          WHERE am."queueId" = t.queue_id
            AND am."isActive" = true
            AND am."userId" IS NOT NULL
        ) picked ON picked.rn = (t.old_idx % picked.total) + 1
      ),
      adv AS (
        UPDATE lead_queues q
        SET "currentIdx" = q."currentIdx" + 1
        FROM member m
        WHERE q.id = m.queue_id
          AND q."currentIdx" = m.old_idx
        RETURNING q.id
      ),
      ins AS (
        INSERT INTO lead_queue_assignments ("id", "queueId", "userId", "leadId", "source")
        SELECT gen_random_uuid()::text, m.queue_id, m.user_id, m.lead_id, ${sourceParam}
        FROM member m
        WHERE EXISTS (SELECT 1 FROM adv)
        ON CONFLICT ("leadId") DO NOTHING
        RETURNING "queueId", "userId"
      )
      SELECT ins."queueId" AS "queueId",
             ins."userId" AS "userId",
             u.name AS "userName",
             u.phone AS "userPhone"
      FROM ins
      JOIN users u ON u.id = ins."userId"
    `) as unknown as AtomicAssignRow[];

    if (rows.length > 0) {
      const row = rows[0];
      return { assigned: true, ...row };
    }

    // Statement vazio: replay do lead (já atribuído) ou CAS perdido.
    if (leadId) {
      const existing = await database.leadQueueAssignment.findFirst({
        where: { leadId },
        select: {
          userId: true,
          queueId: true,
          createdAt: true,
          user: { select: { id: true, name: true, phone: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (existing?.user) {
        return {
          assigned: true,
          userId: existing.user.id,
          userName: existing.user.name,
          userPhone: existing.user.phone,
          queueId: existing.queueId,
          message: 'already_assigned',
        };
      }
      // Sem atribuição existente → CAS perdido (outro lead avançou o
      // ponteiro entre leitura e UPDATE) → backoff e nova tentativa.
    }

    if (attempt < MAX_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, 30 * (attempt + 1)));
    }
  }

  return { assigned: false, message: 'Erro interno na atribuição' };
}

/**
 * Replay da atribuição existente de um lead — usado pelas 3 camadas
 * de idempotência (cache DB, statement vazio no caminho atômico e
 * P2002 no caminho legado). Retorna null se o lead não tem atribuição
 * com usuário válido (user deletado → CASCADE removeu a linha).
 */
async function replayExistingAssignment(
  database: AssignDb,
  leadId: string
): Promise<AssignResult | null> {
  const existingAssignment = await database.leadQueueAssignment.findFirst({
    where: { leadId },
    select: {
      userId: true,
      queueId: true,
      createdAt: true,
      user: { select: { id: true, name: true, phone: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!existingAssignment?.user) return null;

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

/**
 * Testes: limpa o cache Layer-1 (in-memory) para exercitar os caminhos
 * Layer-2/CTE/legado — NUNCA usar em código de aplicação.
 */
export function __resetAssignmentCacheForTests() {
  recentAssignments.clear();
  lastCacheCleanup = Date.now();
}

/**
 * Assigns the next user in the queue via atomic round-robin.
 * This is the shared service function — call it directly instead of via HTTP.
 *
 * Fase 4 (otimização Vercel): reserva (avanço do currentIdx) e criação
 * da atribuição são ATÔMICOS (statement único, compatível com o pooler)
 * e o conflito do UNIQUE(leadId) é tratado como replay — nunca duplica
 * atribuição. O caminho legado (CAS + create) permanece como fallback
 * verbatim (flag LEAD_QUEUE_ATOMIC_V2=legacy ou erro de degradação).
 *
 * @param opts.leadId - Optional client ID to link to the assignment
 * @param opts.queueId - Specific queue ID (uses default if omitted)
 * @param opts.source - Source label (e.g. 'landing_form:slug', 'meta_ads:campaign')
 * @param deps.db - Fatia estrutural opcional (injeção p/ testes; padrão: global db)
 * @returns The assigned user info, or { assigned: false } if no queue/members
 */
export async function assignLeadToUser(
  opts: {
    leadId?: string;
    queueId?: string;
    source?: string;
  } = {},
  deps: { db?: AssignDb } = {}
): Promise<AssignResult> {
  const { leadId, queueId, source } = opts;
  const database: AssignDb = deps.db ?? db;

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
      const user = await database.user.findUnique({
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
    // Uses the UNIQUE(leadId) (Fase 4) para lookup O(log n).
    try {
      const replayed = await replayExistingAssignment(database, leadId);
      if (replayed) return replayed;
    } catch (dbErr) {
      // If DB dedup check fails, log but proceed — the UNIQUE(leadId) +
      // statement atômico abaixo são a rede final contra double-write.
      console.warn('[Lead Queue] DB dedup check failed, proceeding to transaction:', dbErr);
    }
  }

  // Find the queue
  const queue = await database.leadQueue.findFirst({
    where: {
      ...(queueId ? { id: queueId } : { isDefault: true }),
      isActive: true,
    },
    select: { id: true },
  });

  if (!queue) {
    return { assigned: false, message: 'Nenhuma fila ativa encontrada' };
  }

  // ── Caminho atômico (Fase 4) ──
  if (atomicEnabled()) {
    try {
      return await atomicAssignLead(database, { queueId: queue.id, leadId, source });
    } catch (atomicErr) {
      // Degradação automática controlada (padrão da Fase 3): UNIQUE
      // ainda não aplicado, dialeto sem CTE data-modifying (sqlite no
      // dev), indisponibilidade transitória → caminho legado assume.
      if (!warnedAtomicFallback) {
        warnedAtomicFallback = true;
        console.warn(
          '[Lead Queue] Caminho atômico indisponível — usando CAS+create legado:',
          atomicErr instanceof Error ? atomicErr.message : atomicErr
        );
      }
    }
  }

  // ── Caminho legado (fallback verbatim, pré-Fase 4) ──
  // Optimistic concurrency with CAS (Compare-And-Swap) on currentIdx.
  // Compatible with PgBouncer Transaction pooler (no interactive transactions).
  //
  // Strategy:
  // 1. Read currentIdx (no lock)
  // 2. Compute next member
  // 3. Atomic UPDATE ... SET currentIdx = X WHERE id = Q AND currentIdx = old_value
  // 4. If UPDATE affects 0 rows → someone else advanced → retry
  // 5. On success → create assignment
  // Fase 4: conflito de UNIQUE no create = replay da atribuição existente.
  const MAX_RETRIES = 5;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Step 1: Read current state (no transaction needed)
      const freshQueue = await database.leadQueue.findUnique({
        where: { id: queue.id },
        select: { currentIdx: true, isActive: true },
      });

      if (!freshQueue || !freshQueue.isActive) {
        return { assigned: false, message: 'Nenhum membro ativo na fila' };
      }

      const activeMembers = await database.leadQueueMember.findMany({
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
      // Usuário estreitado no pick (FK garante presença; null é defensivo)
      let pickedUser: { id: string; name: string; phone: string | null } | null = null;
      let idx = freshQueue.currentIdx % activeMembers.length;

      while (!assigned && tries < maxTries) {
        const candidate = activeMembers[idx];
        if (candidate.user) {
          pickedMember = candidate;
          pickedUser = candidate.user;
          assigned = true;
        } else {
          console.error(`[Lead Queue] Member ${candidate.id} has no user — data integrity issue, skipping`);
        }
        idx = (idx + 1) % activeMembers.length;
        tries++;
      }

      if (!pickedMember || !pickedUser) {
        console.error('[Lead Queue] All members have null user — cannot assign lead');
        return { assigned: false, message: 'Nenhum membro ativo na fila' };
      }

      // Step 3: Atomic CAS on currentIdx
      const newIdx = freshQueue.currentIdx + tries;
      const updateResult = await database.leadQueue.updateMany({
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
      try {
        await database.leadQueueAssignment.create({
          data: {
            queueId: queue.id,
            userId: pickedMember.userId,
            leadId: leadId || null,
            source: (source || 'api').slice(0, 200),
          },
        });
      } catch (createErr) {
        // Fase 4: com o UNIQUE(leadId) aplicado, corrida do mesmo lead no
        // caminho legado = P2002 → replay (devolve a atribuição existente
        // em vez de propagar erro). O avanço da fila nesse caso é o custo
        // conhecido do caminho legado (motivo da Fase 4).
        if (
          createErr instanceof Prisma.PrismaClientKnownRequestError &&
          createErr.code === 'P2002' &&
          leadId
        ) {
          const replayed = await replayExistingAssignment(database, leadId);
          if (replayed) return replayed;
        }
        throw createErr;
      }

      const result = {
        userId: pickedUser.id,
        userName: pickedUser.name,
        userPhone: pickedUser.phone,
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
