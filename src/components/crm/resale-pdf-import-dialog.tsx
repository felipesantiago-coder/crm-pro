'use client';

/**
 * Importador de PDF de revenda — v2 (prompt v1.0 §13, Fase 6).
 *
 * Fluxo (§13.1): enviar → analisar (SIMULAÇÃO sem gravar) → revisar
 * (status por registro + diff campo a campo + filtros + seleção) →
 * confirmar → resultado com relatório para download.
 *
 * Regras implementadas: status novo/alterado/inalterado/duplicado/erro
 * (§13.2); resumo do impacto antes de gravar; seleção/descarte por registro;
 * preservação de dados existentes em falha de linha (servidor); parser
 * permanece determinístico — nada aqui é IA generativa (§13); mensagem
 * específica para PDF digitalizado sem texto.
 */
import { useMemo, useState, useRef } from 'react';
import {
  Upload, FileText, X, Loader2, CheckCircle2, AlertCircle, Download,
  Plus, Pencil, MinusCircle, CopySlash, CircleSlash,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete: () => void;
}

interface AnalyzeRecord {
  code: string;
  name: string | null;
  region: string | null;
  price: number | string | null;
  status: 'novo' | 'alterado' | 'inalterado' | 'duplicado' | 'erro';
  diff: Array<{ field: string; from: string; to: string }>;
  reason: string | null;
}

interface AnalyzeResponse {
  mode: 'analyze';
  enterpriseId: string | null;
  enterpriseName: string;
  enterpriseExists: boolean;
  pageCount: number;
  summary: { novo: number; alterado: number; inalterado: number; duplicado: number; erro: number; total: number };
  records: AnalyzeRecord[];
  textPreview: string;
}

interface CommitResponse {
  mode: 'commit';
  extracted: number;
  created: number;
  updated: number;
  ignored: number;
  errors: string[];
  pageCount: number;
  totalProperties: number;
  enterpriseId: string;
  enterpriseName: string;
  isNew: boolean;
}

type Step = 'upload' | 'review' | 'result';

const STATUS_META: Record<AnalyzeRecord['status'], { label: string; icon: React.ElementType; cls: string }> = {
  novo: { label: 'Novo', icon: Plus, cls: 'text-emerald-700 dark:text-emerald-400' },
  alterado: { label: 'Alterado', icon: Pencil, cls: 'text-blue-700 dark:text-blue-400' },
  inalterado: { label: 'Inalterado', icon: MinusCircle, cls: 'text-muted-foreground' },
  duplicado: { label: 'Duplicado no arquivo', icon: CopySlash, cls: 'text-amber-700 dark:text-amber-400' },
  erro: { label: 'Erro', icon: AlertCircle, cls: 'text-destructive' },
};

const FIELD_LABELS: Record<string, string> = {
  name: 'nome', region: 'região', category: 'categoria', typology: 'tipologia',
  bedrooms: 'quartos', area: 'área', address: 'endereço', captor: 'captador',
  appointment: 'agendamento', phone: 'telefone', price: 'preço', condo: 'condomínio',
  iptu: 'IPTU', notes: 'observações', url: 'URL', acceptsFinancing: 'aceita financiamento',
  acceptsFgts: 'aceita FGTS',
};

export function ResalePdfImportDialog({ open, onOpenChange, onImportComplete }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<'all' | AnalyzeRecord['status']>('all');
  const [result, setResult] = useState<CommitResponse | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  function resetAndClose() {
    setStep('upload');
    setFile(null);
    setBusy(false);
    setAnalysis(null);
    setSelected(new Set());
    setResult(null);
    setError(null);
    onOpenChange(false);
  }

  function handlePdfSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setError(null);
    if (f) {
      if (!f.name.toLowerCase().endsWith('.pdf') && f.type !== 'application/pdf') {
        toast.error('Apenas arquivos PDF sao aceitos');
        return;
      }
      if (f.size > 20 * 1024 * 1024) {
        toast.error('Arquivo muito grande. Maximo 20MB.');
        return;
      }
      setFile(f);
    }
    e.target.value = '';
  }

  async function analyze() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/enterprises/resale-import?mode=analyze', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        const errMsg = data.error || 'Erro ao processar o PDF';
        setError(errMsg);
        toast.error(errMsg.length > 120 ? errMsg.slice(0, 120) + '...' : errMsg);
        return;
      }
      const a = data as AnalyzeResponse;
      setAnalysis(a);
      setSelected(new Set(a.records.filter((r) => r.status === 'novo' || r.status === 'alterado').map((r) => r.code)));
      setStep('review');
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : 'Erro ao processar o PDF';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!file || !analysis || selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('codes', JSON.stringify([...selected]));
      const res = await fetch('/api/enterprises/resale-import?mode=commit', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        const errMsg = data.error || 'Erro ao confirmar a importação';
        setError(errMsg);
        toast.error(errMsg);
        return;
      }
      setResult(data);
      setStep('result');
      const c = data as CommitResponse;
      if (c.errors.length > 0) {
        toast.warning(`${c.created + c.updated} imóveis importados com ${c.errors.length} erro(s).`);
      } else {
        toast.success(`${c.created} novo(s), ${c.updated} alterado(s).`);
      }
      onImportComplete();
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : 'Erro ao confirmar a importação';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  function toggleSelected(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function buildReportCsv(): string {
    const lines = ['codigo;nome;regiao;preco;status;alteracoes'];
    const source = analysis?.records ?? [];
    for (const r of source) {
      const diff = r.diff.map((d) => `${FIELD_LABELS[d.field] ?? d.field}: ${d.from} → ${d.to}`).join(' | ');
      lines.push([r.code, r.name ?? '', r.region ?? '', r.price ?? '', r.status, r.reason ?? diff].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';'));
    }
    return lines.join('\n');
  }

  function downloadReport() {
    const blob = new Blob(['\ufeff' + buildReportCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio-importacao-${analysis?.enterpriseName ?? 'revenda'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const filteredRecords = useMemo(() => {
    if (!analysis) return [];
    return statusFilter === 'all' ? analysis.records : analysis.records.filter((r) => r.status === statusFilter);
  }, [analysis, statusFilter]);

  const summary = analysis?.summary;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetAndClose(); }}>
      <DialogContent className="sm:max-w-[720px] max-h-[90dvh] flex flex-col">
        {/* STEP 1: Upload */}
        {step === 'upload' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Importar PDF de Revenda
              </DialogTitle>
              <DialogDescription>
                O sistema analisa o PDF (regras determinísticas — sem IA), mostra um relatório
                para revisão e só grava após sua confirmação.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 flex-1 overflow-y-auto">
              <div className="rounded-xl border bg-muted/50 p-4 space-y-2">
                <p className="text-sm font-medium">Como funciona:</p>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Simulação sem gravar: cada imóvel é classificado como novo, alterado, inalterado, duplicado ou erro</li>
                  <li>Você revisa as diferenças campo a campo e escolhe o que importar</li>
                  <li>Nada é gravado antes da confirmação explícita</li>
                </ul>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Arquivo PDF</Label>
                <div
                  className={cn(
                    'relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors',
                    file ? 'border-primary bg-primary/5 dark:bg-primary/10' : 'border-muted-foreground/25 hover:border-primary/40 hover:bg-muted/50',
                  )}
                  onClick={() => pdfInputRef.current?.click()}
                >
                  <input ref={pdfInputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={handlePdfSelect} />
                  {file ? (
                    <>
                      <div className="h-12 w-12 rounded-xl bg-primary/10 dark:bg-primary/20 flex items-center justify-center mb-2">
                        <FileText className="h-6 w-6 text-primary dark:text-primary" />
                      </div>
                      <p className="text-sm font-medium text-primary dark:text-primary">{file.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setFile(null); setError(null); }}
                        className="absolute top-2 right-2 p-1 rounded-md hover:bg-destructive/10 hover:text-destructive transition-colors"
                        aria-label="Remover arquivo"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center mb-2">
                        <Upload className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <p className="text-sm font-medium">Clique para selecionar o PDF</p>
                      <p className="text-xs text-muted-foreground mt-1">.pdf - maximo 20MB</p>
                    </>
                  )}
                </div>
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-950/20 p-3">
                  <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-1">Erro na importacao:</p>
                  <p className="text-xs text-red-700 dark:text-red-300 break-all whitespace-pre-wrap max-h-[120px] overflow-y-auto">{error}</p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={resetAndClose}>Cancelar</Button>
              <Button onClick={analyze} disabled={!file || busy} className="gap-2 font-semibold">
                {busy
                  ? <><Loader2 className="h-4 w-4 animate-spin" />Analisando sem gravar…</>
                  : <><FileSearchIcon />Analisar (simulação)</>}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* STEP 2: Revisão */}
        {step === 'review' && analysis && summary && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Revisão da importação — {analysis.enterpriseName}
              </DialogTitle>
              <DialogDescription>
                Simulação concluída — nada foi gravado. Selecione os imóveis e confirme.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2 flex-1 overflow-y-auto">
              {/* Resumo do impacto */}
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline" className="gap-1 text-[11px]"><Plus className="h-3 w-3" aria-hidden />{summary.novo} novos</Badge>
                <Badge variant="outline" className="gap-1 text-[11px]"><Pencil className="h-3 w-3" aria-hidden />{summary.alterado} alterados</Badge>
                <Badge variant="outline" className="gap-1 text-[11px]"><MinusCircle className="h-3 w-3" aria-hidden />{summary.inalterado} inalterados</Badge>
                <Badge variant="outline" className="gap-1 text-[11px]"><CopySlash className="h-3 w-3" aria-hidden />{summary.duplicado} duplicados</Badge>
                <Badge variant="outline" className="gap-1 text-[11px]"><AlertCircle className="h-3 w-3" aria-hidden />{summary.erro} erros</Badge>
              </div>

              {/* Filtros */}
              <div className="flex flex-wrap gap-1">
                {(['all', 'novo', 'alterado', 'inalterado', 'duplicado', 'erro'] as const).map((f) => (
                  <Button
                    key={f}
                    variant={statusFilter === f ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 px-2.5 text-[11px]"
                    onClick={() => setStatusFilter(f)}
                  >
                    {f === 'all' ? `Todos (${summary.total})` : `${STATUS_META[f].label} (${summary[f]})`}
                  </Button>
                ))}
              </div>

              {/* Tabela de registros → cartões legíveis em telas estreitas */}
              <div className="space-y-1.5">
                {filteredRecords.map((r) => {
                  const meta = STATUS_META[r.status];
                  const Icon = meta.icon;
                  const selectable = r.status === 'novo' || r.status === 'alterado';
                  return (
                    <div
                      key={r.code}
                      className={cn(
                        'rounded-lg border p-2.5',
                        !selectable && 'opacity-70',
                        selected.has(r.code) && 'border-primary/50 bg-primary/5 dark:bg-primary/10',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {selectable ? (
                          <Checkbox
                            checked={selected.has(r.code)}
                            onCheckedChange={() => toggleSelected(r.code)}
                            aria-label={`Selecionar imóvel ${r.code}`}
                            className="mt-0.5"
                          />
                        ) : (
                          <CircleSlash className="h-4 w-4 text-muted-foreground" aria-hidden />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">{r.code} — {r.name ?? 'sem nome'}</p>
                          <p className="truncate text-[10px] text-muted-foreground">
                            {r.region ?? 'sem região'} · {r.price ? `R$ ${r.price}` : 'sem preço'}
                          </p>
                        </div>
                        <span className={cn('inline-flex flex-shrink-0 items-center gap-1 text-[10px] font-medium', meta.cls)}>
                          <Icon className="h-3 w-3" aria-hidden /> {meta.label}
                        </span>
                      </div>
                      {(r.diff.length > 0 || r.reason) && (
                        <div className="mt-1.5 space-y-0.5 pl-7">
                          {r.diff.slice(0, 4).map((d, i) => (
                            <p key={i} className="text-[10px] text-muted-foreground">
                              <span className="font-medium">{FIELD_LABELS[d.field] ?? d.field}:</span> {d.from} → <span className="text-foreground">{d.to}</span>
                            </p>
                          ))}
                          {r.diff.length > 4 && <p className="text-[10px] text-muted-foreground">+{r.diff.length - 4} outras diferenças</p>}
                          {r.reason && <p className="text-[10px] text-amber-700 dark:text-amber-400">{r.reason}</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
                {filteredRecords.length === 0 && (
                  <p className="py-4 text-center text-xs text-muted-foreground">Nenhum registro neste filtro.</p>
                )}
              </div>

              {error && (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive" role="alert">{error}</p>
              )}
            </div>

            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button variant="ghost" size="sm" className="text-xs" onClick={downloadReport}>
                <Download className="mr-1 h-3.5 w-3.5" aria-hidden /> Relatório (CSV)
              </Button>
              <Button variant="outline" size="sm" className="text-xs" onClick={() => { setStep('upload'); }}>
                Voltar
              </Button>
              <Button
                size="sm"
                className="gap-2 font-semibold text-xs"
                onClick={commit}
                disabled={busy || selected.size === 0}
              >
                {busy
                  ? <><Loader2 className="h-4 w-4 animate-spin" />Gravando…</>
                  : `Confirmar importação (${selected.size})`}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* STEP 3: Resultado */}
        {step === 'result' && result && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {result.errors.length > 0
                  ? <AlertCircle className="h-5 w-5 text-amber-500" />
                  : <CheckCircle2 className="h-5 w-5 text-success" />}
                Importação concluída
              </DialogTitle>
              <DialogDescription>
                {result.errors.length === 0 ? 'Todos os imóveis selecionados foram gravados.' : 'Concluída com alguns erros — os demais registros foram preservados.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 flex-1 overflow-y-auto">
              <div className="rounded-xl border bg-muted/50 p-4 space-y-3">
                <p className="text-sm font-medium">
                  Empreendimento: <strong>{result.enterpriseName}</strong>
                  {result.isNew && (
                    <span className="ml-2 text-xs font-normal text-success bg-success/10 dark:bg-success/20 px-2 py-0.5 rounded-full">novo</span>
                  )}
                </p>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="rounded-lg border border-success/30 bg-success/10 p-2.5">
                    <p className="text-lg font-bold text-success">{result.created}</p>
                    <p className="text-[10px] text-muted-foreground">Novos</p>
                  </div>
                  <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800/50 dark:bg-blue-950/20 p-2.5">
                    <p className="text-lg font-bold text-blue-700 dark:text-blue-400">{result.updated}</p>
                    <p className="text-[10px] text-muted-foreground">Alterados</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/30 p-2.5">
                    <p className="text-lg font-bold text-slate-700 dark:text-slate-300">{result.ignored}</p>
                    <p className="text-[10px] text-muted-foreground">Ignorados</p>
                  </div>
                  <div className="rounded-lg border p-2.5">
                    <p className="text-lg font-bold">{result.totalProperties}</p>
                    <p className="text-[10px] text-muted-foreground">No catálogo</p>
                  </div>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">Erros ({result.errors.length})</p>
                  <div className="rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/20 p-3 max-h-[150px] overflow-y-auto">
                    {result.errors.map((err, i) => (
                      <p key={i} className="py-0.5 text-xs text-amber-700 dark:text-amber-400">{err}</p>
                    ))}
                  </div>
                </div>
              )}

              <Button variant="outline" size="sm" className="text-xs" onClick={downloadReport}>
                <Download className="mr-1 h-3.5 w-3.5" aria-hidden /> Baixar relatório (CSV)
              </Button>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => { setFile(null); setResult(null); setAnalysis(null); setStep('upload'); }}>
                <Upload className="mr-2 h-4 w-4" /> Importar outro PDF
              </Button>
              <Button onClick={resetAndClose} className="font-semibold">Concluir</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FileSearchIcon() {
  return <FileText className="h-4 w-4" aria-hidden />;
}
