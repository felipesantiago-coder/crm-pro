'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Users,
  Eye,
  Zap,
  Target,
  TrendingUp,
  ArrowDownRight,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  MousePointerClick,
  Globe,
  FileCode,
  AlertTriangle,
  BarChart3,
  Activity,
  Trophy,
  Trash2,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  conversionRate: number;
  avgEventsPerVisitor: number;
  bounceRate: number;
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
  metaDiscrepancy: MetaDiscrepancy;
}

// ============================================================
// Helpers
// ============================================================
const fmt = new Intl.NumberFormat('pt-BR');
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

const GOLD = '#C9A96E';
const GOLD_LIGHT = 'rgba(201, 169, 110, 0.15)';
const GOLD_MID = 'rgba(201, 169, 110, 0.4)';
const EMERALD = '#10B981';

const FUNNEL_LABELS: Record<string, string> = {
  Pageview: 'Pageview',
  Engagement: 'Engajamento',
  Lead: 'Lead',
};

const FUNNEL_GRADIENTS: Record<string, string> = {
  Pageview: 'from-[#C9A96E] to-[#B8944F]',
  Engagement: 'from-[#D4A843] to-[#C99530]',
  Lead: 'from-[#E5A820] to-[#D4941A]',
};

const PERIOD_OPTIONS = [
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
];

// ============================================================
// Sub-components
// ============================================================
function SkeletonCard() {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div className="space-y-2 flex-1">
            <div className="h-3 w-24 animate-pulse bg-muted rounded" />
            <div className="h-7 w-16 animate-pulse bg-muted rounded" />
          </div>
          <div className="h-11 w-11 animate-pulse bg-muted rounded-xl" />
        </div>
        <div className="mt-3 h-2 w-20 animate-pulse bg-muted rounded" />
      </CardContent>
    </Card>
  );
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn('animate-pulse bg-muted rounded-xl', className)} />;
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(`${label ?? 'Código'} copiado!`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Erro ao copiar');
    }
  }, [text, label]);

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      className="h-7 px-2 text-xs text-[#C9A96E] hover:text-[#C9A96E] hover:bg-[#C9A96E]/10 shrink-0"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      <span className="ml-1">{copied ? 'Copiado' : 'Copiar'}</span>
    </Button>
  );
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  return (
    <div className="relative group rounded-lg bg-card border border-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          {language ?? 'code'}
        </span>
        <CopyButton text={code} label="Código" />
      </div>
      <pre className="p-3 text-xs leading-relaxed text-foreground/70 overflow-x-auto">
        <code>{code}</code>
      </pre>
    </div>
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

  const fetchData = useCallback(async (p: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tracking/dashboard?period=${p}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      } else {
        toast.error('Erro ao carregar dados de tracking');
      }
    } catch {
      toast.error('Erro de conexão ao carregar tracking');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleReset = useCallback(async () => {
    const confirmed = window.confirm(
      'Tem certeza que deseja resetar TODOS os dados de tracking? Esta ação é irreversível e apagará todos os visitantes e eventos registrados.'
    );
    if (!confirmed) return;

    setResetting(true);
    try {
      const res = await fetch('/api/tracking/reset', { method: 'DELETE' });
      if (res.ok) {
        const json = await res.json();
        toast.success(`Tracking resetado: ${json.deletedVisitors} visitantes e ${json.deletedEvents} eventos removidos.`);
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

  useEffect(() => {
    fetchData(period);
  }, [period, fetchData]);

  // ── Loading State ──
  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-6 w-48 animate-pulse bg-muted rounded" />
          <div className="h-9 w-32 animate-pulse bg-muted rounded" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <SkeletonBlock className="h-64" />
        <SkeletonBlock className="h-56" />
        <SkeletonBlock className="h-72" />
      </div>
    );
  }

  // ── Empty State ──
  if (data && data.metrics.totalVisitors === 0) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div />
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-32 h-9 text-xs bg-muted border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card className="border-border">
          <CardContent className="py-16 px-6 text-center">
            <div className="mx-auto mb-4 h-16 w-16 rounded-2xl bg-[#C9A96E]/10 flex items-center justify-center">
              <MousePointerClick className="h-8 w-8 text-[#C9A96E]" />
            </div>
            <h3 className="text-lg font-semibold mb-2">
              Nenhum dado de tracking ainda
            </h3>
            <p className="text-sm text-muted-foreground max-w-lg mx-auto mb-6 leading-relaxed">
              Para começar a rastrear visitantes e conversões do Meta Ads, siga os 3 passos abaixo:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto text-left">
              <div className="rounded-xl border bg-muted/50 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#C9A96E]/20 text-xs font-bold text-[#C9A96E]">
                    1
                  </span>
                  <span className="text-sm font-medium">Migration</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Execute a SQL migration para criar as tabelas{' '}
                  <code className="text-[#C9A96E] bg-[#C9A96E]/10 px-1 py-0.5 rounded text-[11px]">
                    tracking_visitors
                  </code>{' '}
                  e{' '}
                  <code className="text-[#C9A96E] bg-[#C9A96E]/10 px-1 py-0.5 rounded text-[11px]">
                    tracking_events
                  </code>
                  .
                </p>
              </div>

              <div className="rounded-xl border bg-muted/50 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#C9A96E]/20 text-xs font-bold text-[#C9A96E]">
                    2
                  </span>
                  <span className="text-sm font-medium">Pixel Script</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Adicione o script do pixel no{' '}
                  <code className="text-[#C9A96E] bg-[#C9A96E]/10 px-1 py-0.5 rounded text-[11px]">
                    &lt;head&gt;
                  </code>{' '}
                  da sua landing page.
                </p>
              </div>

              <div className="rounded-xl border bg-muted/50 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#C9A96E]/20 text-xs font-bold text-[#C9A96E]">
                    3
                  </span>
                  <span className="text-sm font-medium">UTM Params</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Adicione parâmetros UTM nas URLs dos seus anúncios:{' '}
                  <code className="text-[#C9A96E] bg-[#C9A96E]/10 px-1 py-0.5 rounded text-[11px]">
                    utm_source
                  </code>
                  ,{' '}
                  <code className="text-[#C9A96E] bg-[#C9A96E]/10 px-1 py-0.5 rounded text-[11px]">
                    utm_campaign
                  </code>
                  ,{' '}
                  <code className="text-[#C9A96E] bg-[#C9A96E]/10 px-1 py-0.5 rounded text-[11px]">
                    utm_content
                  </code>
                  .
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  // ── Derived data ──
  const last14 = data.chartData.slice(-14);
  const maxVisitors = Math.max(...last14.map((d) => d.visitors), 1);
  const maxLeads = Math.max(...last14.map((d) => d.leads), 1);
  const maxChart = Math.max(maxVisitors, maxLeads);
  const sortedCampaigns = [...data.byCampaign].sort((a, b) => b.leads - a.leads);

  const kpis: {
    label: string;
    value: string;
    icon: React.ReactNode;
    iconBg: string;
    subtitle: string;
  }[] = [
    {
      label: 'Visitantes Únicos',
      value: fmt.format(data.metrics.totalVisitors),
      icon: <Users className="h-5 w-5 text-white" />,
      iconBg: 'bg-gradient-to-br from-[#C9A96E] to-[#A8894F]',
      subtitle: `${fmt.format(data.metrics.avgEventsPerVisitor)} eventos/visitante`,
    },
    {
      label: 'Pageviews',
      value: fmt.format(data.metrics.totalPageviews),
      icon: <Eye className="h-5 w-5 text-white" />,
      iconBg: 'bg-gradient-to-br from-blue-500 to-blue-700',
      subtitle: `de ${fmt.format(data.metrics.totalVisitors)} visitantes`,
    },
    {
      label: 'Eventos',
      value: fmt.format(data.metrics.totalEvents),
      icon: <Zap className="h-5 w-5 text-white" />,
      iconBg: 'bg-gradient-to-br from-amber-500 to-orange-600',
      subtitle: `${data.byEventType.length} tipos registrados`,
    },
    {
      label: 'Leads Rastreados',
      value: fmt.format(data.metrics.uniqueLeads),
      icon: <Target className="h-5 w-5 text-white" />,
      iconBg: 'bg-gradient-to-br from-emerald-500 to-teal-600',
      subtitle: 'visitantes vinculados ao CRM',
    },
    {
      label: 'Taxa de Conversão',
      value: fmtPct(data.metrics.conversionRate),
      icon: <TrendingUp className="h-5 w-5 text-white" />,
      iconBg: 'bg-gradient-to-br from-violet-500 to-purple-700',
      subtitle: 'visitante → lead',
    },
    {
      label: 'Taxa de Rejeição',
      value: fmtPct(data.metrics.bounceRate),
      icon: <ArrowDownRight className="h-5 w-5 text-white" />,
      iconBg: 'bg-gradient-to-br from-rose-500 to-pink-700',
      subtitle: 'só 1 pageview, sem interação',
    },
  ];

  // ── Main render ──
  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-[#C9A96E]" />
          <h2 className="text-lg font-semibold text-foreground">Tracking de Visitantes</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 h-9 px-3"
            onClick={handleReset}
            disabled={resetting}
          >
            {resetting
              ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              : <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            }
            {resetting ? 'Resetando...' : 'Resetar Dados'}
          </Button>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-32 h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {kpis.map((kpi) => (
          <Card
            key={kpi.label}
            className="border hover:border-[#C9A96E]/20 transition-colors"
          >
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="space-y-1 flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    {kpi.label}
                  </p>
                  <p className="text-2xl font-bold text-foreground tracking-tight">{kpi.value}</p>
                </div>
                <div className={cn('h-11 w-11 rounded-xl flex items-center justify-center shrink-0', kpi.iconBg)}>
                  {kpi.icon}
                </div>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground truncate">{kpi.subtitle}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Section 1: Funil de Conversão ── */}
      <Card className="border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[#C9A96E]" />
            Funil de Conversão
          </CardTitle>
        </CardHeader>
        <CardContent className="px-6 pb-6">
          <div className="flex flex-col items-center gap-1">
            {data.funnel.map((stage, idx) => {
              const widthPercent = Math.max(stage.rate, 10);
              const isFirst = idx === 0;

              return (
                <React.Fragment key={stage.stage}>
                  <div className="w-full max-w-2xl">
                    {/* Label row */}
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'h-2.5 w-2.5 rounded-full',
                            idx === 0 ? 'bg-[#C9A96E]' : idx === 1 ? 'bg-[#D4A843]' : 'bg-[#E5A820]'
                          )}
                        />
                        <span className="text-sm font-medium">
                          {FUNNEL_LABELS[stage.stage] ?? stage.stage}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {!isFirst && (
                          <Badge
                            variant="secondary"
                            className="h-5 px-1.5 text-[10px] font-medium bg-muted text-muted-foreground"
                          >
                            {fmtPct(stage.rate)}
                          </Badge>
                        )}
                        <Badge
                          variant="secondary"
                          className="h-5 px-2 text-[10px] font-bold"
                          style={{ backgroundColor: GOLD_LIGHT, color: GOLD }}
                        >
                          {fmt.format(stage.count)}
                        </Badge>
                      </div>
                    </div>

                    {/* Funnel bar — centered, tapered */}
                    <div className="flex justify-center">
                      <div
                        className={cn(
                          'h-10 rounded-lg bg-gradient-to-r transition-all duration-700 ease-out flex items-center justify-center overflow-hidden',
                          FUNNEL_GRADIENTS[stage.stage] ?? 'from-[#C9A96E] to-[#A8894F]'
                        )}
                        style={{ width: `${widthPercent}%`, minWidth: '80px' }}
                      >
                        <span className="text-xs font-bold text-black/60 drop-shadow-sm">
                          {isFirst ? '100%' : fmtPct(stage.rate)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Arrow between stages */}
                  {idx < data.funnel.length - 1 && (
                    <div className="flex justify-center py-0.5">
                      <svg width="12" height="16" viewBox="0 0 12 16" fill="none" className="text-muted-foreground/30">
                        <path d="M6 0L11 6H1L6 0Z" fill="currentColor" />
                        <path d="M6 16L1 10H11L6 16Z" fill="currentColor" />
                      </svg>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* Funnel conversion summary */}
          <div className="mt-5 pt-4 border-t flex flex-wrap items-center justify-center gap-6 text-center">
            {data.funnel.length >= 3 && (
              <>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                    Pageview → Engajamento
                  </p>
                  <p className="text-sm font-bold text-[#C9A96E]">
                    {fmtPct(data.funnel[1].rate)}
                  </p>
                </div>
                <div className="h-6 w-px bg-border" />
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                    Engajamento → Lead
                  </p>
                  <p className="text-sm font-bold text-[#E5A820]">
                    {data.funnel[1].count > 0
                      ? fmtPct((data.funnel[2].count / data.funnel[1].count) * 100)
                      : '0.0%'}
                  </p>
                </div>
                <div className="h-6 w-px bg-border" />
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                    Conversão Total
                  </p>
                  <p className="text-sm font-bold text-emerald-400">
                    {fmtPct(data.metrics.conversionRate)}
                  </p>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Section 2: Tendência Diária (Mini Bar Chart) ── */}
      {last14.length > 0 && (
        <Card className="border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-[#C9A96E]" />
                Tendência Diária
              </CardTitle>
              <div className="flex items-center gap-3 text-[10px]">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-[#C9A96E]" />
                  <span className="text-muted-foreground">Visitantes</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="text-muted-foreground">Leads</span>
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <div className="flex items-end gap-1 sm:gap-1.5" style={{ height: '200px' }}>
              {last14.map((d) => {
                const vHeight = maxChart > 0 ? (d.visitors / maxChart) * 100 : 0;
                const lHeight = maxChart > 0 ? (d.leads / maxChart) * 100 : 0;
                const dayLabel = (() => {
                  try {
                    return format(parseISO(d.date), 'dd MMM', { locale: ptBR });
                  } catch {
                    return d.date.slice(5);
                  }
                })();

                return (
                  <div
                    key={d.date}
                    className="flex-1 flex flex-col items-center gap-0.5 min-w-0"
                  >
                    <div className="flex-1 w-full flex items-end justify-center gap-px">
                      {/* Visitors bar */}
                      <div
                        className="w-[45%] max-w-[14px] rounded-t-sm transition-all duration-500 ease-out"
                        style={{
                          height: `${Math.max(vHeight, 1)}%`,
                          background: `linear-gradient(to top, ${GOLD}, rgba(201,169,110,0.5))`,
                        }}
                        title={`${d.visitors} visitantes`}
                      />
                      {/* Leads bar */}
                      <div
                        className="w-[45%] max-w-[14px] rounded-t-sm transition-all duration-500 ease-out"
                        style={{
                          height: `${Math.max(lHeight, 1)}%`,
                          background: `linear-gradient(to top, ${EMERALD}, rgba(16,185,129,0.4))`,
                        }}
                        title={`${d.leads} leads`}
                      />
                    </div>
                    <span className="text-[9px] text-muted-foreground leading-none truncate w-full text-center">
                      {dayLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Section 3: Performance por Campanha ── */}
      {sortedCampaigns.length > 0 && sortedCampaigns.some((c) => c.campaign !== '(none)') && (
        <Card className="border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Trophy className="h-4 w-4 text-[#C9A96E]" />
              Performance por Campanha
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 sm:px-6 pb-6">
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Campanha
                    </th>
                    <th className="text-right py-2 px-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Visitantes
                    </th>
                    <th className="text-right py-2 px-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Leads
                    </th>
                    <th className="text-right py-2 px-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Conv.
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCampaigns
                    .filter((c) => c.campaign !== '(none)')
                    .slice(0, 10)
                    .map((row, idx) => (
                      <tr
                        key={row.campaign}
                        className={cn(
                          'border-b hover:bg-muted/50 transition-colors',
                          idx < 3 && 'bg-[#C9A96E]/[0.03]'
                        )}
                      >
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            {idx < 3 && (
                              <span
                                className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold shrink-0"
                                style={{
                                  backgroundColor: idx === 0 ? GOLD : idx === 1 ? '#A0A0A0' : '#CD7F32',
                                  color: '#000',
                                }}
                              >
                                {idx + 1}
                              </span>
                            )}
                            <span className="font-medium truncate max-w-[200px]">
                              {row.campaign}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right text-muted-foreground tabular-nums">
                          {fmt.format(row.visitors)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-medium tabular-nums">
                          {fmt.format(row.leads)}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          <Badge
                            variant="secondary"
                            className={cn(
                              'h-5 px-1.5 text-[10px] font-bold',
                              row.conversionRate >= 5
                                ? 'bg-emerald-500/10 text-emerald-400'
                                : row.conversionRate >= 2
                                  ? 'bg-amber-500/10 text-amber-400'
                                  : 'bg-muted text-muted-foreground'
                            )}
                          >
                            {fmtPct(row.conversionRate)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Section 4: Discrepância Meta Pixel vs CRM ── */}
      <Card
        className={cn(
          'border',
          data.metaDiscrepancy.matchRate >= 80
            ? 'border-emerald-500/20'
            : data.metaDiscrepancy.matchRate >= 50
              ? 'border-amber-500/20'
              : 'border-rose-500/20'
        )}
>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            {data.metaDiscrepancy.matchRate >= 80 ? (
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
            ) : data.metaDiscrepancy.matchRate >= 50 ? (
              <ShieldAlert className="h-4 w-4 text-amber-400" />
            ) : (
              <ShieldX className="h-4 w-4 text-rose-400" />
            )}
            Discrepância Meta Pixel vs CRM
          </CardTitle>
        </CardHeader>
        <CardContent className="px-6 pb-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Pixel Leads */}
            <div className="rounded-xl bg-muted/50 border p-4 text-center">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                Pixel Leads
              </p>
              <p className="text-2xl font-bold tabular-nums">
                {fmt.format(data.metaDiscrepancy.pixelLeads)}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Detectados pelo tracking
              </p>
            </div>

            {/* CRM Meta Leads */}
            <div className="rounded-xl bg-muted/50 border p-4 text-center">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                CRM Meta Leads
              </p>
              <p className="text-2xl font-bold tabular-nums">
                {fmt.format(data.metaDiscrepancy.crmMetaLeads)}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Registrados no CRM
              </p>
            </div>

            {/* Match Rate */}
            <div
              className={cn(
                'rounded-xl border p-4 text-center',
                data.metaDiscrepancy.matchRate >= 80
                  ? 'bg-emerald-500/5 border-emerald-500/20'
                  : data.metaDiscrepancy.matchRate >= 50
                    ? 'bg-amber-500/5 border-amber-500/20'
                    : 'bg-rose-500/5 border-rose-500/20'
              )}
            >
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                Match Rate
              </p>
              <p
                className={cn(
                  'text-2xl font-bold tabular-nums',
                  data.metaDiscrepancy.matchRate >= 80
                    ? 'text-emerald-400'
                    : data.metaDiscrepancy.matchRate >= 50
                      ? 'text-amber-400'
                      : 'text-rose-400'
                )}
              >
                {fmtPct(data.metaDiscrepancy.matchRate)}
              </p>
              <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-700',
                    data.metaDiscrepancy.matchRate >= 80
                      ? 'bg-emerald-500'
                      : data.metaDiscrepancy.matchRate >= 50
                        ? 'bg-amber-500'
                        : 'bg-rose-500'
                  )}
                  style={{ width: `${Math.max(data.metaDiscrepancy.matchRate, 2)}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5">
                {data.metaDiscrepancy.matchRate >= 80
                  ? 'Boa concordância entre pixel e CRM'
                  : data.metaDiscrepancy.matchRate >= 50
                    ? 'Concordância parcial — verifique UTM params'
                    : 'Baixa concordância — leads podem não estar vinculados'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Section 5: Pixel Setup Instructions ── */}
      <Card className="border">
        <CardContent className="p-0">
          <button
            onClick={() => setSetupOpen(!setupOpen)}
            className="w-full flex items-center justify-between p-5 hover:bg-muted/50 transition-colors rounded-t-xl"
          >
            <div className="flex items-center gap-2">
              <FileCode className="h-4 w-4 text-[#C9A96E]" />
              <span className="text-sm font-semibold">Instruções de Setup do Pixel</span>
            </div>
            {setupOpen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>

          {setupOpen && (
            <div className="px-5 pb-5 space-y-5 border-t pt-5">
              {/* Client-side pixel */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Globe className="h-3.5 w-3.5 text-[#C9A96E]" />
                  <h4 className="text-xs font-semibold uppercase tracking-wider">
                    1. Client-side — Embed no &lt;head&gt;
                  </h4>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  Adicione o script abaixo antes do fechamento da tag{' '}
                  <code className="text-[#C9A96E] bg-[#C9A96E]/10 px-1 py-0.5 rounded text-[11px]">
                    &lt;/head&gt;
                  </code>{' '}
                  da sua landing page:
                </p>
                <CodeBlock
                  language="html"
                  code={`<script src="https://SEU-DOMINIO/pixel.js" data-site-id="default"></script>`}
                />
              </div>

              {/* Server-side tracking */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="h-3.5 w-3.5 text-[#C9A96E]" />
                  <h4 className="text-xs font-semibold uppercase tracking-wider">
                    2. Server-side — Evento de lead
                  </h4>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  Quando um lead for capturado no backend, envie um evento via API:
                </p>
                <CodeBlock
                  language="bash"
                  code={`curl -X POST https://SEU-DOMINIO/api/track/server \\
  -H "Content-Type: application/json" \\
  -H "x-tracking-key: crm-tracking-2024" \\
  -d '{
    "eventType": "lead",
    "visitorId": "VISITOR_ID_DO_PIXEL",
    "pageUrl": "https://seu-site.com/obrigado",
    "utmSource": "meta",
    "utmCampaign": "NOME_DA_CAMPANHA",
    "utmContent": "NOME_DO_CRIATIVO",
    "utmMedium": "cpc"
  }'`}
                />
              </div>

              {/* UTM Parameters reference */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                  <h4 className="text-xs font-semibold uppercase tracking-wider">
                    3. UTM Parameters nas URLs dos Anúncios
                  </h4>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  Configure as URLs de destino dos anúncios com UTM params para rastreamento:
                </p>
                <CodeBlock
                  language="url"
                  code={`https://seu-site.com/landing?\n  utm_source=meta\n  &utm_medium=cpc\n  &utm_campaign=NOME_DA_CAMPANHA\n  &utm_content=NOME_DO_CRIATIVO`}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}