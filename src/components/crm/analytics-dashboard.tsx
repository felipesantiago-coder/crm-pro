'use client';

import React, { useEffect, useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Users,
  CalendarCheck,
  CalendarX,
  AlertTriangle,
  Clock,
  Target,
  Award,
  BarChart3,
  MapPin,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useCRMStore } from '@/store/crm-store';
import { cn } from '@/lib/utils';

const STAGE_LABELS: Record<string, string> = {
  LEAD: 'Lead',
  PROSPECT: 'Prospect',
  VISITA_AGENDADA: 'Visita Agendada',
  VISITA_REALIZADA: 'Visita Realizada',
  CARTA_PROPOSTA: 'Carta Proposta',
  CONTRATO_GERADO: 'Contrato Gerado',
  FECHADO_GANHO: 'Fechado',
  FECHADO_PERDIDO: 'Perdido',
};

const STAGE_COLORS: Record<string, string> = {
  LEAD: 'bg-slate-400 dark:bg-slate-500',
  PROSPECT: 'bg-cyan-400 dark:bg-cyan-500',
  VISITA_AGENDADA: 'bg-blue-400 dark:bg-blue-500',
  VISITA_REALIZADA: 'bg-violet-400 dark:bg-violet-500',
  CARTA_PROPOSTA: 'bg-amber-400 dark:bg-amber-500',
  CONTRATO_GERADO: 'bg-orange-400 dark:bg-orange-500',
  FECHADO_GANHO: 'bg-emerald-400 dark:bg-emerald-500',
  FECHADO_PERDIDO: 'bg-rose-400 dark:bg-rose-500',
};

const STAGE_BG: Record<string, string> = {
  LEAD: 'bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300',
  PROSPECT: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  VISITA_AGENDADA: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  VISITA_REALIZADA: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  CARTA_PROPOSTA: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  CONTRATO_GERADO: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  FECHADO_GANHO: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  FECHADO_PERDIDO: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
};

interface AnalyticsData {
  funnel: Array<{ stage: string; count: number }>;
  totalClients: number;
  conversionRate: number;
  schedules: {
    pending: number;
    completed: number;
    cancelled: number;
    overdue: number;
    completionRate: number;
  };
  thisMonth: {
    newClients: number;
    visitsScheduled: number;
    visitsCompleted: number;
  };
  regions: Array<{ name: string; count: number }>;
  monthlyClients: Array<{ month: string; count: number }>;
  interactionsThisWeek: number;
  winRate: number;
  wonCount: number;
  lostCount: number;
}

export function AnalyticsDashboard() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const { setSelectedClientId, setCurrentView } = useCRMStore();

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/analytics');
        if (res.ok) {
          setData(await res.json());
        }
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <div className="h-20 animate-pulse bg-muted rounded-lg" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 h-80 animate-pulse bg-muted rounded-xl" />
          <div className="h-80 animate-pulse bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-16">
        <BarChart3 className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">Nenhum dado disponível</p>
      </div>
    );
  }

  const maxFunnelCount = Math.max(...data.funnel.map((f) => f.count), 1);

  return (
    <div className="space-y-6">
      {/* Top KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Taxa de Conversão */}
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Taxa de Conversão</p>
                <p className="text-3xl font-bold mt-1">{data.conversionRate}%</p>
              </div>
              <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
                <Target className="h-5 w-5 text-white" />
              </div>
            </div>
            <div className="flex items-center mt-2 text-xs text-muted-foreground">
              {data.conversionRate >= 20 ? (
                <TrendingUp className="h-3 w-3 mr-1 text-emerald-500" />
              ) : (
                <TrendingDown className="h-3 w-3 mr-1 text-rose-500" />
              )}
              <span>Lead → Fechado</span>
            </div>
          </CardContent>
        </Card>

        {/* Taxa de Vitória */}
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Taxa de Vitória</p>
                <p className="text-3xl font-bold mt-1">{data.winRate}%</p>
              </div>
              <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg">
                <Award className="h-5 w-5 text-white" />
              </div>
            </div>
            <div className="flex items-center mt-2 text-xs text-muted-foreground">
              <span className="text-emerald-500 font-medium">{data.wonCount} ganhos</span>
              <span className="mx-1">&bull;</span>
              <span className="text-rose-500 font-medium">{data.lostCount} perdidos</span>
            </div>
          </CardContent>
        </Card>

        {/* Visitas este mês */}
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Visitas este Mês</p>
                <p className="text-3xl font-bold mt-1">
                  {data.thisMonth.visitsCompleted}
                  <span className="text-base font-normal text-muted-foreground">
                    /{data.thisMonth.visitsScheduled}
                  </span>
                </p>
              </div>
              <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center shadow-lg">
                <CalendarCheck className="h-5 w-5 text-white" />
              </div>
            </div>
            <div className="flex items-center mt-2 text-xs text-muted-foreground">
              <span className="text-blue-500 font-medium">{data.thisMonth.newClients} novos clientes</span>
            </div>
          </CardContent>
        </Card>

        {/* Atividade semanal */}
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Atividade Semanal</p>
                <p className="text-3xl font-bold mt-1">{data.interactionsThisWeek}</p>
              </div>
              <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg">
                <Users className="h-5 w-5 text-white" />
              </div>
            </div>
            <div className="flex items-center mt-2 text-xs text-muted-foreground">
              <span>interações registradas</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Funnel + Side panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Funnel Visualization */}
        <Card className="lg:col-span-2 hover:shadow-md transition-shadow">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-emerald-500" />
              Funil de Vendas
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <div className="space-y-2">
              {data.funnel.map((item, idx) => {
                const widthPercent = Math.max((item.count / maxFunnelCount) * 100, 8);
                const label = STAGE_LABELS[item.stage] || item.stage;
                const bgClass = STAGE_BG[item.stage] || STAGE_BG.LEAD;
                const colorClass = STAGE_COLORS[item.stage] || STAGE_COLORS.LEAD;

                // Calculate conversion from previous stage
                let convLabel = '';
                if (idx > 0) {
                  const prev = data.funnel[idx - 1].count;
                  if (prev > 0) {
                    const rate = Math.round((item.count / prev) * 100);
                    convLabel = `${rate}% do anterior`;
                  }
                }

                return (
                  <div key={item.stage}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className={cn('h-2.5 w-2.5 rounded-full', colorClass)} />
                        <span className="text-sm font-medium">{label}</span>
                        {convLabel && idx > 0 && (
                          <span className="text-[10px] text-muted-foreground hidden sm:inline">
                            ({convLabel})
                          </span>
                        )}
                      </div>
                      <Badge variant="secondary" className="h-5 px-2 text-xs font-bold">
                        {item.count}
                      </Badge>
                    </div>
                    <div className="h-8 bg-muted/50 rounded-lg overflow-hidden relative">
                      <div
                        className={cn(
                          'h-full rounded-lg transition-all duration-700 ease-out flex items-center px-3',
                          bgClass
                        )}
                        style={{ width: `${widthPercent}%`, minWidth: '32px' }}
                      >
                        {widthPercent > 25 && (
                          <span className="text-[10px] font-semibold truncate">
                            {item.count}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Arrow between stages */}
                    {idx < data.funnel.length - 1 && idx < 6 && (
                      <div className="flex justify-center my-1">
                        <ArrowRight className="h-3 w-3 text-muted-foreground/30" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Side panel: Agendamentos + Regiões */}
        <div className="space-y-6">
          {/* Schedule stats */}
          <Card className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <CalendarCheck className="h-4 w-4 text-blue-500" />
                Agendamentos
              </CardTitle>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              <div className="space-y-3">
                <ScheduleStatItem
                  label="Pendentes"
                  count={data.schedules.pending}
                  icon={<Clock className="h-4 w-4" />}
                  colorClass="text-blue-500"
                  bgClass="bg-blue-50 dark:bg-blue-950/30"
                />
                <ScheduleStatItem
                  label="Concluídos"
                  count={data.schedules.completed}
                  icon={<CalendarCheck className="h-4 w-4" />}
                  colorClass="text-emerald-500"
                  bgClass="bg-emerald-50 dark:bg-emerald-950/30"
                />
                <ScheduleStatItem
                  label="Atrasados"
                  count={data.schedules.overdue}
                  icon={<AlertTriangle className="h-4 w-4" />}
                  colorClass="text-rose-500"
                  bgClass="bg-rose-50 dark:bg-rose-950/30"
                />
                <ScheduleStatItem
                  label="Cancelados"
                  count={data.schedules.cancelled}
                  icon={<CalendarX className="h-4 w-4" />}
                  colorClass="text-gray-500"
                  bgClass="bg-gray-50 dark:bg-gray-900/30"
                />

                {/* Completion rate bar */}
                <div className="pt-2 border-t">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-muted-foreground">Taxa de conclusão</span>
                    <span className="text-sm font-bold">{data.schedules.completionRate}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-400 to-teal-500 rounded-full transition-all duration-700"
                      style={{ width: `${data.schedules.completionRate}%` }}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Top Regions */}
          {data.regions.length > 0 && (
            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-amber-500" />
                  Top Regiões
                </CardTitle>
              </CardHeader>
              <CardContent className="px-6 pb-6">
                <div className="space-y-2.5">
                  {data.regions.map((region, idx) => {
                    const maxRegion = data.regions[0].count || 1;
                    const pct = Math.round((region.count / maxRegion) * 100);
                    return (
                      <div key={region.name}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium truncate flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground font-normal">#{idx + 1}</span>
                            {region.name}
                          </span>
                          <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-bold">
                            {region.count}
                          </Badge>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Monthly Trend */}
      {data.monthlyClients.length > 0 && (
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              Tendência de Novos Clientes
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <div className="flex items-end gap-2 h-40">
              {data.monthlyClients.map((m) => {
                const maxMonth = Math.max(...data.monthlyClients.map((x) => x.count), 1);
                const heightPercent = Math.max((m.count / maxMonth) * 100, 4);
                const [year, month] = m.month.split('-');
                const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
                const monthLabel = monthNames[parseInt(month) - 1];

                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] font-bold">{m.count}</span>
                    <div className="w-full bg-muted/50 rounded-t-md overflow-hidden flex-1 flex items-end">
                      <div
                        className="w-full bg-gradient-to-t from-emerald-500 to-teal-400 rounded-t-md transition-all duration-500"
                        style={{ height: `${heightPercent}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{monthLabel}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ScheduleStatItem({
  label,
  count,
  icon,
  colorClass,
  bgClass,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  colorClass: string;
  bgClass: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className={cn('h-9 w-9 rounded-lg flex items-center justify-center', bgClass, colorClass)}>
        {icon}
      </div>
      <div className="flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-bold leading-tight">{count}</p>
      </div>
    </div>
  );
}