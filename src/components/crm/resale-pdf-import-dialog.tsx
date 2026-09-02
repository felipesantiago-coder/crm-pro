'use client';

import { useState, useRef } from 'react';
import {
  Upload, FileText, X, Loader2, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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

interface ImportResult {
  extracted: number;
  created: number;
  updated: number;
  errors: string[];
  pageCount: number;
  totalProperties: number;
  enterpriseId: string;
  enterpriseName: string;
  isNew: boolean;
  textPreview?: string;
}

type Step = 'upload' | 'result';

export function ResalePdfImportDialog({ open, onOpenChange, onImportComplete }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  function resetAndClose() {
    setStep('upload');
    setFile(null);
    setImporting(false);
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

  async function handleImport() {
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/enterprises/resale-import', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        const errMsg = data.error || 'Erro ao processar o PDF';
        setError(errMsg);
        toast.error(errMsg.length > 120 ? errMsg.slice(0, 120) + '...' : errMsg);
        return;
      }
      setResult(data);
      setStep('result');
      if (data.errors.length > 0) {
        toast.warning(`${data.created} imoveis importados com ${data.errors.length} alerta(s).`);
      } else {
        toast.success(`${data.created} imoveis extraidos com sucesso!`);
      }
      onImportComplete();
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : 'Erro ao processar o PDF';
      setError(msg);
      toast.error(msg);
    } finally {
      setImporting(false);
    }
  }

  function handleImportAnother() {
    setFile(null);
    setResult(null);
    setError(null);
    setStep('upload');
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetAndClose(); }}>
      <DialogContent className="sm:max-w-[560px] max-h-[90dvh] flex flex-col">
        {/* STEP 1: Upload PDF */}
        {step === 'upload' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Importar PDF de Revenda
              </DialogTitle>
              <DialogDescription>
                Envie o PDF com os imoveis. O sistema extraira automaticamente todos os dados e criara o empreendimento.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 flex-1 overflow-y-auto">
              {/* Info box */}
              <div className="rounded-xl border bg-muted/50 p-4 space-y-2">
                <p className="text-sm font-medium">Como funciona:</p>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                  <li>O sistema extraira automaticamente todos os imoveis do PDF (codigo, nome, regiao, preco, etc.)</li>
                  <li>O empreendimento sera criado automaticamente com o nome do arquivo</li>
                  <li>Imoveis duplicados (mesmo codigo) serao atualizados com os novos dados</li>
                </ul>
              </div>

              {/* File upload area */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Arquivo PDF</Label>
                <div
                  className={cn(
                    'relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors',
                    file
                      ? 'border-primary bg-primary/5 dark:bg-primary/10'
                      : 'border-muted-foreground/25 hover:border-primary/40 hover:bg-muted/50'
                  )}
                  onClick={() => pdfInputRef.current?.click()}
                >
                  <input
                    ref={pdfInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    className="hidden"
                    onChange={handlePdfSelect}
                  />
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

              {/* Error display */}
              {error && (
                <div className="rounded-lg border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-950/20 p-3">
                  <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-1">Erro na importacao:</p>
                  <p className="text-xs text-red-700 dark:text-red-300 break-all whitespace-pre-wrap max-h-[120px] overflow-y-auto">{error}</p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={resetAndClose}>
                Cancelar
              </Button>
              <Button
                onClick={handleImport}
                disabled={!file || importing}
                className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
              >
                {importing ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Extraindo imoveis...</>
                ) : (
                  <><Upload className="h-4 w-4 mr-2" />Importar Imoveis</>
                )}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* STEP 2: Result */}
        {step === 'result' && result && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {result.errors.length > 0 ? (
                  <AlertCircle className="h-5 w-5 text-amber-500" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-success" />
                )}
                Resultado da Importacao
              </DialogTitle>
              <DialogDescription>
                {result.errors.length === 0
                  ? 'Todos os imoveis foram importados com sucesso!'
                  : 'Importacao concluida com alguns alertas.'}
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
                <div className="grid grid-cols-3 gap-3">
                  <div className={cn(
                    'rounded-lg border p-3 text-center',
                    'border-success/30 bg-success/10 dark:border-success/20 dark:bg-success/20'
                  )}>
                    <CheckCircle2 className="h-5 w-5 mx-auto mb-1 text-success" />
                    <p className="text-xl font-bold text-success dark:text-success">{result.created}</p>
                    <p className="text-[10px] text-muted-foreground">Importados</p>
                  </div>
                  <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800/50 dark:bg-blue-950/20 p-3 text-center">
                    <FileText className="h-5 w-5 mx-auto mb-1 text-blue-600" />
                    <p className="text-xl font-bold text-blue-700 dark:text-blue-400">{result.totalProperties}</p>
                    <p className="text-[10px] text-muted-foreground">Total no catalogo</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/30 p-3 text-center">
                    <FileText className="h-5 w-5 mx-auto mb-1 text-slate-600" />
                    <p className="text-xl font-bold text-slate-700 dark:text-slate-300">{result.pageCount}</p>
                    <p className="text-[10px] text-muted-foreground">Paginas</p>
                  </div>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">Alertas ({result.errors.length})</p>
                  <div className="rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/20 p-3 max-h-[150px] overflow-y-auto">
                    {result.errors.map((err, i) => (
                      <p key={i} className="text-xs text-amber-700 dark:text-amber-400 py-0.5">{err}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Text preview for debugging */}
              {result.textPreview && (
                <details className="rounded-lg border border-slate-200 dark:border-slate-700">
                  <summary className="px-3 py-2 text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                    Texto extraido do PDF (debug)
                  </summary>
                  <pre className="px-3 pb-3 text-[10px] text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto">{result.textPreview}</pre>
                </details>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleImportAnother}>
                <Upload className="h-4 w-4 mr-2" />
                Importar Outro PDF
              </Button>
              <Button
                onClick={resetAndClose}
                className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
              >
                Concluir
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
