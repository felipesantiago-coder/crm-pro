'use client';

import React, { useEffect, useState } from 'react';
import { Moon, Sun, CheckCircle2, Circle, User, Loader2, Save, CalendarDays, Link2, Unlink, Phone, Send, MessageCircle, Bell, Smartphone, Check, RefreshCw, Plus, X, Clock, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useTheme } from 'next-themes';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';

export function SettingsView() {
  const { theme, setTheme } = useTheme();
  const { data: session, update: updateSession } = useSession();
  const userRole = (session?.user as { role?: string })?.role;
  const isAdmin = userRole === 'ADMIN';

  // Perfil do usuário
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userPhone, setUserPhone] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Google Calendar
  const [gcConnected, setGcConnected] = useState(false);
  const [gcLoading, setGcLoading] = useState(true);
  const [gcConnecting, setGcConnecting] = useState(false);
  const [gcDisconnecting, setGcDisconnecting] = useState(false);

  // Notificações (Telegram)
  const [notifLoading, setNotifLoading] = useState(true);
  const [tgConfigured, setTgConfigured] = useState(false);
  const [tgConnected, setTgConnected] = useState(false);
  const [tgChatId, setTgChatId] = useState('');
  const [tgTesting, setTgTesting] = useState(false);
  const [tgSaving, setTgSaving] = useState(false);

  // Polling automático Meta Leads
  const [pollLoading, setPollLoading] = useState(true);
  const [pollEnabled, setPollEnabled] = useState(false);
  const [pollFormIds, setPollFormIds] = useState<string[]>(['']);
  const [pollSaving, setPollSaving] = useState(false);
  const [pollTriggering, setPollTriggering] = useState(false);
  const [pollLastRun, setPollLastRun] = useState<string | null>(null);
  const [pollLastResult, setPollLastResult] = useState<any>(null);

  useEffect(() => {
    // Verificar status da conexão Google Calendar
    fetch('/api/google-calendar/status')
      .then((r) => r.json())
      .then((data) => setGcConnected(data.connected === true))
      .catch(() => {})
      .finally(() => setGcLoading(false));

    // Verificar status das notificações (Telegram)
    fetch('/api/settings/telegram')
      .then((r) => r.json())
      .then((tgData) => {
        setTgConfigured(tgData.botConfigured === true);
        setTgConnected(tgData.configured === true);
        setTgChatId(tgData.telegramChatId || '');
      })
      .catch(() => {})
      .finally(() => setNotifLoading(false));

    // Carregar configuração do polling Meta Leads (admin only)
    if (isAdmin) {
      fetch('/api/cron/fetch-meta-leads/config')
        .then((r) => {
          if (r.status === 403) return null;
          return r.json();
        })
        .then((data) => {
          if (data) {
            setPollEnabled(data.enabled === true);
            setPollFormIds(data.formIds?.length ? data.formIds : ['']);
            setPollLastRun(data.lastRun || null);
            setPollLastResult(data.lastResult || null);
          }
        })
        .catch(() => {})
        .finally(() => setPollLoading(false));
    } else {
      setPollLoading(false);
    }

    // Verificar feedback de conexão via URL params
    const params = new URLSearchParams(window.location.search);
    if (params.get('google_calendar') === 'connected') {
 setGcConnected(true);
      toast.success('Google Calendar conectado com sucesso!');
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (params.get('google_calendar_error')) {
      const errorMsg = params.get('google_calendar_error');
      toast.error(`Erro ao conectar Google Calendar: ${errorMsg}`);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    // Carregar perfil do usuário logado
    if (session?.user) {
      setUserName(session.user.name || '');
      setUserEmail(session.user.email || '');
      // Carregar phone da API (não fica na sessão)
      fetch('/api/profile')
        .then((r) => r.json())
        .then((data) => { if (data.phone) setUserPhone(data.phone); })
        .catch(() => {});
    }
  }, [session]);

  // Salvar perfil do usuário
  async function saveProfile() {
    if (!userName.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }

    setSavingProfile(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: userName.trim(), phone: userPhone }),
      });

      if (res.ok) {
        toast.success('Perfil atualizado com sucesso!');
        // Atualizar a sessão para refletir o novo nome na sidebar
        await updateSession({ name: userName.trim() });
      } else {
        const data = await res.json();
        throw new Error(data.error || 'Erro ao salvar');
      }
    } catch {
      toast.error('Erro ao atualizar perfil');
    } finally {
      setSavingProfile(false);
    }
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado!`);
  }

  async function connectGoogleCalendar() {
    setGcConnecting(true);
    try {
      window.location.href = '/api/google-calendar/auth';
    } catch {
      toast.error('Erro ao iniciar conexão com Google Calendar');
      setGcConnecting(false);
    }
  }

  async function disconnectGoogleCalendar() {
    setGcDisconnecting(true);
    try {
      const res = await fetch('/api/google-calendar/disconnect', { method: 'POST' });
      if (res.ok) {
        setGcConnected(false);
        toast.success('Google Calendar desconectado');
      } else {
        throw new Error();
      }
    } catch {
      toast.error('Erro ao desconectar Google Calendar');
    } finally {
      setGcDisconnecting(false);
    }
  }

  async function saveTelegramChatId() {
    if (!tgChatId.trim()) {
      toast.error('Insira o Chat ID');
      return;
    }
    setTgSaving(true);
    try {
      const res = await fetch('/api/settings/telegram', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'connect', chatId: tgChatId.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setTgConnected(true);
        toast.success('Telegram vinculado com sucesso!');
      } else {
        toast.error(data.error || 'Erro ao vincular Telegram');
      }
    } catch {
      toast.error('Erro ao vincular Telegram');
    } finally {
      setTgSaving(false);
    }
  }

  async function disconnectTelegram() {
    setTgSaving(true);
    try {
      const res = await fetch('/api/settings/telegram', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disconnect' }),
      });
      if (res.ok) {
        setTgConnected(false);
        setTgChatId('');
        toast.success('Notificações desativadas');
      }
    } catch {
      toast.error('Erro ao desvincular Telegram');
    } finally {
      setTgSaving(false);
    }
  }

  async function testTelegram() {
    setTgTesting(true);
    try {
      const res = await fetch('/api/telegram/test', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || 'Notificação enviada!');
      } else {
        toast.error(data.error || 'Erro ao enviar teste');
      }
    } catch {
      toast.error('Erro ao enviar notificação de teste');
    } finally {
      setTgTesting(false);
    }
  }

  // ── Polling Meta Leads ──
  function addPollFormId() {
    setPollFormIds([...pollFormIds, '']);
  }

  function removePollFormId(index: number) {
    setPollFormIds(pollFormIds.filter((_, i) => i !== index));
  }

  function updatePollFormId(index: number, value: string) {
    const updated = [...pollFormIds];
    updated[index] = value.trim();
    setPollFormIds(updated);
  }

  async function savePollConfig() {
    setPollSaving(true);
    try {
      const validIds = pollFormIds.filter((id) => id.length > 0);
      const res = await fetch('/api/cron/fetch-meta-leads/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: pollEnabled, formIds: validIds }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(pollEnabled ? 'Polling ativado! Leads serão importados a cada 5 minutos.' : 'Polling desativado.');
        // Atualizar formIds com o que foi salvo (sem strings vazias)
        setPollFormIds(validIds.length ? validIds : ['']);
      } else {
        toast.error(data.error || 'Erro ao salvar configuração');
      }
    } catch {
      toast.error('Erro ao salvar configuração do polling');
    } finally {
      setPollSaving(false);
    }
  }

  async function triggerPollNow() {
    setPollTriggering(true);
    try {
      const res = await fetch('/api/cron/fetch-meta-leads');
      const data = await res.json();
      if (res.status === 401) {
        toast.error('Sessão expirada. Faça login novamente.');
      } else if (res.ok) {
        if (data.status === 'disabled') {
          toast.warning('Polling está desativado. Ative primeiro e salve.');
        } else if (data.status === 'idle') {
          toast.info('Nenhum form ID configurado. Adicione ao menos um form ID.');
        } else {
          toast.success(`Polling executado: ${data.totalFetched} encontrados, ${data.totalImported} importados (${data.elapsed}).`);
          // Atualizar resultado exibido
          setPollLastResult(data);
          setPollLastRun(new Date().toISOString());
        }
      } else {
        toast.error(data.error || 'Erro ao executar polling');
      }
    } catch {
      toast.error('Erro ao executar polling manual');
    } finally {
      setPollTriggering(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground mt-1">
          {isAdmin ? 'Gerencie as configurações do sistema e seu perfil' : 'Gerencie seu perfil e preferências'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ==================== PERFIL DO USUÁRIO ==================== */}
        <Card className="hover:shadow-md transition-shadow duration-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <User className="h-4 w-4 text-emerald-500" />
              Meu Perfil
            </CardTitle>
            <CardDescription>
              Altere o nome exibido na barra lateral
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="user-name">Nome</Label>
              <Input
                id="user-name"
                placeholder="Seu nome"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-email">Email</Label>
              <Input
                id="user-email"
                value={userEmail}
                disabled
                className="bg-muted/50"
              />
              <p className="text-xs text-muted-foreground">O email não pode ser alterado</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-phone" className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                Telefone
              </Label>
              <Input
                id="user-phone"
                placeholder="(11) 99999-9999"
                value={userPhone}
                onChange={(e) => setUserPhone(e.target.value)}
                maxLength={20}
              />
              <p className="text-xs text-muted-foreground">Seu número de contato para a equipe</p>
            </div>
            <Button onClick={saveProfile} disabled={savingProfile}>
              {savingProfile ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Salvando...</>
              ) : (
                <><Save className="h-4 w-4 mr-2" /> Salvar Perfil</>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* ==================== TEMA ==================== */}
        <Card className="hover:shadow-md transition-shadow duration-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Sun className="h-4 w-4 text-emerald-500" />
              Tema
            </CardTitle>
            <CardDescription>
              Escolha entre tema claro ou escuro
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Button
                variant={theme === 'light' ? 'default' : 'outline'}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => setTheme('light')}
              >
                <Sun className="h-4 w-4 mr-2" />
                Claro
              </Button>
              <Button
                variant={theme === 'dark' ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => setTheme('dark')}
              >
                <Moon className="h-4 w-4 mr-2" />
                Escuro
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="system-theme"
                checked={theme === 'system'}
                onCheckedChange={(checked) => setTheme(checked ? 'system' : 'light')}
              />
              <Label htmlFor="system-theme" className="text-sm cursor-pointer">
                Usar tema do sistema
              </Label>
            </div>
          </CardContent>
        </Card>

        {/* ==================== GOOGLE CALENDAR ==================== */}
        <Card className={`hover:shadow-md transition-shadow duration-200 ${
          gcConnected
            ? 'border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/50 dark:bg-emerald-950/20'
            : ''
        }`}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-emerald-500" />
              Google Calendar
            </CardTitle>
            <CardDescription>
              Sincronize agendamentos de visita com seu Google Calendar
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {gcLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Verificando conexão...
              </div>
            ) : gcConnected ? (
              <>
                <div className="flex items-center gap-3">
                  <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 gap-1">
                    <Link2 className="h-3 w-3" />
                    Conectado
                  </Badge>
                </div>
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Funcionalidades ativas
                  </h4>
                  <ul className="text-xs text-muted-foreground space-y-2">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                      <span><strong>Criação automática</strong> — Novos agendamentos criam eventos no seu Calendar</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                      <span><strong>Lembretes duplos</strong> — Notificação 24 horas e 2 horas antes (popup + e-mail)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                      <span><strong>Atualização de status</strong> — Cancelar ou concluir visita atualiza o evento no Calendar</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                      <span><strong>Exclusão sincronizada</strong> — Excluir agendamento remove o evento do Calendar</span>
                    </li>
                  </ul>
                </div>
                <Separator />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={disconnectGoogleCalendar}
                  disabled={gcDisconnecting}
                  className="text-destructive hover:text-destructive"
                >
                  {gcDisconnecting ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Desconectando...</>
                  ) : (
                    <><Unlink className="h-4 w-4 mr-2" /> Desconectar Google Calendar</>
                  )}
                </Button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <Badge className="bg-muted text-muted-foreground gap-1">
                    <Unlink className="h-3 w-3" />
                    Não conectado
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Conecte sua conta Google para que os agendamentos de visita sejam automaticamente
                  criados no seu Google Calendar com lembretes configurados.
                </p>
                <Button
                  onClick={connectGoogleCalendar}
                  disabled={gcConnecting}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {gcConnecting ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Conectando...</>
                  ) : (
                    <><Link2 className="h-4 w-4 mr-2" /> Conectar Google Calendar</>
                  )}
                </Button>
                {!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
                  <div className="p-3 rounded-lg bg-amber-100/50 dark:bg-amber-900/20">
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                      As variáveis de ambiente do Google Calendar não estão configuradas.
                      Consulte o tutorial para configurar as credenciais OAuth 2.0.
                    </p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* ==================== NOTIFICAÇÕES DE LEADS ==================== */}
        <Card className={`hover:shadow-md transition-shadow duration-200 col-span-1 lg:col-span-2 ${
          tgConnected
            ? 'border-blue-200 dark:border-blue-800/50 bg-blue-50/30 dark:bg-blue-950/10'
            : ''
        }`}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Bell className="h-4 w-4 text-orange-500" />
                  Notificações de Leads
                </CardTitle>
                <CardDescription className="mt-1">
                  Receba alertas instantâneos no Telegram quando novos leads chegarem
                </CardDescription>
              </div>
              {tgConnected && (
                <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Ativo
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {notifLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
                Verificando...
              </div>
            ) : !tgConfigured ? (
              <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/30">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                    <Circle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">Bot não configurado</p>
                </div>
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  O bot do Telegram não está disponível no momento. Solicite ao administrador que configure o TELEGRAM_BOT_TOKEN.
                </p>
              </div>
            ) : tgConnected ? (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                      <Check className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Telegram conectado</p>
                      <p className="text-[10px] text-muted-foreground">Chat ID: <code className="font-mono">{tgChatId}</code></p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={testTelegram}
                      disabled={tgTesting}
                      className="text-blue-600 border-blue-200 hover:bg-blue-50 dark:text-blue-400 dark:border-blue-800/50 dark:hover:bg-blue-950/30"
                    >
                      {tgTesting ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Enviando...</> : <><Send className="h-4 w-4 mr-1.5" /> Testar</>}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={disconnectTelegram}
                      disabled={tgSaving}
                      className="text-destructive hover:text-destructive"
                    >
                      {tgSaving ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Desativando...</> : <><Unlink className="h-4 w-4 mr-1.5" /> Desativar</>}
                    </Button>
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-blue-50/50 dark:bg-blue-950/10 border border-blue-100 dark:border-blue-900/20">
                  <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-3">O que voce recebera</p>
                  <div className="grid grid-cols-2 gap-2">
                    {['Nome e telefone do lead', 'E-mail do lead', 'Nome do empreendimento', 'Campanha Meta Ads', 'Respostas do formulario'].map((item) => (
                      <div key={item} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CheckCircle2 className="h-3 w-3 text-blue-500 flex-shrink-0" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="tg-chat-id" className="text-sm font-medium">Seu Chat ID</Label>
                  <div className="flex gap-2">
                    <Input
                      id="tg-chat-id"
                      placeholder="Ex: 123456789"
                      value={tgChatId}
                      onChange={(e) => setTgChatId(e.target.value)}
                      className="font-mono text-sm"
                    />
                    <Button
                      onClick={saveTelegramChatId}
                      disabled={tgSaving || !tgChatId.trim()}
                      className="bg-blue-600 hover:bg-blue-700 text-white flex-shrink-0"
                    >
                      {tgSaving ? <><Loader2 className="h-4 w-4 animate-spin" /></> : <><Link2 className="h-4 w-4 mr-1.5" /> Vincular</>}
                    </Button>
                  </div>
                </div>
                <Separator />
                <div className="p-4 rounded-xl bg-muted/30 border border-border/50">
                  <p className="text-sm font-semibold mb-4 flex items-center gap-2">
                    <Smartphone className="h-4 w-4 text-blue-500" />
                    Passo a passo para configurar
                  </p>
                  <div className="space-y-4">
                    <div className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-sm flex-shrink-0">1</div>
                        <div className="w-px flex-1 bg-blue-200 dark:bg-blue-800/40 mt-1" />
                      </div>
                      <div className="pb-4">
                        <p className="text-sm font-medium">Abra o Telegram e busque por <strong>@userinfobot</strong></p>
                        <p className="text-xs text-muted-foreground mt-0.5">Ele e um bot oficial que diz qual e o seu Chat ID</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-sm flex-shrink-0">2</div>
                        <div className="w-px flex-1 bg-blue-200 dark:bg-blue-800/40 mt-1" />
                      </div>
                      <div className="pb-4">
                        <p className="text-sm font-medium">Envie qualquer mensagem para ele</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Pode ser um “oi” — ele respondera automaticamente</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-sm flex-shrink-0">3</div>
                        <div className="w-px flex-1 bg-blue-200 dark:bg-blue-800/40 mt-1" />
                      </div>
                      <div className="pb-4">
                        <p className="text-sm font-medium">Copie o <strong>Chat ID</strong> que ele respondeu</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Sera um numero, por exemplo: <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-[11px]">7123456789</code></p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="w-8 h-8 rounded-full bg-blue-600 dark:bg-blue-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                          <Check className="h-4 w-4" />
                        </div>
                      </div>
                      <div>
                        <p className="text-sm font-medium">Cole o numero acima e clique em <strong>Vincular</strong></p>
                        <p className="text-xs text-muted-foreground mt-0.5">Pronto! Voce recebera todas as notificacoes por aqui</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ==================== POLLING AUTOMÁTICO META LEADS (Admin) ==================== */}
        {isAdmin && (
          <Card className={`hover:shadow-md transition-shadow duration-200 col-span-1 lg:col-span-2 ${
            pollEnabled
              ? 'border-violet-200 dark:border-violet-800/50 bg-violet-50/30 dark:bg-violet-950/10'
              : ''
          }`}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <RefreshCw className={`h-4 w-4 ${pollEnabled ? 'text-violet-500 animate-spin' : 'text-muted-foreground'}`} style={pollEnabled ? { animationDuration: '3s' } : undefined} />
                    Importação Automática de Leads
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Polling da Meta Graph API a cada 5 minutos como alternativa ao webhook
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {pollEnabled && (
                    <Badge className="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Ativo
                    </Badge>
                  )}
                  <Switch
                    checked={pollEnabled}
                    onCheckedChange={setPollEnabled}
                    aria-label="Ativar polling automático"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {pollLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Carregando configuração...
                </div>
              ) : (
                <>
                  {/* Explicação */}
                  <div className="p-4 rounded-xl bg-muted/30 border border-border/50">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Quando o webhook do Meta Ads falhar ou não entregar leads, esta funcionalidade busca
                      automaticamente novos leads nos formulários configurados via Graph API a cada 5 minutos.
                      Os leads são importados com o mesmo pipeline: criação de cliente, atribuição à fila e notificação Telegram.
                      {pollEnabled && ' O Vercel Cron requer plano Pro. No plano Hobby, configure um serviço externo (ex: cron-job.org) para chamar o endpoint.'}
                    </p>
                  </div>

                  {/* Form IDs */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">IDs dos Formulários Meta</Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={addPollFormId}
                        className="text-violet-600 hover:text-violet-700 h-7 px-2"
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Adicionar
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Cole os Form IDs dos formulários de lead do Facebook. Encontre em Meta Business Suite &gt; Formulários de Leads &gt; Configurações.
                    </p>
                    <div className="space-y-2">
                      {pollFormIds.map((formId, index) => (
                        <div key={index} className="flex gap-2 items-center">
                          <Input
                            placeholder={"Ex: 123456789012345"}
                            value={formId}
                            onChange={(e) => updatePollFormId(index, e.target.value)}
                            className="font-mono text-sm"
                            disabled={pollSaving}
                          />
                          {pollFormIds.length > 1 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removePollFormId(index)}
                              disabled={pollSaving}
                              className="text-destructive hover:text-destructive h-9 w-9 flex-shrink-0"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Última execução */}
                  {pollLastRun && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      Última execução: {new Date(pollLastRun).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                      {pollLastResult && (
                        <span className="ml-2">
                          ({pollLastResult.totalFetched} encontrados, {pollLastResult.totalImported} importados, {pollLastResult.elapsed})
                        </span>
                      )}
                    </div>
                  )}

                  {/* Erros na última execução */}
                  {pollLastResult?.errors?.length > 0 && (
                    <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/30">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                        <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">Erros na última execução</span>
                      </div>
                      <ul className="text-xs text-amber-600 dark:text-amber-400 space-y-1">
                        {pollLastResult.errors.slice(0, 5).map((err: string, i: number) => (
                          <li key={i} className="truncate" title={err}>{err}</li>
                        ))}
                        {pollLastResult.errors.length > 5 && (
                          <li className="text-muted-foreground">...e mais {pollLastResult.errors.length - 5} erros</li>
                        )}
                      </ul>
                    </div>
                  )}

                  <Separator />

                  {/* Ações */}
                  <div className="flex items-center gap-3">
                    <Button
                      onClick={savePollConfig}
                      disabled={pollSaving}
                      className="bg-violet-600 hover:bg-violet-700 text-white"
                    >
                      {pollSaving ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Salvando...</>
                      ) : (
                        <><Save className="h-4 w-4 mr-2" /> Salvar Configuração</>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={triggerPollNow}
                      disabled={pollTriggering || !pollEnabled}
                    >
                      {pollTriggering ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Executando...</>
                      ) : (
                        <><RefreshCw className="h-4 w-4 mr-2" /> Executar Agora</>
                      )}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  );
}
