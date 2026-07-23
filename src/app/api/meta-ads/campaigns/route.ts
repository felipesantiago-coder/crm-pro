import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';
import { getCampaignInsights, toggleCampaignStatus, type MetaCampaignInsight } from '@/lib/meta-ads-service';

// GET — Fetch campaigns with insights from all active ad accounts
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('accountId');
    const days = parseInt(searchParams.get('days') || '30', 10);
    const period = Math.min(Math.max(days, 1), 90);

    // Build query for active accounts
    const whereClause: any = { isActive: true };
    if (accountId) {
      whereClause.id = accountId;
    }

    const accounts = await db.metaAdAccount.findMany({
      where: whereClause,
      select: {
        id: true,
        label: true,
        adAccountId: true,
        accessToken: true,
        lastSyncedAt: true,
      },
    });

    if (accounts.length === 0) {
      return NextResponse.json({
        accounts: [],
        campaigns: [],
        message: accountId
          ? 'Conta não encontrada ou inativa'
          : 'Nenhuma conta de anúncios configurada. Vá na aba "Contas" para adicionar.',
      });
    }

    // Fetch campaigns from each account in parallel
    const results = await Promise.allSettled(
      accounts.map(async (account) => {
        const insights = await getCampaignInsights(
          account.accessToken,
          account.adAccountId,
          period,
        );

        // Update lastSyncedAt
        await db.metaAdAccount.update({
          where: { id: account.id },
          data: { lastSyncedAt: new Date() },
        });

        return {
          accountId: account.id,
          accountLabel: account.label,
          adAccountId: account.adAccountId,
          campaigns: insights,
        };
      }),
    );

    // Aggregate results
    const accountResults: any[] = [];
    const allCampaigns: (MetaCampaignInsight & { accountId: string; accountLabel: string; adAccountId: string })[] = [];

    results.forEach((result, i) => {
      const account = accounts[i];
      if (result.status === 'fulfilled') {
        accountResults.push(result.value);
        result.value.campaigns.forEach((c: MetaCampaignInsight) => {
          allCampaigns.push({
            ...c,
            accountId: account.id,
            accountLabel: account.label,
            adAccountId: account.adAccountId,
          });
        });
      } else {
        accountResults.push({
          accountId: account.id,
          accountLabel: account.label,
          adAccountId: account.adAccountId,
          campaigns: [],
          error: result.reason?.message || 'Erro ao buscar campanhas',
        });
      }
    });

    // Compute totals
    const totals = allCampaigns.reduce(
      (acc, c) => {
        acc.spend += c.spend;
        acc.impressions += c.impressions;
        acc.clicks += c.clicks;
        acc.leads += c.leads;
        acc.reach += c.reach;
        return acc;
      },
      { spend: 0, impressions: 0, clicks: 0, leads: 0, reach: 0 },
    );

    totals.cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
    totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
    totals.costPerLead = totals.leads > 0 ? totals.spend / totals.leads : 0;

    return NextResponse.json({
      accounts: accountResults,
      campaigns: allCampaigns,
      totals,
      period,
    });
  } catch (err) {
    console.error('[META-ADS-CAMPAIGNS] Erro:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// POST — Toggle campaign status (pause/activate)
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await request.json();
    const { accountId, campaignId, activate } = body as {
      accountId: string;
      campaignId: string;
      activate: boolean;
    };

    if (!accountId || !campaignId || typeof activate !== 'boolean') {
      return NextResponse.json(
        { error: 'accountId, campaignId e activate são obrigatórios' },
        { status: 400 },
      );
    }

    const account = await db.metaAdAccount.findUnique({
      where: { id: accountId },
    });
    if (!account || !account.isActive) {
      return NextResponse.json(
        { error: 'Conta não encontrada ou inativa' },
        { status: 404 },
      );
    }

    await toggleCampaignStatus(account.accessToken, campaignId, activate);

    return NextResponse.json({
      message: `Campanha ${activate ? 'ativada' : 'pausada'} com sucesso`,
    });
  } catch (err: any) {
    console.error('[META-ADS-CAMPAIGNS] Erro ao alterar status:', err);
    return NextResponse.json(
      { error: `Erro ao alterar status: ${err.message}` },
      { status: 500 },
    );
  }
}
