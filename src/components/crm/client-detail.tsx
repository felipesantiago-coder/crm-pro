'use client';

import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { format, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Phone,
  Mail,
  MapPin,
  Building2,
  Pencil,
  Trash2,
  Plus,
  Bell,
  Check,
  AlertTriangle,
  Clock,
  RefreshCw,
  MessageCircle,
  PhoneCall,
} from 'lucide-react';
import { getWhatsAppUrl, getPhoneCallUrl } from '@/lib/phone-utils';
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

interface ClientDetail {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  region: string | null;
  enterprise: string | null;
  enterpriseId?: string | null;
  linkedEnterprise?: {
    id: string;
    name: string;
    region: string | null;
    imageUrl: string | null;
  } | null;
  notes: string | null;
  updatePeriod: number;
  lastInteractionAt: string | null;
  createdAt: string;
  updatedAt: string;
  tags: Array<{ tagId: string; tag: { id: string; name: string; color: string } }>;
  reminders: Array<{
    id: string;
    title: string;
    description: string | null;
    dueDate: string;
    notified: boolean;
    createdAt: string;
  }>;
}

interface ClientDetailProps {
  clientId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (clientId: string) => void;
  onRefresh: () => void;
}

function needsUpdate(lastInteractionAt: string | null, createdAt: string, updatePeriod: number): boolean {
  const referenceDate = lastInteractionAt ? new Date(lastInteractionAt) : new Date(createdAt);
  const dueDate = new Date(referenceDate);
  dueDate.setDate(dueDate.getDate() + updatePeriod);
  return dueDate <= new Date();
}

function daysUntilUpdate(lastInteractionAt: string | null, createdAt: string, updatePeriod: number): number {
  const referenceDate = lastInteractionAt ? new Date(lastInteractionAt) : new Date(createdAt);
  const dueDate = new Date(referenceDate);
  dueDate.setDate(dueDate.getDate() + updatePeriod);
  return differenceInDays(dueDate, new Date());
}

function DetailContent({
  client,
  onEdit,
  onDelete,
  onRecordInteraction,
}: {
  client: ClientDetail;
  onEdit: () => void;
  onDelete: () => void;
  onRecordInteraction: () => void;
}) {
  const period = client.updatePeriod || 30;
  const isOverdue = needsUpdate(client.lastInteractionAt, client.createdAt, period);
  const daysLeft = daysUntilUpdate(client.lastInteractionAt, client.createdAt, period);

  return (
    <div className="space-y-6">
      {/* Client Info */}
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold">{client.name}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Cadastrado em{' '}
              {format(new Date(client.createdAt), "dd 'de' MMMM 'de' yyyy", {
                locale: ptBR,
              })}
            </p>
          </div>
          <div className="flex gap-1 flex-shrink-0">
            <Button variant="outline" size="icon" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={onDelete}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>

        {/* Update Status Card */}
        <div
          className={`p-4 rounded-xl border ${
            isOverdue
              ? 'border-rose-200 bg-rose-50 dark:border-rose-800/50 dark:bg-rose-950/20'
              : daysLeft <= 5
                ? 'border-amber-200 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-950/20'
                : 'border-emerald-200 bg-emerald-50 dark:border-emerald-800/50 dark:bg-emerald-950/20'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                  isOverdue
                    ? 'bg-rose-100 dark:bg-rose-900/30'
                    : daysLeft <= 5
                      ? 'bg-amber-100 dark:bg-amber-900/30'
                      : 'bg-emerald-100 dark:bg-emerald-900/30'
                }`}
              >
                <Clock
                  className={`h-5 w-5 ${
                    isOverdue
                      ? 'text-rose-500'
                      : daysLeft <= 5
                        ? 'text-amber-500'
                        : 'text-emerald-500'
                  }`}
                />
              </div>
              <div>
                <p className="text-sm font-semibold">
                  {isOverdue
                    ? 'Atualização Vencida!'
                    : daysLeft <= 5
                      ? `Atualização em ${daysLeft} dia${daysLeft !== 1 ? 's' : ''}`
                      : `Próxima atualização em ${daysLeft} dia${daysLeft !== 1 ? 's' : ''}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  Período: {period} dias
                  {client.lastInteractionAt && (
                    <span>
                      {' '}
                      &bull; Última interação:{' '}
                      {format(new Date(client.lastInteractionAt), "dd 'de' MMM", {
                        locale: ptBR,
                      })}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              onClick={onRecordInteraction}
              className={
                isOverdue
                  ? 'bg-rose-600 hover:bg-rose-700 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Registrar Interação
            </Button>
          </div>
        </div>

        <Separator />

        {/* Contact Actions + Info */}
        {client.phone && (() => {
          const whatsappUrl = getWhatsAppUrl(client.phone);
          const phoneUrl = getPhoneCallUrl(client.phone);
          return (whatsappUrl || phoneUrl) ? (
            <div className="flex gap-2">
              {whatsappUrl && (
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1"
                >
                  <Button
                    className="w-full h-11 gap-2 bg-green-500 hover:bg-green-600 text-white border-green-500"
                  >
                    <MessageCircle className="h-4 w-4" />
                    WhatsApp
                  </Button>
                </a>
              )}
              {phoneUrl && (
                <a
                  href={phoneUrl}
                  className="flex-1"
                >
                  <Button
                    variant="outline"
                    className="w-full h-11 gap-2 border-blue-200 dark:border-blue-800/50 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                  >
                    <PhoneCall className="h-4 w-4" />
                    Ligar
                  </Button>
                </a>
              )}
            </div>
          ) : null;
        })()}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {client.phone && (
            <div className="flex items-center gap-3 text-sm">
              <div className="h-9 w-9 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center">
                <Phone className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Telefone</p>
                <p className="font-medium">{client.phone}</p>
              </div>
            </div>
          )}
          {client.email && (
            <div className="flex items-center gap-3 text-sm">
              <div className="h-9 w-9 rounded-lg bg-teal-50 dark:bg-teal-950/30 flex items-center justify-center">
                <Mail className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Email</p>
                <p className="font-medium">{client.email}</p>
              </div>
            </div>
          )}
          {client.region && (
            <div className="flex items-center gap-3 text-sm">
              <div className="h-9 w-9 rounded-lg bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center">
                <MapPin className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Região</p>
                <p className="font-medium">{client.region}</p>
              </div>
            </div>
          )}
          {(client.enterprise || client.linkedEnterprise) && (
            <div className="flex items-center gap-3 text-sm">
              <div className="h-9 w-9 rounded-lg overflow-hidden flex-shrink-0 bg-cyan-50 dark:bg-cyan-950/30">
                {client.linkedEnterprise?.imageUrl ? (
                  <img
                    src={client.linkedEnterprise.imageUrl}
                    alt={client.linkedEnterprise.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center">
                    <Building2 className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                  </div>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Empreendimento</p>
                <p className="font-medium">
                  {client.linkedEnterprise?.name || client.enterprise}
                </p>
                {client.linkedEnterprise?.region && (
                  <p className="text-xs text-muted-foreground">
                    {client.linkedEnterprise.region}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {client.tags.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {client.tags.map((ct) => (
                <Badge
                  key={ct.tag.id}
                  variant="secondary"
                  style={{
                    backgroundColor: ct.tag.color + '20',
                    color: ct.tag.color,
                    borderColor: ct.tag.color + '40',
                  }}
                >
                  {ct.tag.name}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {client.notes && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Observações</p>
            <p className="text-sm bg-muted rounded-lg p-3 whitespace-pre-wrap">
              {client.notes}
            </p>
          </div>
        )}
      </div>

      {/* Reminders Section */}
      <div>
        <Separator className="mb-4" />
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Bell className="h-4 w-4 text-emerald-500" />
            Lembretes
          </h3>
        </div>

        {client.reminders.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6 bg-muted/50 rounded-lg">
            Nenhum lembrete cadastrado
          </p>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {client.reminders.map((reminder) => {
              const isRemOverdue =
                new Date(reminder.dueDate) < new Date() && !reminder.notified;
              return (
                <div
                  key={reminder.id}
                  className={`p-3 rounded-lg border ${
                    isRemOverdue
                      ? 'border-rose-200 bg-rose-50/50 dark:border-rose-800/50 dark:bg-rose-950/20'
                      : reminder.notified
                        ? 'border-muted bg-muted/30'
                        : 'border-border'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {isRemOverdue ? (
                          <AlertTriangle className="h-3.5 w-3.5 text-rose-500 flex-shrink-0" />
                        ) : reminder.notified ? (
                          <Check className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                        ) : (
                          <Bell className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        )}
                        <p className="text-sm font-medium truncate">{reminder.title}</p>
                      </div>
                      {reminder.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {reminder.description}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span
                        className={`text-xs font-medium ${
                          isRemOverdue
                            ? 'text-rose-500'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {format(new Date(reminder.dueDate), 'dd/MM/yy')}
                      </span>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] ${
                          isRemOverdue
                            ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400'
                            : reminder.notified
                              ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
                              : ''
                        }`}
                      >
                        {isRemOverdue
                          ? 'Atrasado'
                          : reminder.notified
                            ? 'Concluído'
                            : 'Pendente'}
                      </Badge>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function ClientDetail({
  clientId,
  open,
  onOpenChange,
  onEdit,
  onRefresh,
}: ClientDetailProps) {
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (clientId && open) {
      fetchClient();
    } else {
      setClient(null);
    }
  }, [clientId, open]);

  async function fetchClient() {
    if (!clientId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/clients/${clientId}`);
      if (res.ok) {
        const data = await res.json();
        setClient(data);
      }
    } catch (err) {
      console.error('Error fetching client:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleRecordInteraction() {
    if (!clientId) return;
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
      });
      if (res.ok) {
        toast.success('Interação registrada com sucesso!');
        fetchClient();
        onRefresh();
      }
    } catch {
      toast.error('Erro ao registrar interação');
    }
  }

  async function handleDelete() {
    if (!clientId) return;
    try {
      const res = await fetch(`/api/clients/${clientId}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Cliente excluído com sucesso!');
        setDeleteOpen(false);
        onOpenChange(false);
        onRefresh();
      } else {
        throw new Error('Erro ao excluir cliente');
      }
    } catch (err) {
      toast.error('Erro ao excluir cliente');
    }
  }

  const content = loading ? (
    <div className="flex items-center justify-center py-12">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
    </div>
  ) : client ? (
    <DetailContent
      client={client}
      onEdit={() => {
        onOpenChange(false);
        onEdit(client.id);
      }}
      onDelete={() => setDeleteOpen(true)}
      onRecordInteraction={handleRecordInteraction}
    />
  ) : null;

  return (
    <>
      {/* Desktop: Dialog */}
      <div className="hidden md:block">
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="sm:max-w-[550px] max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Detalhes do Cliente</DialogTitle>
            </DialogHeader>
            {content}
          </DialogContent>
        </Dialog>
      </div>

      {/* Mobile: Sheet */}
      <div className="md:hidden">
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
            <SheetTitle>Detalhes do Cliente</SheetTitle>
            {content}
          </SheetContent>
        </Sheet>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Cliente</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir <strong>{client?.name}</strong>? Esta ação
              não pode ser desfeita. Todos os lembretes associados também serão excluídos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
