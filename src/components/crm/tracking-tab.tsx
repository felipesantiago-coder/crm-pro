'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Users, Eye, Zap, Target, TrendingUp, ArrowDownRight, Copy, Check,
  ChevronDown, ChevronUp, ShieldCheck, ShieldAlert, ShieldX,
  MousePointerClick, Globe, FileCode, AlertTriangle, BarChart3,
  Activity, Trophy, Trash2, Loader2, Monitor, Smartphone, Tablet,
  MapPin, Clock, ExternalLink, UserCheck, Layers, Hash, ArrowRight,
  CircleDot, Wifi, Image, Gauge, FileText,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

// ============================================================
// Types
// ============================================================
interface TrackingMetrics {
  totalVisitors: number;
  totalPageviews: number;
  totalEvents: number;
  uniqueLeads: number;
  uniqueSessions: number;
  conversionRate: number;
  avgEventsPerVisitor: number;
  bounceRate: number;
  pageviewsPerSession: number;
}

interface ChartPoint {
  date: string;
  visitors: number;
  pageviews: number;
  leads: number;
  events: number;
}

interface FunnelStage {
  stage: string;
  count: number;
  rate: number;
}

interface CampaignRow {
  campaign: string;
  visitors: number;
  leads: number;
  conversionRate: number;
}

interface SourceRow {
  source: string;
  visitors: number;
  leads: number;
  conversionRate: number;
}

interface ContentRow {
  content: string;
  visitors: number;
  leads: number;
  conversionRate: number;
}

interface EventTypeRow {
  eventType: string;
  count: number;
}

interface TopPage {
  url: string;
  views: number;
  leads: number;
  conversionRate: number;
}

interface GeoRow {
  country: string;
  visitors: number;
  leads: number;
}

interface CityRow extends GeoRow {
  city: string;
}

interface DeviceRow {
  device: string;
  visitors: number;
  leads: number;
}

interface HourRow {
  hour: number;
  visitors: number;
  events: number;
  leads: number;
}

interface RecentLead {
  visitorId: string;
  leadId: string;
  country: string | null;
  city: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  pageUrl: string | null;
  convertedAt: string;
  clientName: string | null;
}

interface ReferrerRow {
  referrer: string;
  visitors: number;
  leads: number;
}

interface MetaDiscrepancy {
  pixelLeads: number;
  crmMetaLeads: number;
  matchRate: number;
}

interface TrackingDashboard {
  metrics: TrackingMetrics;
  chartData: ChartPoint[];
  funnel: FunnelStage[];
  byCampaign: CampaignRow[];
  bySource: SourceRow[];
  byContent: ContentRow[];
  byEventType: EventTypeRow[];
  topPages: TopPage[];
  topCountries: GeoRow[];
  topCities: CityRow[];
  deviceBreakdown: DeviceRow[];
  hourlyData: HourRow[];
  recentLeads: RecentLead[];
  referrerBreakdown: ReferrerRow[];
  metaDiscrepancy: MetaDiscrepancy;
}

// ============================================================
// Helpers
// ============================================================
const fmt = new Intl.NumberFormat('pt-BR');
const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const fmtDec = (n: number) => n.toFixed(1);

const GOLD = '#C9A96E';
const GOLD_LIGHT = 'rgba(201, 169, 110, 0.15)';
const EMERALD = '#10B981';
const EMERALD_LIGHT = 'rgba(16, 185, 129, 0.12)';
const BLUE = '#3B82F6';
const BLUE_LIGHT = 'rgba(59, 130, 246, 0.12)';
const VIOLET = '#8B5CF6';
const ROSE = '#F43F5E';
const AMBER = '#F59E0B';

const PERIOD_OPTIONS = [
  { value: '24h', label: '24 horas' },
  { value: '48h', label: '48 horas' },
  { value: '7d', label: '7 dias' },
  { value: '15d', label: '15 dias' },
  { value: '30d', label: '30 dias' },
];

const FUNNEL_LABELS: Record<string, string> = {
  Pageview: 'Visualização de Página',
  Engagement: 'Engajamento',
  Lead: 'Lead Capturado',
};

const FUNNEL_COLORS: Record<string, string> = {
  Pageview: GOLD,
  Engagement: BLUE,
  Lead: EMERALD,
};

const FUNNEL_BG: Record<string, string> = {
  Pageview: GOLD_LIGHT,
  Engagement: BLUE_LIGHT,
  Lead: EMERALD_LIGHT,
};

const DEVICE_ICONS: Record<string, React.ReactNode> = {
  Desktop: <Monitor className="h-4 w-4" />,
  Mobile: <Smartphone className="h-4 w-4" />,
  Tablet: <Tablet className="h-4 w-4" />,
  Outro: <Layers className="h-4 w-4" />,
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  pageview: GOLD,
  engagement: BLUE,
  form_submit: EMERALD,
  lead: '#22D3EE',
  click: VIOLET,
  scroll: AMBER,
};

function getEventTypeColor(type: string): string {
  return EVENT_TYPE_COLORS[type] ?? '#94A3B8';
}

function truncateUrl(url: string, maxLen = 50): string {
  try {
    const u = new URL(url);
    const path = u.pathname + u.search;
    return path.length > maxLen ? path.slice(0, maxLen) + '...' : path;
  } catch {
    return url.length > maxLen ? url.slice(0, maxLen) + '...' : url;
  }
}

function relativeTime(iso: string): string {
  try {
    const d = parseISO(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'agora';
    if (diffMin < 60) return `${diffMin}min atrás`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h atrás`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD}d atrás`;
    return format(d, 'dd/MM/yyyy', { locale: ptBR });
  } catch {
    return iso;
  }
}

// ============================================================
// Shared Sub-components
// ============================================================
function SkeletonCard() {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div className="space-y-2 flex-1">
            <div className="h-3 w-24 animate-pulse bg-muted/50 rounded" />
            <div className="h-7 w-16 animate-pulse bg-muted/50 rounded" />
          </div>
          <div className="h-11 w-11 animate-pulse bg-muted/50 rounded-xl" />
        </div>
        <div className="mt-3 h-2 w-20 animate-pulse bg-muted/50 rounded" />
      </CardContent>
    </Card>
  );
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn('animate-pulse bg-muted/50 rounded-xl', className)} />;
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(`${label ?? 'Texto'} copiado!`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Erro ao copiar');
    }
  }, [text, label]);
  return (
    <Button variant="ghost" size="sm" className="h-6 px-1.5 text-muted-foreground hover:text-foreground" onClick={handleCopy}>
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  return (
    <div className="relative group rounded-lg bg-popover/80 border border-border/50 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{language ?? 'code'}</span>
        <CopyButton text={code} label="Código" />
      </div>
      <pre className="p-3 text-xs leading-relaxed text-foreground/70 overflow-x-auto"><code>{code}</code></pre>
    </div>
  );
}

/** Horizontal progress bar with label */
function MetricBar({ label, value, max, color, suffix }: { label: string; value: number; max: number; color: string; suffix?: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground truncate max-w-[60%]" title={label}>{label}</span>
        <span className="font-medium text-foreground tabular-nums">{fmt.format(value)}{suffix ?? ''}</span>
      </div>
      <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(pct, 1)}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

/** Small info tooltip */
function InfoTip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex ml-1 cursor-help"><AlertTriangle className="h-3 w-3 text-muted-foreground/50" /></span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Conversion badge with color coding */
function ConvBadge({ rate }: { rate: number }) {
  return (
    <Badge variant="secondary" className={cn(
      'h-5 px-1.5 text-[10px] font-bold tabular-nums',
      rate >= 5 ? 'bg-emerald-500/10 text-emerald-600' :
      rate >= 2 ? 'bg-amber-500/10 text-amber-600' :
      rate > 0 ? 'bg-muted/50 text-muted-foreground' :
      'bg-muted/30 text-muted-foreground/50',
    )}>
      {fmtPct(rate)}
    </Badge>
  );
}

/** Section wrapper with title */
function Section({ title, icon, description, children, className }: {
  title: string;
  icon: React.ReactNode;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('border-border/50', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
              {icon}
              {title}
            </CardTitle>
            {description && (
              <CardDescription className="mt-1 text-xs">{description}</CardDescription>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-5 sm:px-6 pb-5">{children}</CardContent>
    </Card>
  );
}

// ============================================================
// Main Component
// ============================================================
export function TrackingTab() {
  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState<TrackingDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);

  const fetchData = useCallback(async (p: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tracking/dashboard?period=${p}`);
      if (res.ok) {
        const json = await res.json();
        if (json && json.metrics && typeof json.metrics.totalVisitors === 'number') {
          setData(json);
        } else {
          toast.error('Erro: formato inesperado dos dados');
        }
      } else {
        toast.error(`Erro ao carregar tracking (${res.status})`);
      }
    } catch {
      toast.error('Erro de conexão ao carregar tracking');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleReset = useCallback(async () => {
    const confirmed = window.confirm('Tem certeza que deseja resetar TODOS os dados de tracking? Esta ação é irreversível.');
    if (!confirmed) return;
    setResetting(true);
    try {
      const res = await fetch('/api/tracking/reset', { method: 'DELETE' });
      if (res.ok) {
        const json = await res.json();
        toast.success(`Resetado: ${json.deletedVisitors} visitantes e ${json.deletedEvents} eventos removidos.`);
        fetchData(period);
      } else {
        toast.error('Erro ao resetar tracking.');
      }
    } catch {
      toast.error('Erro de conexão ao resetar tracking.');
    } finally {
      setResetting(false);
    }
  }, [period, fetchData]);

  const handleGenerateReport = useCallback(async () => {
    setGeneratingReport(true);
    try {
      const res = await fetch(`/api/tracking/report?period=${period}`, {
        headers: { Accept: 'text/markdown' },
      });
      if (!res.ok) {
        toast.error(`Erro ao gerar relatório (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const periodLabel = PERIOD_OPTIONS.find(p => p.value === period)?.label ?? period;
      a.download = `relatorio-tracking-${periodLabel.toLowerCase().replace(/\s/g, '-')}-${new Date().toISOString().split('T')[0]}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Relatório Markdown gerado e baixado!');
    } catch {
      toast.error('Erro de conexão ao gerar relatório.');
    } finally {
      setGeneratingReport(false);
    }
  }, [period]);

  useEffect(() => { fetchData(period); }, [period, fetchData]);

  // Derived data
  const chartDays = useMemo(() => {
    if (!data) return [];
    return data.chartData.length <= 14 ? data.chartData : data.chartData.slice(-14);
  }, [data]);

  const maxChart = useMemo(() => {
    if (!chartDays.length) return 1;
    return Math.max(...chartDays.map(d => Math.max(d.visitors, d.leads)), 1);
  }, [chartDays]);

  const maxHourly = useMemo(() => {
    if (!data?.hourlyData.length) return 1;
    return Math.max(...data.hourlyData.map(h => h.visitors), 1);
  }, [data]);

  const sortedCampaigns = useMemo(() =>
    [...(data?.byCampaign ?? [])].sort((a, b) => b.leads - a.leads),
  [data]);

  const sortedSources = useMemo(() =>
    [...(data?.bySource ?? [])].sort((a, b) => b.visitors - a.visitors),
  [data]);

  const sortedContent = useMemo(() =>
    [...(data?.byContent ?? [])].sort((a, b) => b.visitors - a.visitors),
  [data]);

  const sortedReferrers = useMemo(() =>
    [...(data?.referrerBreakdown ?? [])].sort((a, b) => b.visitors - a.visitors),
  [data]);

  const totalDeviceVisitors = useMemo(() =>
    (data?.deviceBreakdown ?? []).reduce((s, d) => s + d.visitors, 0),
  [data]);

  const hasUtmData = useMemo(() =>
    sortedCampaigns.some(c => c.campaign !== '(sem campanha)') ||
    sortedSources.some(s => s.source !== '(orgânico/direto)'),
  [sortedCampaigns, sortedSources]);

  // ── Loading State ──
  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-6 w-48 animate-pulse bg-muted/50 rounded" />
          <div className="h-9 w-32 animate-pulse bg-muted/50 rounded" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <SkeletonBlock className="h-72" />
        <SkeletonBlock className="h-56" />
        <SkeletonBlock className="h-64" />
      </div>
    );
  }

  // ── Empty State ──
  if (data?.metrics && data.metrics.totalVisitors === 0) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div />
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-32 h-9 text-xs bg-muted/50 border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Card className="border-border/50">
          <CardContent className="py-16 px-6 text-center">
            <div className="mx-auto mb-4 h-16 w-16 rounded-2xl bg-[#C9A96E]/10 flex items-center justify-center">
              <MousePointerClick className="h-8 w-8 text-[#C9A96E]" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Nenhum dado de tracking ainda</h3>
            <p className="text-sm text-muted-foreground max-w-lg mx-auto mb-6 leading-relaxed">
              Para começar a rastrear visitantes e conversões do Meta Ads, siga os 3 passos abaixo:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto text-left">
              <div className="rounded-xl border border-border/50 bg-muted/20 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#C9A96E]/20 text-xs font-bold text-[#C9A96E]">1</span>
                  <span className="text-sm font-medium text-foreground">Migration</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Execute a SQL migration para criar as tabelas{' '}
                  <code className="text-[#C9A96E] bg-[#C9A96E]/10 px-1 py-0.5 rounded text-[11px]">tracking_visitors</code> e{' '}
                  <code className="text-[#C9A96E] bg-[#C9A96E]/10 px-1 py-0.5 rounded text-[11px]">tracking_events</code>.
                </p>
              </div>
              <div className="rounded-xl border border-border/50 bg-muted/20 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#C9A96E]/20 text-xs font-bold text-[#C9A96E]">2</span>
                  <span className="text-sm font-medium text-foreground">Pixel Script</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Adicione o script do pixel no{' '}
                  <code className="text-[#C9A96E] bg-[#C9A96E]/10 px-1 py-0.5 rounded text-[11px]">&lt;head&gt;</code> da sua landing page.
                </p>
              </div>
              <div className="rounded-xl border border-border/50 bg-muted/20 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#C9A96E]/20 text-xs font-bold text-[#C9A96E]">3</span>
                  <span className="text-sm font-medium text-foreground">UTM Params</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Adicione parâmetros UTM nas URLs dos seus anúncios.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data || !data.metrics) {
    return (
      <Card className="border-border/50">
        <CardContent className="py-12 px-6 text-center">
          <p className="text-sm text-muted-foreground">Não foi possível carregar os dados de tracking.</p>
          <button className="mt-3 text-xs text-[#C9A96E] hover:underline" onClick={() => fetchData(period)}>Tentar novamente</button>
        </CardContent>
      </Card>
    );
  }

  const m = data.metrics;

  // ── KPI definitions ──
  const kpis = [
    { label: 'Visitantes Únicos', value: fmt.format(m.totalVisitors), icon: <Users className="h-5 w-5 text-white" />, iconBg: 'bg-gradient-to-br from-[#C9A96E] to-[#A8894F]', subtitle: `${fmtDec(m.avgEventsPerVisitor)} eventos por visitante` },
    { label: 'Pageviews', value: fmt.format(m.totalPageviews), icon: <Eye className="h-5 w-5 text-white" />, iconBg: 'bg-gradient-to-br from-blue-500 to-blue-700', subtitle: `${fmtDec(m.pageviewsPerSession)} por sessão` },
    { label: 'Eventos Totais', value: fmt.format(m.totalEvents), icon: <Zap className="h-5 w-5 text-white" />, iconBg: 'bg-gradient-to-br from-amber-500 to-orange-600', subtitle: `${data.byEventType.length} tipos registrados` },
    { label: 'Leads Rastreados', value: fmt.format(m.uniqueLeads), icon: <Target className="h-5 w-5 text-white" />, iconBg: 'bg-gradient-to-br from-emerald-500 to-teal-600', subtitle: 'visitantes vinculados ao CRM' },
    { label: 'Taxa de Conversão', value: fmtPct(m.conversionRate), icon: <TrendingUp className="h-5 w-5 text-white" />, iconBg: 'bg-gradient-to-br from-violet-500 to-purple-700', subtitle: 'visitante → lead' },
    { label: 'Taxa de Rejeição', value: fmtPct(m.bounceRate), icon: <ArrowDownRight className="h-5 w-5 text-white" />, iconBg: 'bg-gradient-to-br from-rose-500 to-pink-700', subtitle: '1 pageview, sem interação' },
    { label: 'Sessões', value: fmt.format(m.uniqueSessions), icon: <CircleDot className="h-5 w-5 text-white" />, iconBg: 'bg-gradient-to-br from-cyan-500 to-cyan-700', subtitle: `${fmtDec(m.pageviewsPerSession)} pageviews/sessão` },
    { label: 'Páginas / Sessão', value: fmtDec(m.pageviewsPerSession), icon: <Gauge className="h-5 w-5 text-white" />, iconBg: 'bg-gradient-to-br from-indigo-500 to-indigo-700', subtitle: `de ${fmt.format(m.totalPageviews)} pageviews` },
  ];

  // ── Main Render ──
  return (
    <TooltipProvider>
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-[#C9A96E]" />
          <h2 className="text-lg font-semibold text-foreground">Tracking de Visitantes</h2>
          <Badge variant="secondary" className="text-[10px] font-normal bg-muted/50">
            {PERIOD_OPTIONS.find(p => p.value === period)?.label}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="text-xs text-[#C9A96E] hover:text-[#C9A96E]/80 hover:bg-[#C9A96E]/10 h-9 px-3" onClick={handleGenerateReport} disabled={generatingReport}>
                  {generatingReport ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <FileText className="h-3.5 w-3.5 mr-1.5" />}
                  {generatingReport ? 'Gerando...' : 'Relatório MD'}
                </Button>
              </TooltipTrigger>
              <TooltipContent className="text-xs max-w-xs">
                Gera um relatório Markdown completo com todos os dados do período para usar como contexto de IA para otimização de campanha.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button variant="ghost" size="sm" className="text-xs text-red-500 hover:text-red-600 hover:bg-red-500/10 h-9 px-3" onClick={handleReset} disabled={resetting}>
            {resetting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
            {resetting ? 'Resetando...' : 'Resetar Dados'}
          </Button>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-32 h-9 text-xs bg-muted/50 border-border text-foreground/70">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ═══ KPI Cards ═══ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map(kpi => (
          <Card key={kpi.label} className="border-border/50 hover:border-[#C9A96E]/20 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5 flex-1 min-w-0">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{kpi.label}</p>
                  <p className="text-xl font-bold text-foreground tracking-tight">{kpi.value}</p>
                </div>
                <div className={cn('h-10 w-10 rounded-xl flex items-center justify-center shrink-0', kpi.iconBg)}>
                  {kpi.icon}
                </div>
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground truncate">{kpi.subtitle}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ═══ Funnel + Daily Chart side by side ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Funnel */}
        <Section title="Funil de Conversão" icon={<BarChart3 className="h-4 w-4 text-[#C9A96E]" />} description="Pageview → Engajamento → Lead">
          <div className="space-y-3">
            {data.funnel.map((stage, idx) => {
              const color = FUNNEL_COLORS[stage.stage] ?? GOLD;
              const bgColor = FUNNEL_BG[stage.stage] ?? GOLD_LIGHT;
              const dropOff = idx > 0 && data.funnel[idx - 1].count > 0
                ? ((data.funnel[idx - 1].count - stage.count) / data.funnel[idx - 1].count * 100)
                : 0;
              return (
                <div key={stage.stage}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                      <span className="text-xs font-medium text-foreground">{FUNNEL_LABELS[stage.stage] ?? stage.stage}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {idx > 0 && dropOff > 0 && (
                        <span className="text-[10px] text-rose-500 tabular-nums">-{fmtPct(dropOff)}</span>
                      )}
                      <span className="text-xs font-bold text-foreground tabular-nums">{fmt.format(stage.count)}</span>
                      {idx > 0 && (
                        <Badge variant="secondary" className="h-4 px-1 text-[9px] font-bold" style={{ backgroundColor: bgColor, color }}>{fmtPct(stage.rate)}</Badge>
                      )}
                    </div>
                  </div>
                  <div className="h-8 rounded-lg overflow-hidden bg-muted/30">
                    <div className="h-full rounded-lg transition-all duration-700 ease-out flex items-center px-2" style={{ width: `${Math.max(stage.rate, 3)}%`, backgroundColor: color, opacity: 0.8 }}>
                      {stage.rate >= 15 && <span className="text-[10px] font-bold text-white">{fmtPct(stage.rate)}</span>}
                    </div>
                  </div>
                  {idx < data.funnel.length - 1 && <div className="flex justify-center py-1"><ArrowRight className="h-3 w-3 text-muted-foreground/30" /></div>}
                </div>
              );
            })}
            {data.funnel.length >= 3 && (
              <div className="pt-2 border-t border-border/50 flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Conversão Total</span>
                <span className="text-sm font-bold text-emerald-600 tabular-nums">{fmtPct(m.conversionRate)}</span>
              </div>
            )}
          </div>
        </Section>

        {/* Daily Chart */}
        <Section title="Tendência Diária" icon={<TrendingUp className="h-4 w-4 text-[#C9A96E]" />} description="Visitantes e leads por dia">
          <div>
            <div className="flex items-center gap-4 mb-3 text-[10px]">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: GOLD }} /><span className="text-muted-foreground">Visitantes</span></span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: EMERALD }} /><span className="text-muted-foreground">Leads</span></span>
            </div>
            {chartDays.length > 0 ? (
              <div className="flex items-end gap-1" style={{ height: '180px' }}>
                {chartDays.map(d => {
                  const vH = (d.visitors / maxChart) * 100;
                  const lH = (d.leads / maxChart) * 100;
                  const dayLabel = (() => { try { return format(parseISO(d.date), 'dd/MM', { locale: ptBR }); } catch { return d.date.slice(5); } })();
                  return (
                    <TooltipProvider key={d.date} delayDuration={100}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex-1 flex flex-col items-center gap-0.5 min-w-0 cursor-default">
                            <div className="flex-1 w-full flex items-end justify-center gap-px">
                              <div className="w-[45%] max-w-[12px] rounded-t-sm transition-all duration-500" style={{ height: `${Math.max(vH, 1)}%`, background: `linear-gradient(to top, ${GOLD}, rgba(201,169,110,0.4))` }} />
                              <div className="w-[45%] max-w-[12px] rounded-t-sm transition-all duration-500" style={{ height: `${Math.max(lH, 1)}%`, background: `linear-gradient(to top, ${EMERALD}, rgba(16,185,129,0.3))` }} />
                            </div>
                            <span className="text-[8px] text-muted-foreground leading-none truncate w-full text-center">{dayLabel}</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent className="text-[10px]">
                          <div>Visitantes: <b>{d.visitors}</b></div>
                          <div>Leads: <b>{d.leads}</b></div>
                          <div>Eventos: <b>{d.events}</b></div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  );
                })}
              </div>
            ) : (
              <div className="h-[180px] flex items-center justify-center text-xs text-muted-foreground">Sem dados no período</div>
            )}
          </div>
        </Section>
      </div>

      {/* ═══ UTM: Campaigns + Sources + Content ═══ */}
      {hasUtmData && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {sortedCampaigns.filter(c => c.campaign !== '(sem campanha)').length > 0 && (
            <Section title="Campanhas" icon={<Trophy className="h-4 w-4 text-[#C9A96E]" />} description="Performance por utm_campaign">
              <div className="space-y-2.5">
                {sortedCampaigns.filter(c => c.campaign !== '(sem campanha)').slice(0, 8).map((row, idx) => (
                  <div key={row.campaign}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {idx < 3 && <span className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold shrink-0" style={{ backgroundColor: idx === 0 ? GOLD : idx === 1 ? '#A0A0A0' : '#CD7F32', color: '#000' }}>{idx + 1}</span>}
                        <span className="text-[11px] font-medium text-foreground truncate" title={row.campaign}>{row.campaign}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] text-muted-foreground tabular-nums">{fmt.format(row.leads)} leads</span>
                        <ConvBadge rate={row.conversionRate} />
                      </div>
                    </div>
                    <div className="h-1 bg-muted/30 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max((row.visitors / (sortedCampaigns[0]?.visitors || 1)) * 100, 1)}%`, backgroundColor: GOLD }} />
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {sortedSources.length > 0 && (
            <Section title="Fontes de Tráfego" icon={<Wifi className="h-4 w-4 text-blue-500" />} description="Por utm_source">
              <div className="space-y-2.5">
                {sortedSources.slice(0, 8).map(row => (
                  <div key={row.source}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-medium text-foreground truncate" title={row.source}>{row.source}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] text-muted-foreground tabular-nums">{fmt.format(row.visitors)}</span>
                        <ConvBadge rate={row.conversionRate} />
                      </div>
                    </div>
                    <div className="h-1 bg-muted/30 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max((row.visitors / (sortedSources[0]?.visitors || 1)) * 100, 1)}%`, backgroundColor: BLUE }} />
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {sortedContent.filter(c => c.content !== '(sem conteúdo)').length > 0 && (
            <Section title="Criativos / Conteúdo" icon={<Image className="h-4 w-4 text-violet-500" />} description="Por utm_content">
              <div className="space-y-2.5">
                {sortedContent.filter(c => c.content !== '(sem conteúdo)').slice(0, 8).map(row => (
                  <div key={row.content}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-medium text-foreground truncate" title={row.content}>{row.content}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] text-muted-foreground tabular-nums">{fmt.format(row.visitors)}</span>
                        <ConvBadge rate={row.conversionRate} />
                      </div>
                    </div>
                    <div className="h-1 bg-muted/30 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max((row.visitors / (sortedContent[0]?.visitors || 1)) * 100, 1)}%`, backgroundColor: VIOLET }} />
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}

      {/* ═══ Top Pages + Event Types ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="Páginas Mais Visitadas" icon={<ExternalLink className="h-4 w-4 text-[#C9A96E]" />} description="Pageviews por URL">
          <div className="space-y-2.5">
            {data.topPages.slice(0, 8).map((row, idx) => (
              <div key={row.url} className="group">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] text-muted-foreground tabular-nums w-4 text-right shrink-0">{idx + 1}</span>
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-[11px] font-medium text-foreground truncate cursor-default hover:text-[#C9A96E] transition-colors">{truncateUrl(row.url)}</span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-[10px] max-w-sm break-all">{row.url}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {row.leads > 0 && <Badge variant="secondary" className="h-4 px-1 text-[9px] font-medium bg-emerald-500/10 text-emerald-600">{row.leads} leads</Badge>}
                    <span className="text-[10px] font-medium text-foreground tabular-nums">{fmt.format(row.views)}</span>
                  </div>
                </div>
                <div className="h-1 bg-muted/30 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max((row.views / (data.topPages[0]?.views || 1)) * 100, 1)}%`, backgroundColor: GOLD }} />
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Distribuição de Eventos" icon={<Hash className="h-4 w-4 text-amber-500" />} description="Tipos de eventos rastreados">
          <div className="space-y-3">
            {data.byEventType.map(row => {
              const color = getEventTypeColor(row.eventType);
              const totalEvts = data.byEventType.reduce((s, e) => s + e.count, 0);
              return (
                <div key={row.eventType}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                      <span className="text-[11px] font-medium text-foreground capitalize">{row.eventType.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground tabular-nums">{fmtPct((row.count / totalEvts) * 100)}</span>
                      <span className="text-[11px] font-bold text-foreground tabular-nums">{fmt.format(row.count)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max((row.count / (data.byEventType[0]?.count || 1)) * 100, 1)}%`, backgroundColor: color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      </div>

      {/* ═══ Geo + Device + Hourly ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {data.topCountries.length > 0 && (
          <Section title="Países" icon={<Globe className="h-4 w-4 text-emerald-500" />} description="Visitantes por localização">
            <div className="space-y-2.5">
              {data.topCountries.slice(0, 8).map(row => (
                <div key={row.country}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[11px] font-medium text-foreground truncate">{row.country}</span>
                    </div>
                    <span className="text-[11px] font-medium text-foreground tabular-nums shrink-0">{fmt.format(row.visitors)}</span>
                  </div>
                  <div className="h-1 bg-muted/30 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max((row.visitors / (data.topCountries[0]?.visitors || 1)) * 100, 1)}%`, backgroundColor: EMERALD }} />
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {data.deviceBreakdown.length > 0 && (
          <Section title="Dispositivos" icon={<Monitor className="h-4 w-4 text-blue-500" />} description="Desktop, mobile e tablet">
            <div className="space-y-3">
              {data.deviceBreakdown.map(row => {
                const pct = totalDeviceVisitors > 0 ? (row.visitors / totalDeviceVisitors) * 100 : 0;
                return (
                  <div key={row.device} className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-muted/30 flex items-center justify-center text-muted-foreground shrink-0">
                      {DEVICE_ICONS[row.device] ?? DEVICE_ICONS.Outro}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-medium text-foreground">{row.device}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground tabular-nums">{fmt.format(row.visitors)}</span>
                          <span className="text-[10px] font-bold text-foreground tabular-nums">{fmtPct(pct)}</span>
                        </div>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {data.hourlyData.length > 0 && (
          <Section title="Distribuição Horária" icon={<Clock className="h-4 w-4 text-amber-500" />} description="Picos de atividade por hora">
            <div className="space-y-3">
              <div className="flex items-end gap-[2px]" style={{ height: '120px' }}>
                {Array.from({ length: 24 }, (_, h) => {
                  const found = data.hourlyData.find(x => x.hour === h);
                  const visitors = found?.visitors ?? 0;
                  const pct = (visitors / maxHourly) * 100;
                  const isNow = new Date().getHours() === h && period === '24h';
                  return (
                    <TooltipProvider key={h} delayDuration={50}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex-1 flex flex-col items-center gap-0.5 min-w-0 cursor-default">
                            <div className="w-full rounded-t-sm transition-all duration-300" style={{ height: `${Math.max(pct, 2)}%`, backgroundColor: isNow ? ROSE : visitors > 0 ? GOLD : 'transparent', opacity: visitors > 0 ? (pct / 100) * 0.6 + 0.4 : 0.15, minHeight: '2px' }} />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent className="text-[10px]">
                          <div><b>{String(h).padStart(2, '0')}:00</b></div>
                          <div>Visitantes: {visitors}</div>
                          {found && <div>Eventos: {found.events}</div>}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  );
                })}
              </div>
              <div className="flex justify-between text-[8px] text-muted-foreground">
                <span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>23h</span>
              </div>
            </div>
          </Section>
        )}
      </div>

      {/* ═══ Referrers + Cities ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {data.referrerBreakdown.length > 0 && (
          <Section title="Referrers" icon={<ExternalLink className="h-4 w-4 text-blue-400" />} description="De onde os visitantes chegam">
            <div className="space-y-2.5">
              {data.referrerBreakdown.slice(0, 10).map(row => {
                const totalRef = data.referrerBreakdown.reduce((s, r) => s + r.visitors, 0);
                const pct = totalRef > 0 ? (row.visitors / totalRef) * 100 : 0;
                return (
                  <div key={row.referrer}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-medium text-foreground truncate">{row.referrer}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-muted-foreground tabular-nums">{fmtPct(pct)}</span>
                        <span className="text-[11px] font-medium text-foreground tabular-nums">{fmt.format(row.visitors)}</span>
                      </div>
                    </div>
                    <div className="h-1 bg-muted/30 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max((row.visitors / (data.referrerBreakdown[0]?.visitors || 1)) * 100, 1)}%`, backgroundColor: BLUE }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {data.topCities.length > 0 && (
          <Section title="Cidades" icon={<MapPin className="h-4 w-4 text-rose-500" />} description="Maiores centros de visitantes">
            <div className="space-y-2.5">
              {data.topCities.slice(0, 8).map(row => (
                <div key={row.city}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-[11px] font-medium text-foreground truncate">{row.city}{row.country ? ` — ${row.country}` : ''}</span>
                    </div>
                    <span className="text-[11px] font-medium text-foreground tabular-nums shrink-0">{fmt.format(row.visitors)}</span>
                  </div>
                  <div className="h-1 bg-muted/30 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max((row.visitors / (data.topCities[0]?.visitors || 1)) * 100, 1)}%`, backgroundColor: ROSE }} />
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>

      {/* ═══ Recent Leads ═══ */}
      {data.recentLeads.length > 0 && (
        <Section title="Leads Recentes" icon={<UserCheck className="h-4 w-4 text-emerald-500" />} description={`${data.recentLeads.length} leads capturados recentemente via tracking`}>
          <div className="overflow-x-auto -mx-5 sm:mx-0">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-2 px-2 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Lead</th>
                  <th className="text-left py-2 px-2 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Fonte</th>
                  <th className="text-left py-2 px-2 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Campanha</th>
                  <th className="text-left py-2 px-2 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Local</th>
                  <th className="text-left py-2 px-2 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Página</th>
                  <th className="text-right py-2 px-2 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Quando</th>
                </tr>
              </thead>
              <tbody>
                {data.recentLeads.map(lead => (
                  <tr key={lead.visitorId} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                    <td className="py-2 px-2"><span className="font-medium text-foreground">{lead.clientName ?? '—'}</span></td>
                    <td className="py-2 px-2">
                      {lead.utmSource ? <Badge variant="secondary" className="h-4 px-1 text-[9px] bg-blue-500/10 text-blue-600">{lead.utmSource}</Badge> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-2 px-2 text-muted-foreground truncate max-w-[120px]" title={lead.utmCampaign ?? ''}>{lead.utmCampaign ?? '—'}</td>
                    <td className="py-2 px-2 text-muted-foreground">{[lead.city, lead.country].filter(Boolean).join(', ') || '—'}</td>
                    <td className="py-2 px-2 text-muted-foreground truncate max-w-[150px]" title={lead.pageUrl ?? ''}>{lead.pageUrl ? truncateUrl(lead.pageUrl, 30) : '—'}</td>
                    <td className="py-2 px-2 text-right text-muted-foreground whitespace-nowrap">{relativeTime(lead.convertedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* ═══ Meta Discrepancy ═══ */}
      <Card className={cn('border',
        data.metaDiscrepancy.matchRate >= 80 ? 'border-emerald-500/20' :
        data.metaDiscrepancy.matchRate >= 50 ? 'border-amber-500/20' :
        'border-rose-500/20',
      )}>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
            {data.metaDiscrepancy.matchRate >= 80 ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> :
             data.metaDiscrepancy.matchRate >= 50 ? <ShieldAlert className="h-4 w-4 text-amber-600" /> :
             <ShieldX className="h-4 w-4 text-rose-600" />}
            Discrepância Meta Pixel vs CRM
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 sm:px-6 pb-5">
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-xl bg-muted/20 border border-border/50 p-4 text-center">
              <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Pixel Leads</p>
              <p className="text-xl font-bold text-foreground tabular-nums">{fmt.format(data.metaDiscrepancy.pixelLeads)}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">Detectados pelo tracking</p>
            </div>
            <div className="rounded-xl bg-muted/20 border border-border/50 p-4 text-center">
              <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-1">CRM Meta Leads</p>
              <p className="text-xl font-bold text-foreground tabular-nums">{fmt.format(data.metaDiscrepancy.crmMetaLeads)}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">Registrados no CRM</p>
            </div>
            <div className={cn('rounded-xl border p-4 text-center',
              data.metaDiscrepancy.matchRate >= 80 ? 'bg-emerald-500/5 border-emerald-500/20' :
              data.metaDiscrepancy.matchRate >= 50 ? 'bg-amber-500/5 border-amber-500/20' :
              'bg-rose-500/5 border-rose-500/20',
            )}>
              <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Match Rate</p>
              <p className={cn('text-xl font-bold tabular-nums',
                data.metaDiscrepancy.matchRate >= 80 ? 'text-emerald-600' :
                data.metaDiscrepancy.matchRate >= 50 ? 'text-amber-600' : 'text-rose-600',
              )}>{fmtPct(data.metaDiscrepancy.matchRate)}</p>
              <div className="mt-1.5 h-1.5 bg-muted/50 rounded-full overflow-hidden">
                <div className={cn('h-full rounded-full transition-all duration-700',
                  data.metaDiscrepancy.matchRate >= 80 ? 'bg-emerald-500' :
                  data.metaDiscrepancy.matchRate >= 50 ? 'bg-amber-500' : 'bg-rose-500',
                )} style={{ width: `${Math.max(data.metaDiscrepancy.matchRate, 2)}%` }} />
              </div>
              <p className="text-[9px] text-muted-foreground mt-1">
                {data.metaDiscrepancy.matchRate >= 80 ? 'Boa concordância entre pixel e CRM' :
                 data.metaDiscrepancy.matchRate >= 50 ? 'Concordância parcial — verifique UTM params' :
                 'Baixa concordância — leads podem não estar vinculados'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ═══ Setup Instructions ═══ */}
      <Card className="border-border/50">
        <CardContent className="p-0">
          <button onClick={() => setSetupOpen(!setupOpen)} className="w-full flex items-center justify-between p-4 hover:bg-muted/20 transition-colors rounded-t-xl">
            <div className="flex items-center gap-2">
              <FileCode className="h-4 w-4 text-[#C9A96E]" />
              <span className="text-xs font-semibold text-foreground">Instruções de Setup do Pixel</span>
            </div>
            {setupOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>
          {setupOpen && (
            <div className="px-5 pb-5 space-y-4 border-t border-border/50 pt-4">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <Globe className="h-3.5 w-3.5 text-[#C9A96E]" />
                  <h4 className="text-[10px] font-semibold text-foreground uppercase tracking-wider">1. Client-side</h4>
                </div>
                <CodeBlock language="html" code={'<script src="https://SEU-DOMINIO/pixel.js" data-site-id="default"></script>'} />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <Zap className="h-3.5 w-3.5 text-[#C9A96E]" />
                  <h4 className="text-[10px] font-semibold text-foreground uppercase tracking-wider">2. Server-side</h4>
                </div>
                <CodeBlock language="bash" code={`curl -X POST https://SEU-DOMINIO/api/track/server \\
  -H "Content-Type: application/json" \\
  -H "x-tracking-key: crm-tracking-2024" \\
  -d '{"eventType":"lead","visitorId":"VISITOR_ID"}'`} />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                  <h4 className="text-[10px] font-semibold text-foreground uppercase tracking-wider">3. UTM Parameters</h4>
                </div>
                <CodeBlock language="url" code={`https://seu-site.com/landing?utm_source=meta&utm_medium=cpc&utm_campaign=CAMPANHA&utm_content=CRIATIVO`} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </TooltipProvider>
  );
}