'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Megaphone, Eye, EyeOff, RefreshCw, Zap, CheckCircle2, Circle,
  Copy, ExternalLink, Loader2, Save, Users, TrendingUp, Target,
  ArrowUpRight, ArrowDownRight, Search, BarChart3, Brain,
  ChevronDown, ChevronUp, Phone, Mail, MapPin, Calendar,
  AlertTriangle, Filter, Download, ChevronLeft, ChevronRight,
  UserPlus, Sparkles, Activity, PieChart, Crosshair, Globe, UsersRound,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { TrackingTab } from './tracking-tab';
import { LandingPagesTab } from './landing-pages-tab';
import { QueuesTab } from './queues-tab';
import { ptBR } from 'date-fns/locale';

// ============================================================
// Types
// ============================================================
interface Metrics {
  totalLeads: number;
  periodLeads: number;
  convertedLeads: number;
  conversionRate: number;
  byStage: Record<string, number>;
}

interface LeadItem {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  region: string | null;
  stage: string;
  notes: string | null;
  createdAt: string;
  lastInteractionAt: string | null;
  enterprise: string | null;
  adName: string;
  campaignName: string;
  formName: string;
  leadId: string;
  _count: { interactions: number };
}

interface ChartPoint {
  date: string;
  count: number;
}

interface CampaignStat {
  name: string;
  count: number;
}

interface RegionStat {
  region: string;
  count: number;
}

interface AnalysisResponse {
  analysis: string | null;
  error?: string;
  message?: string;
  generatedAt?: string;
  dataPoints?: {
    totalLeads: number;
    recentLeads: number;
    conversionRate: number;
    withoutInteraction: number;
  };
}

// ============================================================
// Stage config
// ============================================================
const STAGE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  LEAD: { label: 'Lead', color: 'text-blue-700 dark:text-blue-400', bg: 'bg-blue-100 dark:bg-blue-900/30' },
  CONTATO: { label: 'Contato', color: 'text-cyan-700 dark:text-cyan-400', bg: 'bg-cyan-100 dark:bg-cyan-900/30' },
  VISITA: { label: 'Visita', color: 'text-purple-700 dark:text-purple-400', bg: 'bg-purple-100 dark:bg-purple-900/30' },
  NEGOCIACAO: { label: 'Negociação', color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/30' },
  PROPOSTA: { label: 'Proposta', color: 'text-orange-700 dark:text-orange-400', bg: 'bg-orange-100 dark:bg-orange-900/30' },
  FECHADO: { label: 'Fechado', color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-100 dark:bg-emerald-900/30' },
  PERDIDO: { label: 'Perdido', color: 'text-red-700 dark:text-red-400', bg: 'bg-red-100 dark:bg-red-900/30' },
};

function StageBadge({ stage }: { stage: string }) {
  const config = STAGE_CONFIG[stage] || { label: stage, color: 'text-gray-600', bg: 'bg-gray-100 dark:bg-gray-800' };
  return (
    <Badge className={`${config.bg} ${config.color} text-[11px] font-semibold px-2 py-0.5 border-0`}>
      {config.label}
    </Badge>
  );
}

// ============================================================
// Mini bar chart (CSS-only, no chart library needed)
// ============================================================
function MiniBarChart({ data, height = 80 }: { data: ChartPoint[]; height?: number }) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="flex items-end gap-[3px] w-full" style={{ height }}>
      {data.map((d, i) => {
        const barH = (d.count / maxCount) * 100;
        const isToday = d.date === new Date().toISOString().split('T')[0];
        return (
          <div
            key={d.date}
            className="flex-1 min-w-0 flex flex-col items-center gap-1 group relative"
          >
            {/* Tooltip */}
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:flex items-center justify-center bg-popover text-popover-foreground text-[10px] px-1.5 py-0.5 rounded shadow-md border whitespace-nowrap z-10 pointer-events-none">
              {format(parseISO(d.date), "dd MMM", { locale: ptBR })}: {d.count} lead{d.count !== 1 ? 's' : ''}
            </div>
            <div
              className={`w-full rounded-sm transition-all duration-300 ${
                isToday
                  ? 'bg-emerald-500'
                  : d.count > 0
                    ? 'bg-blue-400/70 dark:bg-blue-500/60'
                    : 'bg-muted'
              }`}
              style={{ height: `${Math.max(barH, 2)}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Funnel Visualization
// ============================================================
function FunnelVisualization({ byStage }: { byStage: Record<string, number> }) {
  const funnelStages = ['LEAD', 'CONTATO', 'VISITA', 'NEGOCIACAO', 'PROPOSTA', 'FECHADO'];
  const data = funnelStages
    .map((s) => ({ stage: s, count: byStage[s] || 0 }))
    .filter((d) => d.count > 0);

  const maxCount = Math.max(...data.map((d) => d.count), 1);

  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        Nenhum dado de funil disponível
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {data.map((d, i) => {
        const widthPct = Math.max((d.count / maxCount) * 100, 15);
        const config = STAGE_CONFIG[d.stage] || { label: d.stage, color: 'text-gray-600', bg: 'bg-gray-100 dark:bg-gray-800' };
        const prevCount = i > 0 ? data[i - 1].count : d.count;
        const dropRate = prevCount > 0 ? (((prevCount - d.count) / prevCount) * 100).toFixed(0) : '0';

        return (
          <div key={d.stage} className="flex items-center gap-3">
            <div className="w-24 text-right text-[11px] font-medium text-muted-foreground flex-shrink-0">
              {config.label}
            </div>
            <div className="flex-1 relative">
              <div
                className={`${config.bg} rounded-sm h-7 flex items-center px-2 transition-all duration-500`}
                style={{ width: `${widthPct}%` }}
              >
                <span className={`text-[11px] font-bold ${config.color}`}>{d.count}</span>
              </div>
            </div>
            {i > 0 && d.count < prevCount && (
              <div className="w-16 text-right flex-shrink-0">
                <span className="text-[10px] text-red-500 font-medium">-{dropRate}%</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Tab: Visão Geral
// ============================================================
function OverviewTab({ metrics, chartData, topCampaigns, topRegions, onRefresh }: {
  metrics: Metrics | null;
  chartData: ChartPoint[];
  topCampaigns: CampaignStat[];
  topRegions: RegionStat[];
  onRefresh: () => void;
}) {
  if (!metrics) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalLeads = metrics.totalLeads;
  const stageOrder = ['LEAD', 'CONTATO', 'VISITA', 'NEGOCIACAO', 'PROPOSTA', 'FECHADO', 'PERDIDO'];

  return (
    <div className="space-y-6">
      {/* Header com refresh */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Visão Geral</h2>
          <p className="text-sm text-muted-foreground">Métricas e desempenho dos seus anúncios Meta</p>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Atualizar
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard
          title="Total de Leads"
          value={totalLeads}
          icon={<Users className="h-4 w-4" />}
          iconBg="bg-blue-100 dark:bg-blue-900/30"
          iconColor="text-blue-600 dark:text-blue-400"
          subtitle="Desde o início"
        />
        <KpiCard
          title="Leads no Período"
          value={metrics.periodLeads}
          icon={<UserPlus className="h-4 w-4" />}
          iconBg="bg-emerald-100 dark:bg-emerald-900/30"
          iconColor="text-emerald-600 dark:text-emerald-400"
          subtitle="Últimos 30 dias"
          trend={metrics.periodLeads > 0 ? 'up' : 'neutral'}
        />
        <KpiCard
          title="Convertidos"
          value={metrics.convertedLeads}
          icon={<Target className="h-4 w-4" />}
          iconBg="bg-purple-100 dark:bg-purple-900/30"
          iconColor="text-purple-600 dark:text-purple-400"
          subtitle="Negociação + Proposta + Fechado"
        />
        <KpiCard
          title="Taxa de Conversão"
          value={`${metrics.conversionRate}%`}
          icon={<TrendingUp className="h-4 w-4" />}
          iconBg="bg-amber-100 dark:bg-amber-900/30"
          iconColor="text-amber-600 dark:text-amber-400"
          subtitle="Leads → Avançados"
          trend={metrics.conversionRate >= 10 ? 'up' : metrics.conversionRate >= 5 ? 'neutral' : 'down'}
        />
      </div>

      {/* Gráfico + Funil */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Gráfico de leads por dia */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-500" />
              Leads por Dia
            </CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length > 0 ? (
              <>
                <MiniBarChart data={chartData} height={120} />
                <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
                  <span>{format(parseISO(chartData[0].date), "dd MMM", { locale: ptBR })}</span>
                  <span>{format(parseISO(chartData[chartData.length - 1].date), "dd MMM yyyy", { locale: ptBR })}</span>
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-sm text-muted-foreground">
                Nenhum lead no período selecionado
              </div>
            )}
          </CardContent>
        </Card>

        {/* Funil de conversão */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <PieChart className="h-4 w-4 text-purple-500" />
              Funil de Conversão
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FunnelVisualization byStage={metrics.byStage} />
          </CardContent>
        </Card>
      </div>

      {/* Campanhas + Regiões */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Campanhas */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-blue-500" />
              Top Campanhas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topCampaigns.length > 0 ? (
              <div className="space-y-2">
                {topCampaigns.map((c, i) => {
                  const maxCount = topCampaigns[0].count;
                  const widthPct = Math.max((c.count / maxCount) * 100, 10);
                  return (
                    <div key={c.name} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium truncate max-w-[200px]">{c.name}</span>
                        <span className="text-xs text-muted-foreground font-mono">{c.count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-500"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-6 text-sm text-muted-foreground">
                Nenhuma campanha identificada nos leads
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Regiões */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <MapPin className="h-4 w-4 text-emerald-500" />
              Top Regiões
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topRegions.length > 0 ? (
              <div className="space-y-2">
                {topRegions.map((r, i) => {
                  const maxCount = topRegions[0].count;
                  const widthPct = Math.max((r.count / maxCount) * 100, 10);
                  return (
                    <div key={r.region} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium truncate max-w-[200px]">{r.region}</span>
                        <span className="text-xs text-muted-foreground font-mono">{r.count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-6 text-sm text-muted-foreground">
                Nenhuma região identificada nos leads
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Distribuição por estágio (cards inline) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4 text-amber-500" />
            Distribuição por Etapa
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {stageOrder
              .filter((s) => metrics.byStage[s] > 0)
              .map((s) => {
                const config = STAGE_CONFIG[s];
                const count = metrics.byStage[s];
                const pct = ((count / totalLeads) * 100).toFixed(0);
                return (
                  <div
                    key={s}
                    className={`rounded-lg border p-3 ${config.bg} border-transparent hover:border-border transition-colors`}
                  >
                    <div className={`text-lg font-bold ${config.color}`}>{count}</div>
                    <div className="text-[11px] text-muted-foreground">{config.label}</div>
                    <div className={`text-[10px] font-medium ${config.color} mt-0.5`}>{pct}% do total</div>
                  </div>
                );
              })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// KPI Card Component
// ============================================================
function KpiCard({ title, value, icon, iconBg, iconColor, subtitle, trend }: {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  subtitle: string;
  trend?: 'up' | 'down' | 'neutral';
}) {
  return (
    <Card className="hover:shadow-md transition-shadow duration-200">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            <div className="flex items-center gap-1.5">
              {trend === 'up' && <ArrowUpRight className="h-3 w-3 text-emerald-500" />}
              {trend === 'down' && <ArrowDownRight className="h-3 w-3 text-red-500" />}
              <p className="text-[11px] text-muted-foreground">{subtitle}</p>
            </div>
          </div>
          <div className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBg}`}>
            <span className={iconColor}>{icon}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Tab: Leads
// ============================================================
function LeadsTab({ onLeadsNeeded }: { onLeadsNeeded: () => void }) {
  const [leads, setLeads] = useState<LeadItem[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [period, setPeriod] = useState('30');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchLeads = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(p),
        limit: '20',
        period,
      });
      if (search) params.set('search', search);
      if (stageFilter && stageFilter !== 'all') params.set('stage', stageFilter);

      const res = await fetch(`/api/meta-ads/leads?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLeads(data.leads);
        setPagination(data.pagination);
      } else {
        toast.error('Erro ao buscar leads');
      }
    } catch {
      toast.error('Falha de conexão');
    } finally {
      setLoading(false);
    }
  }, [search, stageFilter, period]);

  useEffect(() => {
    onLeadsNeeded();
  }, [onLeadsNeeded]);

  useEffect(() => {
    fetchLeads(1);
  }, [fetchLeads]);

  const totalPages = pagination.totalPages;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Leads do Meta Ads</h2>
          <p className="text-sm text-muted-foreground">
            {pagination.total} lead{pagination.total !== 1 ? 's' : ''} recebido{pagination.total !== 1 ? 's' : ''} via Facebook/Instagram
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="text-[11px]">
            <Filter className="h-3 w-3 mr-1" />
            {pagination.total} resultado{pagination.total !== 1 ? 's' : ''}
          </Badge>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, email ou telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <Select value={stageFilter} onValueChange={(v) => setStageFilter(v)}>
          <SelectTrigger className="w-full sm:w-[160px] h-9 text-sm">
            <SelectValue placeholder="Etapa" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as etapas</SelectItem>
            {Object.entries(STAGE_CONFIG).map(([key, cfg]) => (
              <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={period} onValueChange={(v) => setPeriod(v)}>
          <SelectTrigger className="w-full sm:w-[140px] h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Últimos 7 dias</SelectItem>
            <SelectItem value="30">Últimos 30 dias</SelectItem>
            <SelectItem value="60">Últimos 60 dias</SelectItem>
            <SelectItem value="90">Últimos 90 dias</SelectItem>
            <SelectItem value="365">Último ano</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Lista de leads */}
      <div className="space-y-2">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : leads.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center mb-3">
                <Megaphone className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">Nenhum lead encontrado</p>
              <p className="text-xs text-muted-foreground mt-1">
                {search || stageFilter !== 'all'
                  ? 'Tente ajustar os filtros'
                  : 'Os leads aparecerão aqui quando o webhook receber formulários do Meta Ads'}
              </p>
            </CardContent>
          </Card>
        ) : (
          leads.map((lead) => (
            <Card
              key={lead.id}
              className="hover:shadow-md transition-shadow duration-200 cursor-pointer"
              onClick={() => setExpandedId(expandedId === lead.id ? null : lead.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-blue-600 dark:text-blue-400 text-sm font-bold">
                      {lead.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold truncate">{lead.name}</span>
                      <StageBadge stage={lead.stage} />
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
                      {lead.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {lead.phone}
                        </span>
                      )}
                      {lead.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {lead.email}
                        </span>
                      )}
                      {lead.region && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {lead.region}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {format(parseISO(lead.createdAt), "dd/MM/yyyy")}
                      </span>
                    </div>

                    {/* Expanded details */}
                    {expandedId === lead.id && (
                      <div className="mt-3 pt-3 border-t space-y-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                          <div>
                            <span className="text-muted-foreground">Anúncio: </span>
                            <span className="font-medium">{lead.adName}</span>
                          </div>
                          {lead.campaignName && (
                            <div>
                              <span className="text-muted-foreground">Campanha: </span>
                              <span className="font-medium">{lead.campaignName}</span>
                            </div>
                          )}
                          {lead.formName && (
                            <div>
                              <span className="text-muted-foreground">Formulário: </span>
                              <span className="font-medium">{lead.formName}</span>
                            </div>
                          )}
                          {lead.leadId && (
                            <div>
                              <span className="text-muted-foreground">Lead ID: </span>
                              <span className="font-mono">{lead.leadId}</span>
                            </div>
                          )}
                          <div>
                            <span className="text-muted-foreground">Interações: </span>
                            <span className="font-medium">{lead._count.interactions}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Última interação: </span>
                            <span className="font-medium">
                              {lead.lastInteractionAt
                                ? format(parseISO(lead.lastInteractionAt), "dd/MM/yyyy HH:mm")
                                : 'Nenhuma'}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Expand icon */}
                  <div className="flex-shrink-0 text-muted-foreground">
                    {expandedId === lead.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchLeads(pagination.page - 1)}
            disabled={pagination.page <= 1}
            className="h-8"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground px-2">
            {pagination.page} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchLeads(pagination.page + 1)}
            disabled={pagination.page >= totalPages}
            className="h-8"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Tab: Análise IA
// ============================================================
function AnalysisTab() {
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  async function runAnalysis() {
    setLoading(true);
    setError(null);
    setAnalysis(null);
    try {
      const res = await fetch('/api/meta-ads/analyze');
      if (res.ok) {
        const data: AnalysisResponse = await res.json();
        if (data.analysis) {
          setAnalysis(data.analysis);
          setGeneratedAt(data.generatedAt || null);
          toast.success('Análise gerada com sucesso');
        } else if (data.error) {
          setError(data.error);
          toast.error(data.error);
        } else if (data.message) {
          setError(data.message);
        }
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Erro ao gerar análise');
        toast.error('Erro ao gerar análise');
      }
    } catch {
      setError('Falha de conexão');
      toast.error('Falha de conexão ao servidor');
    } finally {
      setLoading(false);
    }
  }

  function renderMarkdown(text: string) {
    // Simple markdown renderer: headings, bold, lists, line breaks
    const lines = text.split('\n');
    return lines.map((line, i) => {
      // Headings
      if (line.startsWith('### ')) {
        return <h3 key={i} className="text-sm font-bold mt-4 mb-1">{line.slice(4)}</h3>;
      }
      if (line.startsWith('## ')) {
        return <h2 key={i} className="text-base font-bold mt-5 mb-2">{line.slice(3)}</h2>;
      }
      if (line.startsWith('# ')) {
        return <h1 key={i} className="text-lg font-bold mt-4 mb-2">{line.slice(2)}</h1>;
      }
      // Bold
      const parts = line.split(/(\*\*[^*]+\*\*)/g);
      const rendered = parts.map((part, j) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={j}>{part.slice(2, -2)}</strong>;
        }
        return <span key={j}>{part}</span>;
      });
      // List items
      if (line.startsWith('- ')) {
        return (
          <li key={i} className="ml-4 text-sm list-disc text-muted-foreground">
            {rendered}
          </li>
        );
      }
      if (line.match(/^\d+\.\s/)) {
        const numMatch = line.match(/^(\d+)\.\s(.*)$/);
        return (
          <li key={i} className="ml-4 text-sm list-decimal text-muted-foreground">
            {numMatch ? numMatch[2] : rendered}
          </li>
        );
      }
      // Empty line
      if (line.trim() === '') {
        return <div key={i} className="h-2" />;
      }
      // Regular paragraph
      return <p key={i} className="text-sm text-muted-foreground leading-relaxed">{rendered}</p>;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Brain className="h-5 w-5 text-purple-500" />
            Análise por IA
          </h2>
          <p className="text-sm text-muted-foreground">
            Insights e recomendações inteligentes sobre seus anúncios
          </p>
        </div>
        <Button
          onClick={runAnalysis}
          disabled={loading}
          className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Analisando...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              Gerar Análise
            </>
          )}
        </Button>
      </div>

      {/* Info card */}
      <Card className="border-purple-200/50 dark:border-purple-800/30 bg-purple-50/30 dark:bg-purple-950/10">
        <CardContent className="p-4 flex items-start gap-3">
          <Sparkles className="h-5 w-5 text-purple-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Como funciona</p>
            <p className="mt-1">
              A IA analisa todos os seus leads do Meta Ads, incluindo volume, distribuição por estágio,
              campanhas, regiões e padrões nos dados. Com base nisso, gera um relatório com insights
              de qualidade, gargalos no funil e recomendações práticas para otimizar seus anúncios.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Loading state */}
      {loading && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="relative">
              <div className="h-12 w-12 rounded-full border-4 border-purple-200 dark:border-purple-800" />
              <div className="absolute inset-0 h-12 w-12 rounded-full border-4 border-transparent border-t-purple-500 animate-spin" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">Analisando seus dados de anúncios...</p>
              <p className="text-xs text-muted-foreground mt-1">Isso pode levar alguns segundos</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error state */}
      {error && !loading && (
        <Card className="border-red-200 dark:border-red-800/50">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Analysis result */}
      {analysis && !loading && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Brain className="h-4 w-4 text-purple-500" />
                Relatório de Análise
              </CardTitle>
              {generatedAt && (
                <span className="text-[10px] text-muted-foreground">
                  Gerado em {format(parseISO(generatedAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="prose prose-sm max-w-none">
            {renderMarkdown(analysis)}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================
// Tab: Configuração (migrado do painel original)
// ============================================================
function ConfigTab() {
  const [enabled, setEnabled] = useState(false);
  const [verifyToken, setVerifyToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [showAppSecret, setShowAppSecret] = useState(false);
  const [pageAccessToken, setPageAccessToken] = useState('');
  const [showPageToken, setShowPageToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState<any>(null);
  const [leadCount, setLeadCount] = useState(0);
  const [hasVerifyToken, setHasVerifyToken] = useState(false);
  const [hasAppSecret, setHasAppSecret] = useState(false);
  const [hasPageAccessToken, setHasPageAccessToken] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<any>(null);

  const webhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/webhooks/meta-leads`
    : '';

  useEffect(() => { loadConfig(); }, []);

  async function loadConfig() {
    setLoading(true);
    try {
      const res = await fetch('/api/webhooks/meta-leads/config');
      if (res.ok) {
        const data = await res.json();
        setEnabled(data.enabled);
        setLeadCount(data.leadCount);
        setHasVerifyToken(data.hasVerifyToken);
        setHasAppSecret(data.hasAppSecret);
        setHasPageAccessToken(data.hasPageAccessToken);
      }
    } catch {
      // Silencioso
    } finally {
      setLoading(false);
    }
  }

  async function checkWebhookStatus() {
    try {
      const res = await fetch('/api/webhooks/meta-leads');
      if (res.ok) {
        const data = await res.json();
        setWebhookStatus(data);
        toast.success(data.enabled ? 'Webhook ativo e pronto' : 'Webhook configurado mas desativado');
      }
    } catch {
      toast.error('Erro ao verificar status do webhook');
    }
  }

  async function runDiagnosis() {
    setDiagnosing(true);
    setDiagnosis(null);
    try {
      const res = await fetch('/api/webhooks/meta-leads/diagnose');
      if (res.ok) {
        const data = await res.json();
        setDiagnosis(data);
        const errCount = data.summary?.errors ?? 0;
        const warnCount = data.summary?.warnings ?? 0;
        if (errCount > 0) {
          toast.error(`Diagnóstico: ${errCount} erro(s) encontrado(s)`);
        } else if (warnCount > 0) {
          toast.warning(`Diagnóstico: funcionando com ${warnCount} aviso(s)`);
        } else {
          toast.success('Diagnóstico: tudo OK!');
        }
      } else {
        toast.error('Erro ao executar diagnóstico');
      }
    } catch {
      toast.error('Falha de conexão ao executar diagnóstico');
    } finally {
      setDiagnosing(false);
    }
  }

  async function saveConfig() {
    setSaving(true);
    try {
      const res = await fetch('/api/webhooks/meta-leads/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verifyToken: verifyToken || null,
          appSecret: appSecret || null,
          pageAccessToken: pageAccessToken || null,
          enabled,
        }),
      });

      if (res.ok) {
        toast.success('Configurações do Meta Ads salvas com sucesso');
        setVerifyToken('');
        setAppSecret('');
        setPageAccessToken('');
        loadConfig();
      } else {
        const data = await res.json();
        throw new Error(data.error || 'Erro ao salvar');
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar configurações');
    } finally {
      setSaving(false);
    }
  }

  async function copyToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copiado!`);
    } catch {
      toast.error('Falha ao copiar');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold">Configuração do Webhook</h2>
        <p className="text-sm text-muted-foreground">
          Configure a integração com o Meta Ads para receber leads automaticamente
        </p>
      </div>

      <Card className={enabled ? 'border-blue-200 dark:border-blue-800/50 bg-blue-50/50 dark:bg-blue-950/20' : ''}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                Meta Ads — Lead Ads
              </CardTitle>
              <CardDescription className="mt-1">
                Configuração do webhook para receber leads automaticamente
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {enabled ? (
                <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 gap-1">
                  <Zap className="h-3 w-3" />
                  Ativo
                </Badge>
              ) : (
                <Badge className="bg-muted text-muted-foreground gap-1">
                  <Circle className="h-3 w-3" />
                  Inativo
                </Badge>
              )}
              {leadCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  {leadCount} lead{leadCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Toggle */}
          <div className="flex items-center justify-between">
            <Label htmlFor="meta-enabled" className="text-sm cursor-pointer">
              {enabled ? 'Integração ativada' : 'Ativar integração'}
            </Label>
            <Switch id="meta-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <Separator />

          {/* Webhook URL */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              URL do Webhook
            </Label>
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50 border">
              <code className="flex-1 text-xs font-mono truncate text-foreground">
                {webhookUrl}
              </code>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 flex-shrink-0"
                onClick={() => copyToClipboard(webhookUrl, 'URL do Webhook')}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Cole esta URL no campo &quot;Callback URL&quot; ao configurar o webhook no Meta for Developers ou Ads Manager
            </p>
          </div>

          {/* Verify Token */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="meta-verify-token" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Token de Verificação
              </Label>
              {hasVerifyToken && (
                <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px] px-1.5 py-0">
                  <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                  Configurado
                </Badge>
              )}
            </div>
            <Input
              id="meta-verify-token"
              placeholder={hasVerifyToken ? '•••••••••••••••• (valor salvo — preencha apenas para alterar)' : 'Ex: meu_token_secreto_123'}
              value={verifyToken}
              onChange={(e) => setVerifyToken(e.target.value)}
              type="text"
              className="font-mono text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Crie uma string aleatória segura (ex: <code className="bg-muted px-1 rounded">openssl rand -hex 16</code>).
              Use o mesmo valor no campo &quot;Verify Token&quot; do Meta.
            </p>
          </div>

          {/* App Secret */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="meta-app-secret" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                App Secret (segurança)
              </Label>
              {hasAppSecret && (
                <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px] px-1.5 py-0">
                  <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                  Configurado
                </Badge>
              )}
            </div>
            <div className="relative">
              <Input
                id="meta-app-secret"
                placeholder={hasAppSecret ? '•••••••••••••••• (valor salvo — preencha apenas para alterar)' : 'Ex: a1b2c3d4e5f6...'}
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                type={showAppSecret ? 'text' : 'password'}
                className="font-mono text-sm pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                onClick={() => setShowAppSecret(!showAppSecret)}
              >
                {showAppSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Encontrado em Meta for Developers → Seu App → Settings → Basic → App Secret.
              Obrigatório para validar que os leads vieram realmente do Meta (HMAC-SHA256).
            </p>
          </div>

          {/* Page Access Token */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="meta-page-token" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Page Access Token (obrigatório)
              </Label>
              {hasPageAccessToken && (
                <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px] px-1.5 py-0">
                  <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                  Configurado
                </Badge>
              )}
            </div>
            <div className="relative">
              <Input
                id="meta-page-token"
                placeholder={hasPageAccessToken ? '•••••••••••••••• (valor salvo — preencha apenas para alterar)' : 'EAAxxxxxxxxxxxxxxxxx...'}
                value={pageAccessToken}
                onChange={(e) => setPageAccessToken(e.target.value)}
                type={showPageToken ? 'text' : 'password'}
                className="font-mono text-sm pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                onClick={() => setShowPageToken(!showPageToken)}
              >
                {showPageToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Necessário para buscar dados do lead (o Meta envia apenas o ID no webhook).
              Para obter: acesse o{' '}
              <span
                className="text-blue-600 dark:text-blue-400 font-medium cursor-pointer"
                onClick={() => window.open('https://developers.facebook.com/tools/explorer/', '_blank')}
              >
                Graph API Explorer
              </span>
              , selecione sua Página como Token User, marque a permissão{' '}
              <code className="bg-muted px-1 rounded">pages_read_engagement</code> e copie o token gerado.
            </p>
          </div>

          <Separator />

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={saveConfig}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {saving ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Salvando...</>
              ) : (
                <><Save className="h-4 w-4 mr-2" /> Salvar Configurações</>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={checkWebhookStatus}
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Testar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={runDiagnosis}
              disabled={diagnosing}
              className="border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30"
            >
              {diagnosing ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Aguarde...</>
              ) : (
                <><Zap className="h-4 w-4 mr-1" /> Diagnosticar</>
              )}
            </Button>
          </div>

          {/* Diagnosis Panel */}
          {diagnosis && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Diagnóstico</span>
                {diagnosis.status === 'healthy' && <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Tudo OK</Badge>}
                {diagnosis.status === 'degraded' && <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Atenção</Badge>}
                {diagnosis.status === 'broken' && <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Problemas</Badge>}
              </div>
              <div className="rounded-lg border space-y-1.5 p-3 bg-muted/30">
                {diagnosis.checks.map((check: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    {check.status === 'ok' && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 flex-shrink-0" />}
                    {check.status === 'warn' && <Zap className="h-3.5 w-3.5 text-amber-500 mt-0.5 flex-shrink-0" />}
                    {check.status === 'error' && <Circle className="h-3.5 w-3.5 text-red-500 mt-0.5 flex-shrink-0" />}
                    {check.status === 'skip' && <Circle className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />}
                    <div className="min-w-0">
                      <span className="font-medium">{check.name}: </span>
                      <span className={check.status === 'error' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}>
                        {check.details}
                      </span>
                      {check.fix && (
                        <p className="text-amber-600 dark:text-amber-400 mt-0.5">Solução: {check.fix}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tutorial */}
          <details className="group">
            <summary className="text-xs font-medium text-blue-600 dark:text-blue-400 cursor-pointer hover:underline flex items-center gap-1">
              Como configurar no Meta Ads
            </summary>
            <ol className="mt-2 text-[11px] text-muted-foreground space-y-1.5 list-decimal list-inside">
              <li>
                Acesse o{' '}
                <span
                  className="text-blue-600 dark:text-blue-400 font-medium cursor-pointer inline-flex items-center gap-0.5"
                  onClick={() => window.open('https://developers.facebook.com/apps/', '_blank')}
                >
                  Meta for Developers <ExternalLink className="h-2.5 w-2.5" />
                </span>
                {' '}e crie/abra seu App
              </li>
              <li>Vá em <strong>Settings → Basic</strong> e copie o <strong>App Secret</strong></li>
              <li>No menu lateral, vá em <strong>Webhooks → Adicionar</strong></li>
              <li>Cole a <strong>URL do Webhook</strong> (acima) no campo Callback URL</li>
              <li>Cole o <strong>Token de Verificação</strong> no campo Verify Token</li>
              <li>Em &quot;Subscribe to&quot;, selecione <strong>leadgen</strong> (Lead Ads)</li>
              <li>No <strong>Ads Manager</strong>, crie um formulário de Lead Ads</li>
              <li>Ao publicar o anúncio, os leads serão criados automaticamente no CRM com stage <strong>LEAD</strong></li>
            </ol>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Main Panel
// ============================================================
export function MetaAdsPanel() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [topCampaigns, setTopCampaigns] = useState<CampaignStat[]>([]);
  const [topRegions, setTopRegions] = useState<RegionStat[]>([]);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  const fetchOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const res = await fetch('/api/meta-ads/leads?limit=1&period=30');
      if (res.ok) {
        const data = await res.json();
        setMetrics(data.metrics);
        setChartData(data.chartData);
        setTopCampaigns(data.topCampaigns);
        setTopRegions(data.topRegions);
      }
    } catch {
      // Silencioso
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'overview') {
      fetchOverview();
    }
  }, [activeTab, fetchOverview]);

  return (
    <div className="space-y-6 max-w-full">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-3">
          <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg flex-shrink-0">
            <Megaphone className="h-5 w-5 text-white" />
          </div>
          Anúncios Meta
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Gerencie seus anúncios do Facebook e Instagram, acompanhe métricas e receba análises inteligentes
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        {/* Mobile dropdown */}
        <div className="lg:hidden mb-3">
          <Select value={activeTab} onValueChange={setActiveTab}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="overview"><span className="flex items-center gap-2"><BarChart3 className="h-4 w-4" />Visão Geral</span></SelectItem>
              <SelectItem value="leads"><span className="flex items-center gap-2"><Users className="h-4 w-4" />Leads</span></SelectItem>
              <SelectItem value="analysis"><span className="flex items-center gap-2"><Brain className="h-4 w-4" />Análise IA</span></SelectItem>
              <SelectItem value="tracking"><span className="flex items-center gap-2"><Crosshair className="h-4 w-4" />Tracking</span></SelectItem>
              <SelectItem value="landing"><span className="flex items-center gap-2"><Globe className="h-4 w-4" />Landing Pages</span></SelectItem>
              <SelectItem value="queues"><span className="flex items-center gap-2"><UsersRound className="h-4 w-4" />Filas</span></SelectItem>
              <SelectItem value="config"><span className="flex items-center gap-2"><Zap className="h-4 w-4" />Config</span></SelectItem>
            </SelectContent>
          </Select>
        </div>
        {/* Desktop tabs */}
        <TabsList className="hidden lg:grid lg:grid-cols-7 lg:max-w-3xl w-full gap-1 p-0.5">
          <TabsTrigger value="overview" className="text-sm gap-1.5 whitespace-nowrap">
            <BarChart3 className="h-3.5 w-3.5" />
            Visão Geral
          </TabsTrigger>
          <TabsTrigger value="leads" className="text-sm gap-1.5 whitespace-nowrap">
            <Users className="h-3.5 w-3.5" />
            Leads
          </TabsTrigger>
          <TabsTrigger value="analysis" className="text-sm gap-1.5 whitespace-nowrap">
            <Brain className="h-3.5 w-3.5" />
            Análise IA
          </TabsTrigger>
          <TabsTrigger value="tracking" className="text-sm gap-1.5 whitespace-nowrap">
            <Crosshair className="h-3.5 w-3.5" />
            Tracking
          </TabsTrigger>
          <TabsTrigger value="landing" className="text-sm gap-1.5 whitespace-nowrap">
            <Globe className="h-3.5 w-3.5" />
            Landing Pages
          </TabsTrigger>
          <TabsTrigger value="queues" className="text-sm gap-1.5 whitespace-nowrap">
            <UsersRound className="h-3.5 w-3.5" />
            Filas
          </TabsTrigger>
          <TabsTrigger value="config" className="text-sm gap-1.5 whitespace-nowrap">
            <Zap className="h-3.5 w-3.5" />
            Config
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab
            metrics={metrics}
            chartData={chartData}
            topCampaigns={topCampaigns}
            topRegions={topRegions}
            onRefresh={fetchOverview}
          />
        </TabsContent>

        <TabsContent value="leads">
          <LeadsTab onLeadsNeeded={fetchOverview} />
        </TabsContent>

        <TabsContent value="analysis">
          <AnalysisTab />
        </TabsContent>

        <TabsContent value="tracking">
          <TrackingTab />
        </TabsContent>

        <TabsContent value="landing">
          <LandingPagesTab />
        </TabsContent>

        <TabsContent value="queues">
          <QueuesTab />
        </TabsContent>

        <TabsContent value="config">
          <ConfigTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}