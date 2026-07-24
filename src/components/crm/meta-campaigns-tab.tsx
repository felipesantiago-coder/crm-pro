'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Pause, Play, TrendingUp, TrendingDown, Eye,
  MousePointerClick, DollarSign, Users, Target, Loader2, Filter,
  ArrowUpRight, ArrowDownRight, AlertTriangle, Megaphone,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

interface CampaignInsight {
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
  accountId: string;
  accountLabel: string;
  adAccountId: string;
}

interface Totals {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  reach: number;
  cpc: number;
  ctr: number;
  costPerLead: number;
}

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString('pt-BR');
}

function statusColor(status: string) {
  switch (status.toUpperCase()) {
    case 'ACTIVE': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    case 'PAUSED': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    default: return 'bg-muted text-muted-foreground';
  }
}

function statusLabel(status: string) {
  switch (status.toUpperCase()) {
    case 'ACTIVE': return 'Ativa';
    case 'PAUSED': return 'Pausada';
    case 'DELETED': return 'Excluída';
    case 'ARCHIVED': return 'Arquivada';
    default: return status;
  }
}

export function CampaignsTab() {
  const [campaigns, setCampaigns] = useState<CampaignInsight[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string>('all');
  const [selectedPeriod, setSelectedPeriod] = useState('30');
  const [accounts, setAccounts] = useState<{ id: string; label: string }[]>([]);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedAccount !== 'all') params.set('accountId', selectedAccount);
      params.set('days', selectedPeriod);

      const res = await fetch(`/api/meta-ads/campaigns?${params}`);
      if (res.ok) {
        const data = await res.json();
        setCampaigns(data.campaigns || []);
        setTotals(data.totals || null);

        // Extract unique accounts for filter
        const accs: { id: string; label: string }[] = [];
        const seen = new Set<string>();
        (data.campaigns || []).forEach((c: CampaignInsight) => {
          if (!seen.has(c.accountId)) {
            seen.add(c.accountId);
            accs.push({ id: c.accountId, label: c.accountLabel });
          }
        });
        setAccounts(accs);

        if (data.message && accs.length === 0) {
          toast.info(data.message);
        }
      }
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  }, [selectedAccount, selectedPeriod]);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  async function handleToggle(campaign: CampaignInsight, activate: boolean) {
    setToggling(campaign.campaignId);
    try {
      const res = await fetch('/api/meta-ads/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: campaign.accountId,
          campaignId: campaign.campaignId,
          activate,
        }),
      });
      if (res.ok) {
        toast.success(`Campanha ${activate ? 'ativada' : 'pausada'}`);
        fetchCampaigns();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Erro ao alterar status');
      }
    } catch {
      toast.error('Falha de conexão');
    } finally {
      setToggling(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Campanhas</h2>
          <p className="text-sm text-muted-foreground">
            Métricas em tempo real direto do Meta Ads
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
            <SelectTrigger className="w-[130px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="60">Últimos 60 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchCampaigns} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Account Filter */}
      {accounts.length > 1 && (
        <div className="flex items-center gap-2">
 <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={selectedAccount} onValueChange={setSelectedAccount}>
            <SelectTrigger className="w-[240px] h-8 text-xs">
              <SelectValue placeholder="Todas as contas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as contas</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : campaigns.length === 0 ? (
        <Card className="py-12">
          <CardContent className="text-center text-muted-foreground">
            <Megaphone className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">Nenhuma campanha encontrada</p>
            <p className="text-xs mt-1">
              {selectedAccount === 'all'
                ? 'Adicione uma conta na aba "Contas" e verifique se há campanhas ativas no Meta Ads'
                : 'Verifique se esta conta possui campanhas ativas ou pausadas no Meta Ads'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Totals Bar */}
          {totals && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card className="p-3">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Gasto Total</div>
                <div className="text-lg font-bold mt-0.5 flex items-center gap-1">
                  <DollarSign className="h-4 w-4 text-emerald-500" />
                  {formatCurrency(totals.spend)}
                </div>
              </Card>
              <Card className="p-3">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Impressões</div>
                <div className="text-lg font-bold mt-0.5 flex items-center gap-1">
                  <Eye className="h-4 w-4 text-blue-500" />
                  {formatNumber(totals.impressions)}
                </div>
              </Card>
              <Card className="p-3">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Cliques</div>
                <div className="text-lg font-bold mt-0.5 flex items-center gap-1">
                  <MousePointerClick className="h-4 w-4 text-purple-500" />
                  {formatNumber(totals.clicks)}
                </div>
              </Card>
              <Card className="p-3">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Leads</div>
                <div className="text-lg font-bold mt-0.5 flex items-center gap-1">
                  <Users className="h-4 w-4 text-amber-500" />
                  {totals.leads}
                </div>
              </Card>
            </div>
          )}

          {/* Campaign Cards */}
          <div className="grid gap-3 sm:grid-cols-2">
            {campaigns.map((campaign) => (
              <Card key={campaign.campaignId} className="overflow-hidden">
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-sm font-semibold leading-tight truncate">
                        {campaign.campaignName}
                      </CardTitle>
                      <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                        {campaign.adAccountId}
                      </p>
                    </div>
                    <Badge className={`text-[10px] flex-shrink-0 ${statusColor(campaign.status)}`}>
                      {statusLabel(campaign.status)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="grid grid-cols-3 gap-3 mt-2">
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase">Gasto</div>
                      <div className="text-sm font-bold text-foreground">{formatCurrency(campaign.spend)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase">Impressões</div>
                      <div className="text-sm font-bold text-foreground">{formatNumber(campaign.impressions)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase">Alcance</div>
                      <div className="text-sm font-bold text-foreground">{formatNumber(campaign.reach)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase">Cliques</div>
                      <div className="text-sm font-bold text-foreground">{formatNumber(campaign.clicks)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase">CTR</div>
                      <div className="text-sm font-bold text-foreground">{campaign.ctr.toFixed(1)}%</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase">CPC</div>
                      <div className="text-sm font-bold text-foreground">{formatCurrency(campaign.cpc)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase">Leads</div>
                      <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{campaign.leads}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-[10px] text-muted-foreground uppercase">Custo/Lead</div>
                      <div className="text-sm font-bold text-foreground">
                        {campaign.leads > 0 ? formatCurrency(campaign.costPerLead) : '—'}
                      </div>
                    </div>
                  </div>

                  {/* Toggle Button */}
                  <div className="mt-3 pt-3 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full h-8 text-xs"
                      disabled={toggling === campaign.campaignId}
                      onClick={() =>
                        handleToggle(campaign, campaign.status.toUpperCase() !== 'ACTIVE')
                      }
                    >
                      {toggling === campaign.campaignId ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      ) : campaign.status.toUpperCase() === 'ACTIVE' ? (
                        <Pause className="h-3.5 w-3.5 mr-1.5" />
                      ) : (
                        <Play className="h-3.5 w-3.5 mr-1.5" />
                      )}
                      {campaign.status.toUpperCase() === 'ACTIVE' ? 'Pausar Campanha' : 'Ativar Campanha'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
