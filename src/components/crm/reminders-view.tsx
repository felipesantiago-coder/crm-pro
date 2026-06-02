'use client';

import React, { useEffect, useState } from 'react';
import {
  Plus,
  Bell,
  Check,
  Trash2,
  AlertTriangle,
  Filter,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { toast } from 'sonner';
import { format, isPast } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Loader2 } from 'lucide-react';

interface ReminderItem {
  id: string;
  title: string;
  description: string | null;
  dueDate: string;
  notified: boolean;
  createdAt: string;
  client: { id: string; name: string };
}

interface ClientOption {
  id: string;
  name: string;
}

type FilterType = 'all' | 'pending' | 'completed';

export function RemindersView() {
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reminderToDelete, setReminderToDelete] = useState<ReminderItem | null>(null);

  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formClientId, setFormClientId] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const [remindersRes, clientsRes] = await Promise.all([
        fetch('/api/reminders'),
        fetch('/api/clients?limit=1000'),
      ]);
      const remindersData = await remindersRes.json();
      const clientsData = await clientsRes.json();

      setReminders(remindersData || []);
      setClients(
        (clientsData.clients || []).map((c: ClientOption) => ({
          id: c.id,
          name: c.name,
        }))
      );
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  }

  function openCreateForm() {
    setFormTitle('');
    setFormDescription('');
    setFormDueDate('');
    setFormClientId('');
    setFormOpen(true);
  }

  async function handleCreate() {
    if (!formTitle.trim()) {
      toast.error('Título é obrigatório');
      return;
    }
    if (!formDueDate) {
      toast.error('Data de vencimento é obrigatória');
      return;
    }
    if (!formClientId) {
      toast.error('Selecione um cliente');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formTitle.trim(),
          description: formDescription.trim() || null,
          dueDate: formDueDate,
          clientId: formClientId,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Erro ao criar lembrete');
      }

      toast.success('Lembrete criado com sucesso!');
      setFormOpen(false);
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar lembrete');
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkDone(reminder: ReminderItem) {
    try {
      const res = await fetch(`/api/reminders/${reminder.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notified: true }),
      });

      if (res.ok) {
        toast.success('Lembrete marcado como concluído!');
        fetchData();
      }
    } catch {
      toast.error('Erro ao atualizar lembrete');
    }
  }

  function openDeleteDialog(reminder: ReminderItem) {
    setReminderToDelete(reminder);
    setDeleteOpen(true);
  }

  async function handleDelete() {
    if (!reminderToDelete) return;
    try {
      const res = await fetch(`/api/reminders/${reminderToDelete.id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast.success('Lembrete excluído com sucesso!');
        setDeleteOpen(false);
        setReminderToDelete(null);
        fetchData();
      }
    } catch {
      toast.error('Erro ao excluir lembrete');
    }
  }

  const filteredReminders = reminders.filter((r) => {
    if (filter === 'pending') return !r.notified;
    if (filter === 'completed') return r.notified;
    return true;
  });

  const pendingCount = reminders.filter((r) => !r.notified).length;
  const overdueCount = reminders.filter(
    (r) => !r.notified && isPast(new Date(r.dueDate))
  ).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Lembretes</h1>
          <p className="text-muted-foreground mt-1">
            {reminders.length} lembrete{reminders.length !== 1 ? 's' : ''} no total
            {pendingCount > 0 && (
              <span className="text-emerald-600 dark:text-emerald-400">
                {' '}
                &bull; {pendingCount} pendente{pendingCount !== 1 ? 's' : ''}
              </span>
            )}
            {overdueCount > 0 && (
              <span className="text-rose-500">
                {' '}
                &bull; {overdueCount} atrasado{overdueCount !== 1 ? 's' : ''}
              </span>
            )}
          </p>
        </div>
        <Button size="sm" onClick={openCreateForm}>
          <Plus className="h-4 w-4 mr-2" />
          Novo Lembrete
        </Button>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <div className="flex gap-1">
          {[
            { value: 'all' as FilterType, label: 'Todos' },
            { value: 'pending' as FilterType, label: 'Pendentes' },
            { value: 'completed' as FilterType, label: 'Concluídos' },
          ].map((f) => (
            <Button
              key={f.value}
              variant={filter === f.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter(f.value)}
              className={
                filter === f.value
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : ''
              }
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Reminders List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-24 rounded-xl border bg-muted animate-pulse" />
          ))}
        </div>
      ) : filteredReminders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
            <Bell className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">Nenhum lembrete encontrado</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            {filter === 'all'
              ? 'Crie lembretes para acompanhar compromissos com seus clientes.'
              : filter === 'pending'
                ? 'Todos os lembretes foram concluídos!'
                : 'Nenhum lembrete concluído ainda.'}
          </p>
          <Button className="mt-4" onClick={openCreateForm}>
            <Plus className="h-4 w-4 mr-2" />
            Novo Lembrete
          </Button>
        </div>
      ) : (
        <div className="space-y-3 max-h-[calc(100vh-320px)] overflow-y-auto pr-1">
          {filteredReminders.map((reminder) => {
            const isOverdue =
              !reminder.notified && isPast(new Date(reminder.dueDate));

            return (
              <Card
                key={reminder.id}
                className={`group hover:shadow-md transition-all duration-200 ${
                  isOverdue
                    ? 'border-rose-200 dark:border-rose-800/50'
                    : ''
                }`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div
                      className={`h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        isOverdue
                          ? 'bg-rose-100 dark:bg-rose-900/30'
                          : reminder.notified
                            ? 'bg-emerald-100 dark:bg-emerald-900/30'
                            : 'bg-amber-100 dark:bg-amber-900/30'
                      }`}
                    >
                      {isOverdue ? (
                        <AlertTriangle className="h-5 w-5 text-rose-500" />
                      ) : reminder.notified ? (
                        <Check className="h-5 w-5 text-emerald-500" />
                      ) : (
                        <Bell className="h-5 w-5 text-amber-500" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h3
                            className={`font-semibold text-sm ${
                              reminder.notified
                                ? 'line-through text-muted-foreground'
                                : ''
                            }`}
                          >
                            {reminder.title}
                          </h3>
                          {reminder.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                              {reminder.description}
                            </p>
                          )}
                        </div>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] flex-shrink-0 ${
                            isOverdue
                              ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400'
                              : reminder.notified
                                ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
                                : 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
                          }`}
                        >
                          {isOverdue
                            ? 'Atrasado'
                            : reminder.notified
                              ? 'Concluído'
                              : 'Pendente'}
                        </Badge>
                      </div>

                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground/70">
                            {reminder.client.name}
                          </span>
                          <span>&bull;</span>
                          <span
                            className={
                              isOverdue ? 'text-rose-500 font-medium' : ''
                            }
                          >
                            {format(new Date(reminder.dueDate), "dd 'de' MMM, yyyy", {
                              locale: ptBR,
                            })}
                          </span>
                        </div>

                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {!reminder.notified && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleMarkDone(reminder)}
                            >
                              <Check className="h-3.5 w-3.5 text-emerald-500" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => openDeleteDialog(reminder)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Novo Lembrete</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reminder-title">
                Título <span className="text-destructive">*</span>
              </Label>
              <Input
                id="reminder-title"
                placeholder="Título do lembrete"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reminder-desc">Descrição</Label>
              <Textarea
                id="reminder-desc"
                placeholder="Detalhes do lembrete..."
                rows={3}
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="reminder-date">
                  Data <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="reminder-date"
                  type="date"
                  value={formDueDate}
                  onChange={(e) => setFormDueDate(e.target.value)}
                  onFocus={(e) => e.target.showPicker?.()}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reminder-client">
                  Cliente <span className="text-destructive">*</span>
                </Label>
                <Select value={formClientId} onValueChange={setFormClientId}>
                  <SelectTrigger id="reminder-client">
                    <SelectValue placeholder="Selecionar cliente" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Criar Lembrete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Lembrete</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o lembrete &ldquo;{reminderToDelete?.title}
              &rdquo;? Esta ação não pode ser desfeita.
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
