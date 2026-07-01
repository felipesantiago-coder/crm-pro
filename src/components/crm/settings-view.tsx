'use client';

import React, { useEffect, useState } from 'react';
import { Moon, Sun, Database, Wifi, WifiOff, CheckCircle2, Circle, Copy, ExternalLink, User, Loader2, Save, CalendarDays, Link2, Unlink, Phone, Send, MessageCircle, Bell, Shield, Eye, EyeOff } from 'lucide-react';
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

  // Telegram
  const [tgConfigured, setTgConfigured] = useState(false);
  const [tgConnected, setTgConnected] = useState(false);
  const [tgChatId, setTgChatId] = useState('');
  const [tgLoading, setTgLoading] = useState(true);
  const [tgTesting, setTgTesting] = useState(false);
  const [tgSaving, setTgSaving] = useState(false);

  // Ntfy
  const [ntfyConnected, setNtfyConnected] = useState(false);
  const [ntfyLoading, setNtfyLoading] = useState(true);
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

    // Verificar status do Telegram
    fetch('/api/settings/telegram')
      .then((r) => r.json())
      .then((data) => {
        setTgConfigured(data.botConfigured === true);
        setTgConnected(data.configured === true);
        setTgChatId(data.telegramChatId || '');
      })
      .catch(() => {})
      .finally(() => setTgLoading(false));

    // Verificar status do Ntfy
    fetch('/api/settings/ntfy')
      .then((r) => r.json())
      .then((data) => {
        setNtfyConnected(data.configured === true);
        setNtfyTopic(data.ntfyTopic || '');
        setNtfySubscribeUrl(data.subscribeUrl || '');
      })
      .catch(() => {})
      .finally(() => setNtfyLoading(false));

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

  const isSupabaseConfigured = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

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
        toast.success('Telegram desvinculado');
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
        setNtfyTopic(data.ntfyTopic || '');
        setNtfySubscribeUrl(data.subscribeUrl || '');
        if (!data.alreadyActive) {
          // On first activation, the token is returned from a separate endpoint
          // We fetch it by calling GET which doesn't expose the token for security.
          // Instead, we get it from the activate response.
          setNtfyToken(data.ntfyToken || '');
        }
        toast.success('Ntfy ativado! Inscreva-se no tópico usando o link e credenciais abaixo.');
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
        toast.success('Ntfy desativado');
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

        {/* ==================== TELEGRAM NOTIFICAÇÕES ==================== */}
        <Card className={`hover:shadow-md transition-shadow duration-200 ${
          tgConnected
            ? 'border-blue-200 dark:border-blue-800/50 bg-blue-50/50 dark:bg-blue-950/20'
            : ''
        }`}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-blue-500" />
              Notificações Telegram
            </CardTitle>
            <CardDescription>
              Receba alertas instantâneos de novos leads no seu Telegram
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {tgLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Verificando...
              </div>
            ) : !tgConfigured ? (
              <>
                <div className="flex items-center gap-3">
                  <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 gap-1">
                    <Circle className="h-3 w-3" />
                    Bot não configurado
                  </Badge>
                </div>
                <div className="p-3 rounded-lg bg-amber-100/50 dark:bg-amber-900/20">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                    O bot do Telegram não está configurado. Peça ao administrador para adicionar a variável
                    de ambiente <code className="font-mono bg-amber-200/50 dark:bg-amber-800/30 px-1 rounded">TELEGRAM_BOT_TOKEN</code> no Vercel.
                  </p>
                </div>
              </>
            ) : tgConnected ? (
              <>
                <div className="flex items-center gap-3">
                  <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 gap-1">
                    <Link2 className="h-3 w-3" />
                    Conectado
                  </Badge>
                  <span className="text-xs text-muted-foreground">Chat ID: <code className="font-mono">{tgChatId}</code></span>
                </div>
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Como funciona
                  </h4>
                  <ul className="text-xs text-muted-foreground space-y-2">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-blue-500 mt-0.5 flex-shrink-0" />
                      <span><strong>Novo lead</strong> — Você recebe uma notificação instantânea com nome, telefone, e-mail e campanha</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-blue-500 mt-0.5 flex-shrink-0" />
                      <span><strong>Dados da campanha</strong> — Se o lead veio de uma campanha Meta Ads, o nome da campanha aparece na notificação</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-blue-500 mt-0.5 flex-shrink-0" />
                      <span><strong>100% gratuito</strong> — Sem custos por mensagem, sem limites</span>
                    </li>
                  </ul>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={testTelegram}
                    disabled={tgTesting}
                    className="text-blue-600 border-blue-200 hover:bg-blue-50 dark:text-blue-400 dark:border-blue-800/50 dark:hover:bg-blue-950/30"
                  >
                    {tgTesting ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enviando...</>
                    ) : (
                      <><Send className="h-4 w-4 mr-2" /> Enviar Teste</>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={disconnectTelegram}
                    disabled={tgSaving}
                    className="text-destructive hover:text-destructive"
                  >
                    {tgSaving ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Desconectando...</>
                    ) : (
                      <><Unlink className="h-4 w-4 mr-2" /> Desconectar</>
                    )}
                  </Button>
                </div>
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
                  Vincule seu Telegram para receber notificações instantâneas quando novos leads chegarem
                  das campanhas de anúncios.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="tg-chat-id" className="text-xs">Seu Chat ID no Telegram</Label>
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
                      disabled={tgSaving}
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700 text-white flex-shrink-0"
                    >
                      {tgSaving ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /></>
                      ) : (
                        <><Link2 className="h-4 w-4" /></>
                      )}
                    </Button>
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Como obter seu Chat ID
                  </h4>
                  <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
                    <li>No Telegram, busque por <strong>@userinfobot</strong></li>
                    <li>Envie qualquer mensagem para ele</li>
                    <li>Ele responderá com seu <strong>Chat ID</strong> (um número)</li>
                    <li>Cole o número acima e clique em vincular</li>
                  </ol>
                  <p className="text-[10px] text-muted-foreground pt-1">
                    Alternativa: se o webhook estiver configurado, envie <code className="font-mono bg-muted px-1 rounded">/start {userEmail}</code> diretamente no bot do CRM.
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* ==================== NTFY NOTIFICAÇÕES ==================== */}
        <Card className={`hover:shadow-md transition-shadow duration-200 ${
          ntfyConnected
            ? 'border-violet-200 dark:border-violet-800/50 bg-violet-50/50 dark:bg-violet-950/20'
            : ''
        }`}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Bell className="h-4 w-4 text-violet-500" />
              Notificações Ntfy
            </CardTitle>
            <CardDescription>
              Receba alertas de push instantâneos de novos leads (sem precisar instalar nada)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {ntfyLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Verificando...
              </div>
            ) : ntfyConnected ? (
              <>
                <div className="flex items-center gap-3">
                  <Badge className="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 gap-1">
                    <Link2 className="h-3 w-3" />
                    Ativo
                  </Badge>
                  <Badge variant="outline" className="text-violet-600 dark:text-violet-400 gap-1">
                    <Shield className="h-3 w-3" />
                    Privado
                  </Badge>
                </div>

                {/* Subscribe link */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    1. Abra o link para se inscrever
                  </Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-muted px-3 py-2 rounded-md truncate font-mono">
                      {ntfySubscribeUrl}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(ntfySubscribeUrl, '_blank')}
                      className="flex-shrink-0"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(ntfySubscribeUrl, 'Link')}
                      className="flex-shrink-0"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Credentials */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    2. Credenciais de acesso (insira quando solicitado)
                  </Label>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-16 flex-shrink-0">Usuário:</span>
                      <code className="flex-1 text-xs bg-muted px-3 py-1.5 rounded-md font-mono">
                        {ntfyTopic}
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard(ntfyTopic, 'Usuário')}
                        className="h-7 w-7 p-0 flex-shrink-0"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                    {ntfyToken ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-16 flex-shrink-0">Senha:</span>
                        <code className="flex-1 text-xs bg-muted px-3 py-1.5 rounded-md font-mono truncate">
                          {showNtfyToken ? ntfyToken : '••••••••••••••••••••••••••••'}
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowNtfyToken(!showNtfyToken)}
                          className="h-7 w-7 p-0 flex-shrink-0"
                        >
                          {showNtfyToken ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(ntfyToken, 'Senha')}
                          className="h-7 w-7 p-0 flex-shrink-0"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={fetchNtfyCredentials}
                        className="text-xs"
                      >
                        Mostrar credenciais
                      </Button>
                    )}
                  </div>
                </div>

                {/* How it works */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Como funciona
                  </h4>
                  <ul className="text-xs text-muted-foreground space-y-2">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-violet-500 mt-0.5 flex-shrink-0" />
                      <span><strong>Push instantâneo</strong> — Notificação no celular/computador sem instalar app</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-violet-500 mt-0.5 flex-shrink-0" />
                      <span><strong>Tópico privado</strong> — Apenas você tem acesso com suas credenciais</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-violet-500 mt-0.5 flex-shrink-0" />
                      <span><strong>Dados completos</strong> — Nome, telefone, e-mail, campanha e respostas do formulário</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-violet-500 mt-0.5 flex-shrink-0" />
                      <span><strong>Botão de ação</strong> — Toque na notificação para abrir o CRM diretamente</span>
                    </li>
                  </ul>
                </div>

                {/* Instructions for subscription */}
                <div className="p-3 rounded-lg bg-violet-100/50 dark:bg-violet-900/20 space-y-2">
                  <h4 className="text-xs font-semibold text-violet-700 dark:text-violet-300">
                    Passo a passo da inscrição
                  </h4>
                  <ol className="text-xs text-violet-600 dark:text-violet-400 space-y-1.5 list-decimal list-inside">
                    <li>Clique no link acima para abrir a página do tópico</li>
                    <li>Quando solicitado, insira o <strong>Usuário</strong> e <strong>Senha</strong> mostrados acima</li>
                    <li>Pronto! Você começará a receber notificações</li>
                  </ol>
                  <p className="text-[10px] text-violet-500 dark:text-violet-400 pt-1">
                    Dica: Instale o app Ntfy (Android/iOS) para receber push notifications no celular. As credenciais só são pedidas uma vez.
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={testNtfy}
                    disabled={ntfyTesting}
                    className="text-violet-600 border-violet-200 hover:bg-violet-50 dark:text-violet-400 dark:border-violet-800/50 dark:hover:bg-violet-950/30"
                  >
                    {ntfyTesting ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enviando...</>
                    ) : (
                      <><Send className="h-4 w-4 mr-2" /> Enviar Teste</>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={deactivateNtfy}
                    disabled={ntfyDeactivating}
                    className="text-destructive hover:text-destructive"
                  >
                    {ntfyDeactivating ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Desativando...</>
                    ) : (
                      <><Unlink className="h-4 w-4 mr-2" /> Desativar</>
                    )}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <Badge className="bg-muted text-muted-foreground gap-1">
                    <Circle className="h-3 w-3" />
                    Não ativado
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Ative as notificações Ntfy para receber alertas instantâneos de novos leads
                  diretamente no seu celular ou computador, sem precisar instalar o Telegram.
                </p>
                <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    O que é o Ntfy?
                  </h4>
                  <ul className="text-xs text-muted-foreground space-y-1.5">
                    <li className="flex items-start gap-2">
                      <Bell className="h-3 w-3 mt-0.5 flex-shrink-0 text-violet-500" />
                      <span>Serviço gratuito de notificações push — funciona no navegador ou no app (Android/iOS)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Shield className="h-3 w-3 mt-0.5 flex-shrink-0 text-violet-500" />
                      <span>Seu tópico é <strong>privado</strong> — protegido por credenciais únicas geradas automaticamente</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-3 w-3 mt-0.5 flex-shrink-0 text-violet-500" />
                      <span>Configuração em <strong>1 clique</strong> — ative aqui e abra o link gerado</span>
                    </li>
                  </ul>
                </div>
                <Button
                  onClick={activateNtfy}
                  disabled={ntfyActivating}
                  className="bg-violet-600 hover:bg-violet-700 text-white"
                >
                  {ntfyActivating ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Ativando...</>
                  ) : (
                    <><Bell className="h-4 w-4 mr-2" /> Ativar Notificações Ntfy</>
                  )}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* ==================== CONFIGURAÇÕES ADMIN ==================== */}
        {isAdmin && (
          <>
            {/* Supabase Integration Status */}
            <Card className={`hover:shadow-md transition-shadow duration-200 ${
              isSupabaseConfigured
                ? 'border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/50 dark:bg-emerald-950/20'
                : 'border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/20'
            }`}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Database className="h-4 w-4 text-emerald-500" />
                  Integração Supabase
                </CardTitle>
                <CardDescription>
                  Status da conexão com o banco de dados em nuvem
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  {isSupabaseConfigured ? (
                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 gap-1">
                      <Wifi className="h-3 w-3" />
                      Conectado ao Supabase
                    </Badge>
                  ) : (
                    <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 gap-1">
                      <WifiOff className="h-3 w-3" />
                      Modo Local (SQLite)
                    </Badge>
                  )}
                </div>

                <Separator />

                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Recursos do Supabase
                  </h4>
                  <ul className="text-xs text-muted-foreground space-y-2">
                    <li className="flex items-start gap-2">
                      {isSupabaseConfigured ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                      ) : (
                        <Circle className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                      )}
                      <span><strong>PostgreSQL na nuvem</strong> — Banco de dados relacional robusto e escalável</span>
                    </li>
                    <li className="flex items-start gap-2">
                      {isSupabaseConfigured ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                      ) : (
                        <Circle className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                      )}
                      <span><strong>Real-time subscriptions</strong> — Alterações refletidas instantaneamente</span>
                    </li>
                    <li className="flex items-start gap-2">
                      {isSupabaseConfigured ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                      ) : (
                        <Circle className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                      )}
                      <span><strong>Connection Pooling</strong> — Conexões otimizadas para serverless (Vercel)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      {isSupabaseConfigured ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                      ) : (
                        <Circle className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                      )}
                      <span><strong>Prisma ORM</strong> — Type-safe queries para PostgreSQL</span>
                    </li>
                  </ul>
                </div>

                <Separator />

                {!isSupabaseConfigured && (
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Como configurar o Supabase
                    </h4>
                    <ol className="text-xs text-muted-foreground space-y-2 list-decimal list-inside">
                      <li>Crie um projeto em{' '}
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium cursor-pointer inline-flex items-center gap-1" onClick={() => window.open('https://supabase.com', '_blank')}>
                          supabase.com <ExternalLink className="h-2.5 w-2.5" />
                        </span>
                      </li>
                      <li>Acesse <strong>Settings → API</strong> e copie a URL e a chave anônima</li>
                      <li>Acesse <strong>Settings → Database</strong> e copie a string de conexão (use Session mode - porta 5432)</li>
                      <li>
                        No Vercel, adicione as variáveis:
                        <div className="mt-2 space-y-1.5">
                          <div className="flex items-center gap-2 p-2 rounded bg-muted/50 font-mono text-[10px]">
                            <code className="flex-1">DATABASE_URL</code>
                            <button onClick={() => copyToClipboard('DATABASE_URL', 'Variável')} className="text-muted-foreground hover:text-foreground"><Copy className="h-3 w-3" /></button>
                          </div>
                          <div className="flex items-center gap-2 p-2 rounded bg-muted/50 font-mono text-[10px]">
                            <code className="flex-1">NEXT_PUBLIC_SUPABASE_URL</code>
                            <button onClick={() => copyToClipboard('NEXT_PUBLIC_SUPABASE_URL', 'Variável')} className="text-muted-foreground hover:text-foreground"><Copy className="h-3 w-3" /></button>
                          </div>
                          <div className="flex items-center gap-2 p-2 rounded bg-muted/50 font-mono text-[10px]">
                            <code className="flex-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
                            <button onClick={() => copyToClipboard('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'Variável')} className="text-muted-foreground hover:text-foreground"><Copy className="h-3 w-3" /></button>
                          </div>
                        </div>
                      </li>
                    </ol>
                  </div>
                )}

                {isSupabaseConfigured && (
                  <div className="p-3 rounded-lg bg-emerald-100/50 dark:bg-emerald-900/20">
                    <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                      Seu CRM está conectado ao Supabase com atualizações em tempo real.
                      Todas as alterações serão refletidas automaticamente.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Architecture Diagram */}
            <Card className="hover:shadow-md transition-shadow duration-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Wifi className="h-4 w-4 text-emerald-500" />
                  Arquitetura de Tempo Real
                </CardTitle>
                <CardDescription>
                  Como os dados são sincronizados entre dispositivos
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs text-muted-foreground space-y-3">
                  <div className="flex items-center gap-3 p-3 rounded-lg border">
                    <div className="h-8 w-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm">📱</span>
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">Dispositivo A (Vercel)</p>
                      <p className="text-[10px]">Faz alteração no cliente — POST/PUT/DELETE</p>
                    </div>
                    <div className="h-8 w-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs">API</span>
                    </div>
                  </div>
                  <div className="flex justify-center"><div className="h-6 w-px bg-border" /></div>
                  <div className="flex items-center gap-3 p-3 rounded-lg border">
                    <div className="h-8 w-8 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm">⚡</span>
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">Supabase Realtime</p>
                      <p className="text-[10px]">Detecta mudança e broadcasts via WebSocket</p>
                    </div>
                  </div>
                  <div className="flex justify-center"><div className="h-6 w-px bg-border" /></div>
                  <div className="flex items-center gap-3 p-3 rounded-lg border">
                    <div className="h-8 w-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm">💻</span>
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">Dispositivo B (Qualquer sessão)</p>
                      <p className="text-[10px]">Recebe notificação e atualiza a UI automaticamente</p>
                    </div>
                    <div className="h-8 w-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs">UI</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
