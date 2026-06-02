'use client';

import React, { useEffect, useState } from 'react';
import {
  Users,
  UserPlus,
  Bell,
  BellRing,
  TrendingUp,
  Calendar,
  AlertTriangle,
  Clock,
  RefreshCw,
  MessageCircle,
  PhoneCall,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getWhatsAppUrl, getPhoneCallUrl } from '@/lib/phone-utils';
import { format, differenceInDays } from 'date-fns';
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

export function DashboardView() {
  const [totalClients, setTotalClients] = useState(0);
  const [clientsThisMonth, setClientsThisMonth] = useState(0);
  const [totalReminders, setTotalReminders] = useState(0);
  const [pendingReminders, setPendingReminders] = useState(0);
  const [recentClients, setRecentClients] = useState<ClientSummary[]>([]);
  const [upcomingReminders, setUpcomingReminders] = useState<ReminderSummary[]>([]);
  const [needsUpdateClients, setNeedsUpdateClients] = useState<NeedsUpdateClient[]>([]);
  const [loading, setLoading] = useState(true);
  const { setCurrentView } = useCRMStore();

  useEffect(() => {
    async function loadDashboard() {
      try {
        const [clientsRes, remindersRes, needsUpdateRes] = await Promise.all([
          fetch('/api/clients?page=1&limit=5'),
          fetch('/api/reminders'),
          fetch('/api/clients?needsUpdate=true&limit=10'),
        ]);

        const clientsData = await clientsRes.json();
        const remindersData = await remindersRes.json();
        const needsUpdateData = await needsUpdateRes.json();

        const total = clientsData.total || 0;
        setTotalClients(total);

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

        setNeedsUpdateClients(needsUpdateData.clients || []);

        const allReminders: ReminderSummary[] = remindersData || [];
        setTotalReminders(allReminders.length);
        setPendingReminders(allReminders.filter((r) => !r.notified).length);

        const now = new Date();
        const upcoming = allReminders
          .filter((r) => !r.notified && new Date(r.dueDate) >= now)
          .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
          .slice(0, 5);
        setUpcomingReminders(upcoming);

        // Calculate clients this month
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthClients = (clientsData.clients || []).filter(
          (c: ClientSummary) => new Date(c.createdAt) >= startOfMonth
        ).length;
        setClientsThisMonth(monthClients);
      } catch (err) {
        console.error('Error loading dashboard:', err);
      } finally {
        setLoading(false);
      }
    }
    loadDashboard();
  }, []);

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
      title: 'Lembretes Pendentes',
      value: pendingReminders,
      icon: <BellRing className="h-5 w-5" />,
      accent: 'from-amber-500 to-orange-600',
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
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Visão geral do seu CRM
        </p>
      </div>

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
                <span>Atualizado agora</span>
              </div>
            </CardContent>
          </Card>
        ))}
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
                      <Badge className="text-[10px] bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400">
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
                      >
                        <RefreshCw className="h-3 w-3 mr-1" />
                        Registrar
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

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
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
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
    </div>
  );
}
