'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Megaphone, Eye, EyeOff, RefreshCw, Zap, CheckCircle2, Circle,
  Copy, ExternalLink, Loader2, Save, Users, TrendingUp, Target,
  ArrowUpRight, ArrowDownRight, Search, BarChart3,
  ChevronDown, ChevronUp, Phone, Mail, MapPin, Calendar,
  AlertTriangle, Download, ChevronLeft, ChevronRight,
  UserPlus, Activity, PieChart, Crosshair, Globe, UsersRound,
  HeartHandshake, Building2, Clock, Plus, X, Info,
} from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRegisterAssistantContext } from '@/components/ai-assistant/use-assistant-context';
import { useSession } from 'next-auth/react';
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
import { AdAccountsSection } from './meta-ads/ad-accounts-section';
import { CampaignBindingsSection } from './meta-ads/campaign-bindings-section';
import { LostLeadsTab } from './lost-leads-view';
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
  name: string | null;
  phone: string | null;
  email: string | null;
  region: string | null;
  stage: string | null;
  notes: string | null;
  createdAt: string;
  lastInteractionAt: string | null;
  enterprise: string | null;
  adName: string | null;
  campaignName: string | null;
  formName: string | null;
  leadId: string | null;
  leadSource: 'meta_webhook' | 'landing_form' | 'whatsapp_click';
  slug: string | null;
  whatsappSource: string | null;
  _count: { interactions: number };
}

interface SourceCounts {
  meta_webhook: number;
  landing_form: number;
  whatsapp_click: number;
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

// ============================================================
// Stage config
// ============================================================
const STAGE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  LEAD: { label: 'Lead', color: 'text-blue-700 dark:text-blue-400', bg: 'bg-blue-100 dark:bg-blue-900/30' },
  PROSPECT: { label: 'Prospect', color: 'text-cyan-700 dark:text-cyan-400', bg: 'bg-cyan-100 dark:bg-cyan-900/30' },
  VISITA: { label: 'Visita', color: 'text-purple-700 dark:text-purple-400', bg: 'bg-purple-100 dark:bg-purple-900/30' },
  NEGOCIACAO: { label: 'Negociação', color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/30' },
  PROPOSTA: { label: 'Proposta', color: 'text-orange-700 dark:text-orange-400', bg: 'bg-orange-100 dark:bg-orange-900/30' },
  FECHADO: { label: 'Fechado', color: 'text-success', bg: 'bg-success/10' },
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
                  ? 'bg-chart-1'
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
  const funnelStages = ['LEAD', 'PROSPECT', 'VISITA', 'NEGOCIACAO', 'PROPOSTA', 'FECHADO'];
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
  const stageOrder = ['LEAD', 'PROSPECT', 'VISITA', 'NEGOCIACAO', 'PROPOSTA', 'FECHADO', 'PERDIDO'];

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
          iconBg="bg-primary/10"
          iconColor="text-primary dark:text-primary"
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
              <MapPin className="h-4 w-4 text-primary" />
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
                          className="h-full rounded-full bg-chart-1 transition-all duration-500"
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
                    <div className={`text-lg font-bold tabular-nums ${config.color}`}>{count}</div>
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
            <p className="text-2xl font-bold tracking-tight tabular-nums">{value}</p>
            <div className="flex items-center gap-1.5">
              {trend === 'up' && <ArrowUpRight className="h-3 w-3 text-success" />}
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
const SOURCE_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  meta_webhook: {
    label: 'Meta Ads',
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    icon: <Megaphone className="h-3 w-3" />,
  },
  landing_form: {
    label: 'Landing Page',
    color: 'bg-primary/10 text-primary dark:text-primary',
    icon: <Globe className="h-3 w-3" />,
  },
  whatsapp_click: {
    label: 'WhatsApp',
    color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    icon: <Phone className="h-3 w-3" />,
  },
};

const WHATSAPP_SOURCE_LABELS: Record<string, string> = {
  hero: 'Botão principal',
  form_section: 'Seção do formulário',
  faq_cta: 'FAQ',
  footer: 'Rodapé',
  floating_bar: 'Barra flutuante',
};

function SourceBadge({ source }: { source: string }) {
  const cfg = SOURCE_CONFIG[source];
  if (!cfg) return null;
  return (
    <Badge className={`text-[10px] h-5 px-1.5 ${cfg.color}`}>
      {cfg.icon}
      <span className="ml-0.5">{cfg.label}</span>
    </Badge>
  );
}

function LeadsTab({ onLeadsNeeded }: { onLeadsNeeded: () => void }) {
  const [leads, setLeads] = useState<LeadItem[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [period, setPeriod] = useState('30');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [sourceCounts, setSourceCounts] = useState<SourceCounts | null>(null);
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
      if (sourceFilter && sourceFilter !== 'all') params.set('source', sourceFilter);

      const res = await fetch(`/api/meta-ads/leads?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLeads(data.leads);
        setPagination(data.pagination);
        if (data.sourceCounts) setSourceCounts(data.sourceCounts);
      } else {
        toast.error('Erro ao buscar leads');
      }
    } catch {
      toast.error('Falha de conexão');
    } finally {
      setLoading(false);
    }
  }, [search, stageFilter, period, sourceFilter]);

  useEffect(() => {
    onLeadsNeeded();
  }, [onLeadsNeeded]);

  useEffect(() => {
    fetchLeads(1);
  }, [fetchLeads]);

  const totalPages = pagination.totalPages;

  return (
    <div className="space-y-4">
      {/* Source count pills + Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Leads</h2>
          <p className="text-sm text-muted-foreground">
            {pagination.total} resultado{pagination.total !== 1 ? 's' : ''}
            {sourceFilter === 'all' ? ' de todas as origens' : ` — ${SOURCE_CONFIG[sourceFilter]?.label || sourceFilter}`}
          </p>
        </div>
        {sourceCounts && sourceFilter === 'all' && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setSourceFilter('all')}
              className={`inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full font-medium transition-colors ${sourceFilter === 'all' ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
            >
              Todos ({sourceCounts.meta_webhook + sourceCounts.landing_form + sourceCounts.whatsapp_click})
            </button>
            <button
              onClick={() => setSourceFilter('meta_webhook')}
              className={`inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full font-medium transition-colors ${sourceFilter === 'meta_webhook' ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 hover:opacity-80'}`}
            >
              <Megaphone className="h-2.5 w-2.5" /> {sourceCounts.meta_webhook}
            </button>
            <button
              onClick={() => setSourceFilter('landing_form')}
              className={`inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full font-medium transition-colors ${sourceFilter === 'landing_form' ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary dark:text-primary hover:opacity-80'}`}
            >
              <Globe className="h-2.5 w-2.5" /> {sourceCounts.landing_form}
            </button>
            <button
              onClick={() => setSourceFilter('whatsapp_click')}
              className={`inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full font-medium transition-colors ${sourceFilter === 'whatsapp_click' ? 'bg-green-600 text-white' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:opacity-80'}`}
            >
              <Phone className="h-2.5 w-2.5" /> {sourceCounts.whatsapp_click}
            </button>
          </div>
        )}
        {sourceFilter !== 'all' && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSourceFilter('all')}>
            Limpar filtro de origem
          </Button>
        )}
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={sourceFilter === 'whatsapp_click' ? 'Buscar por campanha ou slug...' : 'Buscar por nome, email ou telefone...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        {sourceFilter !== 'whatsapp_click' && (
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
        )}
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
                <Users className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">Nenhum lead encontrado</p>
              <p className="text-xs text-muted-foreground mt-1">
                {search || stageFilter !== 'all' || sourceFilter !== 'all'
                  ? 'Tente ajustar os filtros'
                  : 'Os leads aparecerão aqui quando houver cadastros ou cliques'}
              </p>
            </CardContent>
          </Card>
        ) : (
          leads.map((lead) => {
            const isWhatsApp = lead.leadSource === 'whatsapp_click';
            const displayName = lead.name || (isWhatsApp ? 'Clique WhatsApp' : 'Sem nome');
            const initials = lead.name
              ? lead.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
              : '?';
            const avatarBg = lead.leadSource === 'meta_webhook'
              ? 'bg-blue-100 dark:bg-blue-900/30'
              : lead.leadSource === 'landing_form'
                ? 'bg-primary/10'
                : 'bg-green-100 dark:bg-green-900/30';
            const avatarColor = lead.leadSource === 'meta_webhook'
              ? 'text-blue-600 dark:text-blue-400'
              : lead.leadSource === 'landing_form'
                ? 'text-primary dark:text-primary'
                : 'text-green-600 dark:text-green-400';

            return (
              <Card
                key={lead.id}
                className="hover:shadow-md transition-shadow duration-200 cursor-pointer"
                onClick={() => setExpandedId(expandedId === lead.id ? null : lead.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    {/* Avatar */}
                    <div className={`h-10 w-10 rounded-lg ${avatarBg} flex items-center justify-center flex-shrink-0`}>
                      {isWhatsApp ? (
                        <Phone className={`h-5 w-5 ${avatarColor}`} />
                      ) : (
                        <span className={`${avatarColor} text-sm font-bold`}>{initials}</span>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold truncate">{displayName}</span>
                        <SourceBadge source={lead.leadSource} />
                        {lead.stage && <StageBadge stage={lead.stage} />}
                        {isWhatsApp && lead.whatsappSource && (
                          <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                            {WHATSAPP_SOURCE_LABELS[lead.whatsappSource] || lead.whatsappSource}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
                        {lead.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" /> {lead.phone}
                          </span>
                        )}
                        {lead.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" /> {lead.email}
                          </span>
                        )}
                        {lead.enterprise && (
                          <span className="flex items-center gap-1">
                            <Building2 className="h-3 w-3" /> {lead.enterprise}
                          </span>
                        )}
                        {lead.region && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" /> {lead.region}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(parseISO(lead.createdAt), "dd/MM/yyyy HH:mm")}
                        </span>
                      </div>

                      {/* Expanded details */}
                      {expandedId === lead.id && (
                        <div className="mt-3 pt-3 border-t space-y-2">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                            {lead.adName && (
                              <div>
                                <span className="text-muted-foreground">Anúncio: </span>
                                <span className="font-medium">{lead.adName}</span>
                              </div>
                            )}
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
                            {lead.slug && (
                              <div>
                                <span className="text-muted-foreground">Slug: </span>
                                <span className="font-mono">{lead.slug}</span>
                              </div>
                            )}
                            {isWhatsApp && lead.whatsappSource && (
                              <div>
                                <span className="text-muted-foreground">Local do clique: </span>
                                <span className="font-medium">{WHATSAPP_SOURCE_LABELS[lead.whatsappSource] || lead.whatsappSource}</span>
                              </div>
                            )}
                            {!isWhatsApp && (
                              <div>
                                <span className="text-muted-foreground">Interações: </span>
                                <span className="font-medium">{lead._count.interactions}</span>
                              </div>
                            )}
                            {!isWhatsApp && (
                              <div>
                                <span className="text-muted-foreground">Última interação: </span>
                                <span className="font-medium">
                                  {lead.lastInteractionAt
                                    ? format(parseISO(lead.lastInteractionAt), "dd/MM/yyyy HH:mm")
                                    : 'Nenhuma'}
                                </span>
                              </div>
                            )}
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
            );
          })
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

  // CAPI Multi-config states
  const [capiConfigs, setCapiConfigs] = useState<any[]>([]);
  const [loadingCapi, setLoadingCapi] = useState(false);
  const [showCapiDialog, setShowCapiDialog] = useState(false);
  const [editingCapi, setEditingCapi] = useState<any>(null);
  const [capiForm, setCapiForm] = useState({ name: '', accessToken: '', datasetId: '', isDefault: false, formIds: '', enabled: true, queueId: '' });
  const [savingCapi, setSavingCapi] = useState(false);
  const [testingCapId, setTestingCapId] = useState<string | null>(null);
  const [showCapiTokenDialog, setShowCapiTokenDialog] = useState(false);

  // Form Mappings states
  const [formMappings, setFormMappings] = useState<any[]>([]);
  const [loadingMappings, setLoadingMappings] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importForm, setImportForm] = useState({ accessToken: '', adAccountId: '', capiConfigId: '' });
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);

  // Manual lead import states
  const [showManualImportDialog, setShowManualImportDialog] = useState(false);
  const [manualImportIds, setManualImportIds] = useState('');
  const [manualImporting, setManualImporting] = useState(false);
  const [manualImportResult, setManualImportResult] = useState<any>(null);

  // Import by form + period states
  const [importByFormTab, setImportByFormTab] = useState<'by-id' | 'by-form'>('by-form');
  const [importByFormFormId, setImportByFormFormId] = useState('');
  const [importByFormManualId, setImportByFormManualId] = useState('');
  const [importByFormFromDate, setImportByFormFromDate] = useState('');
  const [importByFormToDate, setImportByFormToDate] = useState('');
  const [importByFormLoading, setImportByFormLoading] = useState(false);
  const [importByFormResult, setImportByFormResult] = useState<any>(null);

  // Polling automático Meta Leads (migrado de settings-view)
  const { data: session } = useSession();
  const userRole = (session?.user as { role?: string })?.role;
  const isAdmin = userRole === 'ADMIN';
  const [pollLoading, setPollLoading] = useState(true);
  const [pollEnabled, setPollEnabled] = useState(false);
  const [pollFormIds, setPollFormIds] = useState<string[]>(['']);
  const [pollSavedEnabled, setPollSavedEnabled] = useState(false);
  const [pollSaving, setPollSaving] = useState(false);
  const [pollTriggering, setPollTriggering] = useState(false);
  const [pollLastRun, setPollLastRun] = useState<string | null>(null);
  const [pollLastResult, setPollLastResult] = useState<any>(null);

  // Filas de atendimento (roteamento multi-anúncio)
  const [queues, setQueues] = useState<Array<{ id: string; name: string; isActive: boolean }>>([]);

  const webhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/webhooks/meta-leads`
    : '';

  useEffect(() => { loadConfig(); if (isAdmin) loadPollConfig(); }, []);

  async function loadQueues() {
    try {
      const res = await fetch('/api/lead-queues');
      if (res.ok) setQueues(await res.json());
    } catch { /* silent */ }
  }

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
    loadCapiConfigs();
    loadFormMappings();
    loadQueues();
  }

  async function checkWebhookStatus() {
    try {
      const res = await fetch('/api/webhooks/meta-leads/config');
      if (res.ok) {
        const data = await res.json();
        setWebhookStatus(data);
        setEnabled(data.enabled);
        setLeadCount(data.leadCount);
        setHasVerifyToken(data.hasVerifyToken);
        setHasAppSecret(data.hasAppSecret);
        setHasPageAccessToken(data.hasPageAccessToken);
        if (data.enabled && data.hasVerifyToken && data.hasAppSecret && data.hasPageAccessToken) {
          toast.success('Webhook ativo e pronto para receber leads');
        } else if (data.enabled) {
          toast.warning('Webhook ativado, mas falta configurar campos obrigatórios');
        } else {
          toast.info('Webhook configurado mas desativado — ative o switch para receber leads');
        }
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

  // ═══ CAPI Multi-config functions ═══
  async function loadCapiConfigs() {
    setLoadingCapi(true);
    try {
      const res = await fetch('/api/meta-capi-configs');
      if (res.ok) setCapiConfigs(await res.json());
    } catch { /* silent */ }
    finally { setLoadingCapi(false); }
  }

  function openNewCapiDialog() {
    setEditingCapi(null);
    setCapiForm({ name: '', accessToken: '', datasetId: '', isDefault: false, formIds: '', enabled: true, queueId: '' });
    setShowCapiDialog(true);
  }

  async function openEditCapiDialog(config: any) {
    setEditingCapi(config);
    // Fetch full config to get the unmasked token
    try {
      const res = await fetch(`/api/meta-capi-configs/${config.id}`);
      if (res.ok) {
        const full = await res.json();
        setCapiForm({
          name: full.name,
          accessToken: full.accessToken,
          datasetId: full.datasetId,
          isDefault: full.isDefault,
          formIds: full.formIds ? JSON.parse(full.formIds).join(', ') : '',
          enabled: full.enabled,
          queueId: full.queueId || '',
        });
      }
    } catch {
      setCapiForm({
        name: config.name,
        accessToken: '',
        datasetId: config.datasetId,
        isDefault: config.isDefault,
        formIds: '',
        enabled: config.enabled,
        queueId: config.queueId || '',
      });
    }
    setShowCapiDialog(true);
  }

  async function saveCapiConfig() {
    if (!capiForm.name || !capiForm.datasetId) {
      toast.error('Nome e Dataset ID são obrigatórios');
      return;
    }
    if (!editingCapi && !capiForm.accessToken) {
      toast.error('Access Token é obrigatório para novos configs');
      return;
    }
    setSavingCapi(true);
    try {
      const body: any = {
        name: capiForm.name,
        datasetId: capiForm.datasetId,
        isDefault: capiForm.isDefault,
        enabled: capiForm.enabled,
        formIds: capiForm.formIds ? capiForm.formIds.split(/[,\s]+/).filter(Boolean) : [],
        queueId: capiForm.queueId || null,
      };
      if (capiForm.accessToken) body.accessToken = capiForm.accessToken;

      const url = editingCapi ? `/api/meta-capi-configs/${editingCapi.id}` : '/api/meta-capi-configs';
      const method = editingCapi ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) {
        toast.success(editingCapi ? 'Configuração CAPI atualizada' : 'Configuração CAPI criada');
        setShowCapiDialog(false);
        loadCapiConfigs();
      } else {
        const data = await res.json();
        throw new Error(data.error || 'Erro ao salvar');
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar configuração CAPI');
    } finally {
      setSavingCapi(false);
    }
  }

  async function deleteCapiConfig(id: string) {
    if (!confirm('Excluir esta configuração CAPI? Leads vinculados perderão a associação.')) return;
    try {
      const res = await fetch(`/api/meta-capi-configs/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Configuração CAPI excluída');
        loadCapiConfigs();
      }
    } catch {
      toast.error('Erro ao excluir configuração CAPI');
    }
  }

  async function testCapiConfig(configId: string) {
    setTestingCapId(configId);
    try {
      const res = await fetch(`/api/meta-capi-configs/${configId}`);
      if (!res.ok) { toast.error('Erro ao buscar config'); return; }
      const config = await res.json();
      const testRes = await fetch('/api/webhooks/meta-leads/capi-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: config.accessToken, datasetId: config.datasetId }),
      });
      if (testRes.ok) {
        const data = await testRes.json();
        toast[data.success ? 'success' : 'error'](data.message);
      }
    } catch {
      toast.error('Falha ao testar CAPI');
    } finally {
      setTestingCapId(null);
    }
  }

  // ═══ Form Mappings functions ═══
  async function loadFormMappings() {
    setLoadingMappings(true);
    try {
      const res = await fetch('/api/meta-capi-configs/form-mappings?grouped=true');
      if (res.ok) setFormMappings(await res.json());
    } catch { /* silent */ }
    finally { setLoadingMappings(false); }
  }

  async function linkFormToConfig(formId: string, capiConfigId: string | null) {
    try {
      const res = await fetch('/api/meta-capi-configs/form-mappings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formId, capiConfigId }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(capiConfigId ? `${data.updated} mapeamento(s) vinculado(s)` : 'Vinculação removida');
        loadFormMappings();
        loadCapiConfigs();
      }
    } catch {
      toast.error('Erro ao vincular formulário');
    }
  }

  async function linkFormToQueue(formId: string, queueId: string | null) {
    try {
      const res = await fetch('/api/meta-capi-configs/form-mappings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formId, queueId }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(queueId ? `${data.updated} mapeamento(s) roteado(s) para a fila` : 'Roteamento de fila removido');
        loadFormMappings();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Erro ao vincular fila');
      }
    } catch {
      toast.error('Falha de conexão');
    }
  }

  async function importFormIds() {
    if (!importForm.accessToken || !importForm.adAccountId) {
      toast.error('Access Token e ID da conta de anúncios são obrigatórios');
      return;
    }
    setImporting(true);
    setImportResult(null);
    try {
      const body: any = {
        accessToken: importForm.accessToken,
        adAccountId: importForm.adAccountId,
      };
      if (importForm.capiConfigId) body.capiConfigId = importForm.capiConfigId;

      const res = await fetch('/api/meta-capi-configs/form-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || 'Formulários importados com sucesso');
        setImportResult(data);
        loadFormMappings();
        loadCapiConfigs();
      } else {
        const detail = data.metaErrorCode
          ? `${data.error} (código ${data.metaErrorCode})`
          : data.error || 'Erro ao importar';
        toast.error(detail, { duration: 8000 });
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao importar formulários');
    } finally {
      setImporting(false);
    }
  }

  async function importManualLeads() {
    const ids = manualImportIds.split(/[\s,\n]+/).map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      toast.error('Cole ao menos um leadgen_id');
      return;
    }
    setManualImporting(true);
    setManualImportResult(null);
    try {
      const res = await fetch('/api/webhooks/meta-leads/import-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadgenIds: ids }),
      });
      const data = await res.json();
      if (res.ok) {
        setManualImportResult(data);
        toast.success(data.message);
      } else {
        toast.error(data.error || 'Erro na importação', { duration: 8000 });
      }
    } catch {
      toast.error('Falha na importação manual');
    } finally {
      setManualImporting(false);
    }
  }

  async function importLeadsByForm() {
    const formId = importByFormTab === 'by-form' ? importByFormFormId : importByFormManualId.trim();
    if (!formId) {
      toast.error('Selecione ou digite um Form ID');
      return;
    }
    if (!importByFormFromDate) {
      toast.error('Selecione a data inicial');
      return;
    }
    setImportByFormLoading(true);
    setImportByFormResult(null);
    try {
      const body: any = { formId, fromDate: importByFormFromDate };
      if (importByFormToDate) body.toDate = importByFormToDate;
      const res = await fetch('/api/webhooks/meta-leads/import-by-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setImportByFormResult(data);
        if (data.imported > 0) {
          toast.success(data.message);
        } else {
          toast.info(data.message || 'Nenhum lead novo encontrado no período');
        }
      } else {
        toast.error(data.error || 'Erro ao buscar leads do formulário', { duration: 8000 });
      }
    } catch {
      toast.error('Falha na importação por formulário');
    } finally {
      setImportByFormLoading(false);
    }
  }

  // ═══ Polling Meta Leads (migrado de settings-view) ═══
  async function loadPollConfig() {
    setPollLoading(true);
    try {
      const res = await fetch('/api/cron/fetch-meta-leads/config');
      if (res.status === 403) { setPollLoading(false); return; }
      const data = await res.json();
      if (data) {
        setPollEnabled(data.enabled === true);
        setPollSavedEnabled(data.enabled === true);
        setPollFormIds(data.formIds?.length ? data.formIds : ['']);
        setPollLastRun(data.lastRun || null);
        setPollLastResult(data.lastResult || null);
      }
    } catch { /* silent */ }
    finally { setPollLoading(false); }
  }

  function addPollFormId() { setPollFormIds([...pollFormIds, '']); }
  function removePollFormId(index: number) { setPollFormIds(pollFormIds.filter((_, i) => i !== index)); }
  function updatePollFormId(index: number, value: string) {
    const updated = [...pollFormIds];
    updated[index] = value.replace(/\D/g, '');
    setPollFormIds(updated);
  }

  async function savePollConfig() {
    setPollSaving(true);
    try {
      const validIds = pollFormIds.filter((id) => id.length > 0);
      const res = await fetch('/api/cron/fetch-meta-leads/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: pollEnabled, formIds: validIds }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(pollEnabled ? 'Polling ativado! Leads serão importados a cada 5 minutos.' : 'Polling desativado.');
        setPollFormIds(validIds.length ? validIds : ['']);
        setPollSavedEnabled(pollEnabled);
      } else {
        toast.error(data.error || 'Erro ao salvar configuração');
      }
    } catch {
      toast.error('Erro ao salvar configuração do polling');
    } finally {
      setPollSaving(false);
    }
  }

  async function triggerPollNow() {
    const hasUnsaved = pollEnabled !== pollSavedEnabled;
    if (hasUnsaved) {
      toast.info('Salvando configuração antes de executar...');
      const validIds = pollFormIds.filter((id) => id.length > 0);
      try {
        const saveRes = await fetch('/api/cron/fetch-meta-leads/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: pollEnabled, formIds: validIds }),
        });
        if (saveRes.ok) {
          setPollSavedEnabled(pollEnabled);
          setPollFormIds(validIds.length ? validIds : ['']);
        } else {
          const saveData = await saveRes.json();
          toast.error(`Erro ao salvar: ${saveData.error || 'desconhecido'}`);
          return;
        }
      } catch {
        toast.error('Erro ao salvar configuração');
        return;
      }
    }
    setPollTriggering(true);
    try {
      const res = await fetch('/api/cron/fetch-meta-leads');
      const data = await res.json();
      if (res.status === 401) {
        toast.error('Sessão expirada. Faça login novamente.');
      } else if (res.ok) {
        if (data.status === 'disabled') {
          toast.warning('Polling está desativado. Ative primeiro e salve.');
        } else if (data.status === 'idle') {
          toast.info('Nenhum form ID configurado. Adicione ao menos um form ID.');
        } else {
          toast.success(`Polling executado: ${data.totalFetched} encontrados, ${data.totalImported} importados (${data.elapsed}).`);
          setPollLastResult(data);
          setPollLastRun(new Date().toISOString());
        }
      } else {
        toast.error(data.error || 'Erro ao executar polling');
      }
    } catch {
      toast.error('Erro ao executar polling manual');
    } finally {
      setPollTriggering(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const pollingEndpointUrl = (typeof window !== 'undefined' ? window.location.origin : '') + '/api/cron/fetch-meta-leads';

  // Status badges helpers
  const webhookReady = enabled && hasVerifyToken && hasAppSecret && hasPageAccessToken;
  const hasCapiActive = capiConfigs.some((c: any) => c.enabled);
  const hasPollActive = pollEnabled;
  const hasFormMappings = formMappings.length > 0;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* ═══ Header ═══ */}
      <div>
        <h2 className="text-lg font-semibold">Configurações dos Anúncios Meta</h2>
        <p className="text-sm text-muted-foreground">
          Centralize todas as configurações da integração com Meta Ads em um só lugar
        </p>
      </div>

      {/* ═══ Flow Diagram ═══ */}
      <Card className="bg-gradient-to-br from-slate-50 to-blue-50/50 dark:from-slate-950/50 dark:to-blue-950/20 border-blue-100 dark:border-blue-900/30">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Info className="h-4 w-4 text-blue-500" />
            <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">Como funciona a integração</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border ${webhookReady ? 'border-green-200 bg-green-50 dark:border-green-800/50 dark:bg-green-950/30' : 'border-amber-200 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-950/30'}`}>
              <Zap className={`h-3.5 w-3.5 ${webhookReady ? 'text-green-500' : 'text-amber-500'}`} />
              <span className="font-medium">1. Webhook</span>
              <Badge className={`text-[9px] px-1 py-0 ${webhookReady ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>
                {webhookReady ? 'OK' : 'Configurar'}
              </Badge>
            </div>
            <span className="text-muted-foreground">→</span>
            <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border ${hasFormMappings ? 'border-green-200 bg-green-50 dark:border-green-800/50 dark:bg-green-950/30' : 'border-muted bg-muted/50'}`}>
              <Target className={`h-3.5 w-3.5 ${hasFormMappings ? 'text-green-500' : 'text-muted-foreground'}`} />
              <span className="font-medium">2. Formulários</span>
              <Badge className={`text-[9px] px-1 py-0 ${hasFormMappings ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}>
                {hasFormMappings ? `${formMappings.length}` : '0'}
              </Badge>
            </div>
            <span className="text-muted-foreground">→</span>
            <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border ${hasCapiActive ? 'border-purple-200 bg-purple-50 dark:border-purple-800/50 dark:bg-purple-950/30' : 'border-muted bg-muted/50'}`}>
              <ArrowUpRight className={`h-3.5 w-3.5 ${hasCapiActive ? 'text-purple-500' : 'text-muted-foreground'}`} />
              <span className="font-medium">3. CAPI</span>
              <Badge className={`text-[9px] px-1 py-0 ${hasCapiActive ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' : 'bg-muted text-muted-foreground'}`}>
                {hasCapiActive ? 'OK' : 'Opcional'}
              </Badge>
            </div>
            <span className="text-muted-foreground">→</span>
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-success/30 bg-success/10">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              <span className="font-medium">Leads no CRM</span>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
            <strong>Fluxo:</strong> O Meta envia leads via <strong>Webhook</strong> → o CRM detecta o <strong>Form ID</strong> → busca dados do lead → cria o cliente → envia evento de conversão via <strong>CAPI</strong> (se configurado).
            Use <strong>Polling</strong> como alternativa ao webhook.
          </p>
        </CardContent>
      </Card>

      {/* ═══ Accordion de Configurações ═══ */}
      <Accordion type="multiple" defaultValue={['webhook', 'capi']} className="space-y-3">

        {/* ═══════════════════════════════════════════════════════
            SEÇÃO 1: Webhook de Lead Ads (Recepção de Leads)
            ═══════════════════════════════════════════════════════ */}
        <AccordionItem value="webhook" className="border rounded-xl overflow-hidden data-[state=open]:border-blue-200 dark:data-[state=open]:border-blue-800/50 data-[state=open]:shadow-sm transition-all">
          <AccordionTrigger className="px-4 py-3.5 hover:no-underline">
            <div className="flex items-center gap-3 text-left">
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${webhookReady ? 'bg-green-100 dark:bg-green-900/30' : 'bg-blue-100 dark:bg-blue-900/30'}`}>
                <Zap className={`h-4 w-4 ${webhookReady ? 'text-green-600 dark:text-green-400' : 'text-blue-600 dark:text-blue-400'}`} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">Webhook de Lead Ads</span>
                  {webhookReady ? (
                    <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px] gap-1"><CheckCircle2 className="h-2.5 w-2.5" /> Ativo</Badge>
                  ) : enabled ? (
                    <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-[10px]">Incompleto</Badge>
                  ) : (
                    <Badge className="bg-muted text-muted-foreground text-[10px]">Inativo</Badge>
                  )}
                  {leadCount > 0 && <span className="text-[10px] text-muted-foreground">{leadCount} leads recebidos</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Recebe leads automaticamente quando alguém preenche um formulário no Facebook/Instagram</p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 space-y-4">
            {/* O que faz */}
            <div className="rounded-lg bg-blue-50/50 dark:bg-blue-950/10 border border-blue-100 dark:border-blue-900/20 p-3 space-y-2">
              <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">O que esta seção faz</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Quando alguém preenche um formulário de Lead Ads no Facebook ou Instagram, o Meta envia uma notificação para seu servidor (webhook). O CRM então busca os dados completos do lead e cria automaticamente um cliente com stage <strong>LEAD</strong>, atribuído à fila de distribuição e com notificação via Telegram.
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                <strong>Depende de:</strong> Nada — é a configuração base da integração.
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                <strong>É usado por:</strong> Seções 2 (Formulários) e 3 (CAPI) dependem dos dados que chegam por aqui.
              </p>
            </div>

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
                <code className="flex-1 text-xs font-mono truncate text-foreground">{webhookUrl}</code>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 flex-shrink-0" onClick={() => copyToClipboard(webhookUrl, 'URL do Webhook')}>
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
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Token de Verificação</Label>
                {hasVerifyToken && <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px] px-1.5 py-0"><CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> Configurado</Badge>}
              </div>
              <Input placeholder={hasVerifyToken ? '•••••••••••••••• (valor salvo — preencha apenas para alterar)' : 'Ex: meu_token_secreto_123'} value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} type="text" className="font-mono text-sm" />
              <p className="text-[11px] text-muted-foreground">
                Crie uma string aleatória segura (ex: <code className="bg-muted px-1 rounded">openssl rand -hex 16</code>). Use o mesmo valor no campo &quot;Verify Token&quot; do Meta.
              </p>
            </div>

            {/* App Secret */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">App Secret (segurança)</Label>
                {hasAppSecret && <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px] px-1.5 py-0"><CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> Configurado</Badge>}
              </div>
              <div className="relative">
                <Input placeholder={hasAppSecret ? '•••••••••••••••• (valor salvo — preencha apenas para alterar)' : 'Ex: a1b2c3d4e5f6...'} value={appSecret} onChange={(e) => setAppSecret(e.target.value)} type={showAppSecret ? 'text' : 'password'} className="font-mono text-sm pr-10" />
                <Button type="button" variant="ghost" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0" onClick={() => setShowAppSecret(!showAppSecret)}>
                  {showAppSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Encontrado em Meta for Developers → Seu App → Settings → Basic → App Secret. Obrigatório para validar que os leads vieram realmente do Meta (HMAC-SHA256).
              </p>
            </div>

            {/* Page Access Token */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Page Access Token (obrigatório)</Label>
                {hasPageAccessToken && <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px] px-1.5 py-0"><CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> Configurado</Badge>}
              </div>
              <div className="relative">
                <Input placeholder={hasPageAccessToken ? '•••••••••••••••• (valor salvo — preencha apenas para alterar)' : 'EAAxxxxxxxxxxxxxxxxx...'} value={pageAccessToken} onChange={(e) => setPageAccessToken(e.target.value)} type={showPageToken ? 'text' : 'password'} className="font-mono text-sm pr-10" />
                <Button type="button" variant="ghost" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0" onClick={() => setShowPageToken(!showPageToken)}>
                  {showPageToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Necessário para buscar dados do lead (o Meta envia apenas o ID no webhook).
                Para obter: acesse o <span className="text-blue-600 dark:text-blue-400 font-medium cursor-pointer" onClick={() => window.open('https://developers.facebook.com/tools/explorer/', '_blank')}>Graph API Explorer</span>,
                selecione sua Página como Token User, marque a permissão <code className="bg-muted px-1 rounded">pages_read_engagement</code> e copie o token gerado.
              </p>
            </div>

            <Separator />

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={saveConfig} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
                {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Salvando...</> : <><Save className="h-4 w-4 mr-2" /> Salvar Webhook</>}
              </Button>
              <Button variant="outline" size="sm" onClick={checkWebhookStatus}>
                <RefreshCw className="h-4 w-4 mr-1" /> Testar
              </Button>
              <Button variant="outline" size="sm" onClick={runDiagnosis} disabled={diagnosing} className="border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30">
                {diagnosing ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Aguarde...</> : <><Zap className="h-4 w-4 mr-1" /> Diagnosticar</>}
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
                        <span className={check.status === 'error' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}>{check.details}</span>
                        {check.fix && <p className="text-amber-600 dark:text-amber-400 mt-0.5">Solução: {check.fix}</p>}
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
                <li>Acesse o <span className="text-blue-600 dark:text-blue-400 font-medium cursor-pointer inline-flex items-center gap-0.5" onClick={() => window.open('https://developers.facebook.com/apps/', '_blank')}>Meta for Developers <ExternalLink className="h-2.5 w-2.5" /></span> e crie/abra seu App</li>
                <li>Vá em <strong>Settings → Basic</strong> e copie o <strong>App Secret</strong></li>
                <li>No menu lateral, vá em <strong>Webhooks → Adicionar</strong></li>
                <li>Cole a <strong>URL do Webhook</strong> (acima) no campo Callback URL</li>
                <li>Cole o <strong>Token de Verificação</strong> no campo Verify Token</li>
                <li>Em &quot;Subscribe to&quot;, selecione <strong>leadgen</strong> (Lead Ads)</li>
                <li>No <strong>Ads Manager</strong>, crie um formulário de Lead Ads</li>
                <li>Ao publicar o anúncio, os leads serão criados automaticamente no CRM com stage <strong>LEAD</strong></li>
              </ol>
            </details>
          </AccordionContent>
        </AccordionItem>

        {/* ═══════════════════════════════════════════════════════
            SEÇÃO 2: Importação por Polling (Alternativa ao Webhook)
            ═══════════════════════════════════════════════════════ */}
        {isAdmin && (
          <AccordionItem value="polling" className="border rounded-xl overflow-hidden data-[state=open]:border-violet-200 dark:data-[state=open]:border-violet-800/50 data-[state=open]:shadow-sm transition-all">
            <AccordionTrigger className="px-4 py-3.5 hover:no-underline">
              <div className="flex items-center gap-3 text-left">
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${hasPollActive ? 'bg-violet-100 dark:bg-violet-900/30' : 'bg-muted'}`}>
                  <RefreshCw className={`h-4 w-4 ${hasPollActive ? 'text-violet-600 dark:text-violet-400' : 'text-muted-foreground'}`} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">Importação por Polling</span>
                    {hasPollActive ? (
                      <Badge className="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 text-[10px] gap-1"><CheckCircle2 className="h-2.5 w-2.5" /> Ativo</Badge>
                    ) : (
                      <Badge className="bg-muted text-muted-foreground text-[10px]">Inativo</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">Busca leads periodicamente via Meta Graph API (alternativa ao webhook)</p>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 space-y-4">
              {/* O que faz */}
              <div className="rounded-lg bg-violet-50/50 dark:bg-violet-950/10 border border-violet-100 dark:border-violet-900/20 p-3 space-y-2">
                <p className="text-xs font-semibold text-violet-700 dark:text-violet-300">O que esta seção faz</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Em vez de esperar o Meta enviar leads via webhook, o sistema <strong>busca ativamente</strong> novos leads nos formulários configurados a cada 5 minutos usando a Meta Graph API. O resultado é o mesmo: criação de cliente, atribuição à fila e notificação Telegram.
                </p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  <strong>Quando usar:</strong> Use como <strong>alternativa ao Webhook</strong> (Seção 1) quando não puder receber webhooks — por exemplo, no plano Hobby da Vercel que não permite execução contínua do servidor. <strong>Não é necessário ativar os dois.</strong>
                </p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  <strong>Depende de:</strong> Form IDs dos formulários de lead do Meta (configurados abaixo). Não depende do Webhook (Seção 1).
                </p>
              </div>

              {/* Aviso de alternativa */}
              {webhookReady && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/30">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                  <div className="text-[11px] text-amber-700 dark:text-amber-300">
                    <strong>O Webhook já está ativo.</strong> O polling é uma alternativa — geralmente não é necessário ter os dois ao mesmo tempo. Use o polling apenas se o webhook não estiver recebendo leads corretamente.
                  </div>
                </div>
              )}

              {pollLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando configuração...
                </div>
              ) : (
                <>
                  {/* Toggle + Instruções cron-job.org */}
                  <div className="flex items-center justify-between">
                    <Label className="text-sm cursor-pointer">
                      {pollEnabled ? 'Polling ativado' : 'Ativar polling'}
                    </Label>
                    <Switch checked={pollEnabled} onCheckedChange={setPollEnabled} aria-label="Ativar polling automático" />
                  </div>

                  {pollEnabled && (
                    <div className="p-3 rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800/30 space-y-2">
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                        <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">Configurar execução automática (a cada 5 min)</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        O plano Hobby da Vercel não permite cron com intervalo menor que 1 dia.
                        Use o <strong>cron-job.org</strong> (gratuito) para chamar o endpoint automaticamente:
                      </p>
                      <ol className="text-[11px] text-muted-foreground space-y-1.5 list-decimal list-inside">
                        <li>Acesse <strong>cron-job.org</strong> e crie uma conta gratuita</li>
                        <li>Clique em <strong>&quot;Create cronjob&quot;</strong></li>
                        <li>No campo <strong>URL</strong>, cole:
                          <code className="ml-1.5 bg-white dark:bg-zinc-800 px-1.5 py-0.5 rounded font-mono text-[10px] text-violet-600 dark:text-violet-400 select-all cursor-pointer"
                            onClick={() => copyToClipboard(pollingEndpointUrl + '?secret=SEU_CRON_SECRET', 'Endpoint URL')}
                            title="Clique para copiar">
                            {pollingEndpointUrl}<span className="text-amber-600 dark:text-amber-400">?secret=SEU_CRON_SECRET</span>
                          </code>
                        </li>
                        <li>Em <strong>Schedule</strong>, selecione <strong>&quot;Every 5 minutes&quot;</strong></li>
                        <li>Salve. O endpoint será chamado automaticamente a cada 5 minutos.</li>
                      </ol>
                      <p className="text-[10px] text-muted-foreground">
                        Substitua <code className="font-mono">SEU_CRON_SECRET</code> pelo valor da env var <code className="font-mono">CRON_SECRET</code> configurada na Vercel.
                        Ou use o botão &quot;Executar Agora&quot; abaixo (não precisa de CRON_SECRET, usa sua sessão).
                      </p>
                    </div>
                  )}

                  {/* Form IDs */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">IDs dos Formulários Meta</Label>
                      <Button variant="ghost" size="sm" onClick={addPollFormId} className="text-violet-600 hover:text-violet-700 h-7 px-2">
                        <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Cole os Form IDs dos formulários de lead do Facebook. Encontre em Meta Business Suite → Formulários de Leads → Configurações.
                    </p>
                    <div className="space-y-2">
                      {pollFormIds.map((formId, index) => (
                        <div key={index} className="flex gap-2 items-center">
                          <Input placeholder="Ex: 123456789012345" value={formId} onChange={(e) => updatePollFormId(index, e.target.value)} className="font-mono text-sm" disabled={pollSaving} inputMode="numeric" maxLength={30} />
                          {pollFormIds.length > 1 && (
                            <Button variant="ghost" size="icon" onClick={() => removePollFormId(index)} disabled={pollSaving} className="text-destructive hover:text-destructive h-9 w-9 flex-shrink-0">
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Última execução */}
                  {pollLastRun && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      Última execução: {new Date(pollLastRun).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                      {pollLastResult && (
                        <span className="ml-2">
                          ({pollLastResult.totalFetched ?? 0} encontrados, {pollLastResult.totalImported ?? 0} importados{pollLastResult.errorCount ? `, ${pollLastResult.errorCount} erros` : ''}, {pollLastResult.elapsed ?? '?'})
                        </span>
                      )}
                    </div>
                  )}

                  {/* Erros */}
                  {(pollLastResult?.errorCount ?? 0) > 0 && (
                    <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/30">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                        <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">{pollLastResult.errorCount} erro{(pollLastResult.errorCount ?? 0) > 1 ? 's' : ''} na última execução</span>
                      </div>
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Verifique os logs do servidor (Vercel Dashboard → Logs) para detalhes.</p>
                    </div>
                  )}

                  <Separator />

                  {/* Ações */}
                  <div className="flex items-center gap-3">
                    <Button onClick={savePollConfig} disabled={pollSaving} className="bg-violet-600 hover:bg-violet-700 text-white">
                      {pollSaving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Salvando...</> : <><Save className="h-4 w-4 mr-2" /> Salvar Polling</>}
                    </Button>
                    <Button variant="outline" onClick={triggerPollNow} disabled={pollTriggering || !pollEnabled}>
                      {pollTriggering ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Executando...</> : <><RefreshCw className="h-4 w-4 mr-2" /> Executar Agora</>}
                    </Button>
                  </div>
                </>
              )}
            </AccordionContent>
          </AccordionItem>
        )}

        {/* ═══════════════════════════════════════════════════════
            SEÇÃO 3: Contas de Anúncio (Multi-conta Meta Ads)
            ═══════════════════════════════════════════════════════ */}
        <AccordionItem value="ad-accounts" className="border rounded-xl overflow-hidden data-[state=open]:border-teal-200 dark:data-[state=open]:border-teal-800/50 data-[state=open]:shadow-sm transition-all">
          <AccordionTrigger className="px-4 py-3.5 hover:no-underline">
            <div className="flex items-center gap-3 text-left">
              <div className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-teal-100 dark:bg-teal-900/30">
                <Building2 className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">Contas de Anúncio (Multi-conta)</span>
                  <Badge className="bg-muted text-muted-foreground text-[10px]">Opcional</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Tokens por conta para capturar leads de contas de anúncios diferentes de forma independente</p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <AdAccountsSection />
          </AccordionContent>
        </AccordionItem>

        {/* ═══════════════════════════════════════════════════════
            SEÇÃO 4: API de Conversões (CAPI Multi-cliente)
            ═══════════════════════════════════════════════════════ */}
        <AccordionItem value="capi" className="border rounded-xl overflow-hidden data-[state=open]:border-purple-200 dark:data-[state=open]:border-purple-800/50 data-[state=open]:shadow-sm transition-all">
          <AccordionTrigger className="px-4 py-3.5 hover:no-underline">
            <div className="flex items-center gap-3 text-left">
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${hasCapiActive ? 'bg-purple-100 dark:bg-purple-900/30' : 'bg-muted'}`}>
                <ArrowUpRight className={`h-4 w-4 ${hasCapiActive ? 'text-purple-600 dark:text-purple-400' : 'text-muted-foreground'}`} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">API de Conversões (CAPI)</span>
                  {hasCapiActive ? (
                    <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 text-[10px] gap-1"><CheckCircle2 className="h-2.5 w-2.5" /> {capiConfigs.filter((c: any) => c.enabled).length} ativo{(capiConfigs.filter((c: any) => c.enabled).length !== 1 ? 's' : '')}</Badge>
                  ) : (
                    <Badge className="bg-muted text-muted-foreground text-[10px]">Nenhum</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Envia eventos de conversão para o Meta otimizar suas campanhas (multi-cliente)</p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 space-y-4">
            {/* O que faz */}
            <div className="rounded-lg bg-purple-50/50 dark:bg-purple-950/10 border border-purple-100 dark:border-purple-900/20 p-3 space-y-2">
              <p className="text-xs font-semibold text-purple-700 dark:text-purple-300">O que esta secao faz</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                A <strong>Conversions API (CAPI)</strong> envia eventos do servidor diretamente para o Meta, permitindo rastrear conversoes (como "lead qualificado" ou "visita agendada") mesmo quando o pixel do navegador nao consegue captura-las. Isso melhora a otimizacao das campanhas de anuncios.
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Cada configuracao representa um <strong>dataset</strong> diferente — normalmente um por cliente/conta de anuncios. Quando um lead muda de stage no CRM, o evento e enviado para o dataset correto.
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                <strong>Depende de:</strong> A secao de <strong>Formularios</strong> (abaixo) conecta cada formulario Meta ao config CAPI correto. Sem essa vinculacao, o sistema usa o config marcado como "Padrao".
              </p>
            </div>

            {/* Lista de configs */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Configs CAPI</span>
              <Button size="sm" variant="outline" className="border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-400" onClick={openNewCapiDialog}>
                <Save className="h-3.5 w-3.5 mr-1" /> Adicionar
              </Button>
            </div>

            {loadingCapi ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : capiConfigs.length === 0 ? (
              <div className="text-center py-6 space-y-2">
                <p className="text-sm text-muted-foreground">Nenhuma configuracao CAPI criada</p>
                <p className="text-xs text-muted-foreground">Adicione um dataset para cada conta de anuncios (sua ou de clientes)</p>
              </div>
            ) : (
              <div className="space-y-2">
                {capiConfigs.map((config: any) => (
                  <div key={config.id} className={`rounded-lg border p-3 transition-colors ${config.enabled ? 'border-purple-200 dark:border-purple-800/50 bg-white dark:bg-gray-900/50' : 'border-muted bg-muted/30 opacity-60'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm truncate">{config.name}</span>
                          {config.isDefault && <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-[10px] px-1.5 py-0">Padrao</Badge>}
                          {!config.enabled && <Badge className="bg-muted text-muted-foreground text-[10px] px-1.5 py-0">Inativo</Badge>}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span className="font-mono">ID: {config.datasetId}</span>
                          {config._count?.clients > 0 && <span>{config._count.clients} lead{config._count.clients !== 1 ? 's' : ''}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => testCapiConfig(config.id)} disabled={testingCapId === config.id}>
                          {testingCapId === config.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEditCapiDialog(config)}>
                          <Save className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:text-red-700" onClick={() => deleteCapiConfig(config.id)}>
                          <Circle className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Info */}
            <div className="rounded-lg bg-muted/50 border p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Como funciona (multi-cliente)</p>
              <ul className="text-[11px] text-muted-foreground space-y-1 list-disc list-inside">
                <li>Cada config tem seu proprio <strong>Access Token</strong> e <strong>Dataset ID</strong> — um por conta de anuncios</li>
                <li>Quando um lead chega via webhook, o CRM busca o config pelo <strong>Form ID</strong> (auto-atribuicao)</li>
                <li>Se nenhum form_id corresponder, e usado o config <strong>Padrao</strong></li>
                <li>Na mudanca de stage, o evento e enviado para o dataset correto do lead</li>
                <li>Dados PII (email, telefone, nome) sao hashados (SHA256) antes do envio</li>
              </ul>
            </div>

            {/* Tutorial */}
            <details className="group">
              <summary className="text-xs font-medium text-purple-600 dark:text-purple-400 cursor-pointer hover:underline flex items-center gap-1">
                Como configurar para multiplos clientes
              </summary>
              <ol className="mt-2 text-[11px] text-muted-foreground space-y-1.5 list-decimal list-inside">
                <li><strong>Sua conta:</strong> Crie um config com seu token e pixel. Marque como "Padrao"</li>
                <li><strong>Cliente:</strong> Peca ao cliente para criar um System User no Business Settings dele</li>
                <li>O cliente gera um token com permissoes <code className="bg-muted px-1 rounded">business_management</code> + <code className="bg-muted px-1 rounded">ads_management</code></li>
                <li>Crie um novo config com o token e dataset ID do cliente</li>
                <li>Opcional: preencha os <strong>Form IDs</strong> para auto-atribuir leads do formulario especifico</li>
                <li>Teste cada config com o botao de raio para confirmar o funcionamento</li>
              </ol>
            </details>
          </AccordionContent>
        </AccordionItem>

        {/* ═══════════════════════════════════════════════════════
            SEÇÃO 5: Mapeamento de Formulários
            ═══════════════════════════════════════════════════════ */}
        <AccordionItem value="form-mappings" className="border rounded-xl overflow-hidden data-[state=open]:border-success/30 data-[state=open]:shadow-sm transition-all">
          <AccordionTrigger className="px-4 py-3.5 hover:no-underline">
            <div className="flex items-center gap-3 text-left">
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${hasFormMappings ? 'bg-success/10' : 'bg-muted'}`}>
                <Target className={`h-4 w-4 ${hasFormMappings ? 'text-success' : 'text-muted-foreground'}`} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">Mapeamento de Formulários</span>
                  {hasFormMappings ? (
                    <Badge className="bg-success/10 text-success text-[10px]">{formMappings.length} formulário{(formMappings.length !== 1 ? 's' : '')}</Badge>
                  ) : (
                    <Badge className="bg-muted text-muted-foreground text-[10px]">Nenhum</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Conecta formulários Meta às configs CAPI e às filas de atendimento</p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 space-y-4">
            {/* O que faz */}
            <div className="rounded-lg bg-accent/40 dark:bg-accent/20 border border-accent p-3 space-y-2">
              <p className="text-xs font-semibold text-accent-foreground">O que esta seção faz</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Toda vez que um lead chega via webhook ou polling, o sistema registra automaticamente o <strong>Form ID</strong>, nome do formulário, campanha e anúncio. Aqui você vê esse mapeamento e pode <strong>vincular cada formulário a um config CAPI</strong> específico e a uma <strong>fila de atendimento</strong>.
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                <strong>Fila de atendimento:</strong> ao vincular uma fila, os leads desse formulário entram no round-robin dela — cada anúncio/campanha pode ter sua própria fila, com atendimento simultâneo e sem misturar leads de fontes diferentes. Sem vínculo, os leads vão para a <strong>fila padrão</strong>.
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Essa vinculação garante que quando o lead muda de stage, o evento de conversão seja enviado para o <strong>dataset correto</strong> do cliente.
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                <strong>Depende de:</strong> Os formulários são detectados automaticamente quando chegam leads via <strong>Webhook</strong> (Seção 1) ou <strong>Polling</strong> (Seção 2). Você também pode importá-los manualmente com o botão &quot;Importar&quot;.
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                <strong>É usado por:</strong> <strong>CAPI</strong> (Seção 4) usa essas vinculações para rotear eventos de conversão.
              </p>
            </div>

            {/* Lista de mappings */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">Formulários Detectados</span>
                {formMappings.length > 0 && <Badge variant="secondary" className="text-[10px]">{formMappings.reduce((acc: number, m: any) => acc + (m.totalLeads || m.leadCount || 0), 0)} leads</Badge>}
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="outline" className="h-7 text-xs border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-400" onClick={() => setShowImportDialog(true)}>
                  <Download className="h-3 w-3 mr-1" /> Importar
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={loadFormMappings} disabled={loadingMappings}>
                  {loadingMappings ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                </Button>
              </div>
            </div>

            {loadingMappings ? (
              <div className="flex items-center justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : formMappings.length === 0 ? (
              <div className="text-center py-6 space-y-1.5">
                <p className="text-xs text-muted-foreground">Nenhum formulário detectado ainda. Os Form IDs aparecem automaticamente quando chegam leads via webhook.</p>
                <p className="text-[11px] text-muted-foreground">Ou use o botão <strong>Importar</strong> para buscar formulários diretamente da conta de anúncios do cliente.</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {formMappings.map((mapping: any) => {
                  const campaigns = mapping.campaigns || [];
                  const linkedConfig = mapping.capiConfig;
                  const isMapped = !!mapping.capiConfigId;
                  const linkedQueue = mapping.queue;
                  return (
                    <div key={mapping.formId} className={`rounded-md border p-2.5 text-xs transition-colors ${isMapped ? 'border-green-200 dark:border-green-800/50 bg-green-50/50 dark:bg-green-950/20' : 'border-amber-200 dark:border-amber-800/50 bg-amber-50/30 dark:bg-amber-950/10'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono font-medium text-[11px]">{mapping.formId}</span>
                            {isMapped ? (
                              <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[9px] px-1.5 py-0">{linkedConfig?.name || 'Vinculado'}</Badge>
                            ) : (
                              <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-[9px] px-1.5 py-0">Sem CAPI</Badge>
                            )}
                            {linkedQueue && (
                              <Badge className="bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary text-[9px] px-1.5 py-0">Fila: {linkedQueue.name}</Badge>
                            )}
                          </div>
                          {mapping.formName && <p className="text-muted-foreground mt-0.5 truncate">{mapping.formName}</p>}
                          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                            <span>{mapping.totalLeads || mapping.leadCount || 0} lead{(mapping.totalLeads || mapping.leadCount || 0) !== 1 ? 's' : ''}</span>
                            {campaigns.length > 0 && campaigns[0].campaignName && <span className="truncate">· {campaigns[0].campaignName}</span>}
                            {campaigns.length > 1 && <span>+{campaigns.length - 1} campanha{campaigns.length - 1 > 1 ? 's' : ''}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <Select value={mapping.capiConfigId || '__none__'} onValueChange={(val) => linkFormToConfig(mapping.formId, val === '__none__' ? null : val)}>
                            <SelectTrigger className="h-7 w-[130px] text-[11px]"><SelectValue placeholder="Vincular CAPI" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Nenhum</SelectItem>
                              {capiConfigs.filter((c: any) => c.enabled).map((cfg: any) => (<SelectItem key={cfg.id} value={cfg.id}>{cfg.name}</SelectItem>))}
                            </SelectContent>
                          </Select>
                          <Select value={mapping.queueId || '__default__'} onValueChange={(val) => linkFormToQueue(mapping.formId, val === '__default__' ? null : val)}>
                            <SelectTrigger className="h-7 w-[130px] text-[11px]" title="Fila de atendimento deste formulário">
                              <SelectValue placeholder="Fila padrão" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__default__">Fila padrão</SelectItem>
                              {queues.map((q) => (
                                <SelectItem key={q.id} value={q.id} disabled={!q.isActive}>
                                  {q.name}{!q.isActive ? ' (inativa)' : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <p className="text-[10px] text-muted-foreground">Form IDs detectados automaticamente via webhook e polling. Vincule cada formulário a um config CAPI (eventos de conversão) e a uma fila de atendimento (distribuição de leads por anúncio).</p>

            {/* FILA POR CAMPANHA (campaignId) — prioridade máxima no roteamento */}
            <div className="pt-2 border-t">
              <CampaignBindingsSection />
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ═══════════════════════════════════════════════════════
            SEÇÃO 6: Importação Manual de Leads
            ═══════════════════════════════════════════════════════ */}
        <AccordionItem value="manual-import" className="border rounded-xl overflow-hidden data-[state=open]:border-red-200 dark:data-[state=open]:border-red-800/50 data-[state=open]:shadow-sm transition-all">
          <AccordionTrigger className="px-4 py-3.5 hover:no-underline">
            <div className="flex items-center gap-3 text-left">
              <div className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-red-100 dark:bg-red-900/30">
                <UserPlus className="h-4 w-4 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">Importação Manual de Leads</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Recupere leads que foram capturados pelo anúncio mas não chegaram ao CRM</p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 space-y-4">
            {/* O que faz */}
            <div className="rounded-lg bg-red-50/50 dark:bg-red-950/10 border border-red-100 dark:border-red-900/20 p-3 space-y-2">
              <p className="text-xs font-semibold text-red-700 dark:text-red-300">O que esta seção faz</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Se por algum motivo leads não foram recebidos pelo webhook ou polling (problema de configuração, queda de servidor, etc.), você pode <strong>importá-los manualmente</strong> diretamente da Meta Graph API. Basta informar os Form IDs ou Leadgen IDs e o sistema buscará os dados no Meta e criará os clientes no CRM.
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                <strong>Depende de:</strong> Access Token do Meta com permissão <code className="bg-muted px-1 rounded">leads_retrieval</code>. Não depende das seções acima para funcionar.
              </p>
            </div>

            <Button onClick={() => { setShowManualImportDialog(true); setManualImportResult(null); setManualImportIds(''); setImportByFormResult(null); setImportByFormFormId(''); setImportByFormFromDate(''); setImportByFormToDate(''); setImportByFormTab('by-form'); }} className="bg-red-600 hover:bg-red-700 text-white">
              <UserPlus className="h-4 w-4 mr-2" /> Importar Leads Perdidos
            </Button>
          </AccordionContent>
        </AccordionItem>

      </Accordion>

      {/* ═══ CAPI Dialog ═══ */}
      {showCapiDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCapiDialog(false)}>
          <div className="bg-background rounded-lg border shadow-lg w-full max-w-lg mx-4 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="text-lg font-semibold">{editingCapi ? 'Editar' : 'Nova'} Configuração CAPI</h3>
              <p className="text-sm text-muted-foreground">{editingCapi ? 'Altere os campos desejados. Deixe o token vazio para manter o atual.' : 'Configure o acesso a um dataset da Conversions API'}</p>
            </div>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Nome *</Label>
                <Input placeholder='Ex: "Felipe - Pixel" ou "Cliente X - Offline"' value={capiForm.name} onChange={(e) => setCapiForm({ ...capiForm, name: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Dataset ID *</Label>
                <Input placeholder="Ex: 1482541132653965" value={capiForm.datasetId} onChange={(e) => setCapiForm({ ...capiForm, datasetId: e.target.value })} className="font-mono text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Access Token {editingCapi ? '(deixe vazio para manter)' : '*'}</Label>
                <Input type="password" placeholder={editingCapi ? '••••••••••••• (manter atual)' : 'Cole o token gerado pelo Meta Business'} value={capiForm.accessToken} onChange={(e) => setCapiForm({ ...capiForm, accessToken: e.target.value })} className="font-mono text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Form IDs (opcional, separados por vírgula)</Label>
                <Input placeholder="Ex: 123456789, 987654321" value={capiForm.formIds} onChange={(e) => setCapiForm({ ...capiForm, formIds: e.target.value })} className="font-mono text-sm" />
                <p className="text-[10px] text-muted-foreground">IDs dos formulários Meta que devem usar este config. Encontrados no Ads Manager → Formulários de Lead. Ou use o botão <strong>Importar</strong> acima.</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Fila de atendimento (opcional)</Label>
                <Select value={capiForm.queueId || '__default__'} onValueChange={(val) => setCapiForm({ ...capiForm, queueId: val === '__default__' ? '' : val })}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Fila padrão do sistema" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">Fila padrão do sistema</SelectItem>
                    {queues.map((q) => (
                      <SelectItem key={q.id} value={q.id} disabled={!q.isActive}>
                        {q.name}{!q.isActive ? ' (inativa)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">Leads dos Form IDs deste config entram nessa fila. O vínculo por formulário (Mapeamento de Formulários) tem prioridade sobre este.</p>
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium cursor-pointer" onClick={() => setCapiForm({ ...capiForm, isDefault: !capiForm.isDefault })}>Configuração padrão (fallback)</Label>
                <Switch checked={capiForm.isDefault} onCheckedChange={(v) => setCapiForm({ ...capiForm, isDefault: v })} />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium cursor-pointer" onClick={() => setCapiForm({ ...capiForm, enabled: !capiForm.enabled })}>Ativado</Label>
                <Switch checked={capiForm.enabled} onCheckedChange={(v) => setCapiForm({ ...capiForm, enabled: v })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowCapiDialog(false)}>Cancelar</Button>
              <Button onClick={saveCapiConfig} disabled={savingCapi} className="bg-purple-600 hover:bg-purple-700 text-white">
                {savingCapi ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Salvando...</> : <><Save className="h-4 w-4 mr-1" /> {editingCapi ? 'Atualizar' : 'Criar'}</>}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Import Manual Leads Dialog ═══ */}
      {showManualImportDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowManualImportDialog(false)}>
          <div className="bg-background rounded-lg border shadow-lg w-full max-w-xl mx-4 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="text-lg font-semibold flex items-center gap-2"><UserPlus className="h-5 w-5 text-red-600" /> Importar Leads Perdidos</h3>
              <p className="text-sm text-muted-foreground mt-1">Recupere leads que foram capturados pelo anúncio mas não chegaram ao CRM.</p>
            </div>
            <Tabs value={importByFormTab} onValueChange={(v) => { setImportByFormTab(v as 'by-id' | 'by-form'); setImportByFormResult(null); }}>
              <TabsList className="w-full">
                <TabsTrigger value="by-form" className="flex-1 gap-1.5"><Download className="h-3.5 w-3.5" /> Por Formulário + Período</TabsTrigger>
                <TabsTrigger value="by-id" className="flex-1 gap-1.5"><UserPlus className="h-3.5 w-3.5" /> Por Leadgen ID</TabsTrigger>
              </TabsList>
              <TabsContent value="by-form" className="space-y-3 mt-3">
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Formulário</Label>
                  {formMappings.length > 0 ? (
                    <Select value={importByFormFormId || '__custom__'} onValueChange={(val) => setImportByFormFormId(val === '__custom__' ? '' : val)}>
                      <SelectTrigger className="text-sm"><SelectValue placeholder="Selecione um formulário..." /></SelectTrigger>
                      <SelectContent>
                        {formMappings.map((fm: any) => (<SelectItem key={fm.formId} value={fm.formId}>{fm.formName || fm.formId}{fm.leadCount ? ` (${fm.leadCount} leads)` : ''}</SelectItem>))}
                        <SelectItem value="__custom__">Digitar outro Form ID...</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : null}
                  {(formMappings.length === 0 || importByFormFormId === '__custom__' || !importByFormFormId) && (
                    <Input placeholder={formMappings.length > 0 ? 'Ou digite um Form ID manualmente...' : 'Digite o Form ID (ex: 123456789012345)'} value={importByFormFormId === '__custom__' ? '' : importByFormFormId} onChange={(e) => setImportByFormFormId(e.target.value)} className="font-mono text-sm mt-1.5" />
                  )}
                  <p className="text-[10px] text-muted-foreground">Selecione um formulário já mapeado ou digite o Form ID manualmente.</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label className="text-xs font-medium">Data inicial *</Label><Input type="date" value={importByFormFromDate} onChange={(e) => setImportByFormFromDate(e.target.value)} max={importByFormToDate || new Date().toISOString().split('T')[0]} /></div>
                  <div className="space-y-1"><Label className="text-xs font-medium">Data final (opcional)</Label><Input type="date" value={importByFormToDate} onChange={(e) => setImportByFormToDate(e.target.value)} min={importByFormFromDate} max={new Date().toISOString().split('T')[0]} /></div>
                </div>
                <p className="text-[10px] text-muted-foreground">O sistema buscará todos os leads deste formulário no período selecionado e importará apenas os que ainda não existem no CRM.</p>
                {importByFormResult && (
                  <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
                    <p className="text-xs font-medium">{importByFormResult.message}</p>
                    {importByFormResult.results && importByFormResult.results.length > 0 && (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {importByFormResult.results.map((r: any) => (
                          <div key={r.leadgenId} className="flex items-center justify-between text-[11px]">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {r.isNew ? <CheckCircle2 className="h-3 w-3 text-green-500 flex-shrink-0" /> : r.success ? <Circle className="h-3 w-3 text-blue-400 flex-shrink-0" /> : <Circle className="h-3 w-3 text-red-500 flex-shrink-0" />}
                              <span className="font-mono truncate">{r.leadgenId}</span>
                              {r.isNew && <Badge className="text-[9px] px-1 py-0 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 flex-shrink-0">novo</Badge>}
                            </div>
                            <span className="text-muted-foreground truncate max-w-[180px] flex-shrink-0">{r.clientName || r.reason}{r.assignedTo ? ` → ${r.assignedTo}` : ''}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <Button onClick={importLeadsByForm} disabled={importByFormLoading || !importByFormFormId || importByFormFormId === '__custom__' || !importByFormFromDate} className="bg-red-600 hover:bg-red-700 text-white">
                    {importByFormLoading ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Buscando e importando...</> : <><Download className="h-4 w-4 mr-1" /> Buscar e Importar</>}
                  </Button>
                </div>
              </TabsContent>
              <TabsContent value="by-id" className="space-y-3 mt-3">
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Leadgen IDs (um por linha ou separados por vírgula)</Label>
                  <textarea className="w-full min-h-[120px] rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring" placeholder={"Ex:\n123456789012345\n987654321098765\n555123456789012"} value={manualImportIds} onChange={(e) => setManualImportIds(e.target.value)} />
                  <p className="text-[10px] text-muted-foreground">Encontre os IDs em: Meta Ads Manager → Gerenciar Leads → clique no lead → o ID aparece na URL (ex: /lead/123456789012345)</p>
                </div>
                {manualImportResult && (
                  <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
                    <p className="text-xs font-medium">{manualImportResult.message}</p>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {manualImportResult.results?.map((r: any) => (
                        <div key={r.leadgenId} className="flex items-center justify-between text-[11px]">
                          <div className="flex items-center gap-1.5">
                            {r.success ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <Circle className="h-3 w-3 text-red-500" />}
                            <span className="font-mono">{r.leadgenId}</span>
                          </div>
                          <span className="text-muted-foreground truncate max-w-[200px]">{r.clientName || r.reason}{r.assignedTo ? ` → ${r.assignedTo}` : ''}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <Button onClick={importManualLeads} disabled={manualImporting || !manualImportIds.trim()} className="bg-red-600 hover:bg-red-700 text-white">
                    {manualImporting ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Importando...</> : <><UserPlus className="h-4 w-4 mr-1" /> Importar Leads</>}
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
            <div className="flex justify-end pt-2 border-t"><Button variant="outline" onClick={() => setShowManualImportDialog(false)}>Fechar</Button></div>
          </div>
        </div>
      )}

      {/* ═══ Import Form IDs Dialog ═══ */}
      {showImportDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setShowImportDialog(false); setImportResult(null); setImportForm({ accessToken: '', adAccountId: '', capiConfigId: '' }); }}>
          <div className="bg-background rounded-lg border shadow-lg w-full max-w-lg mx-4 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="text-lg font-semibold flex items-center gap-2"><Download className="h-5 w-5 text-purple-600" /> Importar Form IDs do Meta</h3>
              <p className="text-sm text-muted-foreground mt-1">Busca automaticamente os formulários de lead de uma conta de anúncios do cliente</p>
            </div>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium">ID da Conta de Anúncios *</Label>
                <Input placeholder="Ex: act_1433936273727810 ou 1433936273727810" value={importForm.adAccountId} onChange={(e) => setImportForm({ ...importForm, adAccountId: e.target.value })} className="font-mono text-sm" />
                <p className="text-[10px] text-muted-foreground">Encontrado no Ads Manager → Configurações da conta, ou na URL do Ads Manager</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Access Token do Cliente *</Label>
                <Input type="password" placeholder="Token com permissão leads_retrieval" value={importForm.accessToken} onChange={(e) => setImportForm({ ...importForm, accessToken: e.target.value })} className="font-mono text-sm" />
                <p className="text-[10px] text-muted-foreground">O cliente gera este token no Business Settings dele (System User com{' '}<code className="bg-muted px-1 rounded">leads_retrieval</code>{' + '}&nbsp;<code className="bg-muted px-1 rounded">ads_read</code>)</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Vincular automaticamente ao CAPI Config</Label>
                <Select value={importForm.capiConfigId || '__none__'} onValueChange={(val) => setImportForm({ ...importForm, capiConfigId: val === '__none__' ? '' : val })}>
                  <SelectTrigger className="text-sm"><SelectValue placeholder="Opcional — vincular após importar" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Não vincular</SelectItem>
                    {capiConfigs.filter((c: any) => c.enabled).map((cfg: any) => (<SelectItem key={cfg.id} value={cfg.id}>{cfg.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {importResult && (
              <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
                <p className="text-xs font-medium">{importResult.imported} formulário(s) importado(s) de {importResult.total} encontrado(s)</p>
                {importResult.forms?.length > 0 && (
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {importResult.forms.map((f: any) => (
                      <div key={f.id} className="flex items-center justify-between text-[11px]">
                        <span className="font-mono">{f.id}</span>
                        <span className="text-muted-foreground truncate ml-2">{f.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setShowImportDialog(false); setImportResult(null); setImportForm({ accessToken: '', adAccountId: '', capiConfigId: '' }); }}>Cancelar</Button>
              <Button onClick={importFormIds} disabled={importing} className="bg-purple-600 hover:bg-purple-700 text-white">
                {importing ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Importando...</> : <><Download className="h-4 w-4 mr-1" /> Importar</>}
              </Button>
            </div>
          </div>
        </div>
      )}
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
  // Bridge de contexto do Nexo (§8.2): publicado somente para ADMIN (§9.2).
  const { data: nexoSession } = useSession();
  const nexoRole = (nexoSession?.user as { role?: string } | undefined)?.role;
  useRegisterAssistantContext({
    view: 'meta-ads',
    disabled: nexoRole !== 'ADMIN',
  });
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
              <SelectItem value="tracking"><span className="flex items-center gap-2"><Crosshair className="h-4 w-4" />Tracking</span></SelectItem>
              <SelectItem value="landing"><span className="flex items-center gap-2"><Globe className="h-4 w-4" />Landing Pages</span></SelectItem>
              <SelectItem value="queues"><span className="flex items-center gap-2"><UsersRound className="h-4 w-4" />Filas</span></SelectItem>
              <SelectItem value="lost-leads"><span className="flex items-center gap-2"><HeartHandshake className="h-4 w-4" />Leads Perdidos</span></SelectItem>
              <SelectItem value="config"><span className="flex items-center gap-2"><Zap className="h-4 w-4" />Config</span></SelectItem>
            </SelectContent>
          </Select>
        </div>
        {/* Desktop tabs */}
        <TabsList className="hidden lg:grid lg:grid-cols-7 lg:max-w-4xl w-full gap-1 p-0.5">
          <TabsTrigger value="overview" className="text-sm gap-1.5 whitespace-nowrap">
            <BarChart3 className="h-3.5 w-3.5" />
            Visão Geral
          </TabsTrigger>
          <TabsTrigger value="leads" className="text-sm gap-1.5 whitespace-nowrap">
            <Users className="h-3.5 w-3.5" />
            Leads
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
          <TabsTrigger value="lost-leads" className="text-sm gap-1.5 whitespace-nowrap">
            <HeartHandshake className="h-3.5 w-3.5" />
            Leads Perdidos
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

        <TabsContent value="tracking">
          <TrackingTab />
        </TabsContent>

        <TabsContent value="landing">
          <LandingPagesTab />
        </TabsContent>

        <TabsContent value="queues">
          <QueuesTab />
        </TabsContent>

        <TabsContent value="lost-leads">
          <LostLeadsTab />
        </TabsContent>

        <TabsContent value="config">
          <ConfigTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}