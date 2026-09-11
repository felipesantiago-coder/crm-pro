import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { drainInbox } from '@/lib/meta-ingest/inbox';
import { resolveDrainAccountById, resolveDrainPageToken, createMetaIngestServices } from '@/lib/meta-ingest/defaults';

// maxDuration 60s (Pro): lotes PEQUENOS por design — o consumo é
// incremental e idempotente; aumentar o lote não aumenta o custo
// (itens extras ficam para a próxima invocação). Limite documentado
// em docs/vercel-optimization.md §Fase 3.
export const maxDuration = 60;

// ============================================================
// GET/POST /api/cron/meta-inbox-drain — worker de consumo da inbox
//
// Fase 3 (prompt): "Se o plano atual não possuir worker, use uma
// tabela de jobs e um endpoint autenticado de consumo em lotes
// pequenos; documente o limite de duração."
//
// Processa itens RECEIVED/RETRYABLE com nextAttemptAt vencido em
// lote pequeno (default 10, máx 25), com CAS por item (claim) —
// seguro contra polling/webhook/endpoint processando o mesmo lead
// simultaneamente. Itens não processados (orçamento) permanecem na
// inbox para a próxima invocação — nenhum lead é perdido.
//
// Autenticação (qualquer UMA das formas):
//   - Sessão NextAuth com role ADMIN
//   - Header Authorization: Bearer <CRON_SECRET>
//   - Query param ?secret=<CRON_SECRET> (cron-job.org a cada 1–5 min)
// ============================================================

const DEFAULT_BATCH = 10;
const MAX_BATCH = 25;
// Orçamento de tempo do worker dentro da invocação (margem p/ response)
const DRAIN_BUDGET_MS = 50_000;

async function authenticate(request: NextRequest): Promise<boolean> {
  // 1. Admin autenticado via sessão
  try {
    const session = await getServerSession(authOptions);
    if (session?.user?.role === 'ADMIN') return true;
  } catch {}

  // 2. Cron/externo via CRON_SECRET
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${cronSecret}`) return true;

  const querySecret = new URL(request.url).searchParams.get('secret');
  if (querySecret === cronSecret) return true;

  return false;
}

async function resolveCreatorId(): Promise<string | undefined> {
  const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
  if (admin?.id) return admin.id;
  const any = await db.user.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } });
  return any?.id;
}

async function handle(request: NextRequest) {
  if (!(await authenticate(request))) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const url = new URL(request.url);
  const requested = parseInt(url.searchParams.get('limit') || '', 10);
  const limit = Number.isFinite(requested) && requested > 0
    ? Math.min(requested, MAX_BATCH)
    : DEFAULT_BATCH;

  const services = createMetaIngestServices(db);
  const creatorId = await resolveCreatorId();

  try {
    const results = await drainInbox(
      db,
      services,
      {
        limit,
        budgetMs: DRAIN_BUDGET_MS,
        concurrency: 4,
        creatorId,
        accountResolver: resolveDrainAccountById,
      },
      resolveDrainPageToken,
    );

    const summary = {
      processed: results.filter((r) => r.outcome).length,
      succeeded: results.filter((r) => r.outcome?.imported).length,
      deduped: results.filter((r) => r.outcome && !r.outcome.imported).length,
      retryable: results.filter((r) => r.deferredAs === 'retryable').length,
      failed: results.filter((r) => r.deferredAs === 'failed').length,
      deferred: results.filter((r) => r.deferredAs === 'deferred' || r.deferredAs === 'quota_exhausted').length,
      claimLost: results.filter((r) => r.deferredAs === 'claim_lost').length,
    };

    return NextResponse.json({ status: 'ok', batch: limit, ...summary });
  } catch (error) {
    // Tabela ausente (migration pendente) ou indisponibilidade: 200
    // com status 'unavailable' — o agendador não trata como falha.
    console.error('[Meta Inbox Drain] indisponível:', error instanceof Error ? error.message : error);
    return NextResponse.json({ status: 'unavailable', error: 'inbox_unavailable' });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
