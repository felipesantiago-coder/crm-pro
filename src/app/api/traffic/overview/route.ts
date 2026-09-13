import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import {
  loadTrafficSnapshot,
  isPrismaMissingTableError,
  type TrafficSnapshot,
} from '@/lib/traffic-insights';
import { createTrafficReadDb, listAccountNames } from '@/lib/traffic-defaults';

// ============================================================
// GET /api/traffic/overview — dados do painel "Gestor de Tráfego"
// (Fase 8, estágio A): campanhas com custo × resultado, breakdown de
// conjuntos e saúde da sincronização. Somente ADMIN.
//
// Sem PII por construção (o TrafficReadDb não seleciona dados de
// cliente). Tabelas ausentes (SQL pendente) → 200 com payload vazio
// e flag 'unavailable' — a página mostra o aviso sem quebrar.
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

function emptySnapshot(days: number): TrafficSnapshot {
  return {
    windowDays: days,
    since: new Date(0),
    until: new Date(0),
    aggregates: [],
    accounts: [],
    entityStates: [],
    totals: {
      spend: 0,
      impressions: 0,
      clicks: 0,
      reach: 0,
      leadsMeta: 0,
      cplMedio: null,
      clientes: 0,
      won: 0,
      lost: 0,
      cpaGlobal: null,
      campaigns: 0,
      withSpend: 0,
    },
    counts: { structuredLeads: 0, legacyLeads: 0 },
  };
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

    try {
      const [snapshot, accountNames] = await Promise.all([
        loadTrafficSnapshot(createTrafficReadDb(), days, new Date()),
        listAccountNames(),
      ]);
      return NextResponse.json({
        status: 'ok',
        ...snapshot,
        accounts: snapshot.accounts.map((account) => ({
          ...account,
          name: accountNames.get(account.adAccountId) || account.adAccountId,
        })),
      });
    } catch (error) {
      if (isPrismaMissingTableError(error)) {
        console.warn('[Traffic Overview] Tabelas de tráfego ausentes — aplique o pacote SQL da Fase 8');
        return NextResponse.json({
          status: 'unavailable',
          reason: 'traffic_tables_missing',
          ...emptySnapshot(days),
        });
      }
      throw error;
    }
  } catch (error) {
    console.error('[Traffic Overview] Erro:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
