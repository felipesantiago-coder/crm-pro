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
