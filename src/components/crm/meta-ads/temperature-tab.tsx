'use client';

/**
 * ============================================================
 * ABA TEMPERATURA — Anúncios Meta > Temperatura (somente ADMIN)
 * ============================================================
 * Configuração POR FORMULÁRIO da temperatura do lead:
 *   - o admin atribui um valor INTEIRO a cada resposta de cada
 *     pergunta observada no formulário (perguntas dissertativas
 *     podem receber nota fixa por resposta recebida);
 *   - define os limiares MORNO/QUENTE daquele formulário;
 *   - ao chegar um lead, o sistema soma as notas e classifica
 *     frio/morno/quente pelo limiar do formulário de origem.
 * Perguntas/respostas são aprendidas dos leads reais recebidos
 * (Client.metaFormData) — respostas novas aparecem com o selo
 * "nova" para o admin pontuar.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Thermometer,
  Flame,
  CloudSun,
  Snowflake,
  RefreshCw,
  Save,
  Trash2,
  FileText,
  HelpCircle,
  Loader2,
  Plus,
  History,
  Download,
  FileX2,
} from 'lucide-react';

// ─────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────

type Temperature = 'QUENTE' | 'MORNO' | 'FRIO';
export type { Temperature };

interface FormListItem {
  formId: string;
  formName: string | null;
  leadCount: number;
  lastSeenAt: string | null;
  scoring: { enabled: boolean; warmMin: number; hotMin: number; updatedAt: string } | null;
  temperatureCounts: Record<string, number>;
}

interface ObservedAnswer { text: string; count: number }
interface ObservedQuestion { key: string; count: number; answers: ObservedAnswer[]; othersCount: number }

interface DetailResponse {
  form: { formId: string; formName: string | null; leadCount: number; lastSeenAt: string | null };
  scoring: {
    enabled: boolean;
    warmMin: number;
    hotMin: number;
    reclassifiedAt: string | null;
    updatedAt: string;
    questions: Array<{ key: string; label?: string; questionScore?: number; answers: Array<{ text: string; score: number }> }>;
  } | null;
  observed: { questions: ObservedQuestion[] };
  temperatureCounts: Record<string, number>;
  scoreStats: { min: number; max: number; avg: number | null } | null;
}

interface EditAnswer {
  text: string;
  count: number;
  score: string;   // '' = sem nota configurada (pontua 0)
  isNew: boolean;  // observada nos leads mas ainda sem nota salva
}

interface EditQuestion {
  key: string;
  count: number;
  questionScore: string; // '' = sem nota fixa
  answers: EditAnswer[];
}

// ── Backfill de formulários antigos (notes) ──
interface LegacyFormInfo {
  formId: string;
  formName: string | null;
  leadCount: number;
  withAnswers: number;
}
interface DiscoveryResult {
  forms: LegacyFormInfo[];
  scanned: number;
  truncated: boolean;
}
interface BackfillResult {
  total: number;
  linked: number;
  withAnswers: number;
  alreadyLinked: number;
}

// ── Importar formulários das contas de anúncios (por conta) ──
interface ImportAccount {
  id: string;
  name: string;
  adAccountId: string;
  enabled: boolean;
}
interface AvailableForm {
  id: string;
  name: string | null;
  status: string | null;
  createdTime: string | null;
  inTemperature: boolean;
  hidden: boolean;
  configured: boolean;
  scoringActive: boolean;
  leadCount: number;
  importedToThisAccount: boolean;
}
interface AvailableFormsResponse {
  account: { id: string; name: string; adAccountId: string };
  via: string | null;
  forms: AvailableForm[];
  message?: string;
  error?: string;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Mesma normalização do motor (meta-lead-utils / lead-temperature). */
function normalizeKey(key: string): string {
  return String(key).toLowerCase().replace(/[_\s-]/g, '');
}

export const TEMPERATURE_BADGE: Record<Temperature, { label: string; icon: typeof Flame; badgeClass: string }> = {
  QUENTE: {
    label: 'Quente',
    icon: Flame,
    badgeClass: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  },
  MORNO: {
    label: 'Morno',
    icon: CloudSun,
    badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  },
  FRIO: {
    label: 'Frio',
    icon: Snowflake,
    badgeClass: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  },
};

/** Badge de temperatura reutilizável (Leads, notificações etc.). */
export function TemperatureBadge({ temperature, score }: { temperature: string | null; score?: number | null }) {
  if (!temperature || !(temperature in TEMPERATURE_BADGE)) return null;
  const cfg = TEMPERATURE_BADGE[temperature as Temperature];
  const Icon = cfg.icon;
  return (
    <Badge className={`text-[10px] h-5 px-1.5 ${cfg.badgeClass}`}>
      <Icon className="h-2.5 w-2.5" />
      <span className="ml-0.5">{cfg.label}{typeof score === 'number' ? ` · ${score}` : ''}</span>
    </Badge>
  );
}

/** Mescla a config salva com as perguntas/respostas observadas nos leads. */
function mergeQuestions(
  saved: DetailResponse['scoring'],
  observed: ObservedQuestion[],
): EditQuestion[] {
  const savedByNorm = new Map<string, NonNullable<DetailResponse['scoring']>['questions'][number]>();
  for (const q of saved?.questions || []) {
    savedByNorm.set(normalizeKey(q.key), q);
  }

  const editQuestions: EditQuestion[] = [];

  for (const obs of observed) {
    const savedQ = savedByNorm.get(normalizeKey(obs.key));
    const savedAnswers = new Map<string, number>();
    for (const a of savedQ?.answers || []) savedAnswers.set(a.text.trim().toLowerCase(), a.score);

    editQuestions.push({
      key: savedQ?.key || obs.key,
      count: obs.count,
      questionScore: savedQ?.questionScore !== undefined ? String(savedQ.questionScore) : '',
      answers: obs.answers.map((a) => ({
        text: a.text,
        count: a.count,
        score: savedAnswers.has(a.text.trim().toLowerCase()) ? String(savedAnswers.get(a.text.trim().toLowerCase())) : '',
        isNew: !savedAnswers.has(a.text.trim().toLowerCase()),
      })),
    });
    savedByNorm.delete(normalizeKey(obs.key));
  }

  // Perguntas configuradas mas ainda não observadas em leads (raro — form novo)
  for (const q of savedByNorm.values()) {
    editQuestions.push({
      key: q.key,
      count: 0,
      questionScore: q.questionScore !== undefined ? String(q.questionScore) : '',
      answers: q.answers.map((a) => ({ text: a.text, count: 0, score: String(a.score), isNew: false })),
    });
  }

  return editQuestions;
}

function parseThreshold(value: string, fallback: number): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

// ─────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────

export function TemperatureTab() {
  const [forms, setForms] = useState<FormListItem[]>([]);
  const [summary, setSummary] = useState<{ formsTotal: number; configured: number; active: number } | null>(null);
  const [loadingForms, setLoadingForms] = useState(true);
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);

  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Estado editável da config
  const [enabled, setEnabled] = useState(false);
  const [warmMin, setWarmMin] = useState('5');
  const [hotMin, setHotMin] = useState('10');
  const [questions, setQuestions] = useState<EditQuestion[]>([]);
  const [reclassifyOnSave, setReclassifyOnSave] = useState(true);

  const [saving, setSaving] = useState(false);
  const [reclassifying, setReclassifying] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Formulários antigos (leads recebidos antes do recurso de temperatura)
  const [legacy, setLegacy] = useState<DiscoveryResult | null>(null);
  const [loadingLegacy, setLoadingLegacy] = useState(false);
  const [linkingFormId, setLinkingFormId] = useState<string | null>(null);

  // Importar formulários das contas de anúncios Meta (por conta)
  const [importOpen, setImportOpen] = useState(false);
  const [accounts, setAccounts] = useState<ImportAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [importAccountId, setImportAccountId] = useState('');
  const [availableForms, setAvailableForms] = useState<AvailableForm[]>([]);
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const [availableMessage, setAvailableMessage] = useState<string | null>(null);
  const [selectedImportIds, setSelectedImportIds] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  // Remover o FORMULÁRIO da seção (não só a config)
  const [removeFormOpen, setRemoveFormOpen] = useState(false);
  const [removingForm, setRemovingForm] = useState(false);

  // ── Lista de formulários ──
  const loadForms = useCallback(async (keepSelection = true) => {
    setLoadingForms(true);
    try {
      const res = await fetch('/api/meta-ads/temperature');
      if (!res.ok) throw new Error();
      const data = await res.json();
      setForms(data.forms || []);
      setSummary(data.summary || null);
      setSelectedFormId((current) => {
        if (keepSelection && current && data.forms?.some((f: FormListItem) => f.formId === current)) return current;
        return data.forms?.[0]?.formId || null;
      });
    } catch {
      toast.error('Erro ao carregar formulários');
    } finally {
      setLoadingForms(false);
    }
  }, []);

  // ── Detalhe do formulário selecionado ──
  const loadDetail = useCallback(async (formId: string) => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/meta-ads/temperature?formId=${encodeURIComponent(formId)}`);
      if (!res.ok) throw new Error();
      const data: DetailResponse = await res.json();
      setDetail(data);
      setEnabled(data.scoring?.enabled || false);
      setWarmMin(String(data.scoring?.warmMin ?? 5));
      setHotMin(String(data.scoring?.hotMin ?? 10));
      setQuestions(mergeQuestions(data.scoring, data.observed.questions));
    } catch {
      toast.error('Erro ao carregar configuração do formulário');
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    loadForms(false);
  }, [loadForms]);

  useEffect(() => {
    if (selectedFormId) loadDetail(selectedFormId);
    else setDetail(null);
  }, [selectedFormId, loadDetail]);

  // ── Ações ──
  async function handleSave() {
    if (!selectedFormId) return;
    if (parseThreshold(hotMin, 10) < parseThreshold(warmMin, 5)) {
      toast.error('O limiar QUENTE não pode ser menor que o limiar MORNO');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        formId: selectedFormId,
        formName: detail?.form.formName || undefined,
        enabled,
        warmMin: parseThreshold(warmMin, 5),
        hotMin: parseThreshold(hotMin, 10),
        reclassify: reclassifyOnSave && enabled,
        questions: questions.map((q) => ({
          key: q.key,
          ...(q.questionScore !== '' ? { questionScore: parseThreshold(q.questionScore, 0) } : {}),
          answers: q.answers
            .filter((a) => a.score !== '')
            .map((a) => ({ text: a.text, score: parseThreshold(a.score, 0) })),
        })),
      };
      const res = await fetch('/api/meta-ads/temperature', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Falha ao salvar');
      toast.success(
        enabled
          ? `Configuração salva — leads deste formulário serão classificados${data.reclassifyResult ? ` (${data.reclassifyResult.scored} reclassificados)` : ''}`
          : 'Configuração salva (pontuação desativada)',
      );
      await Promise.all([loadForms(), loadDetail(selectedFormId)]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar configuração');
    } finally {
      setSaving(false);
    }
  }

  async function handleReclassify() {
    if (!selectedFormId) return;
    setReclassifying(true);
    try {
      const res = await fetch('/api/meta-ads/temperature/reclassify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formId: selectedFormId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Falha ao reclassificar');
      const r = data.result;
      toast.success(`Reclassificação concluída — ${r.quente} quente(s), ${r.morno} morno(s), ${r.frio} frio(s) de ${r.total} lead(s)`);
      await Promise.all([loadForms(), loadDetail(selectedFormId)]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao reclassificar');
    } finally {
      setReclassifying(false);
    }
  }

  async function handleDelete() {
    if (!selectedFormId) return;
    try {
      const res = await fetch(`/api/meta-ads/temperature?formId=${encodeURIComponent(selectedFormId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error();
      toast.success('Configuração removida. As classificações existentes foram mantidas nos leads.');
      setDeleteOpen(false);
      await Promise.all([loadForms(), loadDetail(selectedFormId)]);
    } catch {
      toast.error('Erro ao remover configuração');
    }
  }

  // ── Formulários antigos: descobrir e vincular (backfill das notes) ──
  async function handleDiscoverLegacy() {
    setLoadingLegacy(true);
    try {
      const res = await fetch('/api/meta-ads/temperature/backfill');
      if (!res.ok) throw new Error();
      const data: DiscoveryResult = await res.json();
      setLegacy(data);
      if ((data.forms?.length || 0) === 0) {
        toast.info(`Nenhum formulário antigo encontrado (${data.scanned} lead(s) analisado(s))`);
      }
    } catch {
      toast.error('Erro ao buscar formulários em leads antigos');
    } finally {
      setLoadingLegacy(false);
    }
  }

  async function handleLinkLegacy(formId: string) {
    setLinkingFormId(formId);
    try {
      const res = await fetch('/api/meta-ads/temperature/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Falha ao vincular');
      const r: BackfillResult = data.result;
      toast.success(
        `Vinculação concluída — ${r.linked} lead(s) ligado(s) ao formulário` +
          (r.withAnswers > 0 ? `, ${r.withAnswers} com perguntas/respostas recuperadas` : ''),
      );
      setLegacy((prev) => (prev ? { ...prev, forms: prev.forms.filter((f) => f.formId !== formId) } : prev));
      await loadForms();
      setSelectedFormId(formId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao vincular leads antigos');
    } finally {
      setLinkingFormId(null);
    }
  }

  // ── Importar formulários das contas de anúncios Meta (por conta) ──
  const loadAvailableForms = useCallback(async (accountId: string) => {
    setLoadingAvailable(true);
    setAvailableMessage(null);
    setSelectedImportIds(new Set());
    try {
      const res = await fetch(`/api/meta-ads/temperature/forms?accountId=${encodeURIComponent(accountId)}`);
      const data: AvailableFormsResponse = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Erro ao buscar formulários da conta');
      setAvailableForms(data.forms || []);
      if ((data.forms?.length || 0) === 0) {
        setAvailableMessage(data.message || 'Nenhum formulário de lead encontrado nesta conta.');
      } else {
        // Pré-seleciona os formulários ATIVOS que ainda não estão na seção
        setSelectedImportIds(new Set(
          (data.forms || [])
            .filter((f) => (!f.status || f.status === 'ACTIVE') && !f.inTemperature)
            .map((f) => f.id),
        ));
      }
    } catch (err) {
      setAvailableForms([]);
      setAvailableMessage(err instanceof Error ? err.message : 'Erro ao buscar formulários da conta');
    } finally {
      setLoadingAvailable(false);
    }
  }, []);

  const openImportDialog = useCallback(async () => {
    setImportOpen(true);
    setLoadingAccounts(true);
    setAccounts([]);
    setAvailableForms([]);
    setAvailableMessage(null);
    setImportAccountId('');
    try {
      const res = await fetch('/api/meta-ad-accounts');
      if (!res.ok) throw new Error();
      const data = await res.json();
      const list: ImportAccount[] = Array.isArray(data) ? data : [];
      setAccounts(list);
      const firstEnabled = list.find((a) => a.enabled) || list[0];
      if (firstEnabled) {
        setImportAccountId(firstEnabled.id);
        void loadAvailableForms(firstEnabled.id);
      } else {
        setAvailableMessage('Nenhuma conta de anúncios conectada — cadastre uma na aba Anúncios.');
      }
    } catch {
      toast.error('Erro ao carregar contas de anúncios');
    } finally {
      setLoadingAccounts(false);
    }
  }, [loadAvailableForms]);

  function toggleImportForm(formId: string, checked: boolean) {
    setSelectedImportIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(formId);
      else next.delete(formId);
      return next;
    });
  }

  async function handleImportSelected() {
    if (!importAccountId || selectedImportIds.size === 0) return;
    setImporting(true);
    try {
      const forms = availableForms
        .filter((f) => selectedImportIds.has(f.id))
        .map((f) => ({ id: f.id, name: f.name || undefined }));
      const res = await fetch('/api/meta-ads/temperature/forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: importAccountId, forms }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Falha ao importar');
      toast.success(data?.message || 'Formulários importados');
      await loadForms();
      await loadAvailableForms(importAccountId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao importar formulários');
    } finally {
      setImporting(false);
    }
  }

  // ── Remover o FORMULÁRIO da seção Temperatura (scope=form) ──
  async function handleRemoveForm() {
    if (!selectedFormId) return;
    setRemovingForm(true);
    try {
      const res = await fetch(
        `/api/meta-ads/temperature?formId=${encodeURIComponent(selectedFormId)}&scope=form`,
        { method: 'DELETE' },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Falha ao remover');
      toast.success('Formulário removido da seção Temperatura — importe novamente para restaurar.');
      setRemoveFormOpen(false);
      await loadForms();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao remover formulário');
    } finally {
      setRemovingForm(false);
    }
  }

  // ── Edição local ──
  function updateAnswer(questionIdx: number, answerIdx: number, patch: Partial<EditAnswer>) {
    setQuestions((prev) =>
      prev.map((q, i) =>
        i === questionIdx
          ? { ...q, answers: q.answers.map((a, j) => (j === answerIdx ? { ...a, ...patch } : a)) }
          : q,
      ),
    );
  }

  function updateQuestion(questionIdx: number, patch: Partial<EditQuestion>) {
    setQuestions((prev) => prev.map((q, i) => (i === questionIdx ? { ...q, ...patch } : q)));
  }

  function addManualAnswer(questionIdx: number) {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== questionIdx) return q;
        const used = new Set(q.answers.map((a) => a.text.toLowerCase()));
        let n = 1;
        while (used.has(`outra resposta ${n}`)) n += 1;
        return { ...q, answers: [...q.answers, { text: `Outra resposta ${n}`, count: 0, score: '', isNew: true }] };
      }),
    );
  }

  function renameManualAnswer(questionIdx: number, answerIdx: number, text: string) {
    updateAnswer(questionIdx, answerIdx, { text });
  }

  const canReclassify = !!detail?.scoring?.enabled;
  const hasObservedQuestions = (detail?.observed.questions.length || 0) > 0;
  const tempCounts = detail?.temperatureCounts;

  const scaleSegments = useMemo(() => {
    const warm = parseThreshold(warmMin, 5);
    const hot = parseThreshold(hotMin, 10);
    return { warm, hot, invalid: hot < warm };
  }, [warmMin, hotMin]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Temperatura dos leads</h2>
          <p className="text-sm text-muted-foreground">
            Notas por resposta e limiares específicos de cada formulário — nada genérico.
          </p>
        </div>
        {summary && summary.formsTotal > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-[11px]">{summary.formsTotal} formulário(s)</Badge>
            <Badge variant="outline" className="text-[11px]">{summary.configured} configurado(s)</Badge>
            <Badge className="text-[11px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              {summary.active} ativo(s)
            </Badge>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 items-start">
        {/* ── Lista de formulários ── */}
        <Card className="lg:sticky lg:top-4">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              Formulários importados
            </CardTitle>
            <CardDescription className="text-xs">
              Importados das contas Meta ou aprendidos dos leads recebidos
            </CardDescription>
          </CardHeader>
          <CardContent className="p-2 pt-0">
            <Button
              variant="outline"
              size="sm"
              className="w-full h-7 text-[11px] mb-2"
              onClick={openImportDialog}
            >
              <Download className="h-3 w-3 mr-1" />
              Importar formulários
            </Button>
            {loadingForms ? (
              <div className="space-y-2 p-2">
                {[1, 2, 3].map((i) => <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />)}
              </div>
            ) : forms.length === 0 ? (
              <div className="p-4 text-center space-y-2">
                <Thermometer className="h-8 w-8 text-muted-foreground/40 mx-auto" />
                <p className="text-xs font-medium text-muted-foreground">Nenhum formulário ainda</p>
                <p className="text-[11px] text-muted-foreground">
                  Importe os formulários das suas contas de anúncio Meta com o botão acima para
                  configurar a temperatura antes do primeiro lead — ou aguarde: eles aparecem aqui
                  automaticamente quando o primeiro lead chega.
                </p>
              </div>
            ) : (
              <div className="max-h-[420px] overflow-y-auto space-y-1 p-1 therm-scroll">
                {forms.map((form) => {
                  const isActive = form.scoring?.enabled;
                  const isConfigured = !!form.scoring;
                  const selected = form.formId === selectedFormId;
                  return (
                    <button
                      key={form.formId}
                      onClick={() => setSelectedFormId(form.formId)}
                      className={`w-full text-left rounded-lg p-2.5 transition-colors border ${
                        selected
                          ? 'bg-muted border-border'
                          : 'border-transparent hover:bg-muted/60'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full flex-shrink-0 ${
                            isActive ? 'bg-emerald-500' : isConfigured ? 'bg-amber-500' : 'bg-muted-foreground/30'
                          }`}
                          title={isActive ? 'Pontuação ativa' : isConfigured ? 'Configurado (inativo)' : 'Não configurado'}
                        />
                        <span className="text-xs font-medium truncate flex-1">
                          {form.formName || 'Formulário sem nome'}
                        </span>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">
                          {form.leadCount} lead{form.leadCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                        {(['QUENTE', 'MORNO', 'FRIO'] as Temperature[]).map((temp) => {
                          const count = form.temperatureCounts?.[temp] || 0;
                          if (count === 0) return null;
                          const cfg = TEMPERATURE_BADGE[temp];
                          const Icon = cfg.icon;
                          return (
                            <span
                              key={temp}
                              className={`inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-medium ${cfg.badgeClass}`}
                            >
                              <Icon className="h-2 w-2" /> {count}
                            </span>
                          );
                        })}
                        {isConfigured && !isActive && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">inativo</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Formulários antigos — backfill das notes (leads anteriores ao recurso) */}
            <Separator className="my-2" />
            <div className="p-2 pt-0">
              {!legacy ? (
                <button
                  onClick={handleDiscoverLegacy}
                  disabled={loadingLegacy}
                  className="w-full flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground border rounded-md py-1.5 transition-colors disabled:opacity-60"
                >
                  {loadingLegacy ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <History className="h-3 w-3" />
                  )}
                  Buscar formulários em leads antigos
                </button>
              ) : legacy.forms.length === 0 ? (
                <p className="text-[10px] text-muted-foreground text-center py-1">
                  Nenhum formulário antigo encontrado em {legacy.scanned} lead(s) analisado(s).
                </p>
              ) : (
                <div className="space-y-1.5 mt-1">
                  <p className="text-[10px] text-muted-foreground px-1">
                    Encontrados em leads recebidos antes da temperatura:
                  </p>
                  {legacy.forms.map((f) => (
                    <div key={f.formId} className="rounded-md border p-2 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium truncate">
                          {f.formName || `Formulário ${f.formId.slice(-6)}`}
                        </span>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">
                          {f.leadCount} lead{f.leadCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <p className="text-[9px] text-muted-foreground font-mono truncate">{f.formId}</p>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px] text-muted-foreground">
                          {f.withAnswers > 0
                            ? `${f.withAnswers} com respostas recuperáveis`
                            : 'sem respostas nas notas'}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-2"
                          onClick={() => handleLinkLegacy(f.formId)}
                          disabled={linkingFormId === f.formId}
                        >
                          {linkingFormId === f.formId ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <History className="h-3 w-3 mr-1" />
                          )}
                          Vincular
                        </Button>
                      </div>
                    </div>
                  ))}
                  {legacy.truncated && (
                    <p className="text-[9px] text-amber-600 dark:text-amber-400 px-1">
                      Varredura limitada aos primeiros {legacy.scanned} leads — vincule os formulários
                      acima e busque novamente.
                    </p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Configuração do formulário selecionado ── */}
        {loadingDetail || !detail ? (
          <Card>
            <CardContent className="p-6">
              {loadingDetail ? (
                <div className="space-y-3">
                  <div className="h-6 w-56 rounded bg-muted animate-pulse" />
                  <div className="h-20 rounded bg-muted animate-pulse" />
                  <div className="h-32 rounded bg-muted animate-pulse" />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Thermometer className="h-10 w-10 text-muted-foreground/40 mb-3" />
                  <p className="text-sm font-medium text-muted-foreground">
                    Selecione um formulário para configurar
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                    Cada formulário tem notas e limiares próprios. Leads recebidos sem configuração
                    ficam sem classificação de temperatura.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {/* Cabeçalho do formulário */}
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold truncate">
                      {detail.form.formName || 'Formulário sem nome'}
                    </h3>
                    <p className="text-[11px] text-muted-foreground font-mono truncate">Form ID: {detail.form.formId}</p>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                    <span>{detail.form.leadCount} lead(s)</span>
                    {tempCounts && (
                      <span className="flex items-center gap-1">
                        <Flame className="h-3 w-3 text-red-500" /> {tempCounts.QUENTE || 0}
                        <CloudSun className="h-3 w-3 text-amber-500 ml-1.5" /> {tempCounts.MORNO || 0}
                        <Snowflake className="h-3 w-3 text-sky-500 ml-1.5" /> {tempCounts.FRIO || 0}
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Config da pontuação */}
            <Card>
              <CardHeader className="p-4 pb-3">
                <CardTitle className="text-sm flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <Thermometer className="h-4 w-4" /> Pontuação e limiares
                  </span>
                  <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                    {enabled ? 'Ativa' : 'Inativa'}
                    <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Ativar pontuação" />
                  </span>
                </CardTitle>
                <CardDescription className="text-xs">
                  Soma das notas das respostas: <strong>≥ hotMin → Quente</strong>, <strong>≥ warmMin → Morno</strong>,
                  {' '}abaixo → Frio.
                  {detail.scoreStats && ` Leads atuais: nota ${detail.scoreStats.min} a ${detail.scoreStats.max} (média ${detail.scoreStats.avg ?? '—'}).`}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-4">
                {/* Escala visual */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 grid grid-cols-3 gap-1 text-center">
                    <div className="rounded-md bg-sky-100 dark:bg-sky-900/30 py-1.5">
                      <Snowflake className="h-3 w-3 inline text-sky-600 dark:text-sky-400 mr-1" />
                      <span className="text-[10px] font-medium text-sky-700 dark:text-sky-400">Frio</span>
                      <div className="text-[9px] text-sky-600/70 dark:text-sky-400/70">abaixo de {scaleSegments.warm}</div>
                    </div>
                    <div className="rounded-md bg-amber-100 dark:bg-amber-900/30 py-1.5">
                      <CloudSun className="h-3 w-3 inline text-amber-600 dark:text-amber-400 mr-1" />
                      <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400">Morno</span>
                      <div className="text-[9px] text-amber-600/70 dark:text-amber-400/70">≥ {scaleSegments.warm}</div>
                    </div>
                    <div className="rounded-md bg-red-100 dark:bg-red-900/30 py-1.5">
                      <Flame className="h-3 w-3 inline text-red-600 dark:text-red-400 mr-1" />
                      <span className="text-[10px] font-medium text-red-700 dark:text-red-400">Quente</span>
                      <div className="text-[9px] text-red-600/70 dark:text-red-400/70">≥ {scaleSegments.hot}</div>
                    </div>
                  </div>
                </div>

                {scaleSegments.invalid && (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    O limiar Quente não pode ser menor que o limiar Morno.
                  </p>
                )}

                {/* Limiares */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="warmMin" className="text-xs flex items-center gap-1.5">
                      <CloudSun className="h-3.5 w-3.5 text-amber-500" /> Morno a partir de (≥)
                    </Label>
                    <Input
                      id="warmMin"
                      type="number"
                      step={1}
                      value={warmMin}
                      onChange={(e) => setWarmMin(e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="hotMin" className="text-xs flex items-center gap-1.5">
                      <Flame className="h-3.5 w-3.5 text-red-500" /> Quente a partir de (≥)
                    </Label>
                    <Input
                      id="hotMin"
                      type="number"
                      step={1}
                      value={hotMin}
                      onChange={(e) => setHotMin(e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                </div>

                <Separator />

                {/* Ações */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="reclassifyOnSave"
                      checked={reclassifyOnSave}
                      onCheckedChange={(v) => setReclassifyOnSave(v === true)}
                    />
                    <Label htmlFor="reclassifyOnSave" className="text-xs text-muted-foreground cursor-pointer">
                      Reclassificar leads já recebidos ao salvar
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    {detail.scoring && (
                      <Button variant="ghost" size="sm" className="h-8 text-xs text-red-600 hover:text-red-700 dark:text-red-400" onClick={() => setDeleteOpen(true)}>
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Remover
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-red-600 hover:text-red-700 dark:text-red-400"
                      onClick={() => setRemoveFormOpen(true)}
                      title="Remove o formulário da seção Temperatura (importar novamente restaura)"
                    >
                      <FileX2 className="h-3.5 w-3.5 mr-1" /> Remover formulário
                    </Button>
                    <Button size="sm" className="h-8 text-xs" onClick={handleSave} disabled={saving}>
                      {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                      Salvar configuração
                    </Button>
                  </div>
                </div>

                {canReclassify && (
                  <Button variant="outline" size="sm" className="h-8 text-xs w-full sm:w-auto" onClick={handleReclassify} disabled={reclassifying}>
                    {reclassifying ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                    Reclassificar agora os {detail.form.leadCount} lead(s) deste formulário
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Perguntas e respostas */}
            <Card>
              <CardHeader className="p-4 pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <HelpCircle className="h-4 w-4" /> Notas por pergunta e resposta
                </CardTitle>
                <CardDescription className="text-xs">
                  Valor inteiro para cada resposta observada nos leads. Respostas sem nota pontuam 0.
                  Para perguntas abertas (texto livre), use a nota da pergunta — aplicada a qualquer resposta.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                {!hasObservedQuestions ? (
                  <div className="text-center py-8 space-y-2">
                    <FileText className="h-8 w-8 text-muted-foreground/40 mx-auto" />
                    <p className="text-xs font-medium text-muted-foreground">
                      Nenhuma pergunta observada ainda
                    </p>
                    <p className="text-[11px] text-muted-foreground max-w-md mx-auto">
                      As perguntas deste formulário aparecem aqui quando os primeiros leads com respostas
                      forem recebidos (webhook, importação por formulário ou por leadgen ID).
                    </p>
                    <button
                      onClick={() => selectedFormId && handleLinkLegacy(selectedFormId)}
                      disabled={linkingFormId === selectedFormId}
                      className="inline-flex items-center gap-1.5 text-[11px] text-primary hover:underline disabled:opacity-60 mt-1"
                    >
                      {linkingFormId === selectedFormId ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <History className="h-3 w-3" />
                      )}
                      Recuperar perguntas/respostas dos leads já recebidos deste formulário
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {questions.map((question, qIdx) => (
                      <div key={question.key} className="rounded-lg border p-3 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-medium break-words">{question.key}</p>
                            <p className="text-[10px] text-muted-foreground">
                              respondida em {question.count} lead(s)
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <Label className="text-[10px] text-muted-foreground whitespace-nowrap">
                              Nota fixa
                            </Label>
                            <Input
                              type="number"
                              step={1}
                              placeholder="—"
                              value={question.questionScore}
                              onChange={(e) => updateQuestion(qIdx, { questionScore: e.target.value })}
                              className="h-7 w-16 text-xs"
                              aria-label={`Nota fixa da pergunta ${question.key}`}
                            />
                          </div>
                        </div>

                        <div className="space-y-1.5 max-h-64 overflow-y-auto therm-scroll pr-1">
                          {question.answers.map((answer, aIdx) => (
                            <div
                              key={`${answer.text}-${aIdx}`}
                              className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5"
                            >
                              <div className="flex-1 min-w-0">
                                {answer.count === 0 && answer.isNew ? (
                                  <Input
                                    value={answer.text}
                                    onChange={(e) => renameManualAnswer(qIdx, aIdx, e.target.value)}
                                    className="h-6 text-xs bg-background"
                                    aria-label="Texto da resposta"
                                  />
                                ) : (
                                  <p className="text-xs truncate">{answer.text}</p>
                                )}
                              </div>
                              {answer.count > 0 && (
                                <span className="text-[10px] text-muted-foreground flex-shrink-0">
                                  {answer.count}×
                                </span>
                              )}
                              {answer.isNew && answer.count > 0 && (
                                <Badge variant="outline" className="text-[9px] h-4 px-1 flex-shrink-0">
                                  nova
                                </Badge>
                              )}
                              <Input
                                type="number"
                                step={1}
                                placeholder="0"
                                value={answer.score}
                                onChange={(e) => updateAnswer(qIdx, aIdx, { score: e.target.value })}
                                className="h-7 w-16 text-xs flex-shrink-0"
                                aria-label={`Nota da resposta ${answer.text}`}
                              />
                            </div>
                          ))}
                          {question.answers.length === 0 && (
                            <p className="text-[10px] text-muted-foreground px-1">
                              Pergunta sem respostas observadas — use a nota fixa acima.
                            </p>
                          )}
                          <button
                            onClick={() => addManualAnswer(qIdx)}
                            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground px-1 py-0.5 transition-colors"
                          >
                            <Plus className="h-3 w-3" /> Adicionar resposta manual
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Confirmação de remoção (somente a config de notas) */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover configuração de temperatura?</AlertDialogTitle>
            <AlertDialogDescription>
              As notas e limiares do formulário &quot;{detail?.form.formName || detail?.form.formId}&quot; serão apagados.
              Novos leads deste formulário deixarão de ser classificados. As temperaturas já atribuídas
              aos leads existentes são mantidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmação de remoção do FORMULÁRIO da seção */}
      <AlertDialog open={removeFormOpen} onOpenChange={setRemoveFormOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover formulário da seção?</AlertDialogTitle>
            <AlertDialogDescription>
              O formulário &quot;{detail?.form.formName || detail?.form.formId}&quot; sai da lista de Temperatura
              e as notas/limiares salvos são apagados. Ele deixa de ser consultado no polling da conta
              e não reaparece automaticamente quando novos leads chegarem. Os leads já recebidos mantêm
              as classificações atuais. Para trazer de volta, use &quot;Importar formulários&quot;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removingForm}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveForm}
              disabled={removingForm}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {removingForm && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Remover formulário
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Importar formulários das contas de anúncios Meta (por conta) */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Download className="h-4 w-4" /> Importar formulários da Meta
            </DialogTitle>
            <DialogDescription>
              Busca os formulários de lead de cada conta de anúncios conectada —
              configure a temperatura antes mesmo do primeiro lead.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label className="text-xs">Conta de anúncios</Label>
            <Select
              value={importAccountId || undefined}
              onValueChange={(value) => {
                setImportAccountId(value);
                void loadAvailableForms(value);
              }}
              disabled={loadingAccounts || accounts.length === 0}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder={loadingAccounts ? 'Carregando contas…' : 'Selecione a conta'} />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name} ({account.adAccountId}){account.enabled ? '' : ' — desativada'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto therm-scroll border rounded-md p-2 space-y-1">
            {loadingAvailable ? (
              <div className="space-y-2 p-1">
                {[1, 2, 3].map((i) => <div key={i} className="h-9 rounded-md bg-muted animate-pulse" />)}
              </div>
            ) : availableForms.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6 px-2">
                {availableMessage || 'Nenhum formulário disponível nesta conta.'}
              </p>
            ) : (
              availableForms.map((form) => {
                const isActive = !form.status || form.status === 'ACTIVE';
                const selectable = isActive && !form.inTemperature;
                return (
                  <label
                    key={form.id}
                    className={`flex items-start gap-2 rounded-md p-2 ${selectable ? 'hover:bg-muted/60 cursor-pointer' : 'opacity-60'}`}
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={selectedImportIds.has(form.id)}
                      onCheckedChange={(v) => toggleImportForm(form.id, v === true)}
                      disabled={!selectable || importing}
                      aria-label={`Importar ${form.name || form.id}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{form.name || 'Formulário sem nome'}</p>
                      <p className="text-[10px] text-muted-foreground font-mono truncate">{form.id}</p>
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        {isActive ? (
                          <Badge variant="outline" className="text-[9px] h-4 px-1 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                            ativa
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[9px] h-4 px-1">
                            {form.status === 'ARCHIVED' ? 'arquivado' : form.status?.toLowerCase() || 'inativo'}
                          </Badge>
                        )}
                        {form.inTemperature && !form.hidden && (
                          <Badge variant="outline" className="text-[9px] h-4 px-1">na seção</Badge>
                        )}
                        {form.hidden && (
                          <Badge variant="outline" className="text-[9px] h-4 px-1 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                            removido — importe para restaurar
                          </Badge>
                        )}
                        {form.configured && (
                          <Badge variant="outline" className="text-[9px] h-4 px-1">
                            {form.scoringActive ? 'pontuação ativa' : 'configurado (inativo)'}
                          </Badge>
                        )}
                        {form.leadCount > 0 && (
                          <span className="text-[9px] text-muted-foreground">{form.leadCount} lead(s)</span>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              {selectedImportIds.size} selecionado(s)
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setImportOpen(false)}>
                Fechar
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs"
                onClick={handleImportSelected}
                disabled={importing || selectedImportIds.size === 0}
              >
                {importing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                Importar selecionados
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
