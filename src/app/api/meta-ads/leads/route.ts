import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';
import { Prisma } from '@prisma/client';

// ============================================================
// Source filters
// ============================================================
type LeadSource = 'all' | 'meta_webhook' | 'landing_form' | 'whatsapp_click';

const META_WEBHOOK_FILTER: Prisma.ClientWhereInput = {
  OR: [
    { notes: { contains: '[Meta Ads]' } },
    { interactions: { some: { description: { contains: '[Meta Ads]' } } } },
  ],
};

const LANDING_FORM_FILTER: Prisma.ClientWhereInput = {
  OR: [
    { notes: { contains: '[Landing Page]' } },
    { interactions: { some: { description: { contains: '[Landing Page]' } } } },
  ],
};

const ALL_CLIENTS_FILTER: Prisma.ClientWhereInput = {
  OR: [META_WEBHOOK_FILTER, LANDING_FORM_FILTER],
};

function getClientFilter(source: LeadSource): Prisma.ClientWhereInput | null {
  switch (source) {
    case 'meta_webhook': return META_WEBHOOK_FILTER;
    case 'landing_form': return LANDING_FORM_FILTER;
    case 'all': return ALL_CLIENTS_FILTER;
    default: return null;
  }
}

/** Detect source from client notes */
function detectClientSource(notes: string | null): 'meta_webhook' | 'landing_form' {
  if (!notes) return 'landing_form';
  if (notes.includes('[Meta Ads]')) return 'meta_webhook';
  return 'landing_form';
}

// ============================================================
// WhatsApp click query (from TrackingEvent)
// ============================================================
interface WhatsAppLead {
  id: string;
  leadSource: 'whatsapp_click';
  name: null;
  phone: null;
  email: null;
  region: string | null;
  stage: null;
  notes: null;
  createdAt: string;
  lastInteractionAt: null;
  enterprise: string | null;
  adName: null;
  campaignName: string | null;
  formName: null;
  leadId: null;
  slug: string | null;
  whatsappSource: string | null;
  _count: { interactions: 0 };
}

async function getWhatsAppClickLeads(
  page: number,
  limit: number,
  since: Date,
  search: string,
) {
  const where: Prisma.TrackingEventWhereInput = {
    eventType: 'custom',
    eventName: 'whatsapp_click',
    createdAt: { gte: since },
  };

  // Search on UTM campaign or enterprise name in metadata
  if (search) {
    where.OR = [
      { utmCampaign: { contains: search, mode: 'insensitive' } },
      { utmSource: { contains: search, mode: 'insensitive' } },
      { siteId: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [events, total] = await Promise.all([
    db.trackingEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { visitor: { select: { country: true, city: true } } },
    }),
    db.trackingEvent.count({ where }),
  ]);

  const leads: WhatsAppLead[] = events.map((e) => {
    const meta = (e.metadata || {}) as Record<string, unknown>;
    return {
      id: e.id,
      leadSource: 'whatsapp_click',
      name: null,
      phone: null,
      email: null,
      region: e.visitor?.city || null,
      stage: null,
      notes: null,
      createdAt: e.createdAt.toISOString(),
      lastInteractionAt: null,
      enterprise: (meta.enterprise as string) || null,
      adName: null,
      campaignName: e.utmCampaign || null,
      formName: null,
      leadId: null,
      slug: e.siteId || null,
      whatsappSource: (meta.source as string) || null,
      _count: { interactions: 0 },
    };
  });

  return { leads, total };
}

// ============================================================
// Main GET handler
// ============================================================
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
    const source = (searchParams.get('source') || 'all') as LeadSource;

    const daysAgo = parseInt(period, 10) || 30;
    const since = new Date();
    since.setDate(since.getDate() - daysAgo);

    // ─────────────────────────────────────────
    // WhatsApp clicks — separate path (no Client record)
    // ─────────────────────────────────────────
    if (source === 'whatsapp_click') {
      const { leads, total } = await getWhatsAppClickLeads(page, limit, since, search);
      return NextResponse.json({
        metrics: null,
        chartData: [],
        leads,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        topCampaigns: [],
        topRegions: [],
        sourceCounts: null,
      });
    }

    // ─────────────────────────────────────────
    // Client-based sources (meta_webhook, landing_form, all)
    // ─────────────────────────────────────────
    const baseFilter = getClientFilter(source);
    if (!baseFilter) {
      return NextResponse.json({ error: 'Fonte inválida' }, { status: 400 });
    }

    // 1. Stage counts (for metrics)
    const stageCounts = await db.client.groupBy({
      by: ['stage'],
      where: baseFilter,
      _count: true,
    });
    const stageMap: Record<string, number> = {};
    for (const sc of stageCounts) stageMap[sc.stage] = sc._count;

    // 2. Leads by day
    const dailyLeads = await db.client.groupBy({
      by: ['createdAt'],
      where: { AND: [baseFilter, { createdAt: { gte: since } }] },
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

    // 3. Metrics
    const totalLeads = Object.values(stageMap).reduce((a, b) => a + b, 0);
    const convertedLeads = (stageMap['NEGOCIACAO'] || 0) + (stageMap['PROPOSTA'] || 0) + (stageMap['FECHADO'] || 0);
    const conversionRate = totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(1) : '0.0';
    const periodLeads = chartData.reduce((a, b) => a + b.count, 0);

    // 4. Paginated lead list
    const conditions: Prisma.ClientWhereInput[] = [baseFilter];
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
    const whereClause: Prisma.ClientWhereInput = conditions.length > 1 ? { AND: conditions } : baseFilter;

    const [clients, totalFiltered] = await Promise.all([
      db.client.findMany({
        where: whereClause,
        select: {
          id: true, name: true, phone: true, email: true, region: true,
          stage: true, notes: true, createdAt: true, lastInteractionAt: true,
          enterprise: true, utmSource: true, utmCampaign: true,
          _count: { select: { interactions: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.client.count({ where: whereClause }),
    ]);

    // Enrich with campaign/ad data and detect source
    const enrichedClients = clients.map((c) => {
      let adName = '';
      let campaignName = '';
      let formName = '';
      let leadId = '';
      let slug = '';

      if (c.notes) {
        if (c.notes.includes('[Meta Ads]')) {
          const adMatch = c.notes.match(/Anúncio:\s*(.+)/);
          if (adMatch) adName = adMatch[1].trim();
          const campaignMatch = c.notes.match(/Campanha:\s*(.+)/);
          if (campaignMatch) campaignName = campaignMatch[1].trim();
          const formMatch = c.notes.match(/Formulário:\s*(.+)/);
          if (formMatch) formName = formMatch[1].trim();
          const leadMatch = c.notes.match(/Lead ID:\s*(\S+)/);
          if (leadMatch) leadId = leadMatch[1].trim();
        } else {
          const slugMatch = c.notes.match(/Slug:\s*(\S+)/);
          if (slugMatch) slug = slugMatch[1].trim();
          const campaignMatch = c.notes.match(/Campanha:\s*(.+)/);
          if (campaignMatch) campaignName = campaignMatch[1].trim();
        }
      }

      return {
        ...c,
        leadSource: detectClientSource(c.notes),
        adName,
        campaignName,
        formName,
        leadId,
        slug,
      };
    });

    // 5. Top campaigns
    const allFilteredClients = await db.client.findMany({
      where: baseFilter,
      select: { notes: true, utmCampaign: true },
    });
    const campaignCounts: Record<string, number> = {};
    for (const c of allFilteredClients) {
      let campaignName = '';
      if (c.notes) {
        const m = c.notes.match(/Campanha:\s*(.+)/);
        if (m) campaignName = m[1].trim();
      }
      if (!campaignName && c.utmCampaign) campaignName = c.utmCampaign;
      if (campaignName) campaignCounts[campaignName] = (campaignCounts[campaignName] || 0) + 1;
    }
    const topCampaigns = Object.entries(campaignCounts)
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    // 6. Regions
    const regionCounts = await db.client.groupBy({
      by: ['region'],
      where: { AND: [baseFilter, { region: { not: null } }] },
      _count: true,
      orderBy: { _count: { id: 'desc' } },
    });
    const topRegions = regionCounts
      .filter((r) => r.region)
      .slice(0, 8)
      .map((r) => ({ region: r.region!, count: r._count }));

    // 7. Source counts (for filter badges)
    const [metaCount, landingCount, whatsappCount] = await Promise.all([
      db.client.count({ where: { AND: [META_WEBHOOK_FILTER, { createdAt: { gte: since } }] } }),
      db.client.count({ where: { AND: [LANDING_FORM_FILTER, { createdAt: { gte: since } }] } }),
      db.trackingEvent.count({
        where: {
          eventType: 'custom',
          eventName: 'whatsapp_click',
          createdAt: { gte: since },
        },
      }),
    ]);

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
      sourceCounts: {
        meta_webhook: metaCount,
        landing_form: landingCount,
        whatsapp_click: whatsappCount,
      },
    });
  } catch (error) {
    console.error('[Meta Ads Leads] Erro:', error);
    return NextResponse.json({ error: 'Erro ao buscar leads' }, { status: 500 });
  }
}
