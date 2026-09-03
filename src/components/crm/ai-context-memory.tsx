'use client';

/**
 * Resumo do cliente com Nexo — v2 (prompt Implementação IA v1.0 §9).
 *
 * - FATOS: renderizados a partir do banco (response.facts) — o modelo não
 *   recria estágio, datas, contagens (§9.1).
 * - INTERPRETAÇÃO: ClientBrief estruturado (síntese, riscos com evidência,
 *   pendências, perguntas sugeridas, até 3 ações).
 * - AÇÕES: rascunhos editáveis; salvar lembrete exige confirmação explícita
 *   no dialog (§5.3 — nenhuma mutação automática).
 * - CACHE: "Atualizado há X" + chip de dados novos (stale por dataHash).
 * - FEEDBACK: "Foi útil?" sem interromper o fluxo (§9.5).
 * - Acessibilidade: aria-live nos estados, foco visível, alvos ≥44px,
 *   rótulos em todos os controles, não depende só de cor (ícone+texto).
 * - Identidade Nexo preservada: NexoAvatar, NexoMarkdown, tokens do tema.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  Copy, Check, Loader2, RefreshCw, ChevronDown, ChevronUp,
  AlertTriangle, ListChecks, MessageCircleQuestion, CalendarClock,
  ThumbsUp, ThumbsDown, PencilLine, Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { NexoAvatar } from '@/components/ai-assistant/nexo-avatar';
import { NexoMarkdown } from '@/components/ai-assistant/nexo-markdown';
import { getAssistantMessages, formatMessage } from '@/components/ai-assistant/assistant-messages';
import { useAssistantContextStore } from '@/components/ai-assistant/assistant-context-store';
import { useCRMStore } from '@/store/crm-store';
import { cn } from '@/lib/utils';

// ── Contratos espelhados da rota v2 ────────────────────────────────────────

interface BriefAction {
  label: string;
  actionType: 'OPEN_CHAT' | 'DRAFT_REMINDER' | 'OPEN_SCHEDULE' | 'LIST_PENDENCIES';
  rationale: string;
  requiresConfirmation: boolean;
}

interface ClientBriefData {
  summary: string;
  risks: Array<{ label: string; evidence: string; sourceId?: string }>;
  pendingItems: Array<{ label: string; sourceId?: string }>;
  suggestedQuestions: string[];
  suggestedActions: BriefAction[];
  limitations: string[];
}

interface ClientFacts {
  stageLabel: string;
  ownerName: string | null;
  lastInteractionAt: string | null;
  nextAppointmentAt: string | null;
  pendingRemindersCount: number;
  pendingSchedulesCount: number;
  totalInteractions: number;
  lastSummaryAt: string | null;
  hasNewDataSinceSummary: boolean;
}

interface ContextMemoryResponse {
  facts: ClientFacts;
  brief: ClientBriefData | null;
  cached: boolean;
  stale: boolean;
  generatedAt: string | null;
  insufficientData?: boolean;
  clientName: string;
  hasPhone: boolean;
  hasEmail: boolean;
}

function formatRelative(iso: string, t: ReturnType<typeof getAssistantMessages>): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return formatMessage(t.summary.justNow ?? 'agora', {});
  if (minutes < 60) return formatMessage(t.summary.minAgo, { count: String(minutes) });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatMessage(t.summary.hoursAgo, { count: String(hours) });
  const days = Math.floor(hours / 24);
  return formatMessage(t.summary.daysAgo, { count: String(days) });
}

function formatDateTimePtBr(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

// ── Componente ──────────────────────────────────────────────────────────────

export function AIContextMemory({ clientId }: { clientId: string }) {
  const t = getAssistantMessages();
  const [data, setData] = useState<ContextMemoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<'useful' | 'not_useful' | null>(null);
  const [showPending, setShowPending] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [draftDate, setDraftDate] = useState('');
  const [draftTime, setDraftTime] = useState('');
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftFeedback, setDraftFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const requestOpenPanel = useAssistantContextStore((s) => s.requestOpenPanel);
  const pinEntityContext = useAssistantContextStore((s) => s.pinEntityContext);
  const setCurrentView = useCRMStore((s) => s.setCurrentView);

  const loadBrief = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/context-memory${refresh ? '?refresh=1' : ''}`);
      if (res.ok) {
        const json = (await res.json()) as ContextMemoryResponse;
        setData(json);
      } else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error || t.summary.error);
      }
    } catch {
      setError(t.summary.error);
    } finally {
      setLoading(false);
    }
  }, [clientId, t]);

  async function handleCopy() {
    if (!data?.brief?.summary) return;
    try {
      await navigator.clipboard.writeText(data.brief.summary);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function askNexoAboutClient() {
    // Ação OPEN_CHAT — abre o chat com o cliente fixado como contexto
    // visível e removível, sempre por clique do usuário (§14.3).
    pinEntityContext();
    requestOpenPanel();
  }

  function openDraftReminder() {
    setDraftFeedback(null);
    // Pré-preenche rascunho a partir do resumo (editável, §9.5).
    const suggestion = data?.brief?.suggestedActions.find((a) => a.actionType === 'DRAFT_REMINDER');
    setDraftTitle(suggestion?.label ? t.summary.actions.draftReminder : '');
    setDraftDesc(suggestion?.rationale ?? '');
    setDraftDate('');
    setDraftTime('');
    setDraftOpen(true);
  }

  async function saveDraftReminder() {
    if (!draftTitle.trim() || !draftDate) return;
    setDraftSaving(true);
    setDraftFeedback(null);
    try {
      const res = await fetch('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draftTitle.trim(),
          description: draftDesc.trim() || null,
          dueDate: draftDate,
          dueTime: draftTime || null,
          clientId,
        }),
      });
      if (res.ok) {
        setDraftFeedback({ ok: true, msg: t.summary.draft.saved });
        window.setTimeout(() => setDraftOpen(false), 1200);
      } else {
        setDraftFeedback({ ok: false, msg: t.summary.draft.saveFailed });
      }
    } catch {
      setDraftFeedback({ ok: false, msg: t.summary.draft.saveFailed });
    } finally {
      setDraftSaving(false);
    }
  }

  async function sendFeedback(value: 'useful' | 'not_useful') {
    if (feedback) return;
    setFeedback(value);
    try {
      await fetch(`/api/clients/${clientId}/context-memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: value }),
      });
    } catch {
      // feedback é best-effort — não interrompe o fluxo
    }
  }

  function handleAction(action: BriefAction) {
    switch (action.actionType) {
      case 'OPEN_CHAT':
        askNexoAboutClient();
        break;
      case 'DRAFT_REMINDER':
        openDraftReminder();
        break;
      case 'OPEN_SCHEDULE':
        setCurrentView('reminders');
        break;
      case 'LIST_PENDENCIES':
        setShowPending(true);
        break;
    }
  }

  const pendingCount = (data?.facts.pendingRemindersCount ?? 0) + (data?.facts.pendingSchedulesCount ?? 0);
  const stale = Boolean(data?.stale || data?.facts.hasNewDataSinceSummary);

  const factsItems = useMemo(() => {
    if (!data) return [];
    const f = data.facts;
    const items: Array<{ label: string; value: string }> = [
      { label: t.summary.facts.stage, value: f.stageLabel },
      { label: t.summary.facts.owner, value: f.ownerName ?? t.summary.facts.none },
      { label: t.summary.facts.lastInteraction, value: f.lastInteractionAt ? formatDateTimePtBr(f.lastInteractionAt) : t.summary.facts.none },
      { label: t.summary.facts.nextAppointment, value: f.nextAppointmentAt ? formatDateTimePtBr(f.nextAppointmentAt) : t.summary.facts.none },
      { label: t.summary.facts.pending, value: String(pendingCount) },
    ];
    return items;
  }, [data, t, pendingCount]);

  return (
    <div className="space-y-3">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <NexoAvatar state="idle" theme="transparente" size={28} decorative className="flex-shrink-0 rounded-lg" />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{t.summary.title}</h3>
            <p className="truncate text-[10px] text-muted-foreground">{t.summary.description}</p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {data?.brief && (
            <Button
              variant="ghost" size="sm" className="h-7 px-2 text-xs"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              aria-label={expanded ? t.summary.collapse : t.summary.expand}
            >
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
          )}
          <Button
            variant="outline" size="sm" className="h-7 gap-1.5 px-3 text-xs"
            onClick={() => loadBrief(Boolean(data))}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : data?.brief ? <RefreshCw className="h-3 w-3" aria-hidden /> : null}
            {loading ? t.summary.update : data?.brief ? t.summary.update : t.summary.generate}
          </Button>
        </div>
      </div>

      {/* Fatos do CRM — sempre visíveis, sem depender de IA */}
      {data && (
        <Card>
          <CardContent className="p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t.summary.facts.title}
            </p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs sm:grid-cols-3">
              {factsItems.map((item) => (
                <div key={item.label} className="min-w-0">
                  <dt className="truncate text-[10px] text-muted-foreground">{item.label}</dt>
                  <dd className="truncate font-medium" title={item.value}>{item.value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}

      {/* Aviso de dados novos (chip discreto, não bloqueia) */}
      {stale && !loading && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs">
          <Clock className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium">{t.summary.stale}</p>
            <p className="text-[10px] text-muted-foreground">{t.summary.refreshHint}</p>
          </div>
        </div>
      )}

      {/* aria-live: anúncio de carregamento para leitores de tela */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {loading ? t.summary.loading : error ? error : ''}
      </p>

      {error && (
        <Card className="border-destructive/30">
          <CardContent className="flex items-start gap-2 p-3">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-destructive" aria-hidden />
            <p className="text-xs text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {loading && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <NexoAvatar state="thinking" theme="transparente" size={24} decorative className="flex-shrink-0" />
              <p className="text-xs text-muted-foreground">{t.summary.loading}</p>
            </div>
            <div className="mt-4 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-4 w-full max-w-[85%] animate-pulse rounded bg-muted" style={{ maxWidth: `${95 - i * 15}%` }} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Brief estruturado */}
      {data && !loading && expanded && data.brief && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="text-sm">
              <NexoMarkdown text={data.brief.summary} />
            </div>

            {data.brief.risks.length > 0 && (
              <section aria-label={t.summary.brief.risks}>
                <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden />
                  {t.summary.brief.risks}
                </h4>
                <ul className="space-y-1.5">
                  {data.brief.risks.map((r, i) => (
                    <li key={i} className="rounded-md bg-muted/50 p-2 text-xs">
                      <span className="font-medium">{r.label}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">{r.evidence}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {(showPending || data.brief.pendingItems.length > 0) && (
              <section aria-label={t.summary.brief.pendencies}>
                <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
                  <ListChecks className="h-3.5 w-3.5" aria-hidden />
                  {t.summary.brief.pendencies}
                </h4>
                <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                  {data.brief.pendingItems.map((p, i) => (
                    <li key={i}>{p.label}</li>
                  ))}
                </ul>
              </section>
            )}

            {data.brief.suggestedQuestions.length > 0 && (
              <section aria-label={t.summary.brief.questions}>
                <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
                  <MessageCircleQuestion className="h-3.5 w-3.5" aria-hidden />
                  {t.summary.brief.questions}
                </h4>
                <ul className="space-y-1 text-xs">
                  {data.brief.suggestedQuestions.map((q, i) => (
                    <li key={i} className="rounded-md border px-2 py-1.5">{q}</li>
                  ))}
                </ul>
              </section>
            )}

            {/* Ações sugeridas — máx 3, rascunhos com confirmação */}
            {data.brief.suggestedActions.length > 0 && (
              <section aria-label={t.summary.actions.title}>
                <h4 className="mb-1.5 text-xs font-semibold">{t.summary.actions.title}</h4>
                <div className="flex flex-wrap gap-1.5">
                  {data.brief.suggestedActions.map((a, i) => (
                    <Button
                      key={i}
                      variant={i === 0 ? 'default' : 'outline'}
                      size="sm"
                      className="h-8 min-h-[32px] gap-1.5 px-2.5 text-xs"
                      onClick={() => handleAction(a)}
                      title={a.rationale}
                    >
                      {a.actionType === 'OPEN_CHAT' && <NexoAvatar state="idle" theme="transparente" size={14} decorative className="rounded-full" />}
                      {a.actionType === 'DRAFT_REMINDER' && <PencilLine className="h-3.5 w-3.5" aria-hidden />}
                      {a.actionType === 'OPEN_SCHEDULE' && <CalendarClock className="h-3.5 w-3.5" aria-hidden />}
                      {a.actionType === 'LIST_PENDENCIES' && <ListChecks className="h-3.5 w-3.5" aria-hidden />}
                      {a.label}
                    </Button>
                  ))}
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">{t.summary.actions.confirmHint}</p>
              </section>
            )}

            {/* Limitações declaradas */}
            {data.brief.limitations.length > 0 && (
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                <span className="font-medium">{t.summary.brief.limitations}: </span>
                {data.brief.limitations.join(' ')}
              </p>
            )}

            <Separator className="my-1" />

            {/* Rodapé: atualização, copy, feedback */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] text-muted-foreground">
                {data.generatedAt
                  ? formatMessage(t.summary.updatedAgo, { when: formatRelative(data.generatedAt, t) })
                  : t.summary.note}
              </p>
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="sm" className="h-8 min-h-[32px] gap-1 px-2 text-[11px]" onClick={handleCopy} aria-label={copied ? t.summary.copied : t.summary.copy}>
                  {copied ? <Check className="h-3.5 w-3.5 text-success" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                  {copied ? t.summary.copied : t.summary.copy}
                </Button>
              </div>
            </div>

            {/* Feedback "Foi útil?" */}
            <div className="flex flex-wrap items-center gap-1.5">
              {!feedback ? (
                <>
                  <span className="text-[10px] text-muted-foreground">{t.summary.feedback.title}</span>
                  <Button variant="ghost" size="sm" className="h-7 min-h-[28px] gap-1 px-2 text-[11px]" onClick={() => sendFeedback('useful')} aria-label={t.summary.feedback.yes}>
                    <ThumbsUp className="h-3 w-3" aria-hidden /> {t.summary.feedback.yes}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 min-h-[28px] gap-1 px-2 text-[11px]" onClick={() => sendFeedback('not_useful')} aria-label={t.summary.feedback.no}>
                    <ThumbsDown className="h-3 w-3" aria-hidden /> {t.summary.feedback.no}
                  </Button>
                </>
              ) : (
                <p className="text-[10px] text-muted-foreground" role="status">{t.summary.feedback.thanks}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sem dados suficientes — estado honesto */}
      {data && !loading && !data.brief && data.insufficientData && !error && (
        <Card className="border-dashed">
          <CardContent className="p-4 text-center">
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
              <NexoAvatar state="idle" theme="claro" size={30} decorative className="rounded-lg" />
            </div>
            <p className="mx-auto max-w-xs text-xs text-muted-foreground">{t.summary.insufficient}</p>
          </CardContent>
        </Card>
      )}

      {/* Estado inicial */}
      {!data && !loading && !error && (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
              <NexoAvatar state="idle" theme="claro" size={36} decorative className="rounded-lg" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">{t.summary.title}</p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">{t.summary.empty}</p>
            <Button variant="outline" size="sm" className={cn('mt-3 h-8 gap-1.5 px-3 text-xs')} onClick={() => loadBrief(false)}>
              {t.summary.generate}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Dialog — rascunho de lembrete (edição + confirmação explícita) */}
      <Dialog open={draftOpen} onOpenChange={setDraftOpen}>
        <DialogContent className="sm:max-w-md" role="dialog" aria-label={t.summary.draft.title}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <NexoAvatar state="idle" theme="transparente" size={20} decorative className="rounded-md" />
              {t.summary.draft.title}
            </DialogTitle>
            <DialogDescription className="text-xs">{t.summary.draft.hint}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="draft-title" className="text-xs">{t.summary.draft.titleField}</Label>
              <Input id="draft-title" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="draft-desc" className="text-xs">{t.summary.draft.description}</Label>
              <Textarea id="draft-desc" value={draftDesc} onChange={(e) => setDraftDesc(e.target.value)} rows={3} className="text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="draft-date" className="text-xs">{t.summary.draft.date}</Label>
                <Input id="draft-date" type="date" value={draftDate} onChange={(e) => setDraftDate(e.target.value)} className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="draft-time" className="text-xs">{t.summary.draft.time}</Label>
                <Input id="draft-time" type="time" value={draftTime} onChange={(e) => setDraftTime(e.target.value)} className="h-9 text-sm" />
              </div>
            </div>
            {draftFeedback && (
              <p className={cn('text-xs', draftFeedback.ok ? 'text-success' : 'text-destructive')} role="status">
                {draftFeedback.msg}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" className="h-9 min-h-[36px] text-xs" onClick={() => setDraftOpen(false)}>
              {t.summary.draft.cancel}
            </Button>
            <Button
              size="sm"
              className="h-9 min-h-[36px] text-xs"
              onClick={saveDraftReminder}
              disabled={draftSaving || !draftTitle.trim() || !draftDate}
            >
              {draftSaving && <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />}
              {t.summary.draft.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
