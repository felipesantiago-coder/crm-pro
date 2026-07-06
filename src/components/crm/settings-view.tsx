'use client';

import React, { useEffect, useState } from 'react';
import { Moon, Sun, CheckCircle2, Circle, User, Loader2, Save, CalendarDays, Link2, Unlink, Phone, Send, MessageCircle, Bell, Shield, Eye, EyeOff, Search, ArrowRight, Check, Copy, ExternalLink } from 'lucide-react';
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

  // Notificações (canal único: Telegram ou Ntfy)
  const [notifChannel, setNotifChannel] = useState<'telegram' | 'ntfy' | null>(null);
  const [notifLoading, setNotifLoading] = useState(true);
  // Telegram
  const [tgConfigured, setTgConfigured] = useState(false);
  const [tgConnected, setTgConnected] = useState(false);
  const [tgChatId, setTgChatId] = useState('');
  const [tgTesting, setTgTesting] = useState(false);
  const [tgSaving, setTgSaving] = useState(false);
  const [tgDeepLink, setTgDeepLink] = useState<string | null>(null);
  const [tgBotUsername, setTgBotUsername] = useState<string | null>(null);
  const [showManualChatId, setShowManualChatId] = useState(false);
  const [tgPollInterval, setTgPollInterval] = useState<NodeJS.Timeout | null>(null);
  // Ntfy
  const [ntfyConnected, setNtfyConnected] = useState(false);
  const [ntfyActivating, setNtfyActivating] = useState(false);
  const [ntfyDeactivating, setNtfyDeactivating] = useState(false);
  const [ntfyTesting, setNtfyTesting] = useState(false);
  const [ntfyTopic, setNtfyTopic] = useState('');
  const [ntfyToken, setNtfyToken] = useState('');
  const [ntfySubscribeUrl, setNtfySubscribeUrl] = useState('');
  const [showNtfyToken, setShowNtfyToken] = useState(false);

  useEffect(() => {
    // Verificar status da conexão Google Calendar
    fetch('/api/google-calendar/status')
      .then((r) => r.json())
      .then((data) => setGcConnected(data.connected === true))
      .catch(() => {})
      .finally(() => setGcLoading(false));

    // Verificar status das notificações (Telegram + Ntfy em paralelo)
    Promise.all([
      fetch('/api/settings/telegram').then((r) => r.json()).catch(() => ({})),
      fetch('/api/settings/ntfy').then((r) => r.json()).catch(() => ({})),
    ]).then(([tgData, ntfyData]) => {
      setTgConfigured(tgData.botConfigured === true);
      setTgConnected(tgData.configured === true);
      setTgChatId(tgData.telegramChatId || '');
      setTgDeepLink(tgData.deepLink || null);
      setTgBotUsername(tgData.botUsername || null);
      setNtfyConnected(ntfyData.configured === true);
      setNtfyTopic(ntfyData.ntfyTopic || '');
      setNtfySubscribeUrl(ntfyData.subscribeUrl || '');
      // Determine active channel
      if (tgData.configured) setNotifChannel('telegram');
      else if (ntfyData.configured) setNotifChannel('ntfy');
    })
      .catch(() => {})
      .finally(() => setNotifLoading(false));

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
      const res = await fetch('/api/google-calendar/auth');
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast.error(data.error || 'Erro ao iniciar conexão com Google Calendar');
        setGcConnecting(false);
      }
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
        setNtfyConnected(false);
        setNtfyTopic('');
        setNtfyToken('');
        setNtfySubscribeUrl('');
        setNotifChannel('telegram');
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
        setNotifChannel(null);
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
        const suffix = data.hasImage ? ' (com imagem do empreendimento)' : ' (sem imagem — nenhum empreendimento com capa cadastrado)';
        toast.success(data.message || `Notificação enviada${suffix}`);
      } else {
        toast.error(data.error || 'Erro ao enviar teste');
      }
    } catch {
      toast.error('Erro ao enviar notificação de teste');
    } finally {
      setTgTesting(false);
    }
  }

  /** Abre o deep link do Telegram e inicia polling para detectar quando o usuário se conectou */
  function openTelegramDeepLink() {
    if (!tgDeepLink) return;

    // Abrir o Telegram
    window.open(tgDeepLink, '_blank');

    // Iniciar polling para detectar quando o webhook vinculou o chat ID
    const poll = setInterval(async () => {
      try {
        const res = await fetch('/api/settings/telegram');
        const data = await res.json();
        if (data.configured && data.telegramChatId) {
          clearInterval(poll);
          setTgConnected(true);
          setTgChatId(data.telegramChatId);
          setNtfyConnected(false);
          setNtfyTopic('');
          setNtfyToken('');
          setNtfySubscribeUrl('');
          setNotifChannel('telegram');
          toast.success('Telegram conectado com sucesso!');
          // Limpar referência do interval
          setTgPollInterval(null);
        }
      } catch {
        // Silencioso — continua polling
      }
    }, 3000); // verifica a cada 3 segundos

    // Timeout de segurança: para o polling após 5 minutos
    setTimeout(() => {
      clearInterval(poll);
      setTgPollInterval(null);
    }, 5 * 60 * 1000);

    setTgPollInterval(poll as unknown as NodeJS.Timeout);
    toast.info('Abra o Telegram e envie /start para o bot. Esta tela detectará automaticamente.');
  }

  // Limpar polling ao desmontar
  useEffect(() => {
    return () => {
      if (tgPollInterval) clearInterval(tgPollInterval);
    };
  }, [tgPollInterval]);

  // ── Ntfy handlers ────────────────────────────────────
  async function activateNtfy() {
    setNtfyActivating(true);
    try {
      const res = await fetch('/api/settings/ntfy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'activate' }),
      });
      const data = await res.json();
      if (res.ok) {
        setNtfyConnected(true);
        setTgConnected(false);
        setTgChatId('');
        setNtfyTopic(data.ntfyTopic || '');
        setNtfySubscribeUrl(data.subscribeUrl || '');
        setNotifChannel('ntfy');
        if (!data.alreadyActive) {
          setNtfyToken(data.ntfyToken || '');
        }
        toast.success('Ntfy ativado! Siga os passos abaixo para concluir.');
      } else {
        toast.error(data.error || 'Erro ao ativar Ntfy');
      }
    } catch {
      toast.error('Erro ao ativar Ntfy');
    } finally {
      setNtfyActivating(false);
    }
  }

  async function deactivateNtfy() {
    setNtfyDeactivating(true);
    try {
      const res = await fetch('/api/settings/ntfy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deactivate' }),
      });
      if (res.ok) {
        setNtfyConnected(false);
        setNtfyTopic('');
        setNtfyToken('');
        setNtfySubscribeUrl('');
        setNotifChannel(null);
        toast.success('Notificações desativadas');
      }
    } catch {
      toast.error('Erro ao desativar Ntfy');
    } finally {
      setNtfyDeactivating(false);
    }
  }

  async function testNtfy() {
    setNtfyTesting(true);
    try {
      const res = await fetch('/api/ntfy/test', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || 'Notificação enviada!');
      } else {
        toast.error(data.error || 'Erro ao enviar teste');
      }
    } catch {
      toast.error('Erro ao enviar notificação de teste');
    } finally {
      setNtfyTesting(false);
    }
  }

  async function fetchNtfyCredentials() {
    try {
      const res = await fetch('/api/settings/ntfy/credentials');
      if (res.ok) {
        const data = await res.json();
        setNtfyToken(data.ntfyToken || '');
      }
    } catch { /* silent */ }
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
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Como funciona:</p>
                  <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                    <li>Clique em <strong>"Conectar Google Calendar"</strong></li>
                    <li>Você será redirecionado para a tela de login do Google</li>
                    <li>Escolha a conta Google e permita o acesso ao Calendar</li>
                    <li>Pronto! Todos os agendamentos novos serão sincronizados automaticamente</li>
                  </ol>
                </div>
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
              </>
            )}
          </CardContent>
        </Card>

        {/* ==================== NOTIFICAÇÕES DE LEADS ==================== */}
        <Card className={`hover:shadow-md transition-shadow duration-200 col-span-1 lg:col-span-2 ${
          notifChannel === 'telegram' && tgConnected
            ? 'border-blue-200 dark:border-blue-800/50 bg-blue-50/30 dark:bg-blue-950/10'
            : notifChannel === 'ntfy' && ntfyConnected
            ? 'border-violet-200 dark:border-violet-800/50 bg-violet-50/30 dark:bg-violet-950/10'
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
                  Escolha um canal para receber alertas instantâneos quando novos leads chegarem
                </CardDescription>
              </div>
              {(tgConnected || ntfyConnected) && (
                <Badge className={
                  notifChannel === 'telegram'
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 gap-1'
                    : 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 gap-1'
                }>
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
            ) : (
              <>
                {/* ── Channel Selector ──────────────────────── */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setNotifChannel('telegram')}
                    className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all duration-200 text-left ${
                      notifChannel === 'telegram'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 shadow-sm'
                        : 'border-transparent bg-muted/40 hover:bg-muted/60'
                    }`}
                  >
                    <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${
                      notifChannel === 'telegram'
                        ? 'bg-blue-100 dark:bg-blue-900/40'
                        : 'bg-muted'
                    }`}>
                      <MessageCircle className={`h-5 w-5 ${notifChannel === 'telegram' ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`} />
                    </div>
                    <div>
                      <p className={`text-sm font-semibold ${notifChannel === 'telegram' ? 'text-blue-700 dark:text-blue-300' : 'text-foreground'}`}>Telegram</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">App de mensagens</p>
                    </div>
                    {tgConnected && (
                      <div className="absolute top-2 right-2">
                        <CheckCircle2 className="h-4 w-4 text-blue-500" />
                      </div>
                    )}
                  </button>

                  <button
                    onClick={() => setNotifChannel('ntfy')}
                    className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all duration-200 text-left ${
                      notifChannel === 'ntfy'
                        ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 shadow-sm'
                        : 'border-transparent bg-muted/40 hover:bg-muted/60'
                    }`}
                  >
                    <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${
                      notifChannel === 'ntfy'
                        ? 'bg-violet-100 dark:bg-violet-900/40'
                        : 'bg-muted'
                    }`}>
                      <Bell className={`h-5 w-5 ${notifChannel === 'ntfy' ? 'text-violet-600 dark:text-violet-400' : 'text-muted-foreground'}`} />
                    </div>
                    <div>
                      <p className={`text-sm font-semibold ${notifChannel === 'ntfy' ? 'text-violet-700 dark:text-violet-300' : 'text-foreground'}`}>Ntfy</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Push direto (sem app)</p>
                    </div>
                    {ntfyConnected && (
                      <div className="absolute top-2 right-2">
                        <CheckCircle2 className="h-4 w-4 text-violet-500" />
                      </div>
                    )}
                  </button>
                </div>

                <Separator />

                {/* ═══════════════ TELEGRAM CONTENT ═══════════════ */}
                {notifChannel === 'telegram' && (
                  !tgConfigured ? (
                    <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/30">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                          <Circle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                        </div>
                        <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">Bot não configurado</p>
                      </div>
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        O bot do Telegram não está disponível no momento. Escolha a opção <strong>Ntfy</strong> acima para receber notificações por push direto.
                      </p>
                    </div>
                  ) : tgConnected ? (
                    /* ── Telegram: Connected ──────────────────── */
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
                    /* ── Telegram: One-Click Connect ────────── */
                    <div className="space-y-4">
                      {/* Botão principal de conexão */}
                      {tgDeepLink ? (
                        <div className="p-5 rounded-xl bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/30">
                          <div className="flex items-start gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <MessageCircle className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">Conectar com 1 clique</p>
                              <p className="text-xs text-blue-600/80 dark:text-blue-400/80 mt-0.5">
                                Clique no botão abaixo, envie <code className="bg-blue-100 dark:bg-blue-900/40 px-1 py-0.5 rounded font-mono text-[11px]">/start</code> no Telegram e pronto. Nenhuma cópia de Chat ID necessária.
                              </p>
                            </div>
                          </div>
                          <Button
                            onClick={openTelegramDeepLink}
                            disabled={!!tgPollInterval}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium h-11 text-sm"
                          >
                            {tgPollInterval ? (
                              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Aguardando conexão no Telegram...</>
                            ) : (
                              <><MessageCircle className="h-4 w-4 mr-2" /> Abrir Telegram e conectar</>
                            )}
                          </Button>
                          {tgPollInterval && (
                            <p className="text-[11px] text-muted-foreground text-center mt-2">
                              Detectando automaticamente... Volte para esta tela após enviar /start no bot.
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/30">
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            Não foi possível gerar o link de conexão automática. Use o método manual abaixo.
                          </p>
                        </div>
                      )}

                      {/* Fallback manual (colapsável) */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowManualChatId(!showManualChatId)}
                          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
                        >
                          <span>{showManualChatId ? 'Ocultar' : 'Método manual'} (Chat ID)</span>
                          <span className={`transition-transform ${showManualChatId ? 'rotate-90' : ''}`}>›</span>
                        </button>
                        {showManualChatId && (
                          <div className="mt-3 space-y-3 p-4 rounded-xl bg-muted/30 border border-border/50">
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
                            <p className="text-[11px] text-muted-foreground">
                              Busque <strong>@userinfobot</strong> no Telegram, envie qualquer mensagem e copie o número que ele respondeu.
                            </p>
                          </div>
                        )}
                      </div>

                      {/* O que receberá */}
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
                  )
                )}

                {/* ═══════════════ NTFY CONTENT ═══════════════ */}
                {notifChannel === 'ntfy' && (
                  ntfyConnected ? (
                    /* ── Ntfy: Connected ────────────────────── */
                    <div className="space-y-5">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
                            <Check className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-violet-700 dark:text-violet-300">Ntfy ativo</p>
                            <p className="text-[10px] text-muted-foreground">Tópico privado configurado</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={testNtfy}
                            disabled={ntfyTesting}
                            className="text-violet-600 border-violet-200 hover:bg-violet-50 dark:text-violet-400 dark:border-violet-800/50 dark:hover:bg-violet-950/30"
                          >
                            {ntfyTesting ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Enviando...</> : <><Send className="h-4 w-4 mr-1.5" /> Testar</>}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={deactivateNtfy}
                            disabled={ntfyDeactivating}
                            className="text-destructive hover:text-destructive"
                          >
                            {ntfyDeactivating ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Desativando...</> : <><Unlink className="h-4 w-4 mr-1.5" /> Desativar</>}
                          </Button>
                        </div>
                      </div>

                      <div className="p-4 rounded-xl bg-violet-50/50 dark:bg-violet-950/10 border border-violet-100 dark:border-violet-900/20">
                        <p className="text-xs font-semibold text-violet-600 dark:text-violet-400 mb-3">O que voce recebera</p>
                        <div className="grid grid-cols-2 gap-2">
                          {['Nome e telefone do lead', 'E-mail do lead', 'Nome do empreendimento', 'Campanha Meta Ads', 'Respostas do formulario', 'Botao para abrir o CRM'].map((item) => (
                            <div key={item} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <CheckCircle2 className="h-3 w-3 text-violet-500 flex-shrink-0" />
                              <span>{item}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Visual Step-by-Step Tutorial */}
                      <div className="p-4 rounded-xl bg-violet-50/50 dark:bg-violet-950/10 border border-violet-100 dark:border-violet-900/20">
                        <p className="text-sm font-semibold mb-4 flex items-center gap-2">
                          <ArrowRight className="h-4 w-4 text-violet-500" />
                          Passo a passo para concluir a inscricao
                        </p>
                        <div className="space-y-4">
                          <div className="flex gap-3">
                            <div className="flex flex-col items-center">
                              <div className="w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center text-violet-600 dark:text-violet-400 font-bold text-sm flex-shrink-0">1</div>
                              <div className="w-px flex-1 bg-violet-200 dark:bg-violet-800/40 mt-1" />
                            </div>
                            <div className="pb-4">
                              <p className="text-sm font-medium">Clique no link abaixo para abrir seu topico</p>
                              <div className="flex items-center gap-2 mt-1.5">
                                <code className="text-xs bg-muted px-3 py-1.5 rounded-md font-mono truncate max-w-[180px] sm:max-w-[300px]">{ntfySubscribeUrl}</code>
                                <Button variant="ghost" size="sm" onClick={() => { window.open(ntfySubscribeUrl, '_blank'); }} className="h-7 w-7 p-0 flex-shrink-0"><ExternalLink className="h-3.5 w-3.5" /></Button>
                                <Button variant="ghost" size="sm" onClick={() => copyToClipboard(ntfySubscribeUrl, 'Link')} className="h-7 w-7 p-0 flex-shrink-0"><Copy className="h-3.5 w-3.5" /></Button>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-3">
                            <div className="flex flex-col items-center">
                              <div className="w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center text-violet-600 dark:text-violet-400 font-bold text-sm flex-shrink-0">2</div>
                              <div className="w-px flex-1 bg-violet-200 dark:bg-violet-800/40 mt-1" />
                            </div>
                            <div className="pb-4">
                              <p className="text-sm font-medium">Clique em <strong>"Subscribe to topic"</strong> na pagina que abriu</p>
                              <p className="text-xs text-muted-foreground mt-0.5">Se estiver no celular, use o app Ntfy e adicione o topico <code className="bg-muted px-1 rounded text-[10px] font-mono">{ntfyTopic}</code></p>
                            </div>
                          </div>
                          <div className="flex gap-3">
                            <div className="flex flex-col items-center">
                              <div className="w-8 h-8 rounded-full bg-violet-600 dark:bg-violet-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                                <Check className="h-4 w-4" />
                              </div>
                            </div>
                            <div>
                              <p className="text-sm font-medium">Pronto! Voce ja recebera as notificacoes</p>
                              <p className="text-xs text-muted-foreground mt-0.5">Use o botao "Testar" acima para confirmar que esta funcionando</p>
                              <p className="text-[10px] text-violet-500 dark:text-violet-400 mt-1">
                                Dica: Instale o app Ntfy (Android/iOS) para receber push notifications direto no celular.
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* ── Ntfy: Activate ─────────── */
                    <div className="space-y-4">
                      <div className="p-4 rounded-xl bg-muted/30 border border-border/50 space-y-3">
                        <p className="text-sm font-semibold flex items-center gap-2">
                          <Shield className="h-4 w-4 text-violet-500" />
                          Por que escolher o Ntfy?
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="flex items-start gap-2">
                            <Bell className="h-4 w-4 text-violet-500 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="text-xs font-medium">Sem instalar nada</p>
                              <p className="text-[10px] text-muted-foreground">Funciona direto no navegador ou app</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2">
                            <Shield className="h-4 w-4 text-violet-500 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="text-xs font-medium">Topico exclusivo</p>
                              <p className="text-[10px] text-muted-foreground">Nome aleatorio impossivel de adivinhar</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2">
                            <CheckCircle2 className="h-4 w-4 text-violet-500 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="text-xs font-medium">Configuracao em 1 clique</p>
                              <p className="text-[10px] text-muted-foreground">Ative aqui e abra o link gerado</p>
                            </div>
                          </div>
                        </div>
                      </div>

                      <Button
                        onClick={activateNtfy}
                        disabled={ntfyActivating}
                        className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                      >
                        {ntfyActivating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Gerando credenciais...</> : <><Bell className="h-4 w-4 mr-2" /> Ativar Notificacoes Ntfy</>}
                      </Button>
                    </div>
                  )
                )}
              </>
            )}
          </CardContent>
        </Card>

        
      </div>
    </div>
  );
}
