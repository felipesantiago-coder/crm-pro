import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { fetchDatasetQuality } from '@/lib/meta-dataset-quality';

// ============================================================
// GET /api/meta-capi-configs/[id]/quality
// Métricas REAIS de qualidade do dataset na Meta (Dataset Quality API):
// EMQ (0-10) por evento, cobertura de match keys, event coverage e
// diagnostics — diferente do "teste raio", que só confirma recebimento
// de um evento sintético.
// ============================================================
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error: authError } = await requireAdmin();
    if (authError) return authError;
    const { id } = await params;

    const config = await db.metaCapConfig.findUnique({ where: { id } });
    if (!config) {
      return NextResponse.json({ error: 'Configuração não encontrada' }, { status: 404 });
    }

    const result = await fetchDatasetQuality(config.accessToken, config.datasetId);

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.tokenInvalid
            ? 'Access Token inválido ou expirado — gere um novo token do dataset/system user na Meta.'
            : result.error,
          tokenInvalid: result.tokenInvalid || false,
        },
        { status: result.tokenInvalid ? 401 : 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      configId: config.id,
      configName: config.name,
      datasetId: config.datasetId,
      fetchedAt: new Date().toISOString(),
      events: result.parsed?.events ?? [],
      empty: result.empty || false,
      hint: result.empty
        ? 'A Meta ainda não calculou métricas de qualidade para este dataset. Isso é normal em datasets novos ou com poucos envios — as métricas aparecem 24-48h após tráfego real.'
        : null,
    });
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: error.status });
    }
    console.error('[CAPI Quality] Erro ao consultar Dataset Quality API:', error);
    return NextResponse.json(
      { error: 'Erro ao consultar qualidade do dataset na Meta' },
      { status: 500 }
    );
  }
}
