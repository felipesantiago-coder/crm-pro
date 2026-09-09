'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Activity, AlertTriangle, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { emqTone, type QualityEvent } from '@/lib/meta-dataset-quality';
import { timeAgoPt } from '@/lib/capi-event-log';

// ============================================================
// CapiQualityDialog — métricas REAIS da Meta (Dataset Quality API)
// para um config CAPI: EMQ 0-10 por evento, cobertura das match keys,
// event coverage e diagnostics. Complementa o "teste raio" (que só
// confirma recebimento de um evento sintético) respondendo "como está
// a QUALIDADE do que está sendo enviado?".
//
// Usado nos DOIS lugares: aba CAPI do card da conta e painel global.
// Também mostra as últimas falhas de envio registradas localmente
// (capi_event_logs) — falhas que antes eram invisíveis (console.error).
// ============================================================

interface QualityResponse {
  ok: boolean;
  error?: string;
  fetchedAt?: string;
  events?: QualityEvent[];
  empty?: boolean;
  hint?: string | null;
}

interface LocalFailuresResponse {
  logs?: Array<{
    id: string;
    status: string;
    clientName?: string | null;
    eventName?: string | null;
    errorMessage?: string | null;
    createdAt: string;
  }>;
}

interface CapiQualityDialogProps {
  configId: string;
  configName: string;
  datasetId: string;
}

const EMQ_TONE_CLASSES: Record<string, { bar: string; badge: string; label: string }> = {
  good: { bar: 'bg-green-500', badge: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', label: 'bom' },
  mid: { bar: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', label: 'médio' },
  low: { bar: 'bg-red-500', badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', label: 'fraco' },
  none: { bar: 'bg-muted-foreground/40', badge: 'bg-muted text-muted-foreground', label: 'sem dados' },
};

function keyToneClass(pct: number | null): string {
  if (pct == null) return 'bg-muted text-muted-foreground';
  if (pct >= 80) return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
  if (pct >= 50) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
  return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
}

export function CapiQualityDialog({ configId, configName, datasetId }: CapiQualityDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [quality, setQuality] = useState<QualityResponse | null>(null);
  const [failures, setFailures] = useState<LocalFailuresResponse | null>(null);

  async function load() {
    setLoading(true);
    setQuality(null);
    setFailures(null);
    try {
      const [qRes, fRes] = await Promise.all([
        fetch(`/api/meta-capi-configs/${configId}/quality`),
        fetch(`/api/meta-capi-logs?configId=${encodeURIComponent(configId)}&status=failed&limit=5`),
      ]);
      setQuality(await qRes.json().catch(() => ({ ok: false, error: 'Resposta inválida' })));
      setFailures(fRes.ok ? await fRes.json().catch(() => null) : null);
    } catch {
      setQuality({ ok: false, error: 'Falha de conexão ao consultar a Meta' });
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) load();
  }

  const events = quality?.events ?? [];

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 w-7 p-0"
        onClick={() => handleOpenChange(true)}
        title="Qualidade na Meta (EMQ real do Events Manager)"
      >
        <Activity className="h-3.5 w-3.5" />
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              Qualidade do envio — {configName}
            </DialogTitle>
            <DialogDescription>
              Dataset <span className="font-mono">{datasetId}</span> · métricas reais do Gerenciador
              de Eventos da Meta (aparecem 24-48h após os primeiros envios — diferente do teste raio,
              que só confirma recebimento).
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !quality?.ok ? (
            <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 p-3 text-xs text-red-700 dark:text-red-400 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{quality?.error || 'Erro ao consultar a Meta'}</span>
            </div>
          ) : quality.empty || events.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground text-center">
              {quality.hint ||
                'A Meta ainda não calculou métricas de qualidade para este dataset. Envie eventos reais e volte em 24-48h.'}
            </div>
          ) : (
            <div className="space-y-2.5">
              {events.map((ev) => {
                const tone = EMQ_TONE_CLASSES[emqTone(ev.emq)];
                return (
                  <div key={ev.eventName} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-xs">{ev.eventName}</span>
                      <Badge className={`text-[10px] px-1.5 py-0 ${tone.badge}`}>
                        EMQ {ev.emq != null ? `${ev.emq}/10` : '—'} · {tone.label}
                      </Badge>
                    </div>

                    {/* Barra EMQ (0-10 → 0-100%) */}
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full ${tone.bar}`}
                        style={{ width: `${ev.emq != null ? Math.max(0, Math.min(100, ev.emq * 10)) : 0}%` }}
                      />
                    </div>

                    {/* Match keys enviadas */}
                    {ev.matchKeys.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {ev.matchKeys.map((k) => (
                          <Badge
                            key={k.identifier}
                            className={`text-[9px] px-1.5 py-0 font-normal ${keyToneClass(k.percentage)}`}
                            title={`Cobertura da chave "${k.identifier}" nos eventos deste dataset`}
                          >
                            {k.identifier}{k.percentage != null ? ` ${k.percentage}%` : ''}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Event coverage */}
                    {ev.coverage?.percentage != null && (
                      <p className="text-[10px] text-muted-foreground">
                        Cobertura de eventos (7d): {ev.coverage.percentage}%
                        {ev.coverage.goal != null ? ` — meta da Meta: ${ev.coverage.goal}%` : ''}
                      </p>
                    )}

                    {/* Diagnostics da Meta */}
                    {ev.diagnostics.length > 0 && (
                      <div className="space-y-1.5 pt-1 border-t">
                        {ev.diagnostics.map((d, i) => (
                          <div key={`${d.name}-${i}`} className="flex items-start gap-1.5">
                            <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <p className="text-[11px] font-medium leading-snug">
                                {d.name}
                                {d.percentage != null ? ` (${d.percentage}% dos eventos)` : ''}
                              </p>
                              {d.solution && (
                                <p className="text-[10px] text-muted-foreground leading-snug">{d.solution}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Falhas recentes registradas localmente */}
          {!loading && failures?.logs && failures.logs.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-red-600 dark:text-red-400">
                Falhas recentes de envio neste config
              </p>
              {failures.logs.map((log) => (
                <div
                  key={log.id}
                  className="rounded-md border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/10 p-2 text-[11px] flex items-start gap-1.5"
                >
                  <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">
                      {log.eventName || 'Evento'}
                      {log.clientName ? ` · ${log.clientName}` : ''}
                      <span className="font-normal text-muted-foreground"> · {timeAgoPt(log.createdAt)}</span>
                    </p>
                    {log.errorMessage && (
                      <p className="text-[10px] text-muted-foreground break-words" title={log.errorMessage}>
                        {log.errorMessage}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <DialogFooter className="items-center justify-between sm:justify-between">
            <span className="text-[10px] text-muted-foreground">
              {quality?.fetchedAt ? `Consultado ${timeAgoPt(quality.fetchedAt)}` : ''}
            </span>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" onClick={load} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} /> Atualizar
              </Button>
              <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
                Fechar
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
