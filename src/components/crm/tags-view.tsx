'use client';

import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Tag as TagIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface TagWithCount {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  _count: { clients: number };
}

const PRESET_COLORS = [
  '#0d9488', '#059669', '#0891b2', '#0284c7', '#7c3aed',
  '#db2777', '#e11d48', '#ea580c', '#d97706', '#65a30d',
  '#16a34a', '#2563eb', '#9333ea', '#c026d3', '#e74694',
  '#f97316', '#eab308', '#22c55e', '#14b8a6', '#6366f1',
];

export function TagsView() {
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<TagWithCount | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [tagToDelete, setTagToDelete] = useState<TagWithCount | null>(null);
  const [saving, setSaving] = useState(false);

  const [formName, setFormName] = useState('');
  const [formColor, setFormColor] = useState('#0d9488');

  useEffect(() => {
    fetchTags();
  }, []);

  async function fetchTags() {
    setLoading(true);
    try {
      const res = await fetch('/api/tags');
      const data = await res.json();
      setTags(data);
    } catch (err) {
      console.error('Error fetching tags:', err);
    } finally {
      setLoading(false);
    }
  }

  function openCreateForm() {
    setEditingTag(null);
    setFormName('');
    setFormColor('#0d9488');
    setFormOpen(true);
  }

  function openEditForm(tag: TagWithCount) {
    setEditingTag(tag);
    setFormName(tag.name);
    setFormColor(tag.color);
    setFormOpen(true);
  }

  function openDeleteDialog(tag: TagWithCount) {
    setTagToDelete(tag);
    setDeleteOpen(true);
  }

  async function handleSave() {
    if (!formName.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }

    setSaving(true);
    try {
      const url = editingTag ? `/api/tags/${editingTag.id}` : '/api/tags';
      const method = editingTag ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName.trim(), color: formColor }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Erro ao salvar tag');
      }

      toast.success(editingTag ? 'Tag atualizada com sucesso!' : 'Tag criada com sucesso!');
      setFormOpen(false);
      fetchTags();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar tag');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!tagToDelete) return;
    try {
      const res = await fetch(`/api/tags/${tagToDelete.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Tag excluída com sucesso!');
        setDeleteOpen(false);
        setTagToDelete(null);
        fetchTags();
      } else {
        throw new Error('Erro ao excluir tag');
      }
    } catch {
      toast.error('Erro ao excluir tag');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tags</h1>
          <p className="text-muted-foreground mt-1">
            Gerencie as tags para categorizar seus clientes
          </p>
        </div>
        <Button size="sm" onClick={openCreateForm}>
          <Plus className="h-4 w-4 mr-2" />
          Nova Tag
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-24 rounded-xl border bg-muted animate-pulse" />
          ))}
        </div>
      ) : tags.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
            <TagIcon className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">Nenhuma tag cadastrada</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            Crie tags para organizar e categorizar seus clientes.
          </p>
          <Button className="mt-4" onClick={openCreateForm}>
            <Plus className="h-4 w-4 mr-2" />
            Nova Tag
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tags.map((tag) => (
            <Card
              key={tag.id}
              className="group hover:shadow-md transition-all duration-200"
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: tag.color + '20' }}
                    >
                      <div
                        className="h-5 w-5 rounded-md"
                        style={{ backgroundColor: tag.color }}
                      />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm">{tag.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        {tag._count.clients} cliente{tag._count.clients !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEditForm(tag)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openDeleteDialog(tag)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>
              {editingTag ? 'Editar Tag' : 'Nova Tag'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tag-name">Nome</Label>
              <Input
                id="tag-name"
                placeholder="Nome da tag"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Cor</Label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="h-8 w-8 rounded-lg transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500"
                    style={{
                      backgroundColor: color,
                      transform: formColor === color ? 'scale(1.15)' : undefined,
                      boxShadow:
                        formColor === color ? `0 0 0 2px ${color}40` : undefined,
                    }}
                    onClick={() => setFormColor(color)}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Label htmlFor="custom-color" className="text-xs text-muted-foreground">
                  Cor personalizada:
                </Label>
                <input
                  id="custom-color"
                  type="color"
                  value={formColor}
                  onChange={(e) => setFormColor(e.target.value)}
                  className="h-8 w-8 rounded cursor-pointer"
                />
              </div>
              {/* Preview */}
              <div className="flex items-center gap-2 mt-2 p-2 rounded-lg bg-muted">
                <div
                  className="h-6 w-6 rounded"
                  style={{ backgroundColor: formColor }}
                />
                <Badge
                  variant="secondary"
                  style={{
                    backgroundColor: formColor + '20',
                    color: formColor,
                  }}
                >
                  {formName || 'Pré-visualização'}
                </Badge>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Tag</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir a tag &ldquo;{tagToDelete?.name}&rdquo;?
              Os clientes não serão excluídos, mas perderão esta associação.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
