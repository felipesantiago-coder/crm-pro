import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';

// ============================================================
// GET /api/meta-campaign-bindings
// Lista os vínculos campanha → fila (MetaCampaignBinding), com a
// conta de anúncios e a fila de cada campanha. As bindings são
// auto-registradas quando um lead chega com campaign_id (webhook
// ou polling).
// ============================================================
export async function GET() {
  try {
    await requireAdmin();

    const bindings = await db.metaCampaignBinding.findMany({
      orderBy: [{ lastSeenAt: 'desc' }],
      include: {
        queue: { select: { id: true, name: true, isActive: true } },
        account: { select: { id: true, name: true, adAccountId: true, enabled: true } },
      },
    });

    // leadCount agregado dos mappings de formulário da mesma campanha
    const leadCounts = await db.leadFormMapping.groupBy({
      by: ['campaignId'],
      where: { campaignId: { in: bindings.map((b) => b.campaignId) } },
      _sum: { leadCount: true },
    });
    const countByCampaign = new Map(leadCounts.map((c) => [c.campaignId, c._sum.leadCount || 0]));

    return NextResponse.json(
      bindings.map((b) => ({
        id: b.id,
        campaignId: b.campaignId,
        campaignName: b.campaignName,
        adAccountId: b.adAccountId,
        account: b.account,
        queueId: b.queueId,
        queue: b.queue,
        leadCount: countByCampaign.get(b.campaignId) ?? b.leadCount,
        firstSeenAt: b.firstSeenAt,
        lastSeenAt: b.lastSeenAt,
      }))
    );
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: error.status });
    }
    console.error('[Campaign Bindings] Erro ao listar:', error);
    return NextResponse.json({ error: 'Erro ao listar vínculos de campanhas' }, { status: 500 });
  }
}

// ============================================================
// PATCH /api/meta-campaign-bindings
// Vincula uma campanha a uma fila de atendimento (por campaignId) —
// prioridade máxima no roteamento de leads. Também permite corrigir
// a conta de anúncios da campanha.
// Body: { campaignId: string, campaignName?: string, queueId?: string | null, adAccountId?: string | null }
// ============================================================
export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin();

    const body = await request.json();
    const { campaignId, campaignName, queueId, adAccountId } = body;

    if (!campaignId) {
      return NextResponse.json({ error: 'campaignId é obrigatório' }, { status: 400 });
    }

    // Normaliza: string vazia → null (remove vínculo)
    const nextQueueId = queueId === undefined ? undefined : (queueId || null);
    const nextAdAccountId = adAccountId === undefined ? undefined : (adAccountId || null);

    if (nextQueueId) {
      const queueExists = await db.leadQueue.findUnique({ where: { id: nextQueueId }, select: { id: true } });
      if (!queueExists) {
        return NextResponse.json({ error: 'Fila não encontrada' }, { status: 400 });
      }
    }

    if (nextAdAccountId) {
      const accountExists = await db.metaAdAccount.findUnique({ where: { id: nextAdAccountId }, select: { id: true } });
      if (!accountExists) {
        return NextResponse.json({ error: 'Conta de anúncios não encontrada' }, { status: 400 });
      }
    }

    const existing = await db.metaCampaignBinding.findUnique({ where: { campaignId }, select: { id: true } });

    if (!existing) {
      // Cria a binding (ex.: admin quer vincular fila de uma campanha
      // que ainda não recebeu leads — informando o nome manualmente)
      const created = await db.metaCampaignBinding.create({
        data: {
          campaignId,
          campaignName: campaignName || null,
          queueId: nextQueueId ?? null,
          adAccountId: nextAdAccountId ?? null,
        },
      });
      return NextResponse.json({ id: created.id, created: true, queueId: created.queueId });
    }

    const updateData: { queueId?: string | null; adAccountId?: string | null; campaignName?: string } = {};
    if (nextQueueId !== undefined) updateData.queueId = nextQueueId;
    if (nextAdAccountId !== undefined) updateData.adAccountId = nextAdAccountId;
    if (campaignName) updateData.campaignName = campaignName;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'Nada para atualizar (informe queueId e/ou adAccountId)' }, { status: 400 });
    }

    await db.metaCampaignBinding.update({
      where: { campaignId },
      data: updateData,
    });

    return NextResponse.json({ updated: 1 });
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: error.status });
    }
    console.error('[Campaign Bindings] Erro ao atualizar:', error);
    return NextResponse.json({ error: 'Erro ao atualizar vínculo de campanha' }, { status: 500 });
  }
}
