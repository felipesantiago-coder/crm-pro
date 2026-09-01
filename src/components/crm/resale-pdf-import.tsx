'use client';

import { useState, useRef } from 'react';
import {
  Upload, FileText, X, Loader2, CheckCircle2, AlertCircle,
  Trash2, Download,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Props {
  enterpriseId: string;
  enterpriseName: string;
  propertyCount: number;
  onImportComplete: () => void;
}

interface ImportResult {
  extracted: number;
  created: number;
  updated: number;
  errors: string[];
  pageCount: number;
  totalProperties: number;
}

export function ResalePdfImport({ enterpriseId, enterpriseName, propertyCount, onImportComplete }: Props) {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      toast.error('Apenas arquivos PDF são aceitos para extração de imóveis.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('Arquivo muito grande. Máximo 20MB.');
      return;
    }
    setImporting(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/enterprises/${enterpriseId}/resale-properties`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Erro ao processar o PDF');
        return;
      }
      setResult(data);
      if (data.errors.length > 0) {
        toast.warning(`${data.created} imóveis importados com ${data.errors.length} erro(s).`);
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

  async function handleClearAll() {
    try {
      const res = await fetch(`/api/enterprises/${enterpriseId}/resale-properties`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error || 'Erro ao remover'); return; }
      const data = await res.json();
      toast.success(`${data.deleted} imóveis removidos`);
      setResult(null);
      onImportComplete();
    } catch { toast.error('Erro ao remover imóveis'); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {propertyCount} imóve{propertyCount !== 1 ? 'is' : 'l'} cadastrado{propertyCount !== 1 ? 's' : ''}
        </p>
        <div className="flex items-center gap-2">
          <label className="cursor-pointer">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = '';
              }}
            />
            <Button size="sm" variant="outline" className="text-xs font-semibold" disabled={importing} asChild>
              <span>
                {importing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
                {importing ? 'Extraindo...' : 'Importar PDF'}
              </span>
            </Button>
          </label>
          {propertyCount > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-2 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950" title="Remover todos os imóveis">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remover todos os imóveis</AlertDialogTitle>
                  <AlertDialogDescription>
                    Isso irá remover permanentemente todos os {propertyCount} imóveis de revenda de &quot;{enterpriseName}&quot;. Essa ação não pode ser desfeita.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleClearAll} className="bg-red-600 hover:bg-red-700 text-white">Remover todos</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* Import result */}
      {result && (
        <Card className={cn('border', result.errors.length > 0 ? 'border-amber-300 dark:border-amber-700' : 'border-emerald-300 dark:border-emerald-700')}>
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              {result.errors.length > 0 ? <AlertCircle className="h-4 w-4 text-amber-500" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
              <span className="text-sm font-semibold">Resultado da extração</span>
              <Badge variant="secondary" className="text-[10px]">{result.pageCount} pág.</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />{result.created} importados</div>
              <div className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5 text-blue-500" />{result.totalProperties} total no catálogo</div>
            </div>
            {result.errors.length > 0 && (
              <div className="rounded-md border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/20 p-2 max-h-24 overflow-y-auto">
                {result.errors.map((err, i) => <p key={i} className="text-[11px] text-amber-700 dark:text-amber-400">{err}</p>)}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}