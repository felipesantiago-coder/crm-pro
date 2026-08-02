'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Users,
  MessageSquare,
  CalendarCheck,
  Bell,
  TrendingUp,
  TrendingDown,
  Award,
  ArrowUpDown,
  Loader2,
  BarChart3,
  Clock,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface ReportData {
  period: string;
  startDate: string;
  endDate: string;
  summary: {
    newClients: number;
    totalInteractions: number;
    schedulesCreated: number;
    schedulesCompleted: number;
    schedulesPending: number;
    schedulesCancelled: number;
    remindersCreated: number;
    remindersCompleted: number;
    remindersPending: number;
    wonDeals: number;
    lostDeals: number;
  };
  stageDistribution: Array<{ stage: string; count: number }>;
  dailyActivity: Array<{
    date: string;
    newClients: number;
    interactions: number;
    schedules: number;
    reminders: number;
  }>;
  recentInteractions: Array<{
    clientName: string;
    description: string;
    createdAt: string;
  }>;
  topClients: Array<{
    clientName: string;
    interactionCount: number;
    lastInteraction: string;
  }>;
}

const STAGE_LABELS: Record<string, string> = {
  LEAD: 'Lead',
  PROSPECT: 'Prospect',
  VISITA_AGENDADA: 'Visita Agendada',
  VISITA_REALIZADA: 'Visita Realizada',
  CARTA_PROPOSTA: 'Carta Proposta',
  CONTRATO_GERADO: 'Contrato Gerado',
  FECHADO_GANHO: 'Fechado (Ganho)',
  FECHADO_PERDIDO: 'Fechado (Perdido)',
};

const STAGE_COLORS: Record<string, string> = {
  LEAD: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  PROSPECT: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  VISITA_AGENDADA: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  VISITA_REALIZADA: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  CARTA_PROPOSTA: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  CONTRATO_GERADO: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  FECHADO_GANHO: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  FECHADO_PERDIDO: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
};

const fmt = new Intl.NumberFormat('pt-BR');

export function ReportsView() {
  const [period, setPeriod] = useState('monthly');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ period });
      if (period === 'custom' && customFrom && customTo) {
        params.set('from', customFrom);
        params.set('to', customTo);
      }
      const res = await fetch(`/api/reports?${params}`);
      if (res.ok) {
        setData(await res.json());
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [period, customFrom, customTo]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const s = data?.summary;
  const totalDaily = data?.dailyActivity.reduce(
    (acc, d) => ({
      clients: acc.clients + d.newClients,
      interactions: acc.interactions + d.interactions,
      schedules: acc.schedules + d.schedules,
      reminders: acc.reminders + d.reminders,
    }),
    { clients: 0, interactions: 0, schedules: 0, reminders: 0 }
  ) || { clients: 0, interactions: 0, schedules: 0, reminders: 0 };
  const maxDaily = Math.max(totalDaily.clients, totalDaily.interactions, totalDaily.schedules, totalDaily.reminders, 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Relatórios</h1>
          <p className="text-muted-foreground mt-1">
            {data ? `Período: ${data.period}` : 'Selecione um período'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {period === 'custom' && (
            <>
              <Input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-9 w-40"
              />
              <span className="text-muted-foreground text-sm">a</span>
              <Input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-9 w-40"
              />
            </>
          )}
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-40 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">Semanal</SelectItem>
              <SelectItem value="monthly">Mensal</SelectItem>
              <SelectItem value="quarterly">Trimestral</SelectItem>
              <SelectItem value="semiannual">Semestral</SelectItem>
              <SelectItem value="annual">Anual</SelectItem>
              <SelectItem value="custom">Personalizado</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchReport} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
            <span className="ml-1.5">Atualizar</span>
          </Button>
        </div>
      </div>

      {loading && !data ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : data && s ? (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">Novos Clientes</span>
                </div>
                <p className="text-2xl font-bold tabular-nums">{fmt.format(s.newClients)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <MessageSquare className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">Interações</span>
                </div>
                <p className="text-2xl font-bold tabular-nums">{fmt.format(s.totalInteractions)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                    <CalendarCheck className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">Agendamentos</span>
                </div>
                <p className="text-2xl font-bold tabular-nums">{fmt.format(s.schedulesCreated)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {s.schedulesCompleted} concluídos · {s.schedulesPending} pendentes
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
                    <Bell className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">Lembretes</span>
                </div>
                <p className="text-2xl font-bold tabular-nums">{fmt.format(s.remindersCreated)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {s.remindersCompleted} concluídos · {s.remindersPending} pendentes
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-8 w-8 rounded-lg bg-rose-500/10 flex items-center justify-center">
                    <Award className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">Deals</span>
                </div>
                <p className="text-2xl font-bold tabular-nums">
                  <span className="text-emerald-600 dark:text-emerald-400">{s.wonDeals}</span>
                  <span className="text-muted-foreground mx-1">/</span>
                  <span className="text-rose-600 dark:text-rose-400">{s.lostDeals}</span>
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  <TrendingUp className="inline h-3 w-3 text-emerald-600 dark:text-emerald-400" /> Ganhos{' '}
                  <TrendingDown className="inline h-3 w-3 text-rose-600 dark:text-rose-400 ml-1" /> Perdidos
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Daily Activity Chart + Stage Distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Daily Activity */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  Atividade Diária
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.dailyActivity.length <= 1 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    Dados insuficientes para o gráfico diário.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-4 text-[10px] text-muted-foreground mb-3">
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Clientes</span>
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500" /> Interações</span>
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Agendamentos</span>
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-violet-500" /> Lembretes</span>
                    </div>
                    <div className="space-y-1">
                      {data.dailyActivity.map((d) => {
                        const dayLabel = (() => {
                          try { return format(parseISO(d.date), 'dd MMM', { locale: ptBR }); }
                          catch { return d.date.slice(5); }
                        })();
                        return (
                          <div key={d.date} className="flex items-center gap-2 text-xs">
                            <span className="w-16 text-muted-foreground shrink-0 text-right tabular-nums">{dayLabel}</span>
                            <div className="flex-1 flex gap-px h-4 items-end">
                              <div className="flex-1 bg-emerald-500/80 rounded-sm transition-all" style={{ height: `${Math.max((d.newClients / maxDaily) * 100, d.newClients > 0 ? 12 : 2)}%` }} title={`${d.newClients} clientes`} />
                              <div className="flex-1 bg-blue-500/80 rounded-sm transition-all" style={{ height: `${Math.max((d.interactions / maxDaily) * 100, d.interactions > 0 ? 12 : 2)}%` }} title={`${d.interactions} interações`} />
                              <div className="flex-1 bg-amber-500/80 rounded-sm transition-all" style={{ height: `${Math.max((d.schedules / maxDaily) * 100, d.schedules > 0 ? 12 : 2)}%` }} title={`${d.schedules} agendamentos`} />
                              <div className="flex-1 bg-violet-500/80 rounded-sm transition-all" style={{ height: `${Math.max((d.reminders / maxDaily) * 100, d.reminders > 0 ? 12 : 2)}%` }} title={`${d.reminders} lembretes`} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Stage Distribution */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <ArrowUpDown className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  Distribuição por Etapa
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.stageDistribution.map((item) => {
                    const total = data.stageDistribution.reduce((a, b) => a + b.count, 0);
                    const pct = total > 0 ? ((item.count / total) * 100).toFixed(1) : '0';
                    return (
                      <div key={item.stage} className="flex items-center gap-2">
                        <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded', STAGE_COLORS[item.stage] || 'bg-muted text-muted-foreground')}>
                          {STAGE_LABELS[item.stage] || item.stage}
                        </span>
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-foreground/30 rounded-full transition-all duration-500"
                            style={{ width: `${Math.max(Number(pct), 2)}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium tabular-nums w-6 text-right">{item.count}</span>
                        <span className="text-[10px] text-muted-foreground w-10 text-right">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Top Clients + Recent Interactions */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top Clients */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  Top 10 Clientes com Mais Interações
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.topClients.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">Nenhuma interação no período.</p>
                ) : (
                  <div className="space-y-2">
                    {data.topClients.map((c, idx) => (
                      <div key={idx} className="flex items-center gap-3 py-1.5">
                        <span className={cn(
                          'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold shrink-0',
                          idx === 0 ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' :
                          idx === 1 ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' :
                          idx === 2 ? 'bg-orange-500/20 text-orange-600 dark:text-orange-400' :
                          'bg-muted text-muted-foreground'
                        )}>
                          {idx + 1}
                        </span>
                        <span className="text-sm font-medium flex-1 truncate">{c.clientName}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">{c.interactionCount} interações</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Interactions */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Clock className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                  Últimas Interações do Período
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.recentInteractions.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">Nenhuma interação no período.</p>
                ) : (
                  <div className="space-y-2 max-h-[320px] overflow-y-auto">
                    {data.recentInteractions.map((i, idx) => (
                      <div key={idx} className="flex items-start gap-3 py-1.5 border-b border-border/50 last:border-0">
                        <MessageSquare className="h-3.5 w-3.5 text-blue-500 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{i.clientName}</p>
                          <p className="text-xs text-muted-foreground truncate">{i.description}</p>
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                          {(() => {
                            try { return format(parseISO(i.createdAt), 'dd/MM HH:mm'); }
                            catch { return ''; }
                          })()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : (
        <div className="text-center py-16">
          <p className="text-muted-foreground">Nenhum dado disponível para o período selecionado.</p>
        </div>
      )}
    </div>
  );
}
