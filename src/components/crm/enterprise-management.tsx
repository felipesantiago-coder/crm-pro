'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import {
  Building2,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  Search,
  ImagePlus,
  MapPin,
  X,
  Users,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Ban,
  Download,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import Image from 'next/image';

interface EnterpriseItem {
  id: string;
  name: string;
  region: string | null;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { clients: number };
}

interface EnterpriseFormData {
  name: string;
  region: string;
}

export function EnterpriseManagement() {
  const { data: session } = useSession();
  const [enterprises, setEnterprises] = useState<EnterpriseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createRegion, setCreateRegion] = useState('');
  const [creating, setCreating] = useState(false);

  // Edit dialog
  const [editingEnterprise, setEditingEnterprise] = useState<EnterpriseItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editRegion, setEditRegion] = useState('');
  const [saving, setSaving] = useState(false);

  // Delete dialog
  const [deletingEnterprise, setDeletingEnterprise] = useState<EnterpriseItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Image upload
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Batch import
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchFile, setBatchFile] = useState<File | null>(null);
  const [batchImporting, setBatchImporting] = useState(false);
  const [batchResults, setBatchResults] = useState<{
    created: { name: string; region: string | null }[];
    duplicates: { name: string; reason: string }[];
    invalid: { row: number; reason: string }[];
    total: number;
  } | null>(null);
  const batchFileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchEnterprises = useCallback(async () => {
    try {
      const res = await fetch('/api/enterprises');
      if (res.ok) {
        const data = await res.json();
        setEnterprises(data);
      } else {
        toast.error('Erro ao carregar empreendimentos');
      }
    } catch {
      toast.error('Erro ao carregar empreendimentos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEnterprises();
  }, [fetchEnterprises]);

  const filteredEnterprises = enterprises.filter(
    (e) =>
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      (e.region && e.region.toLowerCase().includes(search.toLowerCase()))
  );

  async function handleCreate() {
    if (!createName.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }

    setCreating(true);
    try {
      const res = await fetch('/api/enterprises', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          region: createRegion.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Erro ao criar empreendimento');
        return;
      }

      toast.success('Empreendimento criado com sucesso!');
      setCreateOpen(false);
      setCreateName('');
      setCreateRegion('');
      fetchEnterprises();
    } catch {
      toast.error('Erro ao criar empreendimento');
    } finally {
      setCreating(false);
    }
  }

  function openEditDialog(enterprise: EnterpriseItem) {
    setEditingEnterprise(enterprise);
    setEditName(enterprise.name);
    setEditRegion(enterprise.region || '');
  }

  async function handleEditSave() {
    if (!editingEnterprise || !editName.trim()) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/enterprises/${editingEnterprise.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          region: editRegion.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Erro ao atualizar');
        return;
      }

      toast.success('Empreendimento atualizado com sucesso!');
      setEditingEnterprise(null);
      fetchEnterprises();
    } catch {
      toast.error('Erro ao atualizar empreendimento');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deletingEnterprise) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/enterprises/${deletingEnterprise.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Erro ao excluir');
        return;
      }

      toast.success('Empreendimento excluído com sucesso!');
      setDeletingEnterprise(null);
      fetchEnterprises();
    } catch {
      toast.error('Erro ao excluir empreendimento');
    } finally {
      setDeleting(false);
    }
  }

  async function handleImageUpload(enterpriseId: string, file: File) {
    if (!file.type.includes('webp') && !file.type.includes('image')) {
      toast.error('Apenas imagens WebP são aceitas');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Imagem muito grande. Máximo 5MB.');
      return;
    }

    setUploadingId(enterpriseId);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('enterpriseId', enterpriseId);

      const res = await fetch('/api/enterprises/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Erro ao enviar imagem');
        return;
      }

      toast.success('Imagem enviada com sucesso!');
      fetchEnterprises();
    } catch {
      toast.error('Erro ao enviar imagem');
    } finally {
      setUploadingId(null);
    }
  }

  function resetBatchDialog() {
    setBatchFile(null);
    setBatchResults(null);
    setBatchImporting(false);
  }

  async function handleBatchImport() {
    if (!batchFile) return;
    setBatchImporting(true);
    setBatchResults(null);
    try {
      const formData = new FormData();
      formData.append('file', batchFile);

      const res = await fetch('/api/enterprises/batch', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Erro ao importar empreendimentos');
        return;
      }

      const data = await res.json();
      setBatchResults(data);

      const totalCreated = data.created.length;
      const totalDupes = data.duplicates.length;
      const totalInvalid = data.invalid.length;

      if (totalCreated > 0) {
        toast.success(`${totalCreated} empreendimento${totalCreated > 1 ? 's' : ''} importado${totalCreated > 1 ? 's' : ''} com sucesso!`);
      }
      if (totalDupes > 0) {
        toast.warning(`${totalDupes} duplicata${totalDupes > 1 ? 's' : ''} ignorada${totalDupes > 1 ? 's' : ''}`);
      }
      if (totalInvalid > 0) {
        toast.error(`${totalInvalid} registro${totalInvalid > 1 ? 's' : ''} inválido${totalInvalid > 1 ? 's' : ''}`);
      }

      fetchEnterprises();
    } catch {
      toast.error('Erro ao importar empreendimentos');
    } finally {
      setBatchImporting(false);
    }
  }

  if ((session?.user as { role?: string })?.role !== 'ADMIN') {
    return (
      <div className="flex items-center justify-center h-64">
        <Card className="p-6 text-center">
          <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Acesso restrito a administradores.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="h-5 w-5 text-emerald-600" />
            Gestão de Empreendimentos
          </h2>
          <p className="text-muted-foreground mt-1">
            Cadastre empreendimentos para vincular aos clientes
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={batchDialogOpen} onOpenChange={(open) => { if (!open) resetBatchDialog(); setBatchDialogOpen(open); }}>
            <DialogTrigger asChild>
              <Button variant="outline" className="font-semibold">
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Importar em Lote
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[520px]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileSpreadsheet className="h-5 w-5 text-emerald-500" />
                  Importar Empreendimentos em Lote
                </DialogTitle>
                <DialogDescription>
                  Faça upload de um arquivo Excel (.xlsx ou .xls) ou CSV contendo os empreendimentos.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                {/* Template info */}
                <div className="rounded-xl border bg-muted/50 p-4 space-y-3">
                  <p className="text-sm font-medium">Formato esperado do arquivo:</p>
                  <div className="rounded-lg border bg-background overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-emerald-50 dark:bg-emerald-950/30">
                          <th className="px-3 py-2 text-left font-semibold text-emerald-700 dark:text-emerald-400">Nome *</th>
                          <th className="px-3 py-2 text-left font-semibold text-emerald-700 dark:text-emerald-400">Região</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-t">
                          <td className="px-3 py-2">Residencial Parque das Flores</td>
                          <td className="px-3 py-2">Zona Sul</td>
                        </tr>
                        <tr className="border-t">
                          <td className="px-3 py-2">Empreendimento Central</td>
                          <td className="px-3 py-2">Centro</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    A coluna <strong>Nome</strong> é obrigatória. A coluna <strong>Região</strong> é opcional.
                    Empreendimentos com nome duplicado serão ignorados.
                  </p>
                </div>

                {/* File upload area */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Arquivo</label>
                  <div
                    className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors ${
                      batchFile
                        ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20'
                        : 'border-muted-foreground/25 hover:border-emerald-500/50 hover:bg-muted/50'
                    }`}
                    onClick={() => batchFileInputRef.current?.click()}
                  >
                    <input
                      ref={batchFileInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setBatchFile(file);
                          setBatchResults(null);
                        }
                        e.target.value = '';
                      }}
                    />
                    {batchFile ? (
                      <>
                        <div className="h-12 w-12 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mb-2">
                          <FileSpreadsheet className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{batchFile.name}</p>
                        <p className="text-xs text-muted-foreground mt-1">{(batchFile.size / 1024).toFixed(1)} KB</p>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setBatchFile(null); setBatchResults(null); }}
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
                        <p className="text-sm font-medium">Clique para selecionar o arquivo</p>
                        <p className="text-xs text-muted-foreground mt-1">.xlsx, .xls ou .csv — máximo 5MB</p>
                      </>
                    )}
                  </div>
                </div>

                {/* Results */}
                {batchResults && (
                  <div className="space-y-3">
                    <Separator />
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">Resultado da Importação</p>
                      <Badge variant="secondary" className="text-xs">
                        {batchResults.created.length + batchResults.duplicates.length + batchResults.invalid.length} / {batchResults.total}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className={`rounded-lg border p-2.5 text-center ${
                        batchResults.created.length > 0
                          ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800/50 dark:bg-emerald-950/20'
                          : 'border-border bg-muted/30'
                      }`}>
                        <CheckCircle2 className={`h-4 w-4 mx-auto mb-1 ${batchResults.created.length > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`} />
                        <p className={`text-lg font-bold ${batchResults.created.length > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}`}>{batchResults.created.length}</p>
                        <p className="text-[10px] text-muted-foreground">Criados</p>
                      </div>
                      <div className={`rounded-lg border p-2.5 text-center ${
                        batchResults.duplicates.length > 0
                          ? 'border-amber-200 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-950/20'
                          : 'border-border bg-muted/30'
                      }`}>
                        <Ban className={`h-4 w-4 mx-auto mb-1 ${batchResults.duplicates.length > 0 ? 'text-amber-600' : 'text-muted-foreground'}`} />
                        <p className={`text-lg font-bold ${batchResults.duplicates.length > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>{batchResults.duplicates.length}</p>
                        <p className="text-[10px] text-muted-foreground">Duplicatas</p>
                      </div>
                      <div className={`rounded-lg border p-2.5 text-center ${
                        batchResults.invalid.length > 0
                          ? 'border-rose-200 bg-rose-50 dark:border-rose-800/50 dark:bg-rose-950/20'
                          : 'border-border bg-muted/30'
                      }`}>
                        <AlertCircle className={`h-4 w-4 mx-auto mb-1 ${batchResults.invalid.length > 0 ? 'text-rose-600' : 'text-muted-foreground'}`} />
                        <p className={`text-lg font-bold ${batchResults.invalid.length > 0 ? 'text-rose-700 dark:text-rose-400' : 'text-muted-foreground'}`}>{batchResults.invalid.length}</p>
                        <p className="text-[10px] text-muted-foreground">Inválidos</p>
                      </div>
                    </div>

                    {/* Created items list */}
                    {batchResults.created.length > 0 && (
                      <div className="rounded-lg border max-h-[150px] overflow-y-auto">
                        <div className="p-2 space-y-1">
                          {batchResults.created.map((item, i) => (
                            <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-emerald-50/50 dark:bg-emerald-950/10 text-xs">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                              <span className="truncate font-medium">{item.name}</span>
                              {item.region && (
                                <span className="text-muted-foreground ml-auto flex-shrink-0">{item.region}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Duplicates list */}
                    {batchResults.duplicates.length > 0 && (
                      <div className="rounded-lg border border-amber-200 dark:border-amber-800/50 max-h-[100px] overflow-y-auto">
                        <div className="p-2 space-y-1">
                          {batchResults.duplicates.map((item, i) => (
                            <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-amber-50/50 dark:bg-amber-950/10 text-xs">
                              <Ban className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                              <span className="truncate font-medium">{item.name}</span>
                              <span className="text-amber-600 dark:text-amber-400 ml-auto flex-shrink-0">Duplicata</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => { resetBatchDialog(); setBatchDialogOpen(false); }}>
                  {batchResults ? 'Fechar' : 'Cancelar'}
                </Button>
                {!batchResults && (
                  <Button
                    onClick={handleBatchImport}
                    disabled={!batchFile || batchImporting}
                    className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold"
                  >
                    {batchImporting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Importando...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        Importar
                      </>
                    )}
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold">
              <Plus className="h-4 w-4 mr-2" />
              Novo Empreendimento
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Novo Empreendimento</DialogTitle>
              <DialogDescription>
                Cadastre um novo empreendimento. Você poderá adicionar uma imagem depois.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="create-name">Nome *</Label>
                <Input
                  id="create-name"
                  placeholder="Nome do empreendimento"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  disabled={creating}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-region">Região</Label>
                <Input
                  id="create-region"
                  placeholder="Ex: Centro, Zona Sul..."
                  value={createRegion}
                  onChange={(e) => setCreateRegion(e.target.value)}
                  disabled={creating}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
                Cancelar
              </Button>
              <Button
                onClick={handleCreate}
                disabled={creating || !createName.trim()}
                className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold"
              >
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Criando...
                  </>
                ) : (
                  'Criar'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total de Empreendimentos</p>
              <p className="text-2xl font-bold">{enterprises.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-teal-500/10 flex items-center justify-center">
              <Users className="h-5 w-5 text-teal-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Clientes Vinculados</p>
              <p className="text-2xl font-bold">
                {enterprises.reduce((acc, e) => acc + e._count.clients, 0)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome ou região..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Enterprise Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-52 rounded-xl border bg-muted animate-pulse" />
          ))}
        </div>
      ) : filteredEnterprises.length === 0 ? (
        <Card className="p-8 text-center">
          <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">
            {search ? 'Nenhum empreendimento encontrado.' : 'Nenhum empreendimento cadastrado ainda.'}
          </p>
          {!search && (
            <Button className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Cadastrar Primeiro
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredEnterprises.map((enterprise) => (
            <Card
              key={enterprise.id}
              className="group hover:shadow-lg transition-all duration-200 overflow-hidden"
            >
              {/* Image Area */}
              <div className="relative h-32 bg-gradient-to-br from-emerald-500/10 to-teal-500/10 flex items-center justify-center overflow-hidden">
                {enterprise.imageUrl ? (
                  <>
                    <Image
                      src={enterprise.imageUrl}
                      alt={enterprise.name}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-300"
                      unoptimized
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                    <div className="absolute bottom-2 left-3 right-3">
                      <h3 className="text-white font-semibold text-sm truncate drop-shadow-md">
                        {enterprise.name}
                      </h3>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Building2 className="h-10 w-10 text-emerald-300 dark:text-emerald-600" />
                    <span className="text-emerald-500 dark:text-emerald-400 font-medium text-sm">
                      {enterprise.name}
                    </span>
                  </div>
                )}

                {/* Upload overlay */}
                <label className="absolute top-2 right-2 cursor-pointer">
                  <input
                    ref={(el) => { fileInputRefs.current[enterprise.id] = el; }}
                    type="file"
                    accept=".webp,image/webp,image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImageUpload(enterprise.id, file);
                      e.target.value = '';
                    }}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 w-7 p-0 bg-black/50 hover:bg-black/70 text-white border-0 backdrop-blur-sm"
                    asChild
                  >
                    <span>
                      {uploadingId === enterprise.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ImagePlus className="h-3.5 w-3.5" />
                      )}
                    </span>
                  </Button>
                </label>
              </div>

              <CardContent className="p-3">
                {/* Info */}
                <div className="space-y-2">
                  {enterprise.region && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{enterprise.region}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <Badge variant="secondary" className="text-[10px]">
                      <Users className="h-3 w-3 mr-1" />
                      {enterprise._count.clients} cliente{enterprise._count.clients !== 1 ? 's' : ''}
                    </Badge>

                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => openEditDialog(enterprise)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <AlertDialog
                        open={deletingEnterprise?.id === enterprise.id}
                        onOpenChange={(open) => !open && setDeletingEnterprise(null)}
                      >
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                            onClick={() => setDeletingEnterprise(enterprise)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir Empreendimento</AlertDialogTitle>
                            <AlertDialogDescription>
                              Tem certeza que deseja excluir &quot;{enterprise.name}&quot;?
                              Os clientes vinculados não serão excluídos, mas perderão o vínculo com este empreendimento.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={handleDelete}
                              disabled={deleting}
                              className="bg-red-600 hover:bg-red-700 text-white"
                            >
                              {deleting ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  Excluindo...
                                </>
                              ) : (
                                'Excluir'
                              )}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog
        open={!!editingEnterprise}
        onOpenChange={(open) => !open && setEditingEnterprise(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Empreendimento</DialogTitle>
            <DialogDescription>
              Atualize as informações do empreendimento.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Nome *</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-region">Região</Label>
              <Input
                id="edit-region"
                value={editRegion}
                onChange={(e) => setEditRegion(e.target.value)}
                disabled={saving}
              />
            </div>

            {/* Image upload in edit dialog */}
            <div className="space-y-2">
              <Label>Imagem do Empreendimento</Label>
              {editingEnterprise?.imageUrl && (
                <div className="relative h-24 rounded-lg overflow-hidden border">
                  <Image
                    src={editingEnterprise.imageUrl}
                    alt={editingEnterprise.name}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                </div>
              )}
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept=".webp,image/webp,image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file && editingEnterprise) {
                      handleImageUpload(editingEnterprise.id, file);
                    }
                    e.target.value = '';
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={uploadingId === editingEnterprise?.id}
                  asChild
                >
                  <span>
                    {uploadingId === editingEnterprise?.id ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Enviando...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        {editingEnterprise?.imageUrl ? 'Alterar Imagem (WebP)' : 'Enviar Imagem (WebP)'}
                      </>
                    )}
                  </span>
                </Button>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingEnterprise(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button
              onClick={handleEditSave}
              disabled={saving || !editName.trim()}
              className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Salvando...
                </>
              ) : (
                'Salvar'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
