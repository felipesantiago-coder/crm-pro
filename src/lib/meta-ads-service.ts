const META_API = 'https://graph.facebook.com/v21.0';

export interface MetaCampaign {
  id: string;
  name: string;
  status: string;
  objective: string;
  effectiveStatus: string;
  dailyBudget: string;
  lifetimeBudget: string;
  startTime: string;
  stopTime: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MetaCampaignInsight {
  campaignId: string;
  campaignName: string;
  status: string;
  impressions: number;
  clicks: number;
  spend: number;
  cpc: number;
  ctr: number;
  leads: number;
  costPerLead: number;
  reach: number;
}

export interface MetaAdAccountInfo {
  id: string;
  name: string;
  accountStatus: string;
  businessName: string;
  balance: number;
  currency: string;
  timezoneName: string;
}

function formatDateToRange(days: number): { since: string; until: string } {
  const until = new Date();
  const since = new Date();
  since.setDate(since.getDate() - days);
  // Meta API requires YYYY-MM-DD format
  return {
    since: since.toISOString().split('T')[0],
    until: until.toISOString().split('T')[0],
  };
}

async function callMetaApi(
  accessToken: string,
  endpoint: string,
  params: Record<string, string> = {},
): Promise<any> {
  const url = new URL(`${META_API}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meta API ${res.status}: ${body}`);
  }

  return res.json();
}

/**
 * Fetch basic ad account info
 */
export async function getAdAccountInfo(
  accessToken: string,
  adAccountId: string,
): Promise<MetaAdAccountInfo> {
  const cleanId = adAccountId.replace('act_', '');
  const data = await callMetaApi(accessToken, `/act_${cleanId}`, {
    fields: 'id,name,account_status,business_name,balance,currency,timezone_name',
  });

  return {
    id: data.id,
    name: data.name,
    accountStatus: data.account_status,
    businessName: data.business_name || '',
    balance: parseFloat(data.balance) / 100, // Meta returns cents
    currency: data.currency,
    timezoneName: data.timezone_name,
  };
}

/**
 * List all campaigns from an ad account
 */
export async function getCampaigns(
  accessToken: string,
  adAccountId: string,
  statusFilter?: string,
): Promise<MetaCampaign[]> {
  const cleanId = adAccountId.replace('act_', '');
  const params: Record<string, string> = {
    fields:
      'id,name,status,objective,effective_status,daily_budget,lifetime_budget,start_time,stop_time,created_time,updated_time',
    limit: '100',
  };

  if (statusFilter && statusFilter !== 'ALL') {
    params['effective_status'] = [
      'ACTIVE',
      'PAUSED',
      'DELETED',
      'ARCHIVED',
      'PREAPPROVED',
    ].includes(statusFilter)
      ? statusFilter
      : statusFilter;
  }

  const data = await callMetaApi(accessToken, `/act_${cleanId}/campaigns`, params);
  return (data.data || []) as MetaCampaign[];
}

/**
 * Get aggregated insights per campaign for a given period
 */
export async function getCampaignInsights(
  accessToken: string,
  adAccountId: string,
  days: number = 30,
): Promise<MetaCampaignInsight[]> {
  const cleanId = adAccountId.replace('act_', '');
  const { since, until } = formatDateToRange(days);

  const data = await callMetaApi(accessToken, `/act_${cleanId}/campaigns`, {
    fields: 'id,name,effective_status',
    limit: '100',
    effective_status: ['ACTIVE', 'PAUSED'].join(','),
  });

  const campaigns = data.data || [];
  if (campaigns.length === 0) return [];

  const ids = campaigns.map((c: any) => c.id).join(',');

  try {
    const insightsData = await callMetaApi(
      accessToken,
      `/${ids}/insights`,
      {
        fields:
          'campaign_id,campaign_name,impressions,clicks,spend,cpc,ctr,actions,reach',
        level: 'campaign',
        time_range: JSON.stringify({ since, until }),
        limit: '100',
      },
    );

    const insights = insightsData.data || [];

    return insights.map((row: any) => {
      const leadsAction = (row.actions || []).find(
        (a: any) => a.action_type === 'leadgen' || a.action_type === 'generate_lead',
      );
      const leads = leadsAction ? parseInt(leadsAction.value) : 0;
      const spend = parseFloat(row.spend) || 0;
      const clicks = parseInt(row.clicks) || 0;

      return {
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
        status: row.campaign_status || '',
        impressions: parseInt(row.impressions) || 0,
        clicks,
        spend,
        cpc: clicks > 0 ? spend / clicks : 0,
        ctr: parseFloat(row.ctr) || 0,
        leads,
        costPerLead: leads > 0 ? spend / leads : 0,
        reach: parseInt(row.reach) || 0,
      };
    });
  } catch (error) {
    // Insights API can fail for new accounts; return campaigns without metrics
    console.error('[META-ADS] Insights failed, returning campaigns without metrics:', error);
    return campaigns.map((c: any) => ({
      campaignId: c.id,
      campaignName: c.name,
      status: c.effective_status || '',
      impressions: 0,
      clicks: 0,
      spend: 0,
      cpc: 0,
      ctr: 0,
      leads: 0,
      costPerLead: 0,
      reach: 0,
    }));
  }
}

/**
 * Toggle campaign status (pause/activate)
 */
export async function toggleCampaignStatus(
  accessToken: string,
  campaignId: string,
  activate: boolean,
): Promise<void> {
  const res = await fetch(`${META_API}/${campaignId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      status: activate ? 'ACTIVE' : 'PAUSED',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meta API ${res.status}: ${body}`);
  }
}
