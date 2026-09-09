'use client';

import React, { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { CheckCircle2, Loader2, MinusCircle, RefreshCw, XCircle } from 'lucide-react';
import { timeAgoPt } from '@/lib/capi-event-log';

// ============================================================
// CapiActivityLog — feed das tentativas REAIS de envio à Conversions API
// (tabela capi_event_logs, alimentada por sendLeadConversionEvent).
//
// Antes desta seção, falhas de envio CAPI eram apenas console.error no
// servidor — o admin mudava o stage de um lead, a conversão nunca chegava
// na Meta e ninguém ficava sabendo. Agora: sent (verde), failed (vermelho)
// e skipped (âmbar — config do lead não resolvido, ex.: excluído/inativo).
// ============================================================

interface LogRow {
  id: string;
  status: string;
  capiConfigId?: string | null;
  capiConfigName?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  eventName?: string | null;
  stage?: string | null;
  errorMessage?: string | null;
  metaResponse?: string | null;
  createdAt: string;
}

interface LogsResponse {
  logs?: LogRow[];
  stats?: {
    total7d: number;
    failed7d: number;
    skipped7d: number;
    failedByConfig: Record<string, number>;
  };
}

const STATUS_ICON: Record<string, { icon: React.ReactNode; text: string }> = {
  sent: {
    icon: <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />,
    text: 'text-foreground',
  },
  failed: { icon: <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0 mt-0.5" />, text: 'text-foreground' },
  skipped: { icon: <MinusCircle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" />, text: 'text-foreground' },
};

export function CapiActivityLog({ refreshToken }: { refreshToken?: number }) {
  const [data, setData] = useState<LogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [onlyProblems, setOnlyProblems] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/meta-capi-logs?limit=60');
      setData(res.ok ? await res.json().catch(() => null) : null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [refreshToken]);

  const logs = data?.logs ?? [];
  const visible = onlyProblems
    ? logs.filter((l) => l.status === 'failed' || l.status === 'skipped')
    : logs;
  const stats = data?.stats;

  return (
    <div className="rounded-lg border p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">Atividade de envio</span>
          {stats && stats.failed7d > 0 && (
            <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-[10px] gap-1">
              <XCircle className="h-2.5 w-2.5" /> {stats.failed7d} falha{stats.failed7d !== 1 ? 's' : ''} em 7d
            </Badge>
          )}
          {stats && stats.skipped7d > 0 && (
            <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-[10px] gap-1">
              <MinusCircle className="h-2.5 w-2.5" /> {stats.skipped7d} sem config em 7d
            </Badge>
          )}
          {stats && stats.total7d > 0 && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{stats.total7d} envio{stats.total7d !== 1 ? 's' : ''} em 7d</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Switch id="capi-only-problems" checked={onlyProblems} onCheckedChange={setOnlyProblems} />
            <Label htmlFor="capi-only-problems" className="text-[11px] text-muted-foreground cursor-pointer">
              Somente falhas
            </Label>
          </div>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={load} disabled={loading} title="Atualizar">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {!loading && visible.length === 0 ? (
        <p className="text-[11px] text-muted-foreground py-2">
          {logs.length === 0
            ? 'Nenhum envio registrado ainda. Envios acontecem automaticamente quando um lead muda de stage no CRM.'
            : onlyProblems
              ? 'Nenhuma falha registrada — todos os envios recentes foram aceitos pela Meta.'
              : ''}
        </p>
      ) : (
        <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
          {visible.map((log) => {
            const s = STATUS_ICON[log.status] ?? STATUS_ICON.failed;
            return (
              <div key={log.id} className="flex items-start gap-2 rounded-md border p-2 text-[11px] bg-background">
                {s.icon}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`font-medium ${s.text}`}>{log.eventName || 'Evento'}</span>
                    {log.capiConfigName && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 max-w-[160px] truncate">
                        {log.capiConfigName}
                      </Badge>
                    )}
                    {log.clientName && <span className="text-muted-foreground truncate">{log.clientName}</span>}
                    <span className="text-muted-foreground ml-auto flex-shrink-0">{timeAgoPt(log.createdAt)}</span>
                  </div>
                  {(log.status === 'failed' || log.status === 'skipped') && log.errorMessage && (
                    <p className="text-[10px] text-red-600 dark:text-red-400 break-words mt-0.5" title={log.errorMessage}>
                      {log.errorMessage}
                    </p>
                  )}
                  {log.status === 'sent' && log.metaResponse && (
                    <p className="text-[10px] text-muted-foreground break-words mt-0.5">{log.metaResponse}</p>
                  )}
                </div>
              </div>
            );
          })}
          {logs.length >= 60 && (
            <p className="text-[10px] text-muted-foreground text-center pt-1">
              Exibindo os 60 envios mais recentes.
            </p>
          )}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Cada mudança de stage de um lead gera um envio CAPI. "Sem config" significa que o lead tinha um
        config atribuído que foi excluído ou desativado — o evento não foi enviado para a Meta.
      </p>
    </div>
  );
}
