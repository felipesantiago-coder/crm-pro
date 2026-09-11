/**
 * assignment.test.ts — contratos da Fase 4 (otimização Vercel):
 * atribuição de fila ATÔMICA (reserva currentIdx + criação em UM
 * statement), replay por UNIQUE(leadId), concorrência (20 chamadas
 * simultâneas), falhas entre etapas e preservação do caminho legado
 * (CAS + create verbatim como fallback, com P2002 → replay).
 *
 * Fakes implementam a SEMÂNTICA real (CTE = bloco atômico único,
 * UNIQUE por leadId, CAS condicional) — sem banco (regra 2 do prompt),
 * mesmo padrão dos testes da Fase 3 (tests/meta-ingest).
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import {
  assignLeadToUser,
  __resetAssignmentCacheForTests,
  type AssignDb,
} from '../../src/lib/lead-queue.ts';

// ── Fixtures ────────────────────────────────────────────────────

const USERS = {
  u1: { id: 'u1', name: 'Alice', phone: '+5511900000001' },
  u2: { id: 'u2', name: 'Bruno', phone: '+5511900000002' },
  u3: { id: 'u3', name: 'Carla', phone: null },
} as const;

type FakeUser = { id: string; name: string; phone: string | null };
type FakeQueue = { id: string; currentIdx: number; isActive: boolean; isDefault: boolean };
type FakeMember = { id: string; queueId: string; userId: string; order: number; isActive: boolean };
type FakeAssignment = {
  id: string;
  queueId: string;
  userId: string;
  leadId: string | null;
  source: string;
  createdAt: Date;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function p2002(leadId: string): Error {
  return new Prisma.PrismaClientKnownRequestError(
    `Unique constraint failed on lead_queue_assignments.leadId (${leadId})`,
    { code: 'P2002', clientVersion: 'test' }
  );
}

/**
 * Fake do AssignDb com a semântica REAL:
 *  - $queryRaw executa a CTE como BLOCO ATÔMICO único (guard de replay,
 *    pick round-robin sobre membros ativos com usuário, CAS no
 *    currentIdx, INSERT condicional à reserva, ON CONFLICT DO NOTHING)
 *  - create do legado lança P2002 real do Prisma se leadId já atribuído
 *  - CAS do legado é condicional (WHERE currentIdx = lido)
 */
function makeDb(seed?: {
  queues?: FakeQueue[];
  members?: FakeMember[];
  users?: Record<string, FakeUser>;
}) {
  const queues = new Map<string, FakeQueue>();
  for (const q of seed?.queues ?? []) queues.set(q.id, { ...q });
  if (seed?.queues === undefined) {
    queues.set('q1', { id: 'q1', currentIdx: 0, isActive: true, isDefault: true });
  }
  const users = new Map<string, FakeUser>(
    Object.entries(seed?.users ?? USERS).map(([k, v]) => [k, { ...v }])
  );
  const members: FakeMember[] = (seed?.members ?? [
    { id: 'm1', queueId: 'q1', userId: 'u1', order: 0, isActive: true },
    { id: 'm2', queueId: 'q1', userId: 'u2', order: 1, isActive: true },
    { id: 'm3', queueId: 'q1', userId: 'u3', order: 2, isActive: true },
  ]).map((m) => ({ ...m }));

  const assignments: FakeAssignment[] = [];
  let assignmentSeq = 0;

  // Knobs de comportamento (por chamada, restaurados nos testes)
  const knobs = {
    cteDelayMs: 0, // interleave p/ concorrência
    failQueryRaw: null as null | (() => Error), // crash ANTES da mutação
    crashAfterMutation: false, // crash DEPOIS da mutação completa
    deactivateAfterFindFirst: false, // fila desativada entre findFirst e o statement
    queryRawCalls: 0,
    createCalls: 0,
    hideLayer2Once: false, // findFirst da Layer-2 retorna null uma vez
  };

  const activeMembersOf = (queueId: string) =>
    members
      .filter((m) => m.queueId === queueId && m.isActive)
      .sort((a, b) => a.order - b.order);

  const withUser = (m: FakeMember) => ({
    ...m,
    user: users.get(m.userId) ?? null,
  });

  const findAssignmentByLead = (leadId: string) =>
    [...assignments]
      .filter((a) => a.leadId === leadId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;

  const db: AssignDb = {
    user: {
      async findUnique(args) {
        return users.get(args.where.id) ?? null;
      },
    },
    leadQueue: {
      async findFirst(args) {
        const w = args.where;
        for (const q of queues.values()) {
          if (w.id !== undefined && q.id !== w.id) continue;
          if (w.isDefault !== undefined && q.isDefault !== w.isDefault) continue;
          if (w.isActive && !q.isActive) continue;
          if (knobs.deactivateAfterFindFirst) {
            // Simula desativação concorrente entre o findFirst e o statement
            knobs.deactivateAfterFindFirst = false;
            q.isActive = false;
          }
          return { id: q.id };
        }
        return null;
      },
      async findUnique(args) {
        const q = queues.get(args.where.id);
        if (!q) return null;
        return { currentIdx: q.currentIdx, isActive: q.isActive };
      },
      async updateMany(args) {
        const q = queues.get(args.where.id);
        if (!q) return { count: 0 };
        if (q.currentIdx !== args.where.currentIdx) return { count: 0 };
        q.currentIdx = args.data.currentIdx;
        return { count: 1 };
      },
    },
    leadQueueMember: {
      async findMany(args) {
        return activeMembersOf(args.where.queueId)
          .filter((m) => (args.where.isActive ? m.isActive : true))
          .map(withUser);
      },
      async count(args) {
        return activeMembersOf(args.where.queueId).length;
      },
    },
    leadQueueAssignment: {
      async findFirst(args) {
        if (knobs.hideLayer2Once) {
          knobs.hideLayer2Once = false;
          return null;
        }
        const found = findAssignmentByLead(args.where.leadId);
        if (!found) return null;
        return {
          userId: found.userId,
          queueId: found.queueId,
          createdAt: found.createdAt,
          user: users.get(found.userId) ?? null,
        };
      },
      async create(args) {
        knobs.createCalls++;
        const { queueId, userId, leadId, source } = args.data;
        if (leadId && assignments.some((a) => a.leadId === leadId)) {
          throw p2002(leadId); // UNIQUE(leadId) real do banco
        }
        const row: FakeAssignment = {
          id: `a-${++assignmentSeq}`,
          queueId,
          userId,
          leadId,
          source,
          createdAt: new Date(),
        };
        assignments.push(row);
        return row;
      },
    },
    async $queryRaw(_strings, ...params) {
      knobs.queryRawCalls++;
      if (knobs.failQueryRaw) throw knobs.failQueryRaw();
      if (knobs.cteDelayMs) await sleep(knobs.cteDelayMs);

      // ── Semântica da CTE (BLOCO ATÔMICO — nenhum await interno) ──
      // params: [0]=leadId|null, [1]=queueId, [2]=sourceParam
      const [leadId, queueId, source] = params as [string | null, string, string];

      const q = queues.get(queueId);
      // target: fila ativa + guard de replay (NOT EXISTS)
      if (!q || !q.isActive) return [];
      if (leadId && findAssignmentByLead(leadId)) return [];

      const actives = activeMembersOf(queueId).filter((m) => users.has(m.userId));
      if (actives.length === 0) return [];

      // member: pick por rn = (old_idx % total) + 1
      const oldIdx = q.currentIdx;
      const picked = actives[oldIdx % actives.length];

      // adv: CAS — no banco real, o UPDATE reavalia o WHERE na versão
      // mais recente da linha; aqui o bloco é atômico, então o CAS só
      // falha se o ponteiro mudou (não acontece dentro do bloco)
      if (q.currentIdx !== oldIdx) return [];

      // ins: INSERT condicional à reserva + ON CONFLICT DO NOTHING
      const conflict = leadId && findAssignmentByLead(leadId);
      if (!conflict) {
        assignments.push({
          id: `a-${++assignmentSeq}`,
          queueId: q.id,
          userId: picked.userId,
          leadId,
          source,
          createdAt: new Date(),
        });
        q.currentIdx = oldIdx + 1;
      }

      if (knobs.crashAfterMutation) throw new Error('crash pós-mutação (simulado)');

      const pickedUser = users.get(picked.userId)!;
      return [
        {
          queueId: q.id,
          userId: picked.userId,
          userName: pickedUser.name,
          userPhone: pickedUser.phone,
        },
      ];
    },
  };

  return { db, state: { queues, members, users, assignments }, knobs };
}

// Cria a fila padrão com N membros ativos (ordem 0..n-1)
function queueWithMembers(userIdList: string[], activeCount = userIdList.length) {
  const members: FakeMember[] = userIdList.map((userId, i) => ({
    id: `m${i + 1}`,
    queueId: 'q1',
    userId,
    order: i,
    isActive: i < activeCount,
  }));
  return {
    queues: [{ id: 'q1', currentIdx: 0, isActive: true, isDefault: true }],
    members,
  };
}

// ── Hooks ───────────────────────────────────────────────────────

const ENV_BACKUP = process.env.LEAD_QUEUE_ATOMIC_V2;
afterEach(() => {
  if (ENV_BACKUP === undefined) delete process.env.LEAD_QUEUE_ATOMIC_V2;
  else process.env.LEAD_QUEUE_ATOMIC_V2 = ENV_BACKUP;
});

beforeEach(() => {
  __resetAssignmentCacheForTests();
});

// ── Caminho atômico (default) ───────────────────────────────────

test('CTE: atribui o membro da vez (round-robin) e avança o ponteiro', async () => {
  const { db, state } = makeDb();
  const r = await assignLeadToUser({ leadId: 'L1', source: 'meta_ads:camp1' }, { db });
  assert.equal(r.assigned, true);
  assert.equal(r.userId, 'u1');
  assert.equal(r.userName, 'Alice');
  assert.equal(r.queueId, 'q1');
  assert.equal(state.queues.get('q1')!.currentIdx, 1);
  assert.equal(state.assignments.length, 1);
  assert.equal(state.assignments[0].source, 'meta_ads:camp1');
});

test('CTE: sequência de leads preserva a ordem A→B→C→A', async () => {
  const { db, state } = makeDb();
  const picks: Array<string | undefined> = [];
  for (let i = 1; i <= 4; i++) {
    const r = await assignLeadToUser({ leadId: `L${i}` }, { db });
    picks.push(r.userId);
  }
  assert.deepEqual(picks, ['u1', 'u2', 'u3', 'u1']);
  assert.equal(state.queues.get('q1')!.currentIdx, 4);
  assert.equal(state.assignments.length, 4);
});

test('CTE: replay do mesmo lead devolve a atribuição existente (UNIQUE)', async () => {
  const { db, state } = makeDb();
  const first = await assignLeadToUser({ leadId: 'L1' }, { db });
  __resetAssignmentCacheForTests(); // força o caminho do statement (sem cache Layer-1)
  const second = await assignLeadToUser({ leadId: 'L1' }, { db });
  assert.equal(second.assigned, true);
  assert.equal(second.message, 'already_assigned');
  assert.equal(second.userId, first.userId);
  assert.equal(state.assignments.length, 1, 'nunca cria 2ª linha');
  assert.equal(state.queues.get('q1')!.currentIdx, 1, 'replay não avança a fila');
});

test('CTE: fila desativada entre o findFirst e o statement → Nenhum membro ativo na fila', async () => {
  const { db, knobs } = makeDb();
  knobs.deactivateAfterFindFirst = true; // corrida: desativação concorrente
  const r = await assignLeadToUser({ leadId: 'L1' }, { db });
  assert.deepEqual(r, { assigned: false, message: 'Nenhum membro ativo na fila' });
});

test('CTE: zero membros ativos → Nenhum membro ativo na fila', async () => {
  const { db } = makeDb(queueWithMembers(['u1', 'u2', 'u3'], 0));
  const r = await assignLeadToUser({ leadId: 'L1' }, { db });
  assert.deepEqual(r, { assigned: false, message: 'Nenhum membro ativo na fila' });
});

test('CTE: sem fila ativa → Nenhuma fila ativa encontrada', async () => {
  const { db } = makeDb({
    queues: [{ id: 'q1', currentIdx: 0, isActive: false, isDefault: true }],
    members: [],
  });
  const r = await assignLeadToUser({ leadId: 'L1' }, { db });
  assert.deepEqual(r, { assigned: false, message: 'Nenhuma fila ativa encontrada' });
});

test('CTE: source default api e corte em 200 chars (contrato do legado)', async () => {
  const { db, state } = makeDb();
  const long = 'x'.repeat(250);
  await assignLeadToUser({ leadId: 'L1' }, { db }); // sem source
  await assignLeadToUser({ leadId: 'L2', source: long }, { db });
  assert.equal(state.assignments[0].source, 'api');
  assert.equal(state.assignments[1].source.length, 200);
});

test('CTE: sem leadId cria atribuição com leadId null — múltiplos NULL válidos', async () => {
  const { db, state } = makeDb();
  await assignLeadToUser({}, { db });
  await assignLeadToUser({}, { db });
  assert.equal(state.assignments.length, 2);
  assert.equal(state.assignments[0].leadId, null);
  assert.equal(state.assignments[1].leadId, null);
  assert.equal(state.queues.get('q1')!.currentIdx, 2, 'NULLs não conflitam no UNIQUE');
});

test('CTE: membro com usuário ausente (FK corrompida) é filtrado', async () => {
  const { db } = makeDb({
    queues: [{ id: 'q1', currentIdx: 0, isActive: true, isDefault: true }],
    members: [
      { id: 'm1', queueId: 'q1', userId: 'ghost', order: 0, isActive: true },
      { id: 'm2', queueId: 'q1', userId: 'u2', order: 1, isActive: true },
      { id: 'm3', queueId: 'q1', userId: 'u3', order: 2, isActive: true },
    ],
  });
  const r = await assignLeadToUser({ leadId: 'L1' }, { db });
  assert.equal(r.assigned, true);
  assert.equal(r.userId, 'u2', 'pula o membro fantasma');
});

test('CTE: queueId específico tem prioridade sobre a default', async () => {
  const { db } = makeDb({
    queues: [
      { id: 'q1', currentIdx: 0, isActive: true, isDefault: true },
      { id: 'q2', currentIdx: 0, isActive: true, isDefault: false },
    ],
    members: [
      { id: 'm1', queueId: 'q1', userId: 'u1', order: 0, isActive: true },
      { id: 'm2', queueId: 'q2', userId: 'u2', order: 0, isActive: true },
    ],
  });
  const r = await assignLeadToUser({ leadId: 'L1', queueId: 'q2' }, { db });
  assert.equal(r.queueId, 'q2');
  assert.equal(r.userId, 'u2');
});

// ── Concorrência (prompt: 20 chamadas simultâneas) ──────────────

test('CONCORRÊNCIA: 20 chamadas simultâneas do MESMO lead → 1 linha, mesmo usuário, fila +1', async () => {
  const { db, state, knobs } = makeDb();
  knobs.cteDelayMs = 2; // interleave real entre as chamadas

  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) => assignLeadToUser({ leadId: 'L-race', source: `src-${i}` }, { db }))
  );

  assert.equal(state.assignments.length, 1, 'UNIQUE(leadId): exatamente 1 atribuição');
  assert.equal(state.queues.get('q1')!.currentIdx, 1, 'fila avança exatamente UMA vez');
  for (const r of results) {
    assert.equal(r.assigned, true);
    assert.equal(r.userId, results[0].userId, 'todos recebem o MESMO dono');
  }
});

test('CONCORRÊNCIA: 20 leads distintos simultâneos → 20 linhas, fila +20, cada lead 1 linha', async () => {
  const { db, state, knobs } = makeDb();
  knobs.cteDelayMs = 2;

  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) => assignLeadToUser({ leadId: `L-${i}` }, { db }))
  );

  assert.equal(results.filter((r) => r.assigned).length, 20);
  assert.equal(state.assignments.length, 20, 'nenhuma atribuição perdida/duplicada');
  const leads = new Set(state.assignments.map((a) => a.leadId));
  assert.equal(leads.size, 20, 'cada lead exatamente 1 linha');
  assert.equal(state.queues.get('q1')!.currentIdx, 20, 'round-robin avança 1 por lead');
  // distribuição entre os 3 membros sem fome
  const byUser = new Map<string, number>();
  for (const a of state.assignments) byUser.set(a.userId, (byUser.get(a.userId) ?? 0) + 1);
  assert.equal(byUser.size, 3, 'todos os membros recebem leads');
});

// ── Falhas entre etapas (atomicidade + degradação) ──────────────

test('FALHA ANTES da mutação: degrada para o legado e atribui normalmente', async () => {
  const { db, state, knobs } = makeDb();
  knobs.failQueryRaw = () => new Error('no unique or exclusion constraint (migration pendente)');

  const r = await assignLeadToUser({ leadId: 'L1' }, { db });
  assert.equal(r.assigned, true, 'legado assume e atribui');
  assert.equal(state.assignments.length, 1);
  assert.equal(state.queues.get('q1')!.currentIdx, 1);
});

test('CRASH PÓS-MUTAÇÃO (statement commitado, resposta perdida): P2002 no legado vira replay', async () => {
  const { db, state, knobs } = makeDb();
  knobs.crashAfterMutation = true;

  const r = await assignLeadToUser({ leadId: 'L1' }, { db });
  // A CTE commitou (fila +1, 1 linha); o legado assume, avança a fila
  // (custo conhecido do fallback) e o create bate no UNIQUE → replay
  // devolve a atribuição existente em vez de propagar erro.
  assert.equal(r.assigned, true);
  assert.equal(r.message, 'already_assigned');
  assert.equal(state.assignments.length, 1, 'nunca duplica');
  assert.equal(state.queues.get('q1')!.currentIdx, 2, 'avanço dupla documentado (custo do legado)');
});

// ── Flag legacy: caminho legado verbatim ────────────────────────

test('FLAG legacy: LEAD_QUEUE_ATOMIC_V2=legacy nunca chama o statement atômico', async () => {
  process.env.LEAD_QUEUE_ATOMIC_V2 = 'legacy';
  const { db, state, knobs } = makeDb();
  const r = await assignLeadToUser({ leadId: 'L1' }, { db });
  assert.equal(r.assigned, true);
  assert.equal(knobs.queryRawCalls, 0, '$queryRaw não é chamado');
  assert.equal(state.assignments.length, 1);
  assert.equal(state.queues.get('q1')!.currentIdx, 1);
});

test('LEGADO: CAS perdido (concorrente avançou o ponteiro) é retentado', async () => {
  process.env.LEAD_QUEUE_ATOMIC_V2 = 'legacy';
  const { db, state } = makeDb();

  // Concorrente avança o ponteiro logo após a leitura da 1ª tentativa
  const q = state.queues.get('q1')!;
  const originalFindUnique = db.leadQueue.findUnique.bind(db.leadQueue);
  let sabotageUsed = false;
  db.leadQueue.findUnique = async (args) => {
    const snap = await originalFindUnique(args);
    if (!sabotageUsed && snap && snap.currentIdx === 0) {
      sabotageUsed = true;
      q.currentIdx = 1; // outro serverless avançou entre leitura e CAS
    }
    return snap;
  };

  const r = await assignLeadToUser({ leadId: 'L1' }, { db });
  assert.equal(r.assigned, true, 'retry do CAS recupera');
  assert.equal(state.assignments.length, 1);
  assert.equal(q.currentIdx, 2, 'avanço do concorrente + avanço do vencedor');
});

test('LEGADO: P2002 no create (corrida com UNIQUE aplicado) → replay, não erro', async () => {
  process.env.LEAD_QUEUE_ATOMIC_V2 = 'legacy';
  const { db, state, knobs } = makeDb();

  // Pré-existe atribuição do L1, mas a Layer-2 falha uma vez (janela de
  // corrida) para o fluxo chegar ao create — que bate no UNIQUE.
  state.assignments.push({
    id: 'a-pre',
    queueId: 'q1',
    userId: 'u2',
    leadId: 'L1',
    source: 'api',
    createdAt: new Date(Date.now() - 1000),
  });
  knobs.hideLayer2Once = true;

  const r = await assignLeadToUser({ leadId: 'L1' }, { db });
  assert.equal(r.assigned, true);
  assert.equal(r.message, 'already_assigned', 'conflito tratado como replay');
  assert.equal(r.userId, 'u2', 'devolve a atribuição EXISTENTE');
  assert.equal(state.assignments.length, 1, 'nenhuma 2ª linha criada');
});

test('CACHE Layer-1: chamada imediata repetida não cria nova linha', async () => {
  const { db, state, knobs } = makeDb();
  const first = await assignLeadToUser({ leadId: 'L1' }, { db });
  const createsAfterFirst = knobs.createCalls;
  const second = await assignLeadToUser({ leadId: 'L1' }, { db });
  assert.equal(second.message, 'already_assigned');
  assert.equal(second.userId, first.userId);
  assert.equal(knobs.createCalls, createsAfterFirst, 'create não é chamado de novo');
  assert.equal(state.assignments.length, 1);
});
