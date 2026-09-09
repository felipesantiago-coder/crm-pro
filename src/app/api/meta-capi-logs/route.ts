import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';

// ============================================================
// GET /api/meta-capi-logs
// Atividade dos envios reais à Conversions API (auditoria de
// sendLeadConversionEvent). Query params:
//   limit     — 1..200 (default 50)
//   status    — 'sent' | 'failed' | 'skipped' (opcional)
//   configId  — filtra por capiConfigId (opcional)
// Resposta: { logs, stats: { total7d, failed7d, skipped7d, failedByConfig } }
// ============================================================
export async function GET(request: NextRequest) {
  try {
    const { error: authError } = await requireAdmin();
    if (authError) return authError;
    const url = new URL(request.url);
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1),
      200
    );
    const status = url.searchParams.get('status');
    const configId = url.searchParams.get('configId');

    const where: Record<string, unknown> = {};
    if (status && ['sent', 'failed', 'skipped'].includes(status)) {
      where.status = status;
    }
    if (configId) {
      where.capiConfigId = configId;
    }

    const logs = await db.capiEventLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [total7d, failed7d, skipped7d, failedByConfigGrouped] = await Promise.all([
      db.capiEventLog.count({ where: { createdAt: { gte: since7d } } }),
      db.capiEventLog.count({ where: { createdAt: { gte: since7d }, status: 'failed' } }),
      db.capiEventLog.count({ where: { createdAt: { gte: since7d }, status: 'skipped' } }),
      db.capiEventLog.groupBy({
        by: ['capiConfigId'],
        where: { createdAt: { gte: since7d }, status: 'failed' },
        _count: { _all: true },
      }),
    ]);

    const failedByConfig: Record<string, number> = {};
    for (const row of failedByConfigGrouped) {
      if (row.capiConfigId) {
        failedByConfig[row.capiConfigId] = row._count._all;
      }
    }

    return NextResponse.json({
      logs,
      stats: { total7d, failed7d, skipped7d, failedByConfig },
    });
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: error.status });
    }
    console.error('[CAPI Logs] Erro ao buscar atividade de envio:', error);
    return NextResponse.json({ error: 'Erro ao buscar atividade de envio CAPI' }, { status: 500 });
  }
}
