'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Users, Eye, Zap, Target, TrendingUp, ArrowDownRight, Copy, Check,
  ChevronDown, ChevronUp, ShieldCheck, ShieldAlert, ShieldX,
  MousePointerClick, Globe, FileCode, AlertTriangle, BarChart3,
  Activity, Trophy, Trash2, Loader2, Monitor, Smartphone, Tablet,
  MapPin, Clock, ExternalLink, UserCheck, Layers, Hash, ArrowRight,
  CircleDot, Wifi, Image, Gauge, FileText, Timer, LogOut, DoorOpen,
  Repeat, CalendarDays, ScrollText, MousePointer, FormInput,
  Heart, Bug, LayoutGrid, MessageCircleQuestion, Camera, AlertCircle,
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
  whatsappClicks: number;
  totalConversions: number;
  uniqueSessions: number;
  conversionRate: number;
  realConversionRate: number;
  avgEventsPerVisitor: number;
  bounceRate: number;
  pageviewsPerSession: number;
  avgSessionDuration: number;
  returningVisitors: number;
  newVisitors: number;
  returningRate: number;
  exitIntents: number;
  exitIntentRate: number;
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
  eventType: string | null;
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

interface MediumRow { medium: string; visitors: number; leads: number; conversionRate: number; }
interface TermRow { term: string; visitors: number; leads: number; conversionRate: number; }
interface ScrollDepthRow { depth: string | null; count: number; }
interface FormInteractionRow { eventType: string; eventName: string | null; count: number; }
interface WebVitalRow { metric: string; avgValue: number; p75: number; count: number; }
interface EngagedTimeRow { seconds: number; count: number; }
interface JsErrorRow { message: string; count: number; latest: string; }
interface SectionViewRow { section: string; views: number; uniqueVisitors: number; }
interface CtaClickRow { ctaText: string; section: string; clicks: number; uniqueVisitors: number; }
interface FormFunnelRow { stage: string; count: number; }
interface VisitorContextRow { contextType: string; contextValue: string; visitors: number; }
interface ContentEngagementRow { eventType: string; label: string; count: number; }
interface EntryPageRow { url: string; count: number; }
interface DayOfWeekRow { dow: number; dowName: string; visitors: number; leads: number; conversionRate: number; }

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
  byMedium: MediumRow[];
  byTerm: TermRow[];
  byEventType: EventTypeRow[];
  topPages: TopPage[];
  topEntryPages: EntryPageRow[];
  topCountries: GeoRow[];
  topCities: CityRow[];
  deviceBreakdown: DeviceRow[];
  hourlyData: HourRow[];
  recentLeads: RecentLead[];
  referrerBreakdown: ReferrerRow[];
  metaDiscrepancy: MetaDiscrepancy;
  scrollDepth: ScrollDepthRow[];
  formInteractions: FormInteractionRow[];
  engagementByDayOfWeek: DayOfWeekRow[];
  webVitals: WebVitalRow[];
  engagedTime: EngagedTimeRow[];
  jsErrors: JsErrorRow[];
  sectionViews: SectionViewRow[];
  ctaClicks: CtaClickRow[];
  formFunnel: FormFunnelRow[];
  visitorContext: VisitorContextRow[];
  contentEngagement: ContentEngagementRow[];
}

// ============================================================
// Helpers
// ============================================================
const fmt = new Intl.NumberFormat('pt-BR');
const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const fmtDec = (n: number) => n.toFixed(1);

const GOLD = '#C9A96E';
const GOLD_LIGHT = 'rgba(201, 169, 110, 0.15)';
const CHART_POSITIVE = 'var(--chart-1)';
const CHART_POSITIVE_LIGHT = 'color-mix(in srgb, var(--chart-1) 12%, transparent)';
const CHART_BLUE = 'var(--chart-6)';
const CHART_BLUE_LIGHT = 'color-mix(in srgb, var(--chart-6) 12%, transparent)';
const CHART_VIOLET = 'var(--chart-3)';
const ROSE = '#F43F5E';
const AMBER = '#F59E0B';

const PERIOD_OPTIONS = [
  { value: '24h', label: '24 horas' },
  { value: '48h', label: '48 horas' },
  { value: '7d', label: '7 dias' },
  { value: '15d', label: '15 dias' },
  { value: '30d', label: '30 dias' },
];

const WHATSAPP = '#25D366';
const WHATSAPP_LIGHT = 'rgba(37, 211, 102, 0.12)';

const FUNNEL_LABELS: Record<string, string> = {
  Pageview: 'Visualização de Página',
  Engagement: 'Engajamento',
  WhatsApp: 'Clique em WhatsApp',
  Lead: 'Lead Capturado',
};

const FUNNEL_COLORS: Record<string, string> = {
  Pageview: GOLD,
  Engagement: CHART_BLUE,
  WhatsApp: WHATSAPP,
  Lead: CHART_POSITIVE,
};

const FUNNEL_BG: Record<string, string> = {
  Pageview: GOLD_LIGHT,
  Engagement: CHART_BLUE_LIGHT,
  WhatsApp: WHATSAPP_LIGHT,
  Lead: CHART_POSITIVE_LIGHT,
};

const DEVICE_ICONS: Record<string, React.ReactNode> = {
  Desktop: <Monitor className="h-4 w-4" />,
  Mobile: <Smartphone className="h-4 w-4" />,
  Tablet: <Tablet className="h-4 w-4" />,
  Outro: <Layers className="h-4 w-4" />,
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  pageview: GOLD,
  engagement: CHART_BLUE,
  form_submit: CHART_POSITIVE,
  lead: '#22D3EE',
  click: CHART_VIOLET,
  scroll: AMBER,
  whatsapp_click: WHATSAPP,
  exit_intent: ROSE,
  scroll_depth: 'var(--chart-1)',
  form_focus: 'var(--chart-6)',
  form_blur: '#60A5FA',
  form_abandon: '#F43F5E',
  section_view: '#0EA5E9',
  cta_click: '#F97316',
  gallery_click: '#EC4899',
  faq_open: 'var(--chart-3)',
  engaged_time: 'var(--chart-1)',
  web_vital: '#06B6D4',
  js_error: '#EF4444',
  form_view: 'var(--chart-6)',
  form_submit_attempt: '#F59E0B',
  form_submit_error: '#EF4444',
};

const DAY_LABELS: Record<string, string> = {
  'Sunday': 'Dom', 'Monday': 'Seg', 'Tuesday': 'Ter', 'Wednesday': 'Qua',
  'Thursday': 'Qui', 'Friday': 'Sex', 'Saturday': 'Sáb',
};

function getEventTypeColor(type: string): string {
  return EVENT_TYPE_COLORS[type] ?? '#94A3B8';
}

// Web Vitals helpers
const VITAL_LABELS: Record<string, string> = {
  LCP: 'Largest Contentful Paint',
  FCP: 'First Contentful Paint',
  TTFB: 'Time to First Byte',
  CLS: 'Cumulative Layout Shift',
  FID: 'First Input Delay',
  INP: 'Interaction to Next Paint',
};

const VITAL_UNITS: Record<string, string> = {
  CLS: '',
};

function getVitalHealth(metric: string, value: number): { label: string; color: string; bg: string } {
  const thresholds: Record<string, [number, number]> = {
    LCP: [2500, 4000],
    FCP: [1800, 3000],
    TTFB: [800, 1800],
    CLS: [0.1, 0.25],
    FID: [100, 300],
    INP: [200, 500],
  };
  const [good, poor] = thresholds[metric] ?? [Infinity, Infinity];
  if (value <= good) return { label: 'Bom', color: 'bg-success', bg: 'bg-success/10 text-success' };
  if (value <= poor) return { label: 'Precisa melhorar', color: 'bg-amber-500', bg: 'bg-amber-500/10 text-amber-600' };
  return { label: 'Ruim', color: 'bg-red-500', bg: 'bg-red-500/10 text-red-600' };
}

const FORM_FUNNEL_STAGES = [
  { key: 'form_view', label: 'Visualização do Form', color: CHART_BLUE },
  { key: 'form_focus', label: 'Foco no Campo', color: '#60A5FA' },
  { key: 'form_submit_attempt', label: 'Tentativa de Envio', color: AMBER },
  { key: 'form_submit', label: 'Envio Concluído', color: CHART_POSITIVE },
  { key: 'form_submit_error', label: 'Erro no Envio', color: ROSE },
];

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
      rate >= 5 ? 'bg-success/10 text-success' :
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
        const errBody = await res.json().catch(() => ({}));
        toast.error(`Erro ao carregar tracking (${res.status}): ${errBody.details ?? 'desconhecido'}`);
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
        const errBody = await res.json().catch(() => ({}));
        toast.error(`Erro ao gerar relatório (${res.status}): ${errBody.details ?? 'desconhecido'}`);
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
    { label: 'Visitantes Únicos', value: fmt.format(m.totalVisitors), icon: <Users className="h-5 w-5 text-white" />, iconBg: 'bg-gradient-to-br from-[#C9A96E] to-[#A8894F]', subtitle: `${fmtDec(m.avgEventsPerVisitor)} eventos/visitante` },
    { label: 'Pageviews', value: fmt.format(m.totalPageviews), icon: <Eye className="h-5 w-5 text-white" />, iconBg: 'bg-gradient-to-br from-blue-500 to-blue-700', subtitle: `${fmtDec(m.pageviewsPerSession)} por sessão` },
    { label: 'Eventos Totais', value: fmt.format(m.totalEvents), icon: <Zap className="h-5 w-5 text-white" />, iconBg: 'bg-gradient-to-br from-amber-500 to-orange-600', subtitle: `${data.byEventType.length} tipos registrados` },
    { label: 'Leads Rastreados', value: fmt.format(m.uniqueLeads), icon: <Target className="h-5 w-5" />, iconBg: 'bg-primary text-primary-foreground', subtitle: 'visitantes vinculados ao CRM' },
    ...(m.whatsappClicks > 0 ? [{ label: 'Cliques WhatsApp', value: fmt.format(m.whatsappClicks), icon: <Wifi className="h-5 w-5 text-white" />, iconBg: 'bg-gradient-to-br from-[#25D366] to-[#128C7E]', subtitle: `${m.totalConversions} conversões no total` }] : []),
    { label: 'Conversão Real', value: fmtPct(m.realConversionRate ?? m.conversionRate), icon: <TrendingUp className="h-5 w-5 text-white" />, iconBg: 'bg-gradient-to-br from-violet-500 to-purple-700', subtitle: 'leads + WhatsApp' },
    { label: 'Rejeição', value: fmtPct(m.bounceRate), icon: <ArrowDownRight className="h-5 w-5 text-white" />, iconBg: 'bg-gradient-to-br from-rose-500 to-pink-700', subtitle: '1 pageview, sem interação' },
    { label: 'Sessões', value: fmt.format(m.uniqueSessions), icon: <CircleDot className="h-5 w-5 text-white" />, iconBg: 'bg-gradient-to-br from-cyan-500 to-cyan-700', subtitle: `${fmtDec(m.pageviewsPerSession)} pvs/sessão` },
    { label: 'Duração Média', value: m.avgSessionDuration >= 60 ? `${Math.round(m.avgSessionDuration / 60)}m ${Math.round(m.avgSessionDuration % 60)}s` : `${Math.round(m.avgSessionDuration)}s`, icon: <Timer className="h-5 w-5" />, iconBg: 'bg-chart-2 text-brand-midnight', subtitle: 'tempo médio por sessão' },
    { label: 'Visitantes Recorrentes', value: fmtPct(m.returningRate), icon: <Repeat className="h-5 w-5 text-white" />, iconBg: 'bg-gradient-to-br from-purple-500 to-fuchsia-700', subtitle: `${fmt.format(m.returningVisitors)} de ${fmt.format(m.totalVisitors)}` },
    { label: 'Intenções de Saída', value: fmt.format(m.exitIntents), icon: <LogOut className="h-5 w-5 text-white" />, iconBg: 'bg-gradient-to-br from-red-400 to-red-600', subtitle: `${fmtPct(m.exitIntentRate)} dos visitantes` },
    { label: 'Novos Visitantes', value: fmt.format(m.newVisitors), icon: <UserCheck className="h-5 w-5 text-white" />, iconBg: 'bg-gradient-to-br from-sky-500 to-blue-700', subtitle: `${fmtPct(100 - m.returningRate)} do total` },
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
                  <p className="text-xl font-bold text-foreground tracking-tight tabular-nums">{kpi.value}</p>
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
        <Section title="Funil de Conversão" icon={<BarChart3 className="h-4 w-4 text-[#C9A96E]" />} description="Pageview → Engajamento → WhatsApp → Lead">
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
            <div className="pt-2 border-t border-border/50 flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Conversão Real (leads + WhatsApp)</span>
              <span className="text-sm font-bold text-success tabular-nums">{fmtPct(m.realConversionRate ?? m.conversionRate)}</span>
            </div>
          </div>
        </Section>

        {/* Daily Chart */}
        <Section title="Tendência Diária" icon={<TrendingUp className="h-4 w-4 text-[#C9A96E]" />} description="Visitantes e leads por dia">
          <div>
            <div className="flex items-center gap-4 mb-3 text-[10px]">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: GOLD }} /><span className="text-muted-foreground">Visitantes</span></span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_POSITIVE }} /><span className="text-muted-foreground">Leads</span></span>
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
                              <div className="w-[45%] max-w-[12px] rounded-t-sm transition-all duration-500" style={{ height: `${Math.max(lH, 1)}%`, background: `linear-gradient(to top, ${CHART_POSITIVE}, color-mix(in srgb, var(--chart-1) 30%, transparent))` }} />
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

      {/* ═══ UTM: Campaigns + Sources + Content + Medium + Term ═══ */}
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
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max((row.visitors / (sortedSources[0]?.visitors || 1)) * 100, 1)}%`, backgroundColor: CHART_BLUE }} />
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
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max((row.visitors / (sortedContent[0]?.visitors || 1)) * 100, 1)}%`, backgroundColor: CHART_VIOLET }} />
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}

      {/* UTM Medium + Term (second row) */}
      {hasUtmData && (data.byMedium?.length > 0 || data.byTerm?.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {data.byMedium && data.byMedium.length > 0 && (
            <Section title="UTM Medium" icon={<Layers className="h-4 w-4 text-indigo-500" />} description="Canal de aquisição (cpc, cpm, organic...)">
              <div className="space-y-2.5">
                {[...data.byMedium].sort((a, b) => b.visitors - a.visitors).slice(0, 8).map(row => (
                  <div key={row.medium}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-medium text-foreground truncate" title={row.medium}>{row.medium}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] text-muted-foreground tabular-nums">{fmt.format(row.visitors)}</span>
                        <ConvBadge rate={row.conversionRate} />
                      </div>
                    </div>
                    <div className="h-1 bg-muted/30 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max((row.visitors / ([...data.byMedium].sort((a, b) => b.visitors - a.visitors)[0]?.visitors || 1)) * 100, 1)}%`, backgroundColor: 'var(--chart-1)' }} />
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}
          {data.byTerm && data.byTerm.filter(t => t.term !== '(não definido)').length > 0 && (
            <Section title="UTM Term" icon={<Hash className="h-4 w-4 text-primary" />} description="Termos de busca / palavras-chave">
              <div className="space-y-2.5">
                {[...data.byTerm].filter(t => t.term !== '(não definido)').sort((a, b) => b.visitors - a.visitors).slice(0, 8).map(row => (
                  <div key={row.term}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-medium text-foreground truncate" title={row.term}>{row.term}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] text-muted-foreground tabular-nums">{fmt.format(row.visitors)}</span>
                        <ConvBadge rate={row.conversionRate} />
                      </div>
                    </div>
                    <div className="h-1 bg-muted/30 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max((row.visitors / ([...data.byTerm].filter(t => t.term !== '(não definido)').sort((a, b) => b.visitors - a.visitors)[0]?.visitors || 1)) * 100, 1)}%`, backgroundColor: 'var(--chart-2)' }} />
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
                    {row.leads > 0 && <Badge variant="secondary" className="h-4 px-1 text-[9px] font-medium bg-success/10 text-success">{row.leads} leads</Badge>}
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
            {data.byEventType.filter(r => r.eventType != null).map(row => {
              const color = getEventTypeColor(row.eventType!);
              const totalEvts = data.byEventType.reduce((s, e) => s + e.count, 0);
              return (
                <div key={row.eventType}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                      <span className="text-[11px] font-medium text-foreground capitalize">{(row.eventType ?? 'desconhecido').replace(/_/g, ' ')}</span>
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
          <Section title="Países" icon={<Globe className="h-4 w-4 text-primary" />} description="Visitantes por localização">
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
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max((row.visitors / (data.topCountries[0]?.visitors || 1)) * 100, 1)}%`, backgroundColor: CHART_POSITIVE }} />
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
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max((row.visitors / (data.referrerBreakdown[0]?.visitors || 1)) * 100, 1)}%`, backgroundColor: CHART_BLUE }} />
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

      {/* ═══ Entry Pages + Day of Week + Scroll Depth ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {data.topEntryPages && data.topEntryPages.length > 0 && (
          <Section title="Páginas de Entrada" icon={<DoorOpen className="h-4 w-4 text-sky-500" />} description="Primeira página visitada por cada visitante">
            <div className="space-y-2.5">
              {data.topEntryPages.slice(0, 8).map((row, idx) => {
                const maxEntry = data.topEntryPages[0]?.count || 1;
                return (
                  <div key={row.url} className="group">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] text-muted-foreground tabular-nums w-4 text-right shrink-0">{idx + 1}</span>
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-[11px] font-medium text-foreground truncate cursor-default hover:text-sky-500 transition-colors">{truncateUrl(row.url)}</span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-[10px] max-w-sm break-all">{row.url}</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <span className="text-[11px] font-medium text-foreground tabular-nums shrink-0">{fmt.format(row.count)}</span>
                    </div>
                    <div className="h-1 bg-muted/30 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max((row.count / maxEntry) * 100, 1)}%`, backgroundColor: '#0EA5E9' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {data.engagementByDayOfWeek && data.engagementByDayOfWeek.length > 0 && (
          <Section title="Engajamento por Dia da Semana" icon={<CalendarDays className="h-4 w-4 text-violet-500" />} description="Qual dia gera mais visitantes e leads">
            <div className="space-y-2.5">
              {[...data.engagementByDayOfWeek].sort((a, b) => b.visitors - a.visitors).map(row => {
                const maxDay = Math.max(...data.engagementByDayOfWeek.map(d => d.visitors), 1);
                const dayLabel = DAY_LABELS[row.dowName] ?? row.dowName?.slice(0, 3);
                return (
                  <div key={row.dow}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-medium text-foreground w-8">{dayLabel}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] text-muted-foreground tabular-nums">{fmt.format(row.visitors)} vis</span>
                        {row.leads > 0 && <span className="text-[10px] text-success tabular-nums">{row.leads} leads</span>}
                        <ConvBadge rate={row.conversionRate} />
                      </div>
                    </div>
                    <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max((row.visitors / maxDay) * 100, 2)}%`, backgroundColor: 'var(--chart-3)' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {data.scrollDepth && data.scrollDepth.length > 0 && (
          <Section title="Profundidade de Scroll" icon={<ScrollText className="h-4 w-4 text-indigo-500" />} description="Até onde os visitantes rolam a página">
            <div className="space-y-2.5">
              {data.scrollDepth.filter(r => r.depth != null).map(row => {
                const totalScroll = data.scrollDepth.reduce((s, r) => s + r.count, 0);
                const pct = totalScroll > 0 ? (row.count / totalScroll) * 100 : 0;
                const depthPct = parseInt((row.depth ?? '0%').replace(/[^0-9]/g, ''), 10);
                const barColor = depthPct >= 75 ? 'var(--success)' : depthPct >= 50 ? 'var(--info)' : depthPct >= 25 ? 'var(--warning)' : 'var(--destructive)';
                return (
                  <div key={row.depth}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: barColor }} />
                        <span className="text-[11px] font-medium text-foreground">{row.depth}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground tabular-nums">{fmtPct(pct)}</span>
                        <span className="text-[11px] font-bold text-foreground tabular-nums">{fmt.format(row.count)}</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: barColor }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}
      </div>

      {/* ═══ Form Interactions ═══ */}
      {data.formInteractions && data.formInteractions.length > 0 && (
        <Section title="Interações com o Formulário" icon={<FormInput className="h-4 w-4 text-blue-500" />} description="Foco, saída e abandono de campos do formulário">
          <div className="overflow-x-auto -mx-5 sm:mx-0">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-2 px-2 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Tipo</th>
                  <th className="text-left py-2 px-2 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Campo</th>
                  <th className="text-right py-2 px-2 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Eventos</th>
                </tr>
              </thead>
              <tbody>
                {data.formInteractions.map((row, idx) => {
                  const typeLabel = row.eventType === 'form_focus' ? 'Foco no Campo' : row.eventType === 'form_blur' ? 'Saída do Campo' : 'Abandono';
                  const typeColor = row.eventType === 'form_focus' ? 'text-blue-600 bg-blue-500/10' : row.eventType === 'form_blur' ? 'text-sky-600 bg-sky-500/10' : 'text-rose-600 bg-rose-500/10';
                  return (
                    <tr key={`${row.eventType}-${row.eventName}-${idx}`} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                      <td className="py-2 px-2"><Badge variant="secondary" className={cn('h-4 px-1 text-[9px]', typeColor)}>{typeLabel}</Badge></td>
                      <td className="py-2 px-2 text-foreground font-medium truncate max-w-[200px]" title={row.eventName ?? ''}>{row.eventName ?? '—'}</td>
                      <td className="py-2 px-2 text-right tabular-nums font-medium text-foreground">{fmt.format(row.count)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 rounded-lg bg-muted/20 border border-border/50 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                <b>form_focus</b> = visitante clicou no campo · <b>form_blur</b> = saiu sem preencher · <b>form_abandon</b> = saiu da página com campos pendentes. Campos com alto abandono indicam pontos de fricção na conversão.
              </p>
            </div>
          </div>
        </Section>
      )}

      {/* ═══ Recent Leads ═══ */}
      {data.recentLeads.length > 0 && (
        <Section title="Leads Recentes" icon={<UserCheck className="h-4 w-4 text-primary" />} description={`${data.recentLeads.length} leads capturados recentemente via tracking`}>
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

      {/* ═══ Web Vitals + Engaged Time ═══ */}
      {data.webVitals && data.webVitals.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Section title="Core Web Vitals" icon={<Gauge className="h-4 w-4 text-cyan-500" />} description="Performance real dos visitantes (média + P75)">
            <div className="space-y-3">
              {data.webVitals.map(v => {
                const health = getVitalHealth(v.metric, v.avgValue);
                return (
                  <div key={v.metric} className="rounded-lg border border-border/50 p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className={cn('h-2 w-2 rounded-full', health.color)} />
                        <span className="text-[11px] font-semibold text-foreground">{VITAL_LABELS[v.metric] ?? v.metric}</span>
                        <span className="text-[9px] text-muted-foreground">n={fmt.format(v.count)}</span>
                      </div>
                      <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded', health.bg)}>{health.label}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded bg-muted/30 px-2.5 py-1.5 text-center">
                        <p className="text-[9px] text-muted-foreground uppercase">Média</p>
                        <p className="text-sm font-bold text-foreground tabular-nums">{v.avgValue}{VITAL_UNITS[v.metric] ?? 'ms'}</p>
                      </div>
                      <div className="rounded bg-muted/30 px-2.5 py-1.5 text-center">
                        <p className="text-[9px] text-muted-foreground uppercase">P75</p>
                        <p className="text-sm font-bold text-foreground tabular-nums">{v.p75}{VITAL_UNITS[v.metric] ?? 'ms'}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div className="pt-1 rounded-lg bg-muted/20 border border-border/50 p-2.5">
                <div className="flex items-start gap-2">
                  <InfoTip text="LCP: velocidade de carregamento do conteúdo principal. FCP: primeira renderização. TTFB: tempo de resposta do servidor. CLS: estabilidade visual. INP: responsividade a interações. FID: atraso na primeira interação." />
                  <p className="text-[9px] text-muted-foreground leading-relaxed"><b>Verde</b> = bom · <b>Amarelo</b> = precisa melhorar · <b>Vermelho</b> = ruim. Valores baseados nos thresholds do Google.</p>
                </div>
              </div>
            </div>
          </Section>
          {data.engagedTime && data.engagedTime.length > 0 && (
            <Section title="Tempo de Engajamento" icon={<Heart className="h-4 w-4 text-rose-500" />} description="Visitantes que permaneceram engajados por cada tempo">
              <div className="space-y-3">
                {data.engagedTime.map(row => {
                  const totalEngaged = data.engagedTime.reduce((s, r) => s + r.count, 0);
                  const pct = totalEngaged > 0 ? (row.count / totalEngaged) * 100 : 0;
                  const barColor = row.seconds >= 180 ? 'var(--success)' : row.seconds >= 60 ? 'var(--info)' : row.seconds >= 30 ? 'var(--warning)' : 'var(--destructive)';
                  return (
                    <div key={row.seconds}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: barColor }} />
                          <span className="text-[11px] font-medium text-foreground">{row.seconds >= 60 ? `${row.seconds / 60}min` : `${row.seconds}s`}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground tabular-nums">{fmtPct(pct)}</span>
                          <span className="text-[11px] font-bold text-foreground tabular-nums">{fmt.format(row.count)}</span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: barColor }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}
        </div>
      )}

      {/* ═══ JS Errors ═══ */}
      {data.jsErrors && data.jsErrors.length > 0 && (
        <Section title="Erros de JavaScript" icon={<Bug className="h-4 w-4 text-red-500" />} description={`${data.jsErrors.reduce((s, e) => s + e.count, 0)} erros JS detectados nos visitantes`}>
          <div className="overflow-x-auto -mx-5 sm:mx-0">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-2 px-2 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Erro</th>
                  <th className="text-right py-2 px-2 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Ocorrências</th>
                  <th className="text-right py-2 px-2 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Último</th>
                </tr>
              </thead>
              <tbody>
                {data.jsErrors.slice(0, 10).map((err, idx) => (
                  <tr key={`${err.message}-${idx}`} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                    <td className="py-2 px-2 text-rose-400 font-mono text-[10px] truncate max-w-[300px]" title={err.message}>{err.message}</td>
                    <td className="py-2 px-2 text-right tabular-nums font-medium text-foreground">{fmt.format(err.count)}</td>
                    <td className="py-2 px-2 text-right text-muted-foreground whitespace-nowrap text-[10px]">{relativeTime(err.latest)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* ═══ Section Views + CTA Clicks ═══ */}
      {(data.sectionViews && data.sectionViews.length > 0 || data.ctaClicks && data.ctaClicks.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {data.sectionViews && data.sectionViews.length > 0 && (
            <Section title="Visualização de Seções" icon={<LayoutGrid className="h-4 w-4 text-sky-500" />} description="Quais seções da página os visitantes veem">
              <div className="space-y-2.5">
                {[...data.sectionViews].sort((a, b) => b.views - a.views).slice(0, 10).map((row, idx) => {
                  const maxViews = data.sectionViews[0]?.views || 1;
                  return (
                    <div key={row.section}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] text-muted-foreground tabular-nums w-4 text-right shrink-0">{idx + 1}</span>
                          <span className="text-[11px] font-medium text-foreground truncate" title={row.section}>{row.section}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] text-muted-foreground tabular-nums">{fmt.format(row.uniqueVisitors)} únicos</span>
                          <span className="text-[11px] font-bold text-foreground tabular-nums">{fmt.format(row.views)}</span>
                        </div>
                      </div>
                      <div className="h-1 bg-muted/30 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max((row.views / maxViews) * 100, 1)}%`, backgroundColor: '#0EA5E9' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}
          {data.ctaClicks && data.ctaClicks.length > 0 && (
            <Section title="Cliques em CTAs" icon={<MousePointer className="h-4 w-4 text-orange-500" />} description="Botões de ação clicados pelos visitantes">
              <div className="space-y-2.5">
                {data.ctaClicks.slice(0, 10).map((row, idx) => {
                  const maxClicks = data.ctaClicks[0]?.clicks || 1;
                  return (
                    <div key={`${row.ctaText}-${row.section}`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] text-muted-foreground tabular-nums w-4 text-right shrink-0">{idx + 1}</span>
                          <div className="min-w-0">
                            <span className="text-[11px] font-medium text-foreground truncate block" title={row.ctaText}>{row.ctaText}</span>
                            <span className="text-[9px] text-muted-foreground truncate block">{row.section}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] text-muted-foreground tabular-nums">{fmt.format(row.uniqueVisitors)} únicos</span>
                          <span className="text-[11px] font-bold text-foreground tabular-nums">{fmt.format(row.clicks)}</span>
                        </div>
                      </div>
                      <div className="h-1 bg-muted/30 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max((row.clicks / maxClicks) * 100, 1)}%`, backgroundColor: '#F97316' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}
        </div>
      )}

      {/* ═══ Form Funnel ═══ */}
      {data.formFunnel && data.formFunnel.length > 0 && (
        <Section title="Funil do Formulário" icon={<FormInput className="h-4 w-4 text-blue-500" />} description="Etapas de interação com o formulário de captação">
          <div className="space-y-3">
            {FORM_FUNNEL_STAGES.map((stage, idx) => {
              const stageData = data.formFunnel.find(f => f.stage === stage.key);
              const count = stageData?.count ?? 0;
              const prevStage = idx > 0 ? FORM_FUNNEL_STAGES[idx - 1] : null;
              const prevCount = prevStage ? (data.formFunnel.find(f => f.stage === prevStage.key)?.count ?? 0) : 0;
              const dropOff = prevCount > 0 ? ((prevCount - count) / prevCount) * 100 : 0;
              const rate = prevCount > 0 ? (count / prevCount) * 100 : 100;
              return (
                <div key={stage.key}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
                      <span className="text-[11px] font-medium text-foreground">{stage.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {idx > 0 && dropOff > 0 && <span className="text-[10px] text-rose-500 tabular-nums">-{fmtPct(dropOff)}</span>}
                      {idx > 0 && <Badge variant="secondary" className="h-4 px-1 text-[9px] font-bold" style={{ backgroundColor: `color-mix(in srgb, ${stage.color} 12%, transparent)`, color: stage.color }}>{fmtPct(rate)}</Badge>}
                      <span className="text-xs font-bold text-foreground tabular-nums">{fmt.format(count)}</span>
                    </div>
                  </div>
                  <div className="h-6 rounded-lg overflow-hidden bg-muted/30">
                    <div className="h-full rounded-lg transition-all duration-700 ease-out flex items-center px-2" style={{ width: `${Math.max(rate, 3)}%`, backgroundColor: stage.color, opacity: 0.8 }}>
                      {rate >= 15 && <span className="text-[10px] font-bold text-white">{fmtPct(rate)}</span>}
                    </div>
                  </div>
                  {idx < FORM_FUNNEL_STAGES.length - 1 && <div className="flex justify-center py-1"><ArrowRight className="h-3 w-3 text-muted-foreground/30" /></div>}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ═══ Content Engagement ═══ */}
      {data.contentEngagement && data.contentEngagement.length > 0 && (
        <Section title="Engajamento de Conteúdo" icon={<MessageCircleQuestion className="h-4 w-4 text-violet-500" />} description="Galeria de imagens e perguntas frequentes">
          <div className="space-y-2.5">
            {data.contentEngagement.slice(0, 10).map((row, idx) => (
              <div key={`${row.eventType}-${row.label}-${idx}`}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="secondary" className={cn('h-4 px-1 text-[9px] shrink-0', row.eventType === 'gallery_click' ? 'bg-pink-500/10 text-pink-600' : 'bg-violet-500/10 text-violet-600')}>
                      {row.eventType === 'gallery_click' ? 'Galeria' : 'FAQ'}
                    </Badge>
                    <span className="text-[11px] font-medium text-foreground truncate" title={row.label}>{row.label}</span>
                  </div>
                  <span className="text-[11px] font-bold text-foreground tabular-nums shrink-0">{fmt.format(row.count)}</span>
                </div>
                <div className="h-1 bg-muted/30 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max((row.count / (data.contentEngagement[0]?.count || 1)) * 100, 1)}%`, backgroundColor: row.eventType === 'gallery_click' ? 'var(--chart-5)' : 'var(--chart-3)' }} />
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ═══ Visitor Context ═══ */}
      {data.visitorContext && data.visitorContext.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {(() => {
            const languages = data.visitorContext.filter(c => c.contextType === 'language');
            const connections = data.visitorContext.filter(c => c.contextType === 'connection');
            return (
              <>
                {languages.length > 0 && (
                  <Section title="Idioma do Navegador" icon={<Globe className="h-4 w-4 text-primary" />} description="Distribuição por idioma">
                    <div className="space-y-2.5">
                      {languages.slice(0, 8).map(row => {
                        const maxLang = languages[0]?.visitors || 1;
                        return (
                          <div key={row.contextValue}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[11px] font-medium text-foreground truncate">{row.contextValue}</span>
                              <span className="text-[11px] font-medium text-foreground tabular-nums shrink-0">{fmt.format(row.visitors)}</span>
                            </div>
                            <div className="h-1 bg-muted/30 rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max((row.visitors / maxLang) * 100, 1)}%`, backgroundColor: 'var(--chart-2)' }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Section>
                )}
                {connections.length > 0 && (
                  <Section title="Tipo de Conexão" icon={<Wifi className="h-4 w-4 text-indigo-500" />} description="Velocidade de conexão dos visitantes">
                    <div className="space-y-2.5">
                      {connections.slice(0, 8).map(row => {
                        const maxConn = connections[0]?.visitors || 1;
                        const connColor = row.contextValue === '4g' ? 'var(--success)' : row.contextValue === '3g' ? 'var(--warning)' : 'var(--destructive)';
                        return (
                          <div key={row.contextValue}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: connColor }} />
                                <span className="text-[11px] font-medium text-foreground uppercase">{row.contextValue}</span>
                              </div>
                              <span className="text-[11px] font-medium text-foreground tabular-nums shrink-0">{fmt.format(row.visitors)}</span>
                            </div>
                            <div className="h-1 bg-muted/30 rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max((row.visitors / maxConn) * 100, 1)}%`, backgroundColor: connColor }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Section>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* ═══ Meta Discrepancy ═══ */}
      <Card className={cn('border',
        data.metaDiscrepancy.matchRate >= 80 ? 'border-success/20' :
        data.metaDiscrepancy.matchRate >= 50 ? 'border-amber-500/20' :
        'border-rose-500/20',
      )}>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
            {data.metaDiscrepancy.matchRate >= 80 ? <ShieldCheck className="h-4 w-4 text-success" /> :
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
              data.metaDiscrepancy.matchRate >= 80 ? 'bg-success/5 border-success/20' :
              data.metaDiscrepancy.matchRate >= 50 ? 'bg-amber-500/5 border-amber-500/20' :
              'bg-rose-500/5 border-rose-500/20',
            )}>
              <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Match Rate</p>
              <p className={cn('text-xl font-bold tabular-nums',
                data.metaDiscrepancy.matchRate >= 80 ? 'text-success' :
                data.metaDiscrepancy.matchRate >= 50 ? 'text-amber-600' : 'text-rose-600',
              )}>{fmtPct(data.metaDiscrepancy.matchRate)}</p>
              <div className="mt-1.5 h-1.5 bg-muted/50 rounded-full overflow-hidden">
                <div className={cn('h-full rounded-full transition-all duration-700',
                  data.metaDiscrepancy.matchRate >= 80 ? 'bg-success' :
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