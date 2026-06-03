'use client';

import React, { useEffect, useState, useRef } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { toast } from 'sonner';
import { format, differenceInDays, isToday, isYesterday, isThisYear, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Phone,
  Mail,
  MapPin,
  Building2,
  Pencil,
  Trash2,
  Bell,
  Check,
  AlertTriangle,
  Clock,
  Send,
  MessageCircle,
  PhoneCall,
  CalendarDays,
  CalendarPlus,
  CalendarCheck,
  CalendarX,
  User,
  StickyNote,
  MessageSquare,
  History,
  Loader2,
  X,
  Users,
  UserPlus,
  Search,
  Crown,
  ShieldCheck,
  ChevronRight,
  Trophy,
  Ban,
  Target,
  FileText,
  Handshake,
  Eye,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useSession } from 'next-auth/react';

interface Interaction {
  id: string;
  description: string;
  createdAt: string;
}

interface Schedule {
  id: string;
  scheduledDate: string;
  scheduledTime: string;
  description: string | null;
  status: string;
  completedAt: string | null;
  createdBy: string;
  createdAt: string;
  creator?: { id: string; name: string } | null;
}

interface Partner {
  id: string;
  clientId: string;
  userId: string;
  addedBy: string;
  createdAt: string;
  user: { id: string; name: string; email: string };
  addedByUser: { id: string; name: string; email: string };
}

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
  stage: string;
  lastInteractionAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  creator?: { id: string; name: string; email: string } | null;
  tags: Array<{ tagId: string; tag: { id: string; name: string; color: string } }>;
  interactions: Interaction[];
  schedules: Schedule[];
  partners: Partner[];
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

interface UserOption {
  id: string;
  name: string;
  email: string;
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

function formatInteractionDate(dateStr: string): string {
  const date = new Date(dateStr);
  const time = format(date, 'HH:mm');

  if (isToday(date)) {
    return `Hoje, ${time}`;
  }
  if (isYesterday(date)) {
    return `Ontem, ${time}`;
  }
  if (isThisYear(date)) {
    return format(date, "dd 'de' MMMM, HH:mm", { locale: ptBR });
  }
  return format(date, "dd 'de' MMMM 'de' yyyy, HH:mm", { locale: ptBR });
}

function formatTimelineDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isToday(date)) return 'Hoje';
  if (isYesterday(date)) return 'Ontem';
  if (isThisYear(date)) return format(date, "dd 'de' MMMM", { locale: ptBR });
  return format(date, "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
}

const STAGES = [
  { value: 'LEAD', label: 'Lead', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800/50 dark:text-slate-300', icon: Target, borderColor: 'border-slate-200 dark:border-slate-700/50' },
  { value: 'PROSPECT', label: 'Prospect', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300', icon: Eye, borderColor: 'border-blue-200 dark:border-blue-800/50' },
  { value: 'VISITA_AGENDADA', label: 'Visita Agendada', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', icon: CalendarDays, borderColor: 'border-amber-200 dark:border-amber-800/50' },
  { value: 'VISITA_REALIZADA', label: 'Visita Realizada', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300', icon: CalendarCheck, borderColor: 'border-emerald-200 dark:border-emerald-800/50' },
  { value: 'CARTA_PROPOSTA', label: 'Carta Proposta', color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300', icon: FileText, borderColor: 'border-violet-200 dark:border-violet-800/50' },
  { value: 'CONTRATO_GERADO', label: 'Contrato Gerado', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300', icon: Handshake, borderColor: 'border-indigo-200 dark:border-indigo-800/50' },
  { value: 'FECHADO_GANHO', label: 'Fechado e Ganho', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300', icon: Trophy, borderColor: 'border-green-200 dark:border-green-800/50' },
  { value: 'FECHADO_PERDIDO', label: 'Fechado e Perdido', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300', icon: Ban, borderColor: 'border-rose-200 dark:border-rose-800/50' },
];

function getStageInfo(stageValue: string) {
  return STAGES.find((s) => s.value === stageValue) || STAGES[0];
}

function DetailContent({
  client,
  onEdit,
  onDelete,
  onSubmitInteraction,
  onDeleteInteraction,
  submitting,
  onRefresh,
}: {
  client: ClientDetail;
  onEdit: () => void;
  onDelete: () => void;
  onSubmitInteraction: (description: string) => void;
  onDeleteInteraction: (interactionId: string) => void;
  submitting: boolean;
  onRefresh: () => void;
}) {
  const { data: session } = useSession();
  const [interactionText, setInteractionText] = useState('');
  const [partners, setPartners] = useState<Partner[]>(client.partners || []);
  const [partnerDialogOpen, setPartnerDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingPartner, setAddingPartner] = useState<string | null>(null);
  const [removingPartner, setRemovingPartner] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState(client.stage || 'LEAD');
  const [updatingStage, setUpdatingStage] = useState(false);

  // Schedule state
  const [schedules, setSchedules] = useState<Schedule[]>(client.schedules || []);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState<Date | undefined>(undefined);
  const [scheduleTime, setScheduleTime] = useState('10:00');
  const [scheduleDescription, setScheduleDescription] = useState('');
  const [creatingSchedule, setCreatingSchedule] = useState(false);
  const [updatingScheduleStatus, setUpdatingScheduleStatus] = useState<string | null>(null);
  const [deletingSchedule, setDeletingSchedule] = useState<string | null>(null);
  const period = client.updatePeriod || 30;
  const isOverdue = needsUpdate(client.lastInteractionAt, client.createdAt, period);
  const daysLeft = daysUntilUpdate(client.lastInteractionAt, client.createdAt, period);

  const whatsappUrl = client.phone ? getWhatsAppUrl(client.phone) : null;
  const phoneUrl = client.phone ? getPhoneCallUrl(client.phone) : null;
  const currentUserId = (session?.user as { id?: string })?.id;
  const isCreator = currentUserId === client.createdBy;

  // Sync stage from client prop
  useEffect(() => {
    setCurrentStage(client.stage || 'LEAD');
  }, [client.stage]);

  // Sync schedules from client prop
  useEffect(() => {
    setSchedules(client.schedules || []);
  }, [client.schedules]);

  const handleSubmit = () => {
    const trimmed = interactionText.trim();
    if (!trimmed) {
      toast.error('Escreva uma descrição da interação antes de registrar');
      return;
    }
    onSubmitInteraction(trimmed);
    setInteractionText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Group interactions by date
  const groupedInteractions: { date: string; items: Interaction[] }[] = [];
  let currentGroup: { date: string; items: Interaction[] } | null = null;

  client.interactions.forEach((interaction) => {
    const dateKey = formatTimelineDate(interaction.createdAt);
    if (!currentGroup || currentGroup.date !== dateKey) {
      currentGroup = { date: dateKey, items: [] };
      groupedInteractions.push(currentGroup);
    }
    currentGroup.items.push(interaction);
  });

  // --- Stage Management ---
  async function updateStage(newStage: string) {
    setUpdatingStage(true);
    try {
      const res = await fetch(`/api/clients/${client.id}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: newStage }),
      });
      if (res.ok) {
        setCurrentStage(newStage);
        toast.success(`Etapa atualizada para: ${getStageInfo(newStage).label}`);
        onRefresh();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Erro ao atualizar etapa');
      }
    } catch {
      toast.error('Erro ao atualizar etapa');
    } finally {
      setUpdatingStage(false);
    }
  }

  // --- Schedule Management ---
  async function fetchSchedules() {
    try {
      const res = await fetch(`/api/clients/${client.id}/schedules`);
      if (res.ok) {
        const data = await res.json();
        setSchedules(data);
      }
    } catch {
      // silently fail
    }
  }

  async function createSchedule() {
    if (!scheduleDate || !scheduleTime) {
      toast.error('Selecione uma data e horário para o agendamento');
      return;
    }
    setCreatingSchedule(true);
    try {
      const dateStr = format(scheduleDate, 'yyyy-MM-dd');
      const res = await fetch(`/api/clients/${client.id}/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledDate: dateStr, scheduledTime: scheduleTime, description: scheduleDescription.trim() || null }),
      });
      if (res.ok) {
        toast.success('Visita agendada com sucesso!');
        setScheduleDialogOpen(false);
        setScheduleDate(undefined);
        setScheduleTime('10:00');
        setScheduleDescription('');
        fetchSchedules();
        onRefresh();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Erro ao criar agendamento');
      }
    } catch {
      toast.error('Erro ao criar agendamento');
    } finally {
      setCreatingSchedule(false);
    }
  }

  async function confirmSchedule(scheduleId: string) {
    setUpdatingScheduleStatus(scheduleId);
    try {
      const res = await fetch(`/api/clients/${client.id}/schedules`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduleId, status: 'COMPLETED' }),
      });
      if (res.ok) {
        toast.success('Visita confirmada como realizada!');
        fetchSchedules();
        onRefresh();
      } else {
        toast.error('Erro ao confirmar visita');
      }
    } catch {
      toast.error('Erro ao confirmar visita');
    } finally {
      setUpdatingScheduleStatus(null);
    }
  }

  async function cancelSchedule(scheduleId: string) {
    setUpdatingScheduleStatus(scheduleId);
    try {
      const res = await fetch(`/api/clients/${client.id}/schedules`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduleId, status: 'CANCELLED' }),
      });
      if (res.ok) {
        toast.success('Agendamento cancelado');
        fetchSchedules();
        onRefresh();
      } else {
        toast.error('Erro ao cancelar agendamento');
      }
    } catch {
      toast.error('Erro ao cancelar agendamento');
    } finally {
      setUpdatingScheduleStatus(null);
    }
  }

  async function deleteSchedule(scheduleId: string) {
    setDeletingSchedule(scheduleId);
    try {
      const res = await fetch(`/api/clients/${client.id}/schedules`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduleId }),
      });
      if (res.ok) {
        toast.success('Agendamento removido');
        fetchSchedules();
        onRefresh();
      } else {
        toast.error('Erro ao remover agendamento');
      }
    } catch {
      toast.error('Erro ao remover agendamento');
    } finally {
      setDeletingSchedule(null);
    }
  }

  // --- Partner Management ---

  async function fetchPartners() {
    try {
      const res = await fetch(`/api/clients/${client.id}/partners`);
      if (res.ok) {
        const data = await res.json();
        setPartners(data);
      }
    } catch {
      // Silently fail — partners might not exist in DB yet
    }
  }

  async function searchUsers(query: string) {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        // Filter out users who are already partners or the creator
        const partnerIds = partners.map((p) => p.userId);
        const filtered = data.filter(
          (u: UserOption) => u.id !== client.createdBy && !partnerIds.includes(u.id)
        );
        setSearchResults(filtered);
      }
    } catch {
      toast.error('Erro ao buscar usuários');
    } finally {
      setSearching(false);
    }
  }

  async function addPartner(userId: string) {
    setAddingPartner(userId);
    try {
      const res = await fetch(`/api/clients/${client.id}/partners`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (res.ok) {
        toast.success('Parceiro adicionado com sucesso!');
        fetchPartners();
        onRefresh();
        setSearchResults((prev) => prev.filter((u) => u.id !== userId));
      } else {
        const data = await res.json();
        toast.error(data.error || 'Erro ao adicionar parceiro');
      }
    } catch {
      toast.error('Erro ao adicionar parceiro');
    } finally {
      setAddingPartner(null);
    }
  }

  async function removePartner(userId: string) {
    setRemovingPartner(userId);
    try {
      const res = await fetch(`/api/clients/${client.id}/partners`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (res.ok) {
        toast.success('Parceiro removido');
        fetchPartners();
        onRefresh();
      } else {
        toast.error('Erro ao remover parceiro');
      }
    } catch {
      toast.error('Erro ao remover parceiro');
    } finally {
      setRemovingPartner(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header with gradient */}
      <div className="bg-gradient-to-br from-emerald-500 to-teal-600 -mx-6 -mt-2 first:-mt-2 px-5 pt-4 pb-5 rounded-b-2xl">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-white/30 backdrop-blur-sm flex items-center justify-center flex-shrink-0 ring-2 ring-white/20 dark:bg-white/15 dark:ring-white/10">
                <User className="h-6 w-6 text-white" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-white truncate drop-shadow-sm">{client.name}</h2>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <CalendarDays className="h-3 w-3 text-white/90" />
                  <p className="text-xs text-white/90">
                    Cliente desde {format(new Date(client.createdAt), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <Button size="sm" onClick={onEdit} className="bg-white text-emerald-700 hover:bg-emerald-50 border-0 shadow-sm h-9 text-xs font-semibold dark:bg-white/15 dark:text-white dark:hover:bg-white/25 dark:backdrop-blur-sm dark:border dark:border-white/20 dark:shadow-none">
            <Pencil className="h-3.5 w-3.5 mr-1.5" />
            Editar
          </Button>
          <Button size="sm" onClick={onDelete} variant="destructive" className="bg-white text-rose-600 hover:bg-rose-50 border-0 shadow-sm h-9 text-xs font-semibold dark:bg-rose-500/25 dark:text-rose-100 dark:hover:bg-rose-500/40 dark:backdrop-blur-sm dark:border dark:border-rose-400/30 dark:shadow-none">
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Excluir
          </Button>
          <div className="flex items-center gap-2 ml-auto">
            {whatsappUrl && (
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="inline-flex">
                <Button size="sm" className="bg-[#25D366] hover:bg-[#1ebe5a] text-white border-0 shadow-sm h-9 text-xs font-semibold dark:shadow-none">
                  <MessageCircle className="h-3.5 w-3.5 mr-1.5" />
                  WhatsApp
                </Button>
              </a>
            )}
            {phoneUrl && (
              <a href={phoneUrl} className="inline-flex">
                <Button size="sm" className="bg-white text-teal-700 hover:bg-teal-50 border-0 shadow-sm h-9 text-xs font-semibold dark:bg-white/15 dark:text-white dark:hover:bg-white/25 dark:backdrop-blur-sm dark:border dark:border-white/20 dark:shadow-none">
                  <PhoneCall className="h-3.5 w-3.5 mr-1.5" />
                  Ligar
                </Button>
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Update Status Card */}
      <div className={`p-4 rounded-xl border ${
        isOverdue
          ? 'border-rose-200 bg-rose-50 dark:border-rose-800/50 dark:bg-rose-950/20'
          : daysLeft <= 5
            ? 'border-amber-200 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-950/20'
            : 'border-emerald-200 bg-emerald-50 dark:border-emerald-800/50 dark:bg-emerald-950/20'
      }`}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
              isOverdue ? 'bg-rose-100 dark:bg-rose-900/30' : daysLeft <= 5 ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-emerald-100 dark:bg-emerald-900/30'
            }`}>
              <Clock className={`h-5 w-5 ${isOverdue ? 'text-rose-500' : daysLeft <= 5 ? 'text-amber-500' : 'text-emerald-500'}`} />
            </div>
            <div>
              <p className="text-sm font-semibold">
                {isOverdue
                  ? 'Acompanhamento Vencido!'
                  : daysLeft <= 5
                    ? `Atualização em ${daysLeft} dia${daysLeft !== 1 ? 's' : ''}`
                    : `Próxima atualização em ${daysLeft} dia${daysLeft !== 1 ? 's' : ''}`}
              </p>
              <p className="text-xs text-muted-foreground">
                Período: {period} dias
                {client.lastInteractionAt && (
                  <span> &bull; Última: {format(new Date(client.lastInteractionAt), "dd 'de' MMM", { locale: ptBR })}</span>
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Pipeline Stage */}
      <div className="space-y-3">
        <Separator />
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Target className="h-3.5 w-3.5 text-emerald-500" />
            Etapa de Atendimento
          </h3>
        </div>
        <div className="p-4 rounded-xl border bg-card space-y-3">
          {/* Current stage badge */}
          <div className="flex items-center gap-3">
            {(() => {
              const stageInfo = getStageInfo(currentStage);
              const StageIcon = stageInfo.icon;
              return (
                <div className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg ${stageInfo.color} ${stageInfo.borderColor} border`}>
                  <StageIcon className="h-4.5 w-4.5" />
                  <span className="text-sm font-semibold">{stageInfo.label}</span>
                  {updatingStage && <Loader2 className="h-3.5 w-3.5 animate-spin ml-1" />}
                </div>
              );
            })()}
          </div>

          {/* Stage pipeline */}
          <div className="flex flex-wrap gap-1.5">
            {STAGES.map((stage) => {
              const isActive = currentStage === stage.value;
              const StageIcon = stage.icon;
              const currentIndex = STAGES.findIndex((s) => s.value === currentStage);
              const stageIndex = STAGES.findIndex((s) => s.value === stage.value);
              const isPast = stageIndex < currentIndex;

              return (
                <button
                  key={stage.value}
                  onClick={() => updateStage(stage.value)}
                  disabled={updatingStage || isActive}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-all duration-200 ${
                    isActive
                      ? `${stage.color} ${stage.borderColor} ring-2 ring-offset-1 ring-emerald-500/30 dark:ring-offset-background`
                      : isPast
                        ? `${stage.color} ${stage.borderColor} opacity-60 hover:opacity-100`
                        : `bg-card border-border hover:border-emerald-300 dark:hover:border-emerald-700 text-muted-foreground hover:text-foreground`
                  }`}
                  title={stage.label}
                >
                  <StageIcon className="h-3 w-3 flex-shrink-0" />
                  <span className="hidden sm:inline">{stage.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Schedules Section */}
      <div className="space-y-3">
        <Separator />
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 text-emerald-500" />
            Agendamentos ({schedules.filter((s) => s.status === 'PENDING').length} pendente{schedules.filter((s) => s.status === 'PENDING').length !== 1 ? 's' : ''})
          </h3>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setScheduleDialogOpen(true);
              setScheduleDate(undefined);
              setScheduleTime('10:00');
              setScheduleDescription('');
            }}
            className="h-7 text-xs gap-1"
          >
            <CalendarPlus className="h-3 w-3" />
            Agendar Visita
          </Button>
        </div>

        {schedules.length === 0 ? (
          <div className="text-center py-8 bg-muted/40 rounded-xl border border-dashed">
            <CalendarDays className="h-7 w-7 text-muted-foreground/30 mx-auto mb-1.5" />
            <p className="text-xs text-muted-foreground">Nenhum agendamento</p>
            <p className="text-[11px] text-muted-foreground/70 mt-0.5">
              Clique em "Agendar Visita" para criar um novo agendamento
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {schedules.map((schedule) => {
              const scheduleDate = parseISO(schedule.scheduledDate);
              const isPending = schedule.status === 'PENDING';
              const isCompleted = schedule.status === 'COMPLETED';
              const isCancelled = schedule.status === 'CANCELLED';
              const isPast = isPending && scheduleDate < new Date();

              return (
                <div
                  key={schedule.id}
                  className={`p-3.5 rounded-xl border group ${
                    isCompleted
                      ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-800/50 dark:bg-emerald-950/20'
                      : isCancelled
                        ? 'border-gray-200 bg-gray-50/50 dark:border-gray-800/50 dark:bg-gray-950/20 opacity-60'
                        : isPast
                          ? 'border-rose-200 bg-rose-50/50 dark:border-rose-800/50 dark:bg-rose-950/20'
                          : 'border-amber-200 bg-amber-50/50 dark:border-amber-800/50 dark:bg-amber-950/20'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {isCompleted ? (
                          <CalendarCheck className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                        ) : isCancelled ? (
                          <CalendarX className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                        ) : isPast ? (
                          <AlertTriangle className="h-3.5 w-3.5 text-rose-500 flex-shrink-0" />
                        ) : (
                          <CalendarDays className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                        )}
                        <p className="text-sm font-medium truncate">
                          {format(scheduleDate, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                        </p>
                        <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 flex-shrink-0 ${
                          isCompleted
                            ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : isCancelled
                              ? 'bg-gray-100 text-gray-600 dark:bg-gray-900/30 dark:text-gray-400'
                              : isPast
                                ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400'
                                : 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
                        }`}>
                          {schedule.scheduledTime}
                        </Badge>
                      </div>
                      {schedule.description && (
                        <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">{schedule.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1.5">
                        <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${
                          isCompleted
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : isCancelled
                              ? 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400'
                              : isPast
                                ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                                : ''
                        }`}>
                          {isCompleted ? 'Realizada' : isCancelled ? 'Cancelada' : isPast ? 'Atrasada' : 'Pendente'}
                        </Badge>
                        {schedule.creator && (
                          <span className="text-[10px] text-muted-foreground">por {schedule.creator.name}</span>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {isPending && (
                        <button
                          onClick={() => confirmSchedule(schedule.id)}
                          disabled={updatingScheduleStatus === schedule.id}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-emerald-100 hover:text-emerald-600 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-400"
                          title="Confirmar visita realizada"
                        >
                          {updatingScheduleStatus === schedule.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                      {isPending && (
                        <button
                          onClick={() => cancelSchedule(schedule.id)}
                          disabled={updatingScheduleStatus === schedule.id}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-amber-100 hover:text-amber-600 dark:hover:bg-amber-900/30 dark:hover:text-amber-400"
                          title="Cancelar agendamento"
                        >
                          <CalendarX className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => deleteSchedule(schedule.id)}
                        disabled={deletingSchedule === schedule.id}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-destructive/10 hover:text-destructive"
                        title="Remover agendamento"
                      >
                        {deletingSchedule === schedule.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Schedule Dialog (Calendar) */}
      <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarPlus className="h-5 w-5 text-emerald-500" />
              Agendar Visita
            </DialogTitle>
            <DialogDescription>
              Selecione a data e horário para o agendamento da visita ao cliente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Data *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={`w-full justify-start text-left font-normal ${!scheduleDate && 'text-muted-foreground'}`}
                  >
                    <CalendarDays className="mr-2 h-4 w-4" />
                    {scheduleDate ? format(scheduleDate, "dd 'de' MMMM 'de' yyyy", { locale: ptBR }) : 'Selecionar data'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={scheduleDate}
                    onSelect={setScheduleDate}
                    locale={ptBR}
                    disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Horário *</Label>
              <Input
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Observações</Label>
              <Textarea
                placeholder="Observações sobre a visita (opcional)..."
                value={scheduleDescription}
                onChange={(e) => setScheduleDescription(e.target.value)}
                className="min-h-[80px] resize-y text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleDialogOpen(false)} disabled={creatingSchedule}>
              Cancelar
            </Button>
            <Button
              onClick={createSchedule}
              disabled={!scheduleDate || !scheduleTime || creatingSchedule}
              className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold"
            >
              {creatingSchedule ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Agendando...
                </>
              ) : (
                <>
                  <CalendarPlus className="h-4 w-4 mr-2" />
                  Agendar
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Partners Section */}
      <div className="space-y-3">
        <Separator />
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-emerald-500" />
            Equipe ({1 + partners.length})
          </h3>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setPartnerDialogOpen(true);
              setSearchQuery('');
              setSearchResults([]);
            }}
            className="h-7 text-xs gap-1"
          >
            <UserPlus className="h-3 w-3" />
            Adicionar Parceiro
          </Button>
        </div>

        <div className="space-y-2">
          {/* Creator */}
          <div className="flex items-center gap-3 p-3 rounded-xl border bg-card">
            <div className="h-9 w-9 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
              <Crown className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium truncate">
                  {client.creator?.name || 'Desconhecido'}
                </p>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                  Criador
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground truncate">{client.creator?.email || ''}</p>
            </div>
          </div>

          {/* Partners */}
          {partners.length === 0 ? (
            <div className="text-center py-6 bg-muted/40 rounded-xl border border-dashed">
              <Users className="h-7 w-7 text-muted-foreground/30 mx-auto mb-1.5" />
              <p className="text-xs text-muted-foreground">Nenhum parceiro vinculado</p>
              <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                Adicione parceiros para compartilhar o acompanhamento deste cliente
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {partners.map((partner) => (
                <div key={partner.id} className="flex items-center gap-3 p-3 rounded-xl border bg-card group">
                  <div className="h-9 w-9 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center flex-shrink-0">
                    <ShieldCheck className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium truncate">{partner.user.name}</p>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400">
                        Parceiro
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{partner.user.email}</p>
                  </div>
                  <button
                    onClick={() => removePartner(partner.userId)}
                    disabled={removingPartner === partner.userId}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-destructive/10 hover:text-destructive"
                    title="Remover parceiro"
                  >
                    {removingPartner === partner.userId ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Record Interaction Section */}
      <div className="space-y-3">
        <Separator />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5 text-emerald-500" />
          Registrar Interação
        </h3>
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <Textarea
            placeholder="Descreva o acompanhamento realizado com o cliente (ex: Ligação feita, cliente demonstrou interesse no empreendimento X, agendou visita para o dia Y...)"
            value={interactionText}
            onChange={(e) => setInteractionText(e.target.value)}
            onKeyDown={handleKeyDown}
            className="min-h-[100px] resize-y text-sm leading-relaxed"
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Ctrl+Enter para enviar rapidamente
            </p>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={submitting || !interactionText.trim()}
              className={
                isOverdue
                  ? 'bg-rose-600 hover:bg-rose-700 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Registrando...
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                  Registrar Interação
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Interaction Timeline */}
      <div className="space-y-3">
        <Separator />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <History className="h-3.5 w-3.5 text-emerald-500" />
          Histórico de Interações ({client.interactions.length})
        </h3>

        {groupedInteractions.length === 0 ? (
          <div className="text-center py-10 bg-muted/40 rounded-xl border border-dashed">
            <History className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Nenhuma interação registrada</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Use o campo acima para registrar o primeiro acompanhamento
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {groupedInteractions.map((group) => (
              <div key={group.date}>
                {/* Date header */}
                <div className="flex items-center gap-3 mb-2.5">
                  <div className="h-6 w-6 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                    <CalendarDays className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <p className="text-xs font-semibold text-muted-foreground">{group.date}</p>
                  <div className="flex-1 h-px bg-border" />
                </div>

                {/* Timeline items */}
                <div className="relative ml-3 border-l-2 border-emerald-200 dark:border-emerald-800/50 pl-5 space-y-3">
                  {group.items.map((interaction, idx) => {
                    const interactionDate = new Date(interaction.createdAt);
                    return (
                      <div key={interaction.id} className="relative group">
                        {/* Timeline dot */}
                        <div className="absolute -left-[22px] top-3 h-3 w-3 rounded-full bg-emerald-500 border-2 border-background ring-2 ring-emerald-200 dark:ring-emerald-800/50" />

                        <div className="bg-card rounded-xl border p-3.5 hover:shadow-sm transition-shadow">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 mb-1.5">
                              <MessageSquare className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                              <span className="text-xs font-medium text-muted-foreground">
                                {format(interactionDate, 'HH:mm')}
                              </span>
                            </div>
                            <button
                              onClick={() => onDeleteInteraction(interaction.id)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-destructive/10 hover:text-destructive"
                              title="Excluir interação"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <p className="text-sm leading-relaxed whitespace-pre-wrap">{interaction.description}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Contact Info */}
      <div className="space-y-3">
        <Separator />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Informações de Contato</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {client.phone && (
            <div className="flex items-center gap-3 p-3 rounded-xl border bg-card">
              <div className="h-10 w-10 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center flex-shrink-0">
                <Phone className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Telefone</p>
                <p className="text-sm font-medium truncate">{client.phone}</p>
              </div>
            </div>
          )}
          {client.email && (
            <div className="flex items-center gap-3 p-3 rounded-xl border bg-card">
              <div className="h-10 w-10 rounded-lg bg-teal-50 dark:bg-teal-950/30 flex items-center justify-center flex-shrink-0">
                <Mail className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Email</p>
                <p className="text-sm font-medium truncate">{client.email}</p>
              </div>
            </div>
          )}
          {client.region && (
            <div className="flex items-center gap-3 p-3 rounded-xl border bg-card">
              <div className="h-10 w-10 rounded-lg bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center flex-shrink-0">
                <MapPin className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Região</p>
                <p className="text-sm font-medium truncate">{client.region}</p>
              </div>
            </div>
          )}
          {(client.enterprise || client.linkedEnterprise) && (
            <div className="flex items-center gap-3 p-3 rounded-xl border bg-card">
              <div className="h-10 w-10 rounded-lg overflow-hidden flex-shrink-0 bg-cyan-50 dark:bg-cyan-950/30">
                {client.linkedEnterprise?.imageUrl ? (
                  <img src={client.linkedEnterprise.imageUrl} alt={client.linkedEnterprise.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center">
                    <Building2 className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Empreendimento</p>
                <p className="text-sm font-medium truncate">{client.linkedEnterprise?.name || client.enterprise}</p>
                {client.linkedEnterprise?.region && (
                  <p className="text-xs text-muted-foreground">{client.linkedEnterprise.region}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tags */}
      {client.tags.length > 0 && (
        <div className="space-y-2">
          <Separator />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tags</h3>
          <div className="flex flex-wrap gap-1.5">
            {client.tags.map((ct) => (
              <Badge key={ct.tag.id} variant="secondary" className="text-xs px-2.5 py-1"
                style={{ backgroundColor: ct.tag.color + '20', color: ct.tag.color, borderColor: ct.tag.color + '40' }}>
                {ct.tag.name}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {client.notes && (
        <div className="space-y-2">
          <Separator />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <StickyNote className="h-3 w-3" />
            Observações Gerais
          </h3>
          <div className="bg-muted/60 rounded-xl p-4 border">
            <p className="text-sm whitespace-pre-wrap leading-relaxed">{client.notes}</p>
          </div>
        </div>
      )}

      {/* Reminders */}
      <div className="space-y-3">
        <Separator />
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Bell className="h-3.5 w-3.5 text-emerald-500" />
            Lembretes ({client.reminders.length})
          </h3>
        </div>
        {client.reminders.length === 0 ? (
          <div className="text-center py-8 bg-muted/40 rounded-xl border border-dashed">
            <Bell className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Nenhum lembrete cadastrado</p>
          </div>
        ) : (
          <div className="space-y-2">
            {client.reminders.map((reminder) => {
              const isRemOverdue = new Date(reminder.dueDate) < new Date() && !reminder.notified;
              return (
                <div key={reminder.id} className={`p-3.5 rounded-xl border ${
                  isRemOverdue
                    ? 'border-rose-200 bg-rose-50/50 dark:border-rose-800/50 dark:bg-rose-950/20'
                    : reminder.notified
                      ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-800/50 dark:bg-emerald-950/20'
                      : 'border-border bg-card'
                }`}>
                  <div className="flex items-start justify-between gap-3">
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
                        <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">{reminder.description}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <span className={`text-xs font-medium ${isRemOverdue ? 'text-rose-500' : 'text-muted-foreground'}`}>
                        {format(new Date(reminder.dueDate), 'dd/MM/yy')}
                      </span>
                      <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${
                        isRemOverdue
                          ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400'
                          : reminder.notified
                            ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : ''
                      }`}>
                        {isRemOverdue ? 'Atrasado' : reminder.notified ? 'Concluído' : 'Pendente'}
                      </Badge>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Partner Dialog */}
      <Dialog open={partnerDialogOpen} onOpenChange={setPartnerDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-emerald-500" />
              Adicionar Parceiro
            </DialogTitle>
            <DialogDescription>
              Busque um usuário cadastrado para adicionar como parceiro de acompanhamento deste cliente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome ou email..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  searchUsers(e.target.value);
                }}
                className="pl-9"
              />
            </div>

            {searching && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-emerald-500" />
              </div>
            )}

            {!searching && searchQuery && searchResults.length === 0 && (
              <div className="text-center py-6">
                <p className="text-sm text-muted-foreground">Nenhum usuário encontrado</p>
              </div>
            )}

            {!searching && searchResults.length > 0 && (
              <div className="space-y-2 max-h-[240px] overflow-y-auto">
                {searchResults.map((user) => (
                  <div key={user.id} className="flex items-center gap-3 p-2.5 rounded-lg border hover:bg-muted/50 transition-colors">
                    <div className="h-8 w-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                      <User className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{user.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => addPartner(user.id)}
                      disabled={addingPartner === user.id}
                      className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      {addingPartner === user.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        'Adicionar'
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {!searching && !searchQuery && (
              <div className="text-center py-6">
                <p className="text-sm text-muted-foreground">Digite para buscar usuários cadastrados</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
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
  const [submitting, setSubmitting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  async function handleSubmitInteraction(description: string) {
    if (!clientId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/interactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      if (res.ok) {
        toast.success('Interação registrada com sucesso!');
        fetchClient();
        onRefresh();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Erro ao registrar interação');
      }
    } catch {
      toast.error('Erro ao registrar interação');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteInteraction(interactionId: string) {
    if (!clientId) return;
    try {
      const res = await fetch(`/api/clients/${clientId}/interactions`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interactionId }),
      });
      if (res.ok) {
        toast.success('Interação excluída');
        fetchClient();
      } else {
        toast.error('Erro ao excluir interação');
      }
    } catch {
      toast.error('Erro ao excluir interação');
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
    } catch {
      toast.error('Erro ao excluir cliente');
    }
  }

  const content = loading ? (
    <div className="flex items-center justify-center py-20">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
        <p className="text-sm text-muted-foreground">Carregando...</p>
      </div>
    </div>
  ) : client ? (
    <DetailContent
      client={client}
      onEdit={() => { onOpenChange(false); onEdit(client.id); }}
      onDelete={() => setDeleteOpen(true)}
      onSubmitInteraction={handleSubmitInteraction}
      onDeleteInteraction={handleDeleteInteraction}
      submitting={submitting}
      onRefresh={onRefresh}
    />
  ) : null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-[560px] lg:max-w-[620px] p-0 flex flex-col"
        >
          <SheetHeader className="px-6 pt-5 pb-3 flex-shrink-0">
            <SheetTitle>Detalhes do Cliente</SheetTitle>
            <SheetDescription>Visualize e gerencie as informações do cliente</SheetDescription>
          </SheetHeader>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 pb-8">
            {content}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Cliente</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir <strong>{client?.name}</strong>? Esta ação
              não pode ser desfeita. Todos os lembretes e interações associados também serão excluídos.
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
