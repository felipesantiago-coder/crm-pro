'use client';

import React, { useEffect, useState, useMemo } from 'react';
import {
  Users,
  UserPlus,
  Bell,
  BellRing,
  TrendingUp,
  Calendar,
  CalendarDays,
  AlertTriangle,
  Clock,
  RefreshCw,
  MessageCircle,
  PhoneCall,
  CheckCircle2,
  XCircle,
  MapPin,
  MoreVertical,
  Pencil,
  Trash2,
  Check,
  Loader2,
  LayoutDashboard,
  Kanban,
  BarChart3,
} from 'lucide-react';
import { KanbanBoard } from './kanban-board';
import { AnalyticsDashboard } from './analytics-dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getWhatsAppUrl, getPhoneCallUrl } from '@/lib/phone-utils';
import { format, differenceInDays, isToday, isTomorrow, isPast, isThisWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useCRMStore } from '@/store/crm-store';
import { toast } from 'sonner';

interface ClientSummary {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
  updatePeriod?: number;
  lastInteractionAt?: string | null;
}

interface ReminderSummary {
  id: string;
  title: string;
  dueDate: string;
  notified: boolean;
  client: { name: string };
}

interface NeedsUpdateClient {
  id: string;
  name: string;
  phone: string | null;
  updatePeriod: number;
  lastInteractionAt: string | null;
  createdAt: string;
}

interface ScheduleItem {
  id: string;
  scheduledDate: string;
  scheduledTime: string;
  description: string | null;
  status: string;
  completedAt: string | null;
  clientId: string;
  createdBy: string;
  createdAt: string;
  client: {
    id: string;
    name: string;
    phone: string | null;
  };
  creatorUser: {
    id: string;
    name: string;
  };
}

function getScheduleStatusConfig(status: string, scheduledDate: string) {
  const now = new Date();
  const date = new Date(scheduledDate);
  const isOverdue = isPast(date) && status === 'PENDING';

  switch (status) {
    case 'COMPLETED':
      return {
        label: 'Concluído',
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
        bgClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
        borderClass: 'border-emerald-100 dark:border-emerald-800/30',
        dotClass: 'bg-emerald-500',
        rowBg: 'bg-emerald-50/30 dark:bg-emerald-950/5',
      };
    case 'CANCELLED':
      return {
        label: 'Cancelado',
        icon: <XCircle className="h-3.5 w-3.5" />,
        bgClass: 'bg-gray-100 text-gray-500 dark:bg-gray-800/40 dark:text-gray-400',
        borderClass: 'border-gray-100 dark:border-gray-800/30',
        dotClass: 'bg-gray-400',
        rowBg: 'bg-gray-50/30 dark:bg-gray-950/5',
      };
    default: // PENDING
      if (isOverdue) {
        return {
          label: 'Atrasado',
          icon: <AlertTriangle className="h-3.5 w-3.5" />,
          bgClass: 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400',
          borderClass: 'border-rose-100 dark:border-rose-800/30',
          dotClass: 'bg-rose-500',
          rowBg: 'bg-rose-50/50 dark:bg-rose-950/10',
        };
      }
      return {
        label: isToday(date) ? 'Hoje' : isTomorrow(date) ? 'Amanhã' : 'Agendado',
        icon: <CalendarDays className="h-3.5 w-3.5" />,
        bgClass: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
        borderClass: 'border-blue-100 dark:border-blue-800/30',
        dotClass: 'bg-blue-500',
        rowBg: 'bg-blue-50/30 dark:bg-blue-950/5',
      };
  }
}

function getRelativeDateLabel(date: Date): string {
  if (isToday(date)) return 'Hoje';
  if (isTomorrow(date)) return 'Amanhã';
  return format(date, "EEE, dd 'de' MMM", { locale: ptBR });
}

export function DashboardView() {
  const [dashboardTab, setDashboardTab] = useState<'default' | 'kanban' | 'analytics'>('default');
  const [totalClients, setTotalClients] = useState(0);
  const [clientsThisMonth, setClientsThisMonth] = useState(0);
  const [totalReminders, setTotalReminders] = useState(0);
  const [pendingReminders, setPendingReminders] = useState(0);
  const [recentClients, setRecentClients] = useState<ClientSummary[]>([]);
  const [upcomingReminders, setUpcomingReminders] = useState<ReminderSummary[]>([]);
  const [needsUpdateClients, setNeedsUpdateClients] = useState<NeedsUpdateClient[]>([]);
  const [allSchedules, setAllSchedules] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [scheduleActionLoading, setScheduleActionLoading] = useState<string | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<ScheduleItem | null>(null);
  const [editForm, setEditForm] = useState({ scheduledDate: '', scheduledTime: '', description: '' });
  const { setCurrentView, setSelectedClientId } = useCRMStore();

  useEffect(() => {
    async function loadDashboard() {
      try {
        const [clientsRes, remindersRes, needsUpdateRes, statsRes, schedulesRes] = await Promise.all([
          fetch('/api/clients?page=1&limit=5'),
          fetch('/api/reminders?limit=50'),
          fetch('/api/clients?needsUpdate=true&limit=10'),
          fetch('/api/clients/stats'),
          fetch('/api/schedules?limit=30'),
        ]);

        const clientsData = await clientsRes.json();
        const remindersData = await remindersRes.json();
        const needsUpdateData = await needsUpdateRes.json();
        const statsData = await statsRes.json();
        const schedulesData = await schedulesRes.json();

        setTotalClients(statsData.total || clientsData.total || 0);
        setClientsThisMonth(statsData.thisMonth || 0);

        setRecentClients(
          (clientsData.clients || []).slice(0, 5).map((c: ClientSummary) => ({
            id: c.id,
            name: c.name,
            email: c.email,
            phone: c.phone,
            createdAt: c.createdAt,
            updatePeriod: c.updatePeriod,
            lastInteractionAt: c.lastInteractionAt,
          }))
        );

        setNeedsUpdateClients(Array.isArray(needsUpdateData.clients) ? needsUpdateData.clients : []);

        const allReminders: ReminderSummary[] = Array.isArray(remindersData.reminders)
          ? remindersData.reminders
          : Array.isArray(remindersData)
            ? remindersData
            : [];
        setTotalReminders(allReminders.length);
        setPendingReminders(allReminders.filter((r) => !r.notified).length);

        const now = new Date();
        const upcoming = allReminders
          .filter((r) => !r.notified && new Date(r.dueDate) >= now)
          .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
          .slice(0, 5);
        setUpcomingReminders(upcoming);

        const schedules = Array.isArray(schedulesData.schedules) ? schedulesData.schedules : [];
        setAllSchedules(schedules);
      } catch (err) {
        console.error('Error loading dashboard:', err);
      } finally {
        setLoading(false);
      }
    }
    loadDashboard();
  }, []);

  // Classify schedules
  const { pastSchedules, futureSchedules, todaySchedules } = useMemo(() => {
    const now = new Date();
    const today = todaySchedules;
    const past: ScheduleItem[] = [];
    const future: ScheduleItem[] = [];
    const todayList: ScheduleItem[] = [];

    for (const s of allSchedules) {
      const date = new Date(s.scheduledDate);
      if (isToday(date)) {
        todayList.push(s);
      } else if (isPast(date)) {
        past.push(s);
      } else {
        future.push(s);
      }
    }

    // Sort: today by time, past newest first, future soonest first
    todayList.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
    past.sort((a, b) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime());
    future.sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime());

    return { pastSchedules: past.slice(0, 5), futureSchedules: future.slice(0, 10), todaySchedules: todayList };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSchedules]);

  const pendingSchedulesCount = allSchedules.filter((s) => s.status === 'PENDING' && !isPast(new Date(s.scheduledDate))).length;
  const overdueSchedulesCount = allSchedules.filter((s) => s.status === 'PENDING' && isPast(new Date(s.scheduledDate))).length;

  async function handleRecordInteraction(clientId: string) {
    try {
      const res = await fetch(`/api/clients/${clientId}`, { method: 'PATCH' });
      if (res.ok) {
        toast.success('Interação registrada!');
        setNeedsUpdateClients((prev) => prev.filter((c) => c.id !== clientId));
      }
    } catch {
      toast.error('Erro ao registrar interação');
    }
  }

  function handleNavigateToClient(clientId: string) {
    setSelectedClientId(clientId);
    setCurrentView('clientDetail');
  }

  async function handleScheduleAction(schedule: ScheduleItem, action: 'complete' | 'cancel' | 'delete') {
    const labels = { complete: 'concluir', cancel: 'cancelar', delete: 'excluir' };
    if (!confirm(`Tem certeza que deseja ${labels[action]} o agendamento de ${schedule.client.name}?`)) return;

    setScheduleActionLoading(schedule.id);
    try {
      if (action === 'delete') {
        const res = await fetch(`/api/clients/${schedule.clientId}/schedules`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheduleId: schedule.id }),
        });
        if (res.ok) {
          toast.success('Agendamento excluído');
          setAllSchedules((prev) => prev.filter((s) => s.id !== schedule.id));
        } else {
          throw new Error();
        }
      } else {
        const status = action === 'complete' ? 'COMPLETED' : 'CANCELLED';
        const res = await fetch(`/api/clients/${schedule.clientId}/schedules`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheduleId: schedule.id, status }),
        });
        if (res.ok) {
          toast.success(action === 'complete' ? 'Agendamento concluído!' : 'Agendamento cancelado');
          // Update locally
          setAllSchedules((prev) =>
            prev.map((s) =>
              s.id === schedule.id
                ? { ...s, status, completedAt: action === 'complete' ? new Date().toISOString() : s.completedAt }
                : s
            )
          );
        } else {
          throw new Error();
        }
      }
    } catch {
      toast.error(`Erro ao ${labels[action]} agendamento`);
    } finally {
      setScheduleActionLoading(null);
    }
  }

  function handleOpenEdit(schedule: ScheduleItem) {
    setEditForm({
      scheduledDate: schedule.scheduledDate.split('T')[0],
      scheduledTime: schedule.scheduledTime,
      description: schedule.description || '',
    });
    setEditingSchedule(schedule);
  }

  async function handleSaveEdit() {
    if (!editingSchedule) return;
    setScheduleActionLoading(editingSchedule.id);
    try {
      const res = await fetch(`/api/clients/${editingSchedule.clientId}/schedules`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId: editingSchedule.id,
          scheduledDate: editForm.scheduledDate,
          scheduledTime: editForm.scheduledTime,
          description: editForm.description || null,
        }),
      });
      if (!res.ok) throw new Error('Erro ao atualizar agendamento');

      toast.success('Agendamento atualizado!');
      setEditingSchedule(null);
      // Update locally
      setAllSchedules((prev) =>
        prev.map((s) =>
          s.id === editingSchedule.id
            ? {
                ...s,
                scheduledDate: editForm.scheduledDate,
                scheduledTime: editForm.scheduledTime,
                description: editForm.description || null,
              }
            : s
        )
      );
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar alterações');
    } finally {
      setScheduleActionLoading(null);
    }
  }

  function getInitials(name: string) {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  function getAvatarColor(name: string) {
    const colors = [
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
      'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
      'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
      'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
      'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
      'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  function getDaysOverdue(client: NeedsUpdateClient): number {
    const ref = client.lastInteractionAt ? new Date(client.lastInteractionAt) : new Date(client.createdAt);
    const due = new Date(ref);
    due.setDate(due.getDate() + (client.updatePeriod || 30));
    return Math.abs(differenceInDays(new Date(), due));
  }

  function renderScheduleRow(schedule: ScheduleItem) {
    const date = new Date(schedule.scheduledDate);
    const config = getScheduleStatusConfig(schedule.status, schedule.scheduledDate);
    const relativeDate = isToday(date) || isTomorrow(date)
      ? getRelativeDateLabel(date)
      : format(date, "dd/MM/yyyy");
    const isPending = schedule.status === 'PENDING';
    const isLoading = scheduleActionLoading === schedule.id;

    return (
      <div
        key={schedule.id}
        className={`flex items-center gap-3 p-3 rounded-lg border ${config.borderClass} ${config.rowBg} transition-all`}
      >
        {/* Date indicator - clickable to navigate */}
        <div
          className="flex-shrink-0 flex flex-col items-center justify-center w-12 h-12 rounded-lg bg-white dark:bg-gray-900 shadow-sm border border-gray-100 dark:border-gray-800 cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => handleNavigateToClient(schedule.clientId)}
          title="Ver cliente"
        >
          <span className="text-[10px] font-medium uppercase text-muted-foreground leading-none">
            {format(date, 'MMM', { locale: ptBR })}
          </span>
          <span className="text-lg font-bold leading-tight">
            {format(date, 'dd')}
          </span>
        </div>

        {/* Info - clickable to navigate */}
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={() => handleNavigateToClient(schedule.clientId)}
        >
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold truncate">{schedule.client.name}</p>
            <Badge className={`text-[10px] h-5 px-1.5 ${config.bgClass}`}>
              {config.icon}
              <span className="ml-1">{config.label}</span>
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
            <Clock className="h-3 w-3" />
            <span>{schedule.scheduledTime}</span>
            <span className="text-muted-foreground/50">&bull;</span>
            <span>{relativeDate}</span>
            {schedule.creatorUser && (
              <>
                <span className="text-muted-foreground/50">&bull;</span>
                <span>por {schedule.creatorUser.name}</span>
              </>
            )}
          </div>
          {schedule.description && (
            <p className="text-xs text-muted-foreground/70 mt-1 truncate">
              {schedule.description}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Contact buttons */}
          {schedule.client.phone && isPending && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="text-[10px] h-7 px-2 border-green-200 dark:border-green-800/50 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/30"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(getWhatsAppUrl(schedule.client.phone ?? '') || undefined, '_blank', 'noopener,noreferrer');
                }}
              >
                <MessageCircle className="h-3 w-3" />
              </Button>
              <a href={getPhoneCallUrl(schedule.client.phone ?? '') || undefined} onClick={(e) => e.stopPropagation()}>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-[10px] h-7 px-2 border-blue-200 dark:border-blue-800/50 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                >
                  <PhoneCall className="h-3 w-3" />
                </Button>
              </a>
            </>
          )}

          {/* Complete button (only pending) */}
          {isPending && (
            <Button
              size="sm"
              variant="outline"
              className="text-[10px] h-7 px-2 border-emerald-200 dark:border-emerald-800/50 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
              disabled={isLoading}
              onClick={(e) => {
                e.stopPropagation();
                handleScheduleAction(schedule, 'complete');
              }}
              title="Concluir"
            >
              {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            </Button>
          )}

          {/* More actions menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="text-[10px] h-7 w-7 p-0"
                onClick={(e) => e.stopPropagation()}
                disabled={isLoading}
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {isPending && (
                <DropdownMenuItem
                  className="text-emerald-600 dark:text-emerald-400"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleScheduleAction(schedule, 'complete');
                  }}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Concluir
                </DropdownMenuItem>
              )}
              {isPending && (
                <DropdownMenuItem
                  className="text-amber-600 dark:text-amber-400"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleScheduleAction(schedule, 'cancel');
                  }}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Cancelar
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenEdit(schedule);
                }}
              >
                <Pencil className="h-4 w-4 mr-2" />
                Editar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-rose-600 dark:text-rose-400"
                onClick={(e) => {
                  e.stopPropagation();
                  handleScheduleAction(schedule, 'delete');
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="h-20 animate-pulse bg-muted rounded-lg" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const kpis = [
    {
      title: 'Total de Clientes',
      value: totalClients,
      icon: <Users className="h-5 w-5" />,
      accent: 'from-emerald-500 to-teal-600',
    },
    {
      title: 'Clientes este Mês',
      value: clientsThisMonth,
      icon: <UserPlus className="h-5 w-5" />,
      accent: 'from-teal-500 to-cyan-600',
    },
    {
      title: 'Visitas Agendadas',
      value: pendingSchedulesCount,
      icon: <CalendarDays className="h-5 w-5" />,
      accent: pendingSchedulesCount > 0 ? 'from-blue-500 to-indigo-600' : 'from-emerald-500 to-teal-600',
      subtitle: overdueSchedulesCount > 0 ? `${overdueSchedulesCount} atrasada${overdueSchedulesCount > 1 ? 's' : ''}` : undefined,
      highlight: overdueSchedulesCount > 0,
    },
    {
      title: 'Precisam de Atualização',
      value: needsUpdateClients.length,
      icon: <AlertTriangle className="h-5 w-5" />,
      accent: needsUpdateClients.length > 0 ? 'from-rose-500 to-pink-600' : 'from-emerald-500 to-teal-600',
      highlight: needsUpdateClients.length > 0,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-20 -mt-4 sm:-mt-5 lg:-mt-6 pt-4 sm:pt-5 lg:pt-6 pb-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Visão geral do seu CRM
          </p>
        </div>
        {/* View toggle tabs */}
        <div className="flex items-center bg-muted rounded-lg p-1 gap-0.5">
          <button
            onClick={() => setDashboardTab('default')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              dashboardTab === 'default'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Visão Geral</span>
          </button>
          <button
            onClick={() => setDashboardTab('kanban')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              dashboardTab === 'kanban'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Kanban className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Pipeline</span>
          </button>
          <button
            onClick={() => setDashboardTab('analytics')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              dashboardTab === 'analytics'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Analytics</span>
          </button>
        </div>
      </div>
      </div>

      {/* Kanban view */}
      {dashboardTab === 'kanban' && <KanbanBoard />}

      {/* Analytics view */}
      {dashboardTab === 'analytics' && <AnalyticsDashboard />}

      {/* Default view */}
      {dashboardTab === 'default' && (
      <>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <Card
            key={kpi.title}
            className={`group hover:shadow-md transition-shadow duration-200 ${
              kpi.highlight ? 'border-rose-200 dark:border-rose-800/50' : ''
            }`}
          >
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    {kpi.title}
                  </p>
                  <p className="text-3xl font-bold mt-2">{kpi.value}</p>
                </div>
                <div
                  className={`h-12 w-12 rounded-xl bg-gradient-to-br ${kpi.accent} flex items-center justify-center shadow-lg`}
                >
                  <span className="text-white">{kpi.icon}</span>
                </div>
              </div>
              <div className="flex items-center mt-3 text-xs text-muted-foreground">
                <TrendingUp className="h-3 w-3 mr-1 text-emerald-500" />
                <span>
                  {kpi.subtitle || `Atualizado às ${format(new Date(), 'HH:mm')}`}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ─── Agendamentos de Hoje ─── */}
      {todaySchedules.length > 0 && (
        <Card className="hover:shadow-md transition-shadow duration-200 border-blue-200 dark:border-blue-800/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <MapPin className="h-4 w-4 text-blue-500" />
              <span className="flex-1">Visitas de Hoje</span>
              <Badge className="bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                {todaySchedules.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <div className="space-y-3">
              {todaySchedules.map((schedule) => renderScheduleRow(schedule))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Agendamentos: Próximos e Passados ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Próximas Visitas */}
        <Card className="hover:shadow-md transition-shadow duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Calendar className="h-4 w-4 text-blue-500" />
                Próximas Visitas
              </CardTitle>
              {futureSchedules.length > 0 && (
                <Badge className="bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                  {futureSchedules.length}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            {futureSchedules.length === 0 ? (
              <div className="text-center py-8">
                <div className="h-12 w-12 rounded-xl bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center mx-auto mb-3">
                  <Calendar className="h-6 w-6 text-blue-400" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">
                  Nenhuma visita agendada
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Os próximos agendamentos aparecerão aqui.
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                {futureSchedules.map((schedule) => renderScheduleRow(schedule))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Visitas Passadas */}
        <Card className="hover:shadow-md transition-shadow duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                Histórico de Visitas
              </CardTitle>
              {pastSchedules.length > 0 && (
                <Badge className="bg-gray-100 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400">
                  {pastSchedules.length}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            {pastSchedules.length === 0 ? (
              <div className="text-center py-8">
                <div className="h-12 w-12 rounded-xl bg-gray-50 dark:bg-gray-900/30 flex items-center justify-center mx-auto mb-3">
                  <Clock className="h-6 w-6 text-gray-400" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">
                  Nenhuma visita realizada ainda
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  As visitas concluídas e canceladas aparecerão aqui.
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                {pastSchedules.map((schedule) => renderScheduleRow(schedule))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Clients Needing Update - Priority Section */}
      <Card className={`hover:shadow-md transition-shadow duration-200 ${needsUpdateClients.length > 0 ? 'border-rose-200 dark:border-rose-800/50' : ''}`}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <AlertTriangle className={`h-4 w-4 ${needsUpdateClients.length > 0 ? 'text-rose-500' : 'text-emerald-500'}`} />
            <span className="flex-1">Clientes que Precisam de Atualização</span>
            {needsUpdateClients.length > 0 && (
              <Badge className="bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400">
                {needsUpdateClients.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-6 pb-6">
          {needsUpdateClients.length === 0 ? (
            <div className="text-center py-6">
              <div className="h-12 w-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center mx-auto mb-3">
                <Clock className="h-6 w-6 text-emerald-500" />
              </div>
              <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                Todos os clientes estão em dia!
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Nenhum cliente precisa de atualização no momento.
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
              {needsUpdateClients.map((client) => {
                const daysOverdue = getDaysOverdue(client);
                return (
                  <div
                    key={client.id}
                    className="flex items-center gap-3 p-3 rounded-lg border border-rose-100 dark:border-rose-800/30 bg-rose-50/50 dark:bg-rose-950/10 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors"
                  >
                    <div
                      className={`h-10 w-10 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${getAvatarColor(client.name)}`}
                    >
                      {getInitials(client.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{client.name}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <Clock className="h-3 w-3" />
                        <span>
                          Vencido há {daysOverdue} dia{daysOverdue !== 1 ? 's' : ''}
                          {client.lastInteractionAt && (
                            <span>
                              {' '}&bull; Última:{' '}
                              {format(new Date(client.lastInteractionAt), 'dd/MM/yy')}
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Badge className="text-[10px] bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400 hidden sm:inline-flex">
                        {client.updatePeriod}d
                      </Badge>
                      {(() => {
                        const waUrl = client.phone ? getWhatsAppUrl(client.phone) : null;
                        const callUrl = client.phone ? getPhoneCallUrl(client.phone) : null;
                        return (waUrl || callUrl) ? (
                          <>
                            {waUrl && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-[10px] h-7 px-2 border-green-200 dark:border-green-800/50 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/30"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  window.open(waUrl, '_blank', 'noopener,noreferrer');
                                }}
                              >
                                <MessageCircle className="h-3 w-3" />
                              </Button>
                            )}
                            {callUrl && (
                              <a href={callUrl} onClick={(e) => e.stopPropagation()}>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-[10px] h-7 px-2 border-blue-200 dark:border-blue-800/50 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                                >
                                  <PhoneCall className="h-3 w-3" />
                                </Button>
                              </a>
                            )}
                          </>
                        ) : null;
                      })()}
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7"
                        onClick={() => handleRecordInteraction(client.id)}
                        title="Registrar interação"
                      >
                        <RefreshCw className="h-3 w-3 sm:mr-1" />
                        <span className="hidden sm:inline">Registrar</span>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Schedule Dialog */}
      {dashboardTab === 'default' && <Dialog open={!!editingSchedule} onOpenChange={(open) => { if (!open) setEditingSchedule(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Agendamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-schedule-date">Data</Label>
              <Input
                id="edit-schedule-date"
                type="date"
                value={editForm.scheduledDate}
                onChange={(e) => setEditForm((f) => ({ ...f, scheduledDate: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-schedule-time">Horário</Label>
              <Input
                id="edit-schedule-time"
                type="time"
                value={editForm.scheduledTime}
                onChange={(e) => setEditForm((f) => ({ ...f, scheduledTime: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-schedule-desc">Observações</Label>
              <Input
                id="edit-schedule-desc"
                type="text"
                placeholder="Ex: Visita ao imóvel na Rua X"
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setEditingSchedule(null)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={scheduleActionLoading === editingSchedule?.id || !editForm.scheduledDate || !editForm.scheduledTime}
            >
              {scheduleActionLoading === editingSchedule?.id ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Salvando...</>
              ) : (
                'Salvar'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}

      {/* Recent Clients & Upcoming Reminders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Clients */}
        <Card className="hover:shadow-md transition-shadow duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Users className="h-4 w-4 text-emerald-500" />
                Clientes Recentes
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => setCurrentView('clients')}
              >
                Ver todos
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            {recentClients.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Nenhum cliente cadastrado ainda
              </p>
            ) : (
              <div className="space-y-3">
                {recentClients.map((client) => (
                  <div
                    key={client.id}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => handleNavigateToClient(client.id)}
                  >
                    <div
                      className={`h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold ${getAvatarColor(client.name)}`}
                    >
                      {getInitials(client.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {client.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {client.email || client.phone || 'Sem contato'}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground flex-shrink-0">
                      {format(new Date(client.createdAt), 'dd/MM/yy')}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Upcoming Reminders */}
        <Card className="hover:shadow-md transition-shadow duration-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Calendar className="h-4 w-4 text-emerald-500" />
                Próximos Lembretes
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => setCurrentView('reminders')}
              >
                Ver todos
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            {upcomingReminders.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Nenhum lembrete pendente
              </p>
            ) : (
              <div className="space-y-3">
                {upcomingReminders.map((reminder) => {
                  const isOverdue = new Date(reminder.dueDate) < new Date();
                  return (
                    <div
                      key={reminder.id}
                      className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div
                        className={`h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                          isOverdue
                            ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400'
                            : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
                        }`}
                      >
                        <Bell className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {reminder.title}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {reminder.client.name}
                        </p>
                      </div>
                      <p
                        className={`text-xs flex-shrink-0 font-medium ${
                          isOverdue
                            ? 'text-rose-500'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {format(new Date(reminder.dueDate), 'dd/MM/yy', {
                          locale: ptBR,
                        })}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      </>
      )}
    </div>
  );
}
