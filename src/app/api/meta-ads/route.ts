import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const STAGES = [
  'LEAD', 'PROSPECT', 'VISITA_AGENDADA', 'VISITA_REALIZADA',
  'CARTA_PROPOSTA', 'CONTRATO_GERADO', 'FECHADO_GANHO', 'FECHADO_PERDIDO',
] as const;

/**
 * Extrai dados estruturados de um texto de nota do Meta Ads.
 * Formato esperado no notes:
 *   [Meta Ads] Lead recebido automaticamente.
 *   Anúncio: nome do anúncio
 *   Campanha: nome da campanha
 *   Formulário: nome do formulário
 *   Lead ID: xxx
 */
function parseMetaNote(notes: string | null): {
  adName: string;
  campaignName: string;
  formName: string;
  leadId: string;
  isMetaLead: boolean;
} {
  if (!notes || !notes.includes('[Meta Ads]')) {
    return { adName: '', campaignName: '', formName: '', leadId: '', isMetaLead: false };
  }

  const adMatch = notes.match(/Anúncio:\s*(.+)/i);
  const campaignMatch = notes.match(/Campanha:\s*(.+)/i);
  const formMatch = notes.match(/Formulário:\s*(.+)/i);
  const leadIdMatch = notes.match(/Lead ID:\s*(\S+)/i);

  return {
    adName: adMatch?.[1]?.trim() || 'Anúncio não identificado',
    campaignName: campaignMatch?.[1]?.trim() || 'Campanha não identificada',
    formName: formMatch?.[1]?.trim() || '',
    leadId: leadIdMatch?.[1]?.trim() || '',
    isMetaLead: true,
  };
}

export async function GET() {
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

    const now = new Date();

    // 1. Buscar todos os clientes originados do Meta Ads
    const metaClients = await db.client.findMany({
      where: {
        notes: { contains: '[Meta Ads]' },
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        region: true,
        stage: true,
        enterprise: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
        lastInteractionAt: true,
        interactions: {
          select: { id: true, createdAt: true, description: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 2. Extrair dados estruturados de cada lead
    const parsedLeads = metaClients.map((c) => {
      const parsed = parseMetaNote(c.notes);
      return {
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        region: c.region,
        stage: c.stage,
        enterprise: c.enterprise,
        adName: parsed.adName,
        campaignName: parsed.campaignName,
        formName: parsed.formName,
        leadId: parsed.leadId,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        lastInteractionAt: c.lastInteractionAt,
      };
    });

    // 3. KPIs gerais
    const totalLeads = parsedLeads.length;

    // Leads este mês
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const leadsThisMonth = parsedLeads.filter(
      (l) => new Date(l.createdAt) >= monthStart
    ).length;

    // Leads hoje
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const leadsToday = parsedLeads.filter(
      (l) => new Date(l.createdAt) >= todayStart
    ).length;

    // Distribuição por estágio
    const stageBreakdown = STAGES.map((stage) => ({
      stage,
      count: parsedLeads.filter((l) => l.stage === stage).length,
    }));

    // Conversão: LEAD → FECHADO_GANHO
    const wonLeads = parsedLeads.filter((l) => l.stage === 'FECHADO_GANHO').length;
    const lostLeads = parsedLeads.filter((l) => l.stage === 'FECHADO_PERDIDO').length;
    const conversionRate = totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 100) : 0;
    const winRate = wonLeads + lostLeads > 0 ? Math.round((wonLeads / (wonLeads + lostLeads)) * 100) : 0;

    // 4. Quebra por campanha
    const campaignMap = new Map<string, { count: number; won: number; lost: number; leads: typeof parsedLeads }>();
    for (const lead of parsedLeads) {
      const key = lead.campaignName || 'Sem campanha';
      if (!campaignMap.has(key)) {
        campaignMap.set(key, { count: 0, won: 0, lost: 0, leads: [] });
      }
      const entry = campaignMap.get(key)!;
      entry.count++;
      entry.leads.push(lead);
      if (lead.stage === 'FECHADO_GANHO') entry.won++;
      if (lead.stage === 'FECHADO_PERDIDO') entry.lost++;
    }

    const campaigns = Array.from(campaignMap.entries())
      .map(([name, data]) => ({
        name,
        totalLeads: data.count,
        won: data.won,
        lost: data.lost,
        conversionRate: data.count > 0 ? Math.round((data.won / data.count) * 100) : 0,
        winRate: data.won + data.lost > 0 ? Math.round((data.won / (data.won + data.lost)) * 100) : 0,
      }))
      .sort((a, b) => b.totalLeads - a.totalLeads);

    // 5. Quebra por anúncio
    const adMap = new Map<string, { count: number; won: number; campaignName: string }>();
    for (const lead of parsedLeads) {
      const key = lead.adName || 'Anúncio não identificado';
      if (!adMap.has(key)) {
        adMap.set(key, { count: 0, won: 0, campaignName: lead.campaignName });
      }
      const entry = adMap.get(key)!;
      entry.count++;
      if (lead.stage === 'FECHADO_GANHO') entry.won++;
    }

    const ads = Array.from(adMap.entries())
      .map(([name, data]) => ({
        name,
        campaignName: data.campaignName,
        totalLeads: data.count,
        won: data.won,
        conversionRate: data.count > 0 ? Math.round((data.won / data.count) * 100) : 0,
      }))
      .sort((a, b) => b.totalLeads - a.totalLeads);

    // 6. Tendência mensal (últimos 6 meses)
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyData = parsedLeads
      .filter((l) => new Date(l.createdAt) >= sixMonthsAgo)
      .reduce((acc, lead) => {
        const d = new Date(lead.createdAt);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!acc.has(key)) acc.set(key, { total: 0, won: 0 });
        const entry = acc.get(key)!;
        entry.total++;
        if (lead.stage === 'FECHADO_GANHO') entry.won++;
        return acc;
      }, new Map<string, { total: number; won: number }>());

    const monthlyTrend = Array.from(monthlyData.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month,
        leads: data.total,
        conversions: data.won,
      }));

    // 7. Regiões
    const regionMap = new Map<string, number>();
    for (const lead of parsedLeads) {
      if (lead.region) {
        regionMap.set(lead.region, (regionMap.get(lead.region) || 0) + 1);
      }
    }
    const regions = Array.from(regionMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // 8. Status do webhook
    const webhookSettings = await db.userSettings.findMany({
      where: {
        key: {
          in: ['meta_webhook_enabled', 'meta_webhook_verify_token', 'meta_app_secret', 'meta_page_access_token', 'meta_lead_count'],
        },
      },
    });
    const settingsMap: Record<string, string> = {};
    webhookSettings.forEach((s) => { settingsMap[s.key] = s.value; });

    const webhookConfig = {
      enabled: settingsMap['meta_webhook_enabled'] === 'true',
      hasVerifyToken: !!settingsMap['meta_webhook_verify_token'],
      hasAppSecret: !!settingsMap['meta_app_secret'],
      hasPageAccessToken: !!settingsMap['meta_page_access_token'],
      totalLeadCount: parseInt(settingsMap['meta_lead_count'] || '0', 10),
    };

    // 9. Tempo médio de conversão (LEAD → FECHADO_GANHO) em dias
    const convertedLeads = parsedLeads.filter(
      (l) => l.stage === 'FECHADO_GANHO' || l.stage === 'FECHADO_PERDIDO'
    );
    let avgConversionDays: number | null = null;
    if (convertedLeads.length > 0) {
      const totalDays = convertedLeads.reduce((sum, l) => {
        const created = new Date(l.createdAt).getTime();
        const updated = new Date(l.updatedAt).getTime();
        return sum + Math.max(0, Math.round((updated - created) / 86400000));
      }, 0);
      avgConversionDays = Math.round(totalDays / convertedLeads.length);
    }

    return NextResponse.json({
      kpis: {
        totalLeads,
        leadsThisMonth,
        leadsToday,
        conversionRate,
        winRate,
        wonLeads,
        lostLeads,
        avgConversionDays,
      },
      stageBreakdown,
      campaigns,
      ads,
      monthlyTrend,
      regions,
      webhookConfig,
      leads: parsedLeads,
    });
  } catch (error) {
    console.error('[META ADS] Erro ao buscar dados:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}