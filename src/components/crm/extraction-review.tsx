'use client';

/**
 * extraction-review.tsx — Saúde da base documental + revisão de extração
 * (prompt v1.0 Fase 3 UI §10.6 e Fase 4 §11).
 *
 * Fluxo implementado (§10.6):
 *   Envio/Processamento → Revisão (atual × sugerido, evidência, status) →
 *   Confirmação (resumo das mudanças) → Publicação (confirmação explícita) →
 *   Resultado (versão, data, responsável, restauração).
 *
 * Regras: críticos (preço, entrega, status, tipologias) exigem decisão
 * individual; baixo risco aceita em lote; edição sem JSON; conflitos
 * sinalizados por ícone + texto; dados não salvos preservados em erro
 * recuperável (estado local). Publicação falha ⇒ nada muda no servidor.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2, RefreshCw, FileSearch, AlertTriangle, CheckCircle2, XCircle,
  Pencil, History, RotateCcw, ShieldCheck, Database, FileWarning, CircleSlash,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NexoAvatar } from '@/components/ai-assistant/nexo-avatar';
import { useAssistantContextStore } from '@/components/ai-assistant/assistant-context-store';
import { cn } from '@/lib/utils';

// Registro dos cartões montados — agrega o sinal proativo determinístico
// (Fase 7): nº de empreendimentos com revisão pendente. Sem IA, sem PII.
const reviewSignalRegistry = new Map<string, boolean>();

function publishReviewSignal(setProactiveSignals: (s: { enterpriseReview?: number }) => void): void {
  let count = 0;
  for (const needs of reviewSignalRegistry.values()) if (needs) count++;
  setProactiveSignals({ enterpriseReview: count });
}

// ── Tipos (espelham as rotas) ───────────────────────────────────────────────

type FieldStatus = 'found' | 'missing' | 'conflicting' | 'needs_review' | 'accepted' | 'edited' | 'rejected';

interface FieldCandidate {
  field: string;
  value: unknown;
  status: FieldStatus;
  method: 'ai' | 'rule' | 'human';
  confidence: number | null;
  evidence: Array<{ page: number | null; excerpt: string; blockIndex: number }>;
  note: string | null;
}

interface StatusResponse {
  enterpriseId: string;
  document: { hasText: boolean; characters: number; documentHash: string | null; lastUploadedAt: string };
  draft: {
    runId: string; status: string; generatedAt: string;
    blocksProcessed: number; blocksTotal: number; needsReview: boolean; stale: boolean;
    fields: FieldCandidate[]; limitations: string[];
  } | null;
  verified: { info: Record<string, unknown>; at: string | null; by: string | null } | null;
  published: { info: Record<string, unknown>; at: string | null; version: number } | null;
  lastRun: { id: string; status: string; trigger: string; blocksTotal: number; blocksProcessed: number; error: string | null; startedAt: string; completedAt: string | null } | null;
  versions: Array<{ id: string; version: number; source: string; publishedById: string | null; publishedAt: string }>;
  health: {
    status: 'ready' | 'processing' | 'needs_review' | 'failed' | 'stale' | 'no_document';
    coverage: { found: string[]; missing: string[]; conflicting: string[] };
  };
}

const CRITICAL_FIELDS = new Set(['price', 'deliveryDate', 'status', 'apartmentTypes']);

const FIELD_LABELS: Record<string, string> = {
  'location.address': 'Endereço',
  'location.neighborhood': 'Bairro',
  'location.city': 'Cidade',
  'location.state': 'Estado',
  'location.region': 'Região',
  'location.additionalInfo': 'Complemento de localização',
  'builder': 'Construtora',
  'architecture': 'Arquitetura',
  'landscaping': 'Paisagismo',
  'status': 'Status do empreendimento',
  'deliveryDate': 'Previsão de entrega',
  'price': 'Preço',
  'totalUnits': 'Total de unidades',
  'floors': 'Andares',
  'parkingSpots': 'Vagas de garagem',
  'differentials': 'Diferenciais',
  'apartmentTypes': 'Tipologias',
  'summary': 'Resumo',
};

const HEALTH_LABELS: Record<StatusResponse['health']['status'], { label: string; className: string; icon: React.ElementType }> = {
  ready: { label: 'Base pronta', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30', icon: CheckCircle2 },
  processing: { label: 'Processando', className: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30', icon: Loader2 },
  needs_review: { label: 'Precisa de revisão', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30', icon: AlertTriangle },
  failed: { label: 'Extração falhou', className: 'bg-destructive/10 text-destructive border-destructive/30', icon: XCircle },
  stale: { label: 'Desatualizada', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30', icon: FileWarning },
  no_document: { label: 'Sem base documental', className: 'bg-muted text-muted-foreground border-border', icon: CircleSlash },
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    if (typeof value[0] === 'object' && value[0] !== null) {
      return value.map((t) => {
        const o = t as Record<string, unknown>;
        const parts = [o.name, o.area, o.bedrooms, o.price].filter(Boolean);
        return parts.join(' · ');
      }).join(' | ');
    }
    return value.map(String).join(', ');
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).filter(Boolean).join(', ') || '—';
  }
  return String(value);
}

function readPath(info: Record<string, unknown> | null | undefined, field: string): unknown {
  if (!info) return null;
  if (field.startsWith('location.')) {
    const loc = info.location as Record<string, unknown> | null | undefined;
    return loc?.[field.split('.')[1]] ?? null;
  }
  return info[field] ?? null;
}

// ════════════════════════════════════════════════════════════════════════════
// Cartão de saúde da base documental (Fase 4)
// ════════════════════════════════════════════════════════════════════════════

export function DocumentHealthCard({
  enterpriseId,
  hasDocument,
  refreshKey,
  onOpenReview,
}: {
  enterpriseId: string;
  hasDocument: boolean;
  /** Mudou ⇒ recarrega o status (pós-upload/remoção da base ou extração manual). */
  refreshKey?: number;
  onOpenReview: () => void;
}) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setProactiveSignals = useAssistantContextStore((s) => s.setProactiveSignals);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/enterprises/extraction/status?enterpriseId=${enterpriseId}`);
      if (res.ok) {
        const json = (await res.json()) as StatusResponse;
        setStatus(json);
        reviewSignalRegistry.set(enterpriseId, json.health.status === 'needs_review' || json.health.status === 'stale' || json.health.status === 'failed');
        publishReviewSignal(setProactiveSignals);
      } else {
        setError('Não foi possível carregar o status da base.');
      }
    } catch {
      setError('Não foi possível carregar o status da base.');
    } finally {
      setLoading(false);
    }
  }, [enterpriseId, setProactiveSignals]);

  useEffect(() => {
    void load();
    return () => {
      reviewSignalRegistry.delete(enterpriseId);
      publishReviewSignal(setProactiveSignals);
    };
  }, [load, enterpriseId, setProactiveSignals, refreshKey]);

  async function runExtraction() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/enterprises/extract-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enterpriseId, force: true }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error || 'A extração falhou — dados existentes preservados.');
      }
      await load();
    } catch {
      setError('A extração falhou — dados existentes preservados.');
    } finally {
      setRunning(false);
    }
  }

  const health = status?.health.status ?? (hasDocument ? 'processing' : 'no_document');
  const meta = HEALTH_LABELS[health];
  const HealthIcon = meta.icon;
  const draft = status?.draft;
  const published = status?.published;
  const verified = status?.verified;

  return (
    <Card className="border-dashed">
      <CardContent className="p-3 space-y-2.5">
        {/* Status + documento */}
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium', meta.className)}>
            <HealthIcon className={cn('h-3 w-3', health === 'processing' && 'animate-spin')} aria-hidden />
            {meta.label}
          </span>
          {hasDocument && status?.document && (
            <span className="text-[10px] text-muted-foreground">
              {(status.document.characters / 1024).toFixed(0)} KB
              {draft ? ` · blocos ${draft.blocksProcessed}/${draft.blocksTotal}` : ''}
            </span>
          )}
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Carregando saúde da base…
          </div>
        )}

        {error && (
          <p className="flex items-start gap-1.5 text-xs text-destructive" role="alert">
            <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" aria-hidden /> {error}
          </p>
        )}

        {/* Cobertura */}
        {draft && draft.fields.length > 0 && (
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            <Badge variant="outline" className="h-5 gap-1 text-[10px]">
              <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" aria-hidden />
              {status?.health.coverage.found.length ?? 0} encontrados
            </Badge>
            {(status?.health.coverage.conflicting.length ?? 0) > 0 && (
              <Badge variant="outline" className="h-5 gap-1 text-[10px]">
                <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400" aria-hidden />
                {status?.health.coverage.conflicting.length} conflitantes
              </Badge>
            )}
            {(status?.health.coverage.missing.length ?? 0) > 0 && (
              <Badge variant="outline" className="h-5 gap-1 text-[10px]">
                <CircleSlash className="h-3 w-3 text-muted-foreground" aria-hidden />
                {status?.health.coverage.missing.length} ausentes
              </Badge>
            )}
          </div>
        )}

        {/* Uso — versão pública */}
        <div className="text-[10px] leading-relaxed text-muted-foreground">
          {published ? (
            <span className="inline-flex items-center gap-1">
              <Database className="h-3 w-3" aria-hidden />
              Landing page usa a versão publicada v{published.version}
              {published.at ? ` · ${new Date(published.at).toLocaleDateString('pt-BR')}` : ''}
            </span>
          ) : verified ? (
            <span className="inline-flex items-center gap-1">
              <Database className="h-3 w-3" aria-hidden />
              Dados verificados prontos — publique para usar na landing page
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <FileWarning className="h-3 w-3" aria-hidden />
              Sem versão verificada: superfícies públicas usam o legado (cachedInfo). Revise e publique.
            </span>
          )}
        </div>

        {/* Limitações da última extração */}
        {draft?.limitations.map((l, i) => (
          <p key={i} className="text-[10px] text-amber-700 dark:text-amber-400">{l}</p>
        ))}

        {/* Ações */}
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm" variant="outline"
            className="h-8 min-h-[32px] gap-1.5 px-2.5 text-xs"
            onClick={runExtraction}
            disabled={running || !hasDocument || !status?.document.hasText}
            title={!hasDocument ? 'Envie uma base documental primeiro' : undefined}
          >
            {running ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
            {draft ? 'Reprocessar' : 'Extrair informações'}
          </Button>
          <Button
            size="sm" variant="outline"
            className="h-8 min-h-[32px] gap-1.5 px-2.5 text-xs"
            onClick={onOpenReview}
            disabled={!draft}
          >
            <FileSearch className="h-3 w-3" aria-hidden />
            Revisar extração
          </Button>
        </div>

        {!hasDocument && (
          <p className="text-[10px] text-muted-foreground">
            Sem texto legível: o Nexo não consegue responder sobre este empreendimento e a extração estruturada não está disponível.
          </p>
        )}
        {hasDocument && status && !status.document.hasText && (
          <p className="flex items-start gap-1.5 text-[10px] text-amber-700 dark:text-amber-400">
            <FileWarning className="mt-0.5 h-3 w-3 flex-shrink-0" aria-hidden />
            O arquivo vinculado não tem texto extraível (provável documento digitalizado). Substitua por um PDF com camada de texto.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Dialog de revisão campo a campo + publicação (Fase 3 UI)
// ════════════════════════════════════════════════════════════════════════════

type Decision = { action: 'accept' | 'edit' | 'reject'; value?: unknown };

export function ExtractionReviewDialog({
  enterpriseId,
  enterpriseName,
  open,
  onOpenChange,
  onPublished,
}: {
  enterpriseId: string;
  enterpriseName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPublished?: () => void;
}) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [editTypes, setEditTypes] = useState<Record<string, Array<{ name: string; area: string; bedrooms: string; price: string }>>>({});
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/enterprises/extraction/status?enterpriseId=${enterpriseId}`);
      if (res.ok) {
        const json = (await res.json()) as StatusResponse;
        setStatus(json);
        setDecisions({});
        setEditing({});
        setEditTypes({});
      } else {
        setError('Não foi possível carregar o rascunho.');
      }
    } catch {
      setError('Não foi possível carregar o rascunho.');
    } finally {
      setLoading(false);
    }
  }, [enterpriseId, open]);

  useEffect(() => {
    void load();
  }, [load]);

  const draft = status?.draft;
  const fields = draft?.fields ?? [];

  const decidedCount = Object.keys(decisions).length;
  const unresolvedCritical = fields.filter(
    (f) => CRITICAL_FIELDS.has(f.field) && (f.status === 'conflicting' || f.status === 'needs_review' || f.status === 'missing') && !decisions[f.field],
  );

  function setDecision(field: string, d: Decision | null) {
    setDecisions((prev) => {
      const next = { ...prev };
      if (d === null) delete next[field];
      else next[field] = d;
      return next;
    });
  }

  function startEdit(f: FieldCandidate) {
    if (f.field === 'apartmentTypes') {
      const list = Array.isArray(f.value) ? f.value as Array<Record<string, unknown>> : [];
      setEditTypes((prev) => ({
        ...prev,
        [f.field]: list.map((t) => ({
          name: String(t.name ?? ''),
          area: String(t.area ?? ''),
          bedrooms: String(t.bedrooms ?? ''),
          price: String(t.price ?? ''),
        })),
      }));
    } else {
      setEditing((prev) => ({ ...prev, [f.field]: f.value === null || f.value === undefined ? '' : typeof f.value === 'object' ? (f.value as string[]).join(', ') : String(f.value) }));
    }
    setDecision(f.field, { action: 'edit', value: undefined });
  }

  function commitEdit(f: FieldCandidate) {
    if (f.field === 'apartmentTypes') {
      const list = (editTypes[f.field] ?? []).filter((t) => t.name.trim() !== '');
      setDecision(f.field, { action: 'edit', value: list });
    } else if (f.field === 'differentials') {
      const list = (editing[f.field] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      setDecision(f.field, { action: 'edit', value: list });
    } else if (['totalUnits', 'floors', 'parkingSpots'].includes(f.field)) {
      const n = parseInt((editing[f.field] ?? '').replace(/\D/g, ''), 10);
      setDecision(f.field, { action: 'edit', value: Number.isFinite(n) ? n : null });
    } else {
      const v = (editing[f.field] ?? '').trim();
      setDecision(f.field, { action: 'edit', value: v === '' ? null : v });
    }
  }

  async function publish(verifyOnly: boolean) {
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch('/api/enterprises/extraction/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enterpriseId,
          decisions: Object.entries(decisions).map(([field, d]) => ({ field, action: d.action, value: d.value })),
          verifyOnly,
        }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        setSuccessMsg(verifyOnly
          ? 'Alterações salvas como verificado — ainda não publicadas.'
          : `Publicação concluída (v${body?.publishedVersion ?? '?'}) — landing pages agora usam a versão aprovada.`);
        setDecisions({});
        onPublished?.();
        await load();
      } else {
        // Decisões preservadas em erro recuperável (§10.6)
        setError(body?.error || 'Não foi possível publicar. Suas decisões foram preservadas.');
      }
    } catch {
      setError('Não foi possível publicar. Suas decisões foram preservadas.');
    } finally {
      setPublishing(false);
      setPublishOpen(false);
    }
  }

  async function restore(version: number) {
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch('/api/enterprises/extraction/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enterpriseId, version }),
      });
      if (res.ok) {
        setSuccessMsg(`Versão v${version} restaurada como nova versão publicada.`);
        onPublished?.();
        await load();
      } else {
        const body = await res.json().catch(() => null);
        setError(body?.error || 'Não foi possível restaurar.');
      }
    } catch {
      setError('Não foi possível restaurar.');
    } finally {
      setPublishing(false);
    }
  }

  function acceptLowRiskBatch() {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const f of fields) {
        if (CRITICAL_FIELDS.has(f.field)) continue;
        if (f.status !== 'found') continue;
        if (!next[f.field]) next[f.field] = { action: 'accept' };
      }
      return next;
    });
  }

  const statusChip = (f: FieldCandidate) => {
    const decided = decisions[f.field];
    if (decided?.action === 'accept') return { label: 'Aceito', icon: CheckCircle2, cls: 'text-emerald-700 dark:text-emerald-400' };
    if (decided?.action === 'edit') return { label: 'Editado', icon: Pencil, cls: 'text-blue-700 dark:text-blue-400' };
    if (decided?.action === 'reject') return { label: 'Rejeitado', icon: XCircle, cls: 'text-muted-foreground' };
    switch (f.status) {
      case 'found': return { label: 'Encontrado', icon: CheckCircle2, cls: 'text-emerald-700 dark:text-emerald-400' };
      case 'conflicting': return { label: 'Conflitante — revisão individual', icon: AlertTriangle, cls: 'text-amber-700 dark:text-amber-400' };
      case 'needs_review': return { label: 'Precisa de revisão', icon: AlertTriangle, cls: 'text-amber-700 dark:text-amber-400' };
      case 'missing': return { label: 'Não encontrado no documento', icon: CircleSlash, cls: 'text-muted-foreground' };
      default: return { label: f.status, icon: FileWarning, cls: 'text-muted-foreground' };
    }
  };

  const isEditing = (field: string) => decisions[field]?.action === 'edit' && (editing[field] !== undefined || editTypes[field] !== undefined);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl" role="dialog" aria-label="Revisão de extração">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <NexoAvatar state="idle" theme="transparente" size={22} decorative className="rounded-md" />
              Revisão da extração — {enterpriseName}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Compare o valor atual com o sugerido, veja a evidência do documento e decida campo a campo.
              Campos críticos exigem decisão individual. Nada é publicado sem confirmação.
            </DialogDescription>
          </DialogHeader>

          {loading && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Carregando rascunho…
            </div>
          )}

          {error && (
            <p className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive" role="alert">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden /> {error}
            </p>
          )}
          {successMsg && (
            <p className="flex items-start gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-xs text-emerald-700 dark:text-emerald-400" role="status">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden /> {successMsg}
            </p>
          )}

          {!loading && !draft && (
            <p className="py-4 text-sm text-muted-foreground">
              Nenhum rascunho disponível. Use "Extrair informações" no cartão de saúde da base.
            </p>
          )}

          {!loading && draft && (
            <>
              {draft.limitations.map((l, i) => (
                <p key={i} className="text-[10px] text-amber-700 dark:text-amber-400">{l}</p>
              ))}

              <div className="space-y-2">
                {fields.map((f) => {
                  const chip = statusChip(f);
                  const ChipIcon = chip.icon;
                  const current = readPath(status?.verified?.info, f.field) ?? readPath(status?.published?.info, f.field);
                  const critical = CRITICAL_FIELDS.has(f.field);
                  return (
                    <div key={f.field} className={cn('rounded-lg border p-2.5', f.status === 'conflicting' && 'border-amber-500/40')}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-semibold">{FIELD_LABELS[f.field] ?? f.field}</span>
                        {critical && (
                          <Badge variant="outline" className="h-4 gap-1 px-1 text-[9px] uppercase">
                            <ShieldCheck className="h-2.5 w-2.5" aria-hidden /> crítico
                          </Badge>
                        )}
                        <span className={cn('ml-auto inline-flex items-center gap-1 text-[10px]', chip.cls)}>
                          <ChipIcon className="h-3 w-3" aria-hidden /> {chip.label}
                        </span>
                      </div>

                      {/* Sugerido / edição */}
                      <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                        <div className="min-w-0">
                          <p className="text-[10px] text-muted-foreground">Atual (verificado)</p>
                          <p className="truncate" title={formatValue(current)}>{formatValue(current)}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] text-muted-foreground">Sugerido pela extração</p>
                          {isEditing(f.field) && f.field !== 'apartmentTypes' ? (
                            <Input
                              value={editing[f.field] ?? ''}
                              onChange={(e) => setEditing((prev) => ({ ...prev, [f.field]: e.target.value }))}
                              onBlur={() => commitEdit(f)}
                              className="h-7 text-xs"
                              aria-label={`Editar ${FIELD_LABELS[f.field] ?? f.field}`}
                            />
                          ) : isEditing(f.field) ? (
                            <div className="space-y-1">
                              {(editTypes[f.field] ?? []).map((t, i) => (
                                <div key={i} className="grid grid-cols-4 gap-1">
                                  <Input value={t.name} onChange={(e) => setEditTypes((prev) => ({ ...prev, [f.field]: prev[f.field].map((x, j) => j === i ? { ...x, name: e.target.value } : x) }))} placeholder="Nome" className="h-7 text-[11px]" aria-label="Nome do tipo" />
                                  <Input value={t.area} onChange={(e) => setEditTypes((prev) => ({ ...prev, [f.field]: prev[f.field].map((x, j) => j === i ? { ...x, area: e.target.value } : x) }))} placeholder="Área" className="h-7 text-[11px]" aria-label="Área" />
                                  <Input value={t.bedrooms} onChange={(e) => setEditTypes((prev) => ({ ...prev, [f.field]: prev[f.field].map((x, j) => j === i ? { ...x, bedrooms: e.target.value } : x) }))} placeholder="Quartos" className="h-7 text-[11px]" aria-label="Quartos" />
                                  <Input value={t.price} onChange={(e) => setEditTypes((prev) => ({ ...prev, [f.field]: prev[f.field].map((x, j) => j === i ? { ...x, price: e.target.value } : x) }))} placeholder="Preço" className="h-7 text-[11px]" aria-label="Preço" />
                                </div>
                              ))}
                              <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => { setEditTypes((prev) => ({ ...prev, [f.field]: [...(prev[f.field] ?? []), { name: '', area: '', bedrooms: '', price: '' }] })); }}>
                                + tipo
                              </Button>
                            </div>
                          ) : (
                            <p className="truncate" title={formatValue(f.value)}>{formatValue(f.value)}</p>
                          )}
                        </div>
                      </div>

                      {/* Evidência + nota de conflito */}
                      {(f.evidence.length > 0 || f.note) && (
                        <div className="mt-1.5 space-y-1">
                          {f.note && (
                            <p className="flex items-start gap-1 text-[10px] text-amber-700 dark:text-amber-400">
                              <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" aria-hidden />
                              Valores divergentes no documento: {f.note}
                            </p>
                          )}
                          {f.evidence.slice(0, 1).map((ev, i) => (
                            <p key={i} className="truncate text-[10px] italic text-muted-foreground" title={ev.excerpt}>
                              “{ev.excerpt}”{ev.page ? ` — página ${ev.page}` : ''}
                            </p>
                          ))}
                        </div>
                      )}

                      {/* Decisões */}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {!decisions[f.field] ? (
                          <>
                            <Button variant="outline" size="sm" className="h-7 min-h-[28px] gap-1 px-2 text-[11px]" onClick={() => setDecision(f.field, { action: 'accept' })} disabled={f.status === 'missing'}>
                              <CheckCircle2 className="h-3 w-3" aria-hidden /> Aceitar
                            </Button>
                            <Button variant="outline" size="sm" className="h-7 min-h-[28px] gap-1 px-2 text-[11px]" onClick={() => startEdit(f)}>
                              <Pencil className="h-3 w-3" aria-hidden /> Editar
                            </Button>
                            <Button variant="outline" size="sm" className="h-7 min-h-[28px] gap-1 px-2 text-[11px]" onClick={() => setDecision(f.field, { action: 'reject' })}>
                              <XCircle className="h-3 w-3" aria-hidden /> Rejeitar
                            </Button>
                          </>
                        ) : (
                          <Button variant="ghost" size="sm" className="h-7 min-h-[28px] px-2 text-[11px]" onClick={() => setDecision(f.field, null)}>
                            <RotateCcw className="h-3 w-3" aria-hidden /> Desfazer decisão
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Histórico de versões */}
              {(status?.versions.length ?? 0) > 0 && (
                <details className="rounded-lg border p-2.5">
                  <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium">
                    <History className="h-3.5 w-3.5" aria-hidden /> Versões publicadas ({status?.versions.length})
                  </summary>
                  <ul className="mt-2 space-y-1.5">
                    {status?.versions.map((v) => (
                      <li key={v.id} className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="font-medium">v{v.version}</span>
                        <Badge variant="outline" className="h-4 text-[9px]">{v.source}</Badge>
                        <span className="text-muted-foreground">{new Date(v.publishedAt).toLocaleString('pt-BR')}</span>
                        {v.version !== status?.published?.version && (
                          <Button variant="outline" size="sm" className="ml-auto h-6 min-h-[24px] px-1.5 text-[10px]" onClick={() => restore(v.version)} disabled={publishing}>
                            <RotateCcw className="h-2.5 w-2.5" aria-hidden /> Restaurar
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <div className="mr-auto text-left text-[10px] text-muted-foreground">
              {draft && (
                <>
                  {decidedCount} decisão(ões) registrada(s)
                  {unresolvedCritical.length > 0 && (
                    <span className="ml-1 inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-3 w-3" aria-hidden />
                      {unresolvedCritical.length} crítico(s) sem decisão
                    </span>
                  )}
                </>
              )}
            </div>
            <Button variant="ghost" size="sm" className="h-9 min-h-[36px] text-xs" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 min-h-[36px] gap-1.5 text-xs"
              onClick={acceptLowRiskBatch}
              disabled={!draft || fields.filter((f) => !CRITICAL_FIELDS.has(f.field) && f.status === 'found').length === 0}
            >
              Aceitar baixo risco em lote
            </Button>
            <Button
              size="sm"
              className="h-9 min-h-[36px] gap-1.5 text-xs"
              onClick={() => setPublishOpen(true)}
              disabled={!draft || decidedCount === 0}
            >
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              Aplicar alterações
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação proporcional ao risco (publicação) */}
      <AlertDialog open={publishOpen} onOpenChange={setPublishOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar publicação das alterações?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1.5 text-sm">
                <p>
                  {decisions['apartmentTypes'] || decisions['price'] || decisions['deliveryDate'] || decisions['status']
                    ? 'Campos críticos (preço, entrega, status, tipologias) serão alterados nas superfícies públicas.'
                    : 'Somente campos de baixo risco serão alterados.'}
                </p>
                <p className="text-xs text-muted-foreground">
                  A versão atual permanece no histórico e pode ser restaurada. A publicação cria uma nova versão com seu nome e data.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9">Cancelar</AlertDialogCancel>
            <Button
              variant="outline"
              className="h-9 text-xs"
              onClick={() => publish(true)}
              disabled={publishing}
            >
              Salvar só como verificado
            </Button>
            <AlertDialogAction
              className="h-9"
              onClick={(e) => { e.preventDefault(); void publish(false); }}
              disabled={publishing || unresolvedCritical.length > 0}
            >
              {publishing && <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />}
              Publicar nova versão
            </AlertDialogAction>
          </AlertDialogFooter>
          {unresolvedCritical.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              A publicação está bloqueada enquanto houver campos críticos em conflito sem decisão: {unresolvedCritical.map((f) => FIELD_LABELS[f.field] ?? f.field).join(', ')}.
            </p>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
