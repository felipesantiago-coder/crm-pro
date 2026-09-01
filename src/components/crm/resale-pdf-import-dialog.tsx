'use client';

import { useState, useRef } from 'react';
import {
  Upload, FileText, X, Loader2, CheckCircle2, AlertCircle,
  Plus, Building2, ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface RevendaEnterprise {
  id: string;
  name: string;
  region: string | null;
  resalePropertyCount?: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  revendaEnterprises: RevendaEnterprise[];
  onImportComplete: () => void;
}

interface ImportResult {
  extracted: number;
  created: number;
  updated: number;
  errors: string[];
  pageCount: number;
  totalProperties: number;
  enterpriseName: string;
}

type Step = 'select-enterprise' | 'upload-pdf' | 'result';

export function ResalePdfImportDialog({ open, onOpenChange, revendaEnterprises, onImportComplete }: Props) {
  const [step, setStep] = useState<Step>('select-enterprise');
  const [selectedId, setSelectedId] = useState<string>('');
  const [newName, setNewName] = useState('');
  const [newRegion, setNewRegion] = useState('');
  const [creating, setCreating] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const selectedEnterprise = revendaEnterprises.find(e => e.id === selectedId);

  function resetAndClose() {
    setStep('select-enterprise');
    setSelectedId('');
    setNewName('');
    setNewRegion('');
    setFile(null);
    setImporting(false);
    setResult(null);
    setCreating(false);
    onOpenChange(false);
  }

  async function handleCreateAndSelect() {
    if (!newName.trim()) {
      toast.error('Nome do empreendimento é obrigatório');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/enterprises', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), region: newRegion.trim() || null, type: 'REVENDA' }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Erro ao criar empreendimento');
        return;
      }
      const data = await res.json();
      toast.success(`Empreendimento "${newName.trim()}" criado!`);
      setSelectedId(data.id);
      onImportComplete(); // Refresh enterprise list
      setStep('upload-pdf');
    } catch {
      toast.error('Erro ao criar empreendimento');
    } finally {
      setCreating(false);
    }
  }

  function handleSelectExisting(id: string) {
    setSelectedId(id);
    setStep('upload-pdf');
  }

  function handlePdfSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) {
      if (!f.name.toLowerCase().endsWith('.pdf') && f.type !== 'application/pdf') {
        toast.error('Apenas arquivos PDF são aceitos');
        return;
      }
      if (f.size > 20 * 1024 * 1024) {
        toast.error('Arquivo muito grande. Máximo 20MB.');
        return;
      }
      setFile(f);
    }
    e.target.value = '';
  }

  async function handleImport() {
    if (!file || !selectedId) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/enterprises/${selectedId}/resale-properties`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Erro ao processar o PDF');
        return;
      }
      setResult(data);
      setStep('result');
      if (data.errors.length > 0) {
        toast.warning(`${data.created} imóveis importados com ${data.errors.length} alerta(s).`);
      } else {
        toast.success(`${data.created} imóveis extraídos com sucesso!`);
      }
      onImportComplete();
    } catch {
      toast.error('Erro ao processar o PDF');
    } finally {
      setImporting(false);
    }
  }

  function handleImportAnother() {
    setFile(null);
    setResult(null);
    setStep(selectedId ? 'upload-pdf' : 'select-enterprise');
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetAndClose(); }}>
      <DialogContent className="sm:max-w-[540px] max-h-[90dvh] flex flex-col">
        {/* STEP 1: Select or Create Enterprise */}
        {step === 'select-enterprise' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-emerald-500" />
                Importar PDF de Revenda
              </DialogTitle>
              <DialogDescription>
                Selecione um empreendimento de revenda existente ou crie um novo para importar os imóveis do PDF.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 flex-1 overflow-y-auto">
              {/* Existing enterprises */}
              {revendaEnterprises.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Empreendimentos de Revenda existentes</Label>
                  <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                    {revendaEnterprises.map((ent) => (
                      <button
                        key={ent.id}
                        type="button"
                        onClick={() => handleSelectExisting(ent.id)}
                        disabled={creating}
                        className="w-full flex items-center gap-3 p-3 rounded-xl border text-left hover:border-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 transition-colors group"
                      >
                        <div className="h-9 w-9 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
                          <Building2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate group-hover:text-emerald-700 dark:group-hover:text-emerald-300">
                            {ent.name}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {ent.region && <span>{ent.region}</span>}
                            {(ent.resalePropertyCount ?? 0) > 0 && (
                              <Badge variant="secondary" className="text-[10px] h-4">
                                {(ent.resalePropertyCount ?? 0)} imóveis
                              </Badge>
                            )}
                          </div>
                        </div>
                        <ChevronDown className="h-4 w-4 text-muted-foreground rotate-[-90deg] group-hover:translate-x-0.5 transition-transform" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Divider */}
              {revendaEnterprises.length > 0 && (
                <div className="flex items-center gap-3">
                  <div className="flex-1 border-t" />
                  <span className="text-xs text-muted-foreground font-medium">ou crie novo</span>
                  <div className="flex-1 border-t" />
                </div>
              )}

              {/* Create new */}
              <div className="space-y-3 rounded-xl border border-dashed border-emerald-300 dark:border-emerald-700 p-4">
                <Label className="text-sm font-semibold flex items-center gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  Novo Empreendimento de Revenda
                </Label>
                <div className="space-y-2">
                  <Input
                    placeholder="Nome do empreendimento *"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    disabled={creating}
                  />
                  <Input
                    placeholder="Região (opcional)"
                    value={newRegion}
                    onChange={(e) => setNewRegion(e.target.value)}
                    disabled={creating}
                  />
                </div>
                <Button
                  onClick={handleCreateAndSelect}
                  disabled={!newName.trim() || creating}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                >
                  {creating ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Criando...</>
                  ) : (
                    <><Plus className="h-4 w-4 mr-2" />Criar e Importar PDF</>
                  )}
                </Button>
              </div>
            </div>
          </>
        )}

        {/* STEP 2: Upload PDF */}
        {step === 'upload-pdf' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-emerald-500" />
                Importar PDF de Revenda
              </DialogTitle>
              <DialogDescription>
                Enviando para: <strong className="text-emerald-600 dark:text-emerald-400">{selectedEnterprise?.name || 'Empreendimento'}</strong>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 flex-1 overflow-y-auto">
              {/* Info box */}
              <div className="rounded-xl border bg-muted/50 p-4 space-y-2">
                <p className="text-sm font-medium">Como funciona:</p>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                  <li>O sistema extrairá automaticamente os imóveis do PDF (código, nome, região, preço, etc.)</li>
                  <li>Cada imóvel será catalogado e vinculado ao empreendimento selecionado</li>
                  <li>Imóveis duplicados (mesmo código) serão atualizados com os novos dados</li>
                </ul>
              </div>

              {/* File upload area */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Arquivo PDF</Label>
                <div
                  className={cn(
                    'relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors',
                    file
                      ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20'
                      : 'border-muted-foreground/25 hover:border-emerald-500/50 hover:bg-muted/50'
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
                      <div className="h-12 w-12 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mb-2">
                        <FileText className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{file.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setFile(null); }}
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
                      <p className="text-xs text-muted-foreground mt-1">.pdf — máximo 20MB</p>
                    </>
                  )}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('select-enterprise')}>
                Voltar
              </Button>
              <Button
                onClick={handleImport}
                disabled={!file || importing}
                className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold"
              >
                {importing ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Extraindo imóveis...</>
                ) : (
                  <><Upload className="h-4 w-4 mr-2" />Importar Imóveis</>
                )}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* STEP 3: Result */}
        {step === 'result' && result && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {result.errors.length > 0 ? (
                  <AlertCircle className="h-5 w-5 text-amber-500" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                )}
                Resultado da Importação
              </DialogTitle>
              <DialogDescription>
                {result.errors.length === 0
                  ? 'Todos os imóveis foram importados com sucesso!'
                  : 'Importação concluída com alguns alertas.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 flex-1 overflow-y-auto">
              <div className="rounded-xl border bg-muted/50 p-4">
                <p className="text-sm font-medium mb-3">Empreendimento: <strong>{result.enterpriseName}</strong></p>
                <div className="grid grid-cols-3 gap-3">
                  <div className={cn(
                    'rounded-lg border p-3 text-center',
                    'border-emerald-200 bg-emerald-50 dark:border-emerald-800/50 dark:bg-emerald-950/20'
                  )}>
                    <CheckCircle2 className="h-5 w-5 mx-auto mb-1 text-emerald-600" />
                    <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400">{result.created}</p>
                    <p className="text-[10px] text-muted-foreground">Importados</p>
                  </div>
                  <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800/50 dark:bg-blue-950/20 p-3 text-center">
                    <FileText className="h-5 w-5 mx-auto mb-1 text-blue-600" />
                    <p className="text-xl font-bold text-blue-700 dark:text-blue-400">{result.totalProperties}</p>
                    <p className="text-[10px] text-muted-foreground">Total no catálogo</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/30 p-3 text-center">
                    <FileText className="h-5 w-5 mx-auto mb-1 text-slate-600" />
                    <p className="text-xl font-bold text-slate-700 dark:text-slate-300">{result.pageCount}</p>
                    <p className="text-[10px] text-muted-foreground">Páginas processadas</p>
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
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleImportAnother}>
                <Upload className="h-4 w-4 mr-2" />
                Importar Outro PDF
              </Button>
              <Button
                onClick={resetAndClose}
                className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold"
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
