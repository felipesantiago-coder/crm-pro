import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';
import { Prisma } from '@prisma/client';

/** Filtro base: clientes originados do Meta Ads */
const metaAdsFilter: Prisma.ClientWhereInput = {
  OR: [
    { notes: { contains: '[Meta Ads]' } },
    {
      interactions: {
        some: {
          description: { contains: '[Meta Ads]' },
        },
      },
    },
  ],
};

/**
 * API de Leads do Meta Ads
 * Retorna leads originados do Meta com métricas agregadas e dados para o painel.
 */
export async function GET(request: Request) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const search = searchParams.get('search') || '';
    const stageFilter = searchParams.get('stage') || '';
    const period = searchParams.get('period') || '30';

    const daysAgo = parseInt(period, 10) || 30;
    const since = new Date();
    since.setDate(since.getDate() - daysAgo);

    // ─────────────────────────────────────────
    // 1. Contar totais por estágio
    // ─────────────────────────────────────────
    const stageCounts = await db.client.groupBy({
      by: ['stage'],
      where: metaAdsFilter,
      _count: true,
    });

    const stageMap: Record<string, number> = {};
    for (const sc of stageCounts) {
      stageMap[sc.stage] = sc._count;
    }

    // ─────────────────────────────────────────
    // 2. Leads por dia (últimos N dias)
    // ─────────────────────────────────────────
    const dailyLeads = await db.client.groupBy({
      by: ['createdAt'],
      where: {
        AND: [
          metaAdsFilter,
          { createdAt: { gte: since } },
        ],
      },
      _count: true,
      orderBy: { createdAt: 'asc' },
    });

    const leadsByDay: Record<string, number> = {};
    for (const dl of dailyLeads) {
      const day = dl.createdAt.toISOString().split('T')[0];
      leadsByDay[day] = (leadsByDay[day] || 0) + 1;
    }

    const chartData: Array<{ date: string; count: number }> = [];
    const today = new Date();
    for (let i = daysAgo - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      chartData.push({ date: key, count: leadsByDay[key] || 0 });
    }

    // ─────────────────────────────────────────
    // 3. Métricas gerais
    // ─────────────────────────────────────────
    const totalLeads = Object.values(stageMap).reduce((a, b) => a + b, 0);
    const convertedLeads = (stageMap['NEGOCIACAO'] || 0) + (stageMap['PROPOSTA'] || 0) + (stageMap['FECHADO'] || 0);
    const conversionRate = totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(1) : '0.0';
    const periodLeads = chartData.reduce((a, b) => a + b.count, 0);

    // ─────────────────────────────────────────
    // 4. Listagem paginada de leads
    // ─────────────────────────────────────────
    const conditions: Prisma.ClientWhereInput[] = [metaAdsFilter];

    if (search) {
      conditions.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
        ],
      });
    }

    if (stageFilter && stageFilter !== 'all') {
      conditions.push({ stage: stageFilter });
    }

    const whereClause: Prisma.ClientWhereInput = conditions.length > 1
      ? { AND: conditions }
      : metaAdsFilter;

    const [clients, totalFiltered] = await Promise.all([
      db.client.findMany({
        where: whereClause,
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          region: true,
          stage: true,
          notes: true,
          createdAt: true,
          lastInteractionAt: true,
          enterprise: true,
          _count: { select: { interactions: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.client.count({ where: whereClause }),
    ]);

    // Extrair dados de campanha/anúncio das notas
    const enrichedClients = clients.map((c) => {
      let adName = 'Desconhecido';
      let campaignName = '';
      let formName = '';
      let leadId = '';

      if (c.notes) {
        const adMatch = c.notes.match(/Anúncio:\s*(.+)/);
        if (adMatch) adName = adMatch[1].trim();

        const campaignMatch = c.notes.match(/Campanha:\s*(.+)/);
        if (campaignMatch) campaignName = campaignMatch[1].trim();

        const formMatch = c.notes.match(/Formulário:\s*(.+)/);
        if (formMatch) formName = formMatch[1].trim();

        const leadMatch = c.notes.match(/Lead ID:\s*(\S+)/);
        if (leadMatch) leadId = leadMatch[1].trim();
      }

      return { ...c, adName, campaignName, formName, leadId };
    });

    // ─────────────────────────────────────────
    // 5. Top campanhas
    // ─────────────────────────────────────────
    const allMetaClients = await db.client.findMany({
      where: metaAdsFilter,
      select: { notes: true },
    });

    const campaignCounts: Record<string, number> = {};
    for (const c of allMetaClients) {
      if (c.notes) {
        const campaignMatch = c.notes.match(/Campanha:\s*(.+)/);
        if (campaignMatch) {
          const name = campaignMatch[1].trim();
          campaignCounts[name] = (campaignCounts[name] || 0) + 1;
        }
      }
    }

    const topCampaigns = Object.entries(campaignCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    // ─────────────────────────────────────────
    // 6. Regiões dos leads
    // ─────────────────────────────────────────
    const regionCounts = await db.client.groupBy({
      by: ['region'],
      where: {
        AND: [
          metaAdsFilter,
          { region: { not: null } },
        ],
      },
      _count: true,
      orderBy: { _count: { id: 'desc' } },
    });

    const topRegions = regionCounts
      .filter((r) => r.region)
      .slice(0, 8)
      .map((r) => ({ region: r.region!, count: r._count }));

    return NextResponse.json({
      metrics: {
        totalLeads,
        periodLeads,
        convertedLeads,
        conversionRate: parseFloat(conversionRate),
        byStage: stageMap,
      },
      chartData,
      leads: enrichedClients,
      pagination: {
        page,
        limit,
        total: totalFiltered,
        totalPages: Math.ceil(totalFiltered / limit),
      },
      topCampaigns,
      topRegions,
    });
  } catch (error) {
    console.error('[Meta Ads Leads] Erro:', error);
    return NextResponse.json({ error: 'Erro ao buscar leads do Meta Ads' }, { status: 500 });
  }
}