'use client';

import React, { useEffect, useState } from 'react';
import { Moon, Sun, CheckCircle2, Circle, User, Loader2, Save, CalendarDays, Link2, Unlink, Phone, Send, MessageCircle, Bell, Smartphone, Check, AlertTriangle } from 'lucide-react';
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
import { useRegisterAssistantContext } from '@/components/ai-assistant/use-assistant-context';
import { useAssistantContextStore, initProactivityPreference } from '@/components/ai-assistant/assistant-context-store';
import { getAssistantMessages } from '@/components/ai-assistant/assistant-messages';
import { TelegramLeadPreview } from '@/components/crm/telegram-lead-preview';

/** Shape do diagnóstico devolvido por /api/telegram/webhook/register. */
interface TgWebhookData {
  diagnosis: { status: string; verdict: string; problems: string[]; hints: string[] };
  bot: { id: number | null; username: string | null } | null;
  webhook: { url?: string; pending_update_count?: number; last_error_message?: string } | null;
  expectedUrl: string | null;
  env: { botTokenConfigured: boolean; webhookSecretConfigured: boolean; botUsernameEnv: string | null };
}

export function SettingsView() {
  const { theme, setTheme } = useTheme();
  const { data: session, update: updateSession } = useSession();
  const userRole = (session?.user as { role?: string })?.role;
  const isAdmin = userRole === 'ADMIN';

  // Preferência de proatividade do Nexo (prompt v2.0 §13.2) — não sensível.
  const proactiveEnabled = useAssistantContextStore((s) => s.proactiveSuggestionsEnabled);
  const setProactiveEnabled = useAssistantContextStore((s) => s.setProactiveSuggestionsEnabled);
  useEffect(() => {
    initProactivityPreference();
  }, []);
  const assistantT = getAssistantMessages();

  // Bridge de contexto do Nexo (§8.2).
  useRegisterAssistantContext({ view: 'settings' });

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
  const [tgMaskedChatId, setTgMaskedChatId] = useState('');
  const [tgTesting, setTgTesting] = useState(false);
  const [tgSaving, setTgSaving] = useState(false);
  // Vinculação segura (§18.1): convite com token de uso único e TTL curto
  const [tgLinking, setTgLinking] = useState(false);
  const [tgDeepLink, setTgDeepLink] = useState<string | null>(null);
  const [tgTokenExpiresAt, setTgTokenExpiresAt] = useState<string | null>(null);
  const [tgPreviewOpen, setTgPreviewOpen] = useState(false);
  // Fallback legado (convite indisponível): Chat ID digitado manualmente
  const [tgLegacyFallback, setTgLegacyFallback] = useState(false);
  const [tgChatId, setTgChatId] = useState('');
  // Webhook do bot (ADMIN): o setWebhook era um passo manual — sem ele o
  // bot fica mudo para tudo (nem /start responde). Diagnóstico + registro.
  const [tgWebhook, setTgWebhook] = useState<TgWebhookData | null>(null);
  const [tgWebhookLoading, setTgWebhookLoading] = useState(false);
  const [tgWebhookRegistering, setTgWebhookRegistering] = useState(false);

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
        setTgMaskedChatId(tgData.maskedChatId || '');
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

  /**
   * Vinculação SEGURA (§18.1): gera convite com token de uso único
   * (TTL 15 min, só o hash é persistido) e abre o deep link do bot.
   * A posse do chat é provada no bot — não por digitar um Chat ID.
   */
  async function linkTelegram() {
    setTgLinking(true);
    try {
      const res = await fetch('/api/telegram/link-token', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setTgDeepLink(data.deepLink);
        setTgTokenExpiresAt(data.expiresAt);
        window.open(data.deepLink, '_blank', 'noopener');
      } else if (res.status === 503) {
        // Bot sem username resolvível — cai no fluxo legado de Chat ID
        setTgLegacyFallback(true);
        toast.info('Convite indisponível agora — vincule pelo Chat ID');
      } else {
        toast.error(data.error || 'Erro ao gerar convite');
      }
    } catch {
      toast.error('Erro ao gerar convite de vinculação');
    } finally {
      setTgLinking(false);
    }
  }

  async function refreshTelegramStatus() {
    try {
      const res = await fetch('/api/settings/telegram');
      const data = await res.json();
      if (data.configured === true) {
        setTgConnected(true);
        setTgMaskedChatId(data.maskedChatId || '');
        setTgDeepLink(null);
        toast.success('Telegram vinculado com sucesso!');
      } else {
        toast.info('Ainda não confirmado — abra o convite e envie a mensagem ao bot.');
      }
    } catch {
      toast.error('Erro ao verificar vínculo');
    }
  }

  // ── Webhook do bot (ADMIN): diagnóstico e registro do setWebhook ──
  async function checkTelegramWebhook(showToast = false) {
    setTgWebhookLoading(true);
    try {
      const res = await fetch('/api/telegram/webhook/register');
      const data = await res.json();
      if (res.ok) {
        setTgWebhook(data);
        if (showToast) {
          if (data.diagnosis?.status === 'ok') toast.success('Webhook do bot saudável.');
          else toast.warning(data.diagnosis?.verdict || 'Webhook com pendências.');
        }
      } else {
        toast.error(data.error || 'Erro no diagnóstico do webhook');
      }
    } catch {
      toast.error('Erro no diagnóstico do webhook');
    } finally {
      setTgWebhookLoading(false);
    }
  }

  async function registerTelegramWebhook() {
    setTgWebhookRegistering(true);
    try {
      const res = await fetch('/api/telegram/webhook/register', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setTgWebhook(data);
        if (data.diagnosis?.status === 'ok') {
          toast.success('Webhook registrado e saudável — teste o bot agora (/help deve responder).');
        } else {
          toast.warning(data.diagnosis?.verdict || 'Webhook registrado, mas com pendências.');
        }
      } else {
        toast.error(data.error || 'Erro ao registrar o webhook');
      }
    } catch {
      toast.error('Erro ao registrar o webhook');
    } finally {
      setTgWebhookRegistering(false);
    }
  }

  useEffect(() => {
    // Diagnóstico silencioso ao abrir Ajustes como admin
    if (isAdmin) checkTelegramWebhook();
  }, [isAdmin]);

  /** Fallback legado (só quando o convite seguro não puder ser gerado). */
  async function saveTelegramChatIdLegacy() {
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
        setTgMaskedChatId(`••••${tgChatId.trim().slice(-3)}`);
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
        setTgMaskedChatId('');
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
              <User className="h-4 w-4 text-primary" />
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
              <Sun className="h-4 w-4 text-primary" />
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
                className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
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
            ? 'border-success/30 bg-success/10 dark:border-success/20 dark:bg-success/10'
            : ''
        }`}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-primary" />
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
                  <Badge className="bg-success/10 text-success dark:bg-success/20 dark:text-success gap-1">
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
                      <CheckCircle2 className="h-3.5 w-3.5 text-success mt-0.5 flex-shrink-0" />
                      <span><strong>Criação automática</strong> — Novos agendamentos criam eventos no seu Calendar</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-success mt-0.5 flex-shrink-0" />
                      <span><strong>Lembretes duplos</strong> — Notificação 24 horas e 2 horas antes (popup + e-mail)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-success mt-0.5 flex-shrink-0" />
                      <span><strong>Atualização de status</strong> — Cancelar ou concluir visita atualiza o evento no Calendar</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-success mt-0.5 flex-shrink-0" />
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
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
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
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                      <Check className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Telegram conectado</p>
                      <p className="text-[10px] text-muted-foreground">Chat <code className="font-mono">{tgMaskedChatId || '•••••'}</code> — você receberá apenas leads atribuídos a você</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={testTelegram}
                      disabled={tgTesting}
                      className="text-blue-600 border-blue-200 hover:bg-blue-50 dark:text-blue-400 dark:border-blue-800/50 dark:hover:bg-blue-950/30"
                    >
                      {tgTesting ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Enviando...</> : <><Send className="h-4 w-4 mr-1.5" /> Enviar teste</>}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setTgPreviewOpen((v) => !v)}
                    >
                      {tgPreviewOpen ? 'Ocultar exemplo' : 'Visualizar exemplo'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={disconnectTelegram}
                      disabled={tgSaving}
                      className="text-destructive hover:text-destructive"
                    >
                      {tgSaving ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Desvinculando...</> : <><Unlink className="h-4 w-4 mr-1.5" /> Desvincular</>}
                    </Button>
                  </div>
                </div>
                {tgPreviewOpen && <TelegramLeadPreview />}
              </div>
            ) : (
              <div className="space-y-4">
                {tgLegacyFallback ? (
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
                          onClick={saveTelegramChatIdLegacy}
                          disabled={tgSaving || !tgChatId.trim()}
                          className="bg-blue-600 hover:bg-blue-700 text-white flex-shrink-0"
                        >
                          {tgSaving ? <><Loader2 className="h-4 w-4 animate-spin" /></> : <><Link2 className="h-4 w-4 mr-1.5" /> Vincular</>}
                        </Button>
                      </div>
                    </div>
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
                            <p className="text-xs text-muted-foreground mt-0.5">Ele é um bot oficial que diz qual é o seu Chat ID</p>
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-sm flex-shrink-0">2</div>
                            <div className="w-px flex-1 bg-blue-200 dark:bg-blue-800/40 mt-1" />
                          </div>
                          <div className="pb-4">
                            <p className="text-sm font-medium">Envie qualquer mensagem para ele</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Pode ser um “oi” — ele responderá automaticamente</p>
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-sm flex-shrink-0">3</div>
                            <div className="w-px flex-1 bg-blue-200 dark:bg-blue-800/40 mt-1" />
                          </div>
                          <div className="pb-4">
                            <p className="text-sm font-medium">Copie o <strong>Chat ID</strong> que ele respondeu</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Será um número, por exemplo: <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-[11px]">7123456789</code></p>
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <div className="w-8 h-8 rounded-full bg-blue-600 dark:bg-blue-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                              <Check className="h-4 w-4" />
                            </div>
                          </div>
                          <div>
                            <p className="text-sm font-medium">Cole o número acima e clique em <strong>Vincular</strong></p>
                            <p className="text-xs text-muted-foreground mt-0.5">Pronto! Você receberá todas as notificações por aqui</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : tgDeepLink ? (
                  <div className="p-4 rounded-xl bg-muted/30 border border-border/50 space-y-4">
                    <p className="text-sm font-semibold flex items-center gap-2">
                      <Smartphone className="h-4 w-4 text-blue-500" />
                      Confirme no Telegram
                    </p>
                    <div className="space-y-3">
                      <div className="flex gap-3">
                        <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-xs flex-shrink-0">1</div>
                        <p className="text-sm">Toque em <strong>Abrir Telegram</strong> — o bot abre com a mensagem pronta</p>
                      </div>
                      <div className="flex gap-3">
                        <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-xs flex-shrink-0">2</div>
                        <p className="text-sm">Envie a mensagem no bot (botão de envio do Telegram)</p>
                      </div>
                      <div className="flex gap-3">
                        <div className="w-6 h-6 rounded-full bg-blue-600 dark:bg-blue-500 flex items-center justify-center text-white font-bold text-xs flex-shrink-0">3</div>
                        <p className="text-sm">Volte aqui e toque em <strong>Já confirmei</strong></p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <a href={tgDeepLink} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white">
                          <Link2 className="h-4 w-4 mr-1.5" /> Abrir Telegram
                        </Button>
                      </a>
                      <Button size="sm" variant="outline" onClick={refreshTelegramStatus} disabled={tgLinking}>
                        {tgLinking ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Verificando...</> : 'Já confirmei'}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      O convite expira em 15 minutos{tgTokenExpiresAt ? ` (${new Date(tgTokenExpiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})` : ''} e vale para uso único.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <Button
                      onClick={linkTelegram}
                      disabled={tgLinking}
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {tgLinking ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Gerando convite...</> : <><Link2 className="h-4 w-4 mr-1.5" /> Vincular Telegram</>}
                    </Button>
                    <div className="p-4 rounded-xl bg-blue-50/50 dark:bg-blue-950/10 border border-blue-100 dark:border-blue-900/20">
                      <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-3">O que você receberá</p>
                      <div className="grid grid-cols-2 gap-2">
                        {['Cartão do lead com foto do empreendimento', 'Nome, telefone e e-mail para contato', 'Respostas humanizadas do formulário', 'Origem: campanha, anúncio e formulário', 'Botões: WhatsApp e cliente no CRM', 'Apenas leads atribuídos a você'].map((item) => (
                          <div key={item} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <CheckCircle2 className="h-3 w-3 text-blue-500 flex-shrink-0" />
                            <span>{item}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setTgPreviewOpen((v) => !v)}>
                      {tgPreviewOpen ? 'Ocultar exemplo' : 'Visualizar exemplo do cartão'}
                    </Button>
                    {tgPreviewOpen && <TelegramLeadPreview />}
                    <p className="text-[11px] text-muted-foreground">
                      A vinculação confirma que o Telegram é seu (convite de uso único) — o canal carrega dados de clientes e é tratado como privado.
                    </p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Webhook do bot (Telegram) — admin: registro/diagnóstico do setWebhook */}
        {isAdmin && (
          <Card className="hover:shadow-md transition-shadow duration-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-blue-500" />
                Webhook do bot (Telegram)
              </CardTitle>
              <CardDescription>
                O bot só responde se o webhook estiver registrado no Telegram — sem isso nem o /start do convite recebe resposta.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {tgWebhook ? (
                <>
                  <div className="flex items-start gap-2">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium flex-shrink-0 mt-0.5 ${tgWebhook.diagnosis.status === 'ok' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>
                      {tgWebhook.diagnosis.status === 'ok' ? 'OK' : tgWebhook.diagnosis.status.toUpperCase()}
                    </span>
                    <p className="text-sm">{tgWebhook.diagnosis.verdict}</p>
                  </div>
                  {tgWebhook.diagnosis.problems.length > 0 && (
                    <ul className="space-y-1 text-xs text-destructive">
                      {tgWebhook.diagnosis.problems.map((p, i) => (
                        <li key={i} className="flex gap-1.5"><AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" /><span>{p}</span></li>
                      ))}
                    </ul>
                  )}
                  {tgWebhook.diagnosis.hints.length > 0 && (
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {tgWebhook.diagnosis.hints.map((h, i) => (<li key={i}>• {h}</li>))}
                    </ul>
                  )}
                  <div className="text-[11px] text-muted-foreground space-y-0.5">
                    {tgWebhook.webhook?.url ? (
                      <p>Registrado em: <span className="font-mono">{tgWebhook.webhook.url}</span></p>
                    ) : (
                      <p>Nenhum webhook registrado no bot.</p>
                    )}
                    {tgWebhook.expectedUrl && (
                      <p>Esperado: <span className="font-mono">{tgWebhook.expectedUrl}</span></p>
                    )}
                    {typeof tgWebhook.webhook?.pending_update_count === 'number' && tgWebhook.webhook.pending_update_count > 0 && (
                      <p>Fila pendente no Telegram: {tgWebhook.webhook.pending_update_count}</p>
                    )}
                    {tgWebhook.bot?.username && (
                      <p>Bot: <span className="font-mono">@{tgWebhook.bot.username}</span>{tgWebhook.env.botUsernameEnv ? ` · env aponta para @${tgWebhook.env.botUsernameEnv}` : ''}{tgWebhook.env.webhookSecretConfigured ? '' : ' · sem TELEGRAM_WEBHOOK_SECRET'}</p>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {tgWebhookLoading ? 'Verificando webhook...' : 'Clique em Verificar para consultar o status no Telegram.'}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => checkTelegramWebhook(true)} disabled={tgWebhookLoading}>
                  {tgWebhookLoading ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Verificando...</> : 'Verificar'}
                </Button>
                <Button size="sm" onClick={registerTelegramWebhook} disabled={tgWebhookRegistering} className="bg-blue-600 hover:bg-blue-700 text-white">
                  {tgWebhookRegistering ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Registrando...</> : 'Registrar webhook'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Sugestões proativas do Nexo (prompt v2.0 §13.2) */}
        <Card className="hover:shadow-md transition-shadow duration-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Bell className="h-4 w-4 text-[var(--nexo-cyan)]" />
              {assistantT.settings.proactivityTitle}
            </CardTitle>
            <CardDescription>
              {assistantT.settings.proactivityDescription}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="nexo-proactive" className="text-sm">
                {assistantT.settings.proactivityTitle}
              </Label>
              <Switch
                id="nexo-proactive"
                checked={proactiveEnabled}
                onCheckedChange={setProactiveEnabled}
                aria-label={assistantT.settings.proactivityTitle}
              />
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
