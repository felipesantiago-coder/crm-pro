'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Building2,
  MapPin,
  Mail,
  Phone,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  CalendarClock,
  Shield,
  Loader2,
  CalendarDays,
  History,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { toast } from 'sonner';
import { format, isPast, isToday, isTomorrow, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

interface ClientData {
  name: string;
  phone: string | null;
  email: string | null;
  region: string | null;
  enterprise: string | null;
  stage: string;
  registeredSince: string;
}

interface ScheduleData {
  id: string;
  date: string;
  time: string;
  description: string | null;
  status?: string;
  completedAt?: string | null;
  createdBy: string;
}

interface PortalData {
  client: ClientData;
  pendingSchedules: ScheduleData[];
  pastSchedules: ScheduleData[];
}

function getScheduleStatusLabel(status: string, dateStr: string): {
  label: string;
  color: string;
} {
  const date = parseISO(dateStr);
  if (status === 'COMPLETED') return { label: 'Concluída', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' };
  if (status === 'CANCELLED') return { label: 'Cancelada', color: 'bg-gray-100 text-gray-500 dark:bg-gray-800/40 dark:text-gray-400' };
  if (isPast(date) && status === 'PENDING') return { label: 'Atrasada', color: 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400' };
  if (isToday(date)) return { label: 'Hoje', color: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' };
  if (isTomorrow(date)) return { label: 'Amanhã', color: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' };
  return { label: 'Agendada', color: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' };
}

function PortalContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('t');
  const clientId = searchParams.get('c');

  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // Reschedule dialog
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleForm, setRescheduleForm] = useState({ date: '', time: '' });
  const [rescheduling, setRescheduling] = useState(false);

  const loadPortal = useCallback(async () => {
    if (!token || !clientId) {
      setError('Link inválido. Verifique se o link foi copiado corretamente.');
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/portal/verify?t=${encodeURIComponent(token)}&c=${encodeURIComponent(clientId)}`
      );
      const json = await res.json();
      if (res.ok) {
        setData(json);
      } else {
        setError(json.error || 'Erro ao carregar dados.');
      }
    } catch {
      setError('Erro de conexão. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }, [token, clientId]);

  useEffect(() => {
    loadPortal();
  }, [loadPortal]);

  function openReschedule(schedule: ScheduleData) {
    const today = format(new Date(), 'yyyy-MM-dd');
    setRescheduleForm({
      date: schedule.date.split('T')[0] < today ? today : schedule.date.split('T')[0],
      time: schedule.time,
    });
    setRescheduleId(schedule.id);
  }

  async function handleReschedule() {
    if (!rescheduleId || !rescheduleForm.date || !rescheduleForm.time || !token || !clientId) return;
    setRescheduling(true);
    try {
      const res = await fetch('/api/portal/reschedule', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          clientId,
          scheduleId: rescheduleId,
          newDate: rescheduleForm.date,
          newTime: rescheduleForm.time,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success('Visita reagendada com sucesso!');
        setRescheduleId(null);
        loadPortal();
      } else {
        toast.error(json.error || 'Erro ao reagendar.');
      }
    } catch {
      toast.error('Erro de conexão.');
    } finally {
      setRescheduling(false);
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto mb-4 animate-pulse">
            <Calendar className="h-7 w-7 text-white" />
          </div>
          <p className="text-sm text-muted-foreground">Carregando seu portal...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex items-center justify-center p-4">
        <Card className="max-w-md w-full border-rose-200 dark:border-rose-800/50">
          <CardContent className="p-8 text-center">
            <div className="h-14 w-14 rounded-2xl bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="h-7 w-7 text-rose-500" />
            </div>
            <h2 className="text-lg font-bold">Acesso Indisponível</h2>
            <p className="text-sm text-muted-foreground mt-2">
              {error || 'Não foi possível carregar seus dados.'}
            </p>
            <p className="text-xs text-muted-foreground mt-4">
              Se o problema persistir, entre em contato com sua equipe.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { client, pendingSchedules, pastSchedules } = data;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      {/* Header */}
      <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-sm">
              <Calendar className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold leading-tight">Meu Portal</h1>
              <p className="text-[10px] text-muted-foreground">Área do Cliente</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Shield className="h-3.5 w-3.5" />
            <span>Acesso seguro</span>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {/* Client info card */}
        <Card className="overflow-hidden">
          <div className="bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-4">
            <h2 className="text-lg font-bold text-white">Olá, {client.name}!</h2>
            <p className="text-emerald-100 text-xs mt-0.5">
              {client.stage} {client.enterprise && `· ${client.enterprise}`}
            </p>
          </div>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {client.region && (
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>{client.region}</span>
                </div>
              )}
              {client.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{client.phone}</span>
                </div>
              )}
              {client.email && (
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{client.email}</span>
                </div>
              )}
              {client.enterprise && (
                <div className="flex items-center gap-2 text-sm">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{client.enterprise}</span>
                </div>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Cliente desde {format(new Date(client.registeredSince), 'MMMM yyyy', { locale: ptBR })}
            </p>
          </CardContent>
        </Card>

        {/* Pending schedules */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-blue-500" />
                Próximas Visitas
              </h3>
              {pendingSchedules.length > 0 && (
                <Badge className="bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 text-[10px]">
                  {pendingSchedules.length}
                </Badge>
              )}
            </div>

            {pendingSchedules.length === 0 ? (
              <div className="text-center py-6">
                <Calendar className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Nenhuma visita agendada</p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Quando uma visita for agendada, ela aparecerá aqui.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {pendingSchedules.map((schedule) => {
                  const date = parseISO(schedule.date);
                  const statusInfo = getScheduleStatusLabel('PENDING', schedule.date);
                  const isOverdue = isPast(date) && !isToday(date);

                  return (
                    <div
                      key={schedule.id}
                      className={`p-3 rounded-lg border transition-all ${
                        isOverdue
                          ? 'border-rose-200 dark:border-rose-800/50 bg-rose-50/50 dark:bg-rose-950/10'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 flex flex-col items-center justify-center w-12 h-12 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
                            <span className="text-[10px] font-medium uppercase text-muted-foreground leading-none">
                              {format(date, 'MMM', { locale: ptBR })}
                            </span>
                            <span className="text-lg font-bold leading-tight">
                              {format(date, 'dd')}
                            </span>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <Badge className={`text-[10px] h-5 px-1.5 ${statusInfo.color}`}>
                                {statusInfo.label}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                              <Clock className="h-3 w-3" />
                              <span>{schedule.time}</span>
                              <span className="text-muted-foreground/40">&bull;</span>
                              <span>{format(date, "EEEE, dd 'de' MMMM", { locale: ptBR })}</span>
                            </div>
                            {schedule.description && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {schedule.description}
                              </p>
                            )}
                            <p className="text-[10px] text-muted-foreground/60 mt-1">
                              Agendado por {schedule.createdBy}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Reschedule button */}
                      {!isOverdue && (
                        <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                            onClick={() => openReschedule(schedule)}
                          >
                            <Pencil className="h-3 w-3 mr-1" />
                            Reagendar
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Past schedules (collapsible) */}
        {pastSchedules.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="w-full flex items-center justify-between"
              >
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <History className="h-4 w-4 text-muted-foreground" />
                  Histórico de Visitas
                </h3>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">
                    {pastSchedules.length}
                  </Badge>
                  {showHistory ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </button>

              {showHistory && (
                <div className="mt-3 space-y-2">
                  {pastSchedules.map((schedule) => {
                    const statusInfo = getScheduleStatusLabel(
                      schedule.status || 'PENDING',
                      schedule.date
                    );
                    const statusIcon =
                      schedule.status === 'COMPLETED' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      ) : schedule.status === 'CANCELLED' ? (
                        <XCircle className="h-3.5 w-3.5 text-gray-400" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
                      );

                    return (
                      <div
                        key={schedule.id}
                        className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-50/50 dark:bg-slate-900/50"
                      >
                        <div className="flex-shrink-0">{statusIcon}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">
                              {format(parseISO(schedule.date), "dd/MM/yyyy", { locale: ptBR })}
                            </span>
                            <span className="text-xs text-muted-foreground">{schedule.time}</span>
                            <Badge className={`text-[9px] h-4 px-1 ${statusInfo.color}`}>
                              {statusInfo.label}
                            </Badge>
                          </div>
                          {schedule.description && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              {schedule.description}
                            </p>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">
                          {schedule.createdBy}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Footer note */}
        <p className="text-center text-[10px] text-muted-foreground/50 pb-6">
          Portal do Cliente · CRM Pro
        </p>
      </main>

      {/* Reschedule Dialog */}
      <Dialog open={!!rescheduleId} onOpenChange={(open) => { if (!open) setRescheduleId(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-blue-500" />
              Reagendar Visita
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Escolha a nova data e horário para sua visita. A equipe será notificada automaticamente.
            </p>
            <div className="space-y-2">
              <Label htmlFor="portal-date">Nova Data</Label>
              <Input
                id="portal-date"
                type="date"
                min={format(new Date(), 'yyyy-MM-dd')}
                value={rescheduleForm.date}
                onChange={(e) => setRescheduleForm((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="portal-time">Horário</Label>
              <Input
                id="portal-time"
                type="time"
                value={rescheduleForm.time}
                onChange={(e) => setRescheduleForm((f) => ({ ...f, time: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setRescheduleId(null)}>
              Cancelar
            </Button>
            <Button
              onClick={handleReschedule}
              disabled={rescheduling || !rescheduleForm.date || !rescheduleForm.time}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {rescheduling ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Reagendando...</>
              ) : (
                <><Check className="h-4 w-4 mr-2" /> Confirmar</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function PortalPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex items-center justify-center">
          <div className="text-center">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto mb-4 animate-pulse">
              <Calendar className="h-7 w-7 text-white" />
            </div>
            <p className="text-sm text-muted-foreground">Carregando...</p>
          </div>
        </div>
      }
    >
      <PortalContent />
    </Suspense>
  );
}