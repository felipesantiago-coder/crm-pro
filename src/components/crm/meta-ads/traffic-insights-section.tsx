'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  TrendingUp, RefreshCw, FileText, Copy, Download, AlertTriangle, Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { fmtBRL, fmtPct } from '@/lib/traffic-insights';

// ============================================================
// TRAFFIC INSIGHTS SECTION — aba "Gestor de Tráfego" (Fase 8, estágio A)
// Custo (Marketing API) × resultado real no CRM, com relatório sem
// PII para análise por IA externa. Somente administradores.
// ============================================================

interface TrafficAccountState {
  adAccountId: string;
  lastStatus: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  name?: string;
}

interface TrafficCampaignRow {
  key: string;
  campaignId: string | null;
  name: string;
  spend: number;
  leadsMeta: number;
  cplMeta: number | null;
  outcome: { leads: number; won: number; lost: number; quente: number; morno: number; frio: number };
  cpa: number | null;
  winRate: number | null;
}

interface OverviewPayload {
  status: string;
  reason?: string;
  windowDays: number;
  totals: {
    spend: number;
    leadsMeta: number;
    cplMedio: number | null;
    clientes: number;
    won: number;
    lost: number;
    cpaGlobal: number | null;
    campaigns: number;
    withSpend: number;
  };
  accounts: TrafficAccountState[];
  aggregates: TrafficCampaignRow[];
}

const DAY_OPTIONS = ['7', '14', '30', '60', '90'];

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'ok') return 'default';
  if (status === 'partial') return 'secondary';
  if (status === 'error') return 'destructive';
  return 'outline';
}

function statusLabel(status: string): string {
  if (status === 'ok') return 'OK';
  if (status === 'partial') return 'Parcial';
  if (status === 'error') return 'Erro';
  if (status === 'never') return 'Nunca';
  return status;
}

export function TrafficInsightsSection() {
  const [days, setDays] = useState('30');
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportText, setReportText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/traffic/overview?days=${days}`);
      if (res.status === 403 || res.status === 401) {
        toast.error('Acesso restrito a administradores');
        return;
      }
      const json = (await res.json()) as OverviewPayload;
      setData(json);
    } catch {
      toast.error('Falha ao carregar dados de tráfego');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch(`/api/cron/traffic-insights-sync?days=${days}`, { method: 'POST' });
      const json = (await res.json()) as {
        status?: string;
        accounts?: Array<{ name?: string; status: string; error?: string }>;
        reason?: string;
        error?: string;
      };
      if (res.status === 401 || res.status === 403) {
        toast.error('Não autorizado');
        return;
      }
      if (json.status === 'unavailable') {
        toast.warning('Sync indisponível — aplique o pacote SQL da Fase 8 no Supabase');
        return;
      }
      if (json.status === 'no_accounts') {
        toast.info('Nenhuma conta Meta habilitada para sincronizar');
        return;
      }
      const accounts = json.accounts ?? [];
      const errors = accounts.filter((a) => a.status === 'error');
      if (errors.length > 0) {
        toast.warning(`Sync com falhas: ${errors.length} conta(s) — ${truncate(errors[0].error || 'erro desconhecido')}`);
      } else if (json.status === 'partial') {
        toast.warning('Sync parcial — veja o status por conta abaixo');
      } else {
        toast.success(`Sync concluída: ${accounts.length} conta(s) sincronizada(s)`);
      }
      await load();
    } catch {
      toast.error('Falha ao sincronizar insights');
    } finally {
      setSyncing(false);
    }
  }, [days, load]);

  const handleReport = useCallback(async () => {
    setReportLoading(true);
    try {
      const res = await fetch(`/api/traffic/report?days=${days}`);
      const json = (await res.json()) as { status?: string; report?: string; error?: string };
      if (json.report) {
        setReportText(json.report);
        setReportOpen(true);
      } else {
        toast.error(json.error || 'Falha ao gerar relatório');
      }
    } catch {
      toast.error('Falha ao gerar relatório');
    } finally {
      setReportLoading(false);
    }
  }, [days]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      toast.success('Relatório copiado — cole na sua IA externa');
    } catch {
      toast.error('Não foi possível copiar automaticamente');
    }
  }, [reportText]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([reportText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `relatorio-meta-ads-${days}d.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [reportText, days]);

  const totals = data?.totals;
  const unavailable = data?.status === 'unavailable';

  return (
    <div className="space-y-4">
      {/* Cabeçalho: período + ações */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="text-muted-foreground h-5 w-5" />
          <div>
            <p className="text-sm font-medium">Gestor de Tráfego</p>
            <p className="text-muted-foreground text-xs">
              Custo Meta × resultado no CRM · dados agregados
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[130px]" aria-label="Período de análise">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAY_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>{option} dias</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sincronizar
          </Button>
          <Button size="sm" onClick={handleReport} disabled={reportLoading}>
            {reportLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Gerar relatório p/ IA
          </Button>
        </div>
      </div>

      {unavailable && (
        <Card className="border-amber-500/40">
          <CardContent className="flex items-start gap-3 pt-4">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <div className="text-sm">
              <p className="font-medium">Tabelas de tráfego ainda não existem no banco</p>
              <p className="text-muted-foreground">
                Aplique o pacote <code className="text-xs">download/fase8-sql-editor-release.sql</code> no
                SQL Editor do Supabase e recarregue. O restante do CRM não é afetado.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cards de totais */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Gasto total</CardDescription>
            <CardTitle className="text-xl">{loading ? '…' : fmtBRL(totals?.spend ?? 0)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Leads (Meta)</CardDescription>
            <CardTitle className="text-xl">{loading ? '…' : totals?.leadsMeta ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>CPL médio</CardDescription>
            <CardTitle className="text-xl">
              {loading ? '…' : totals?.cplMedio == null ? '—' : fmtBRL(totals.cplMedio)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>CPA global (gasto/ganho)</CardDescription>
            <CardTitle className="text-xl">
              {loading ? '…' : totals?.cpaGlobal == null ? '—' : fmtBRL(totals.cpaGlobal)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Saúde da sincronização */}
      {(data?.accounts?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs">Sync:</span>
          {data!.accounts.map((account) => (
            <Badge
              key={account.adAccountId}
              variant={statusBadgeVariant(account.lastStatus)}
              title={account.lastError || account.lastSyncedAt || undefined}
            >
              {account.name || account.adAccountId}: {statusLabel(account.lastStatus)}
            </Badge>
          ))}
        </div>
      )}

      {/* Tabela por campanha */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Desempenho por campanha</CardTitle>
          <CardDescription>
            {data?.aggregates?.length ?? 0} campanha(s) · janela de {days} dias ·
            {' '}clientes = leads atribuídos no CRM (ganho/perdido = estágio do funil)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : (data?.aggregates?.length ?? 0) === 0 ? (
            <p className="text-muted-foreground py-6 text-sm">
              Nenhum dado no período. Sincronize os insights (botão acima) e aguarde tráfego —
              o custo aparece após a primeira sincronização e os clientes por campanha são
              atribuídos automaticamente a cada lead.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campanha</TableHead>
                    <TableHead className="text-right">Gasto</TableHead>
                    <TableHead className="text-right">Leads (Meta)</TableHead>
                    <TableHead className="text-right">CPL</TableHead>
                    <TableHead className="text-right">Clientes</TableHead>
                    <TableHead className="text-right">Ganhos</TableHead>
                    <TableHead className="text-right">Perdidos</TableHead>
                    <TableHead className="text-right">CPA</TableHead>
                    <TableHead className="text-right">Win rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data!.aggregates.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="max-w-[260px] truncate font-medium" title={row.name}>
                        {row.name}
                      </TableCell>
                      <TableCell className="text-right">{fmtBRL(row.spend)}</TableCell>
                      <TableCell className="text-right">{row.leadsMeta}</TableCell>
                      <TableCell className="text-right">{row.cplMeta == null ? '—' : fmtBRL(row.cplMeta)}</TableCell>
                      <TableCell className="text-right">{row.outcome.leads}</TableCell>
                      <TableCell className="text-right">{row.outcome.won}</TableCell>
                      <TableCell className="text-right">{row.outcome.lost}</TableCell>
                      <TableCell className="text-right">{row.cpa == null ? '—' : fmtBRL(row.cpa)}</TableCell>
                      <TableCell className="text-right">{fmtPct(row.winRate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog do relatório */}
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Relatório de otimização (sem PII)</DialogTitle>
            <DialogDescription>
              Cole este markdown na sua IA externa. As regras de decisão (guardrails) já estão no topo do documento.
            </DialogDescription>
          </DialogHeader>
          <pre className="bg-muted max-h-[55vh] overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
            {reportText}
          </pre>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="h-4 w-4" /> Baixar .md
            </Button>
            <Button size="sm" onClick={handleCopy}>
              <Copy className="h-4 w-4" /> Copiar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function truncate(text: string, max = 140): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
