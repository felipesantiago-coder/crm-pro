import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import {
  loadTrafficSnapshot,
  buildTrafficReportMarkdown,
  isPrismaMissingTableError,
  type SyncStateRecord,
  type TrafficReportEntityState,
} from '@/lib/traffic-insights';
import { createTrafficReadDb, listAccountNames } from '@/lib/traffic-defaults';

// ============================================================
// GET /api/traffic/report — relatório markdown SEM PII para análise
// por IA externa (Fase 8, estágio A+B): custo (Marketing API) ×
// resultado real do funil no CRM, com guardrails de decisão embutidos.
// Somente ADMIN.
//
// O relatório contém APENAS agregados (nomes de campanha/conjunto +
// números) — nenhum nome/telefone/e-mail de cliente. Tabelas ausentes
// (SQL pendente) → 200 com relatório explicativo e flag 'unavailable'.
//
// Params: ?days=N (default 30, clamp 7..90)
// ============================================================

const DEFAULT_DAYS = 30;
const MIN_DAYS = 7;
const MAX_DAYS = 90;

function parseDays(request: NextRequest): number {
  const requested = parseInt(new URL(request.url).searchParams.get('days') || '', 10);
  if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_DAYS;
  return Math.min(Math.max(requested, MIN_DAYS), MAX_DAYS);
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const currentUser = await db.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true },
    });

    if (!currentUser) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    if (currentUser.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Acesso restrito a administradores' }, { status: 403 });
    }

    const days = parseDays(request);
    const generatedAt = new Date();

    try {
      const [snapshot, accountNames] = await Promise.all([
        loadTrafficSnapshot(createTrafficReadDb(), days, generatedAt),
        listAccountNames(),
      ]);
      const report = buildTrafficReportMarkdown({
        aggregates: snapshot.aggregates,
        windowDays: snapshot.windowDays,
        generatedAt,
        accounts: snapshot.accounts.map((account: SyncStateRecord) => ({
          name: accountNames.get(account.adAccountId) || account.adAccountId,
          lastStatus: account.lastStatus,
          lastSyncedAt: account.lastSyncedAt,
          lastError: account.lastError,
        })),
        // Fase 8.2: estado de entrega/orçamento com nome de conta resolvido
        entityStates: snapshot.entityStates.map(
          (state): TrafficReportEntityState => ({
            level: state.level,
            entityId: state.entityId,
            entityName: state.entityName,
            accountName: accountNames.get(state.adAccountId) || state.adAccountId,
            dailyBudgetMinor: state.dailyBudgetMinor,
            lifetimeBudgetMinor: state.lifetimeBudgetMinor,
            status: state.status,
            effectiveStatus: state.effectiveStatus,
            learningStage: state.learningStage,
            fetchedAt: state.fetchedAt,
          }),
        ),
        totals: snapshot.totals,
      });
      return NextResponse.json({
        status: 'ok',
        report,
        generatedAt: generatedAt.toISOString(),
        windowDays: snapshot.windowDays,
      });
    } catch (error) {
      if (isPrismaMissingTableError(error)) {
        console.warn('[Traffic Report] Tabelas de tráfego ausentes — aplique o pacote SQL da Fase 8');
        return NextResponse.json({
          status: 'unavailable',
          reason: 'traffic_tables_missing',
          report:
            '# Relatório indisponível\n\nAs tabelas de tráfego ainda não existem no banco. ' +
            'Aplique o pacote SQL da Fase 8 (download/fase8-sql-editor-release.sql) no SQL Editor do Supabase e gere novamente.',
          generatedAt: generatedAt.toISOString(),
          windowDays: days,
        });
      }
      throw error;
    }
  } catch (error) {
    console.error('[Traffic Report] Erro:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
