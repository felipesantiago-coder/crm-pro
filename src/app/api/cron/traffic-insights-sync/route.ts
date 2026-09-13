import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { syncTrafficInsights, isPrismaMissingTableError } from '@/lib/traffic-insights';
import { createTrafficSyncDeps } from '@/lib/traffic-defaults';

// maxDuration 60s (Pro): 2 requisições de insights por conta com paging
// (teto MAX_PAGES=10) — contas são processadas em série para respeitar
// rate limit da Marketing API.
export const maxDuration = 60;

// ============================================================
// GET/POST /api/cron/traffic-insights-sync — sincroniza insights
// diários (custo/performance) da Marketing API por conta habilitada.
//
// Fase 8 (gestor de tráfego, estágio A). Snapshot-replace por janela:
// re-sincronizar SOBRESCREVE os dias da janela (a Meta retrocorrige
// atribuição). Recomendação: 1×/dia no cron-job.org.
//
// Fase 8.2: também sincroniza o estado de entrega/orçamento
// (/campaigns + /adsets — daily_budget, effective_status,
// learning_stage_info). Flag de rollback: TRAFFIC_ENTITY_STATE_V2=legacy
// desliga APENAS essa coleta (insights seguem normais).
//
// Autenticação (qualquer UMA das formas — padrão meta-inbox-drain):
//   - Sessão NextAuth com role ADMIN (botão "Sincronizar" do painel)
//   - Header Authorization: Bearer <CRON_SECRET>
//   - Query param ?secret=<CRON_SECRET>
//
// Params: ?days=N (default 7, clamp 1..60)
// ============================================================

const DEFAULT_DAYS = 7;
const MAX_DAYS = 60;

async function authenticate(request: NextRequest): Promise<boolean> {
  try {
    const session = await getServerSession(authOptions);
    if (session?.user?.role === 'ADMIN') return true;
  } catch {}

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${cronSecret}`) return true;

  const querySecret = new URL(request.url).searchParams.get('secret');
  if (querySecret === cronSecret) return true;

  return false;
}

function parseDays(request: NextRequest): number {
  const requested = parseInt(new URL(request.url).searchParams.get('days') || '', 10);
  if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_DAYS;
  return Math.min(requested, MAX_DAYS);
}

async function handle(request: NextRequest) {
  if (!(await authenticate(request))) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const days = parseDays(request);
  // Fase 8.2: coleta de estado de entrega/orçamento — rollback granular
  // por env (TRAFFIC_ENTITY_STATE_V2=legacy → só insights).
  const includeEntityState = process.env.TRAFFIC_ENTITY_STATE_V2 !== 'legacy';

  try {
    const summary = await syncTrafficInsights(createTrafficSyncDeps(), { days, includeEntityState });
    return NextResponse.json(summary);
  } catch (error) {
    // Tabelas ausentes (SQL da Fase 8 pendente) ou indisponibilidade:
    // 200 com status 'unavailable' — o agendador não trata como falha
    // e o restante do CRM segue intacto (padrão meta-inbox-drain).
    if (isPrismaMissingTableError(error)) {
      console.warn('[Traffic Sync] Tabelas de insights ausentes — aplique o pacote SQL da Fase 8');
      return NextResponse.json({ status: 'unavailable', reason: 'traffic_tables_missing', days });
    }
    console.error('[Traffic Sync] indisponível:', error instanceof Error ? error.message : error);
    return NextResponse.json({ status: 'unavailable', reason: 'traffic_sync_unavailable', days });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
