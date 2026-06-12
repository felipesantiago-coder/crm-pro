'use client';

import React, { useEffect, useState } from 'react';
import { Moon, Sun, Database, Wifi, WifiOff, CheckCircle2, Circle, Copy, ExternalLink, User, Loader2, Save, CalendarDays, Link2, Unlink, Megaphone, Eye, EyeOff, RefreshCw, Zap } from 'lucide-react';
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

// ============================================================
// Meta Ads Integration Card (Admin only)
// ============================================================
function MetaAdsCard() {
  const [enabled, setEnabled] = useState(false);
  const [verifyToken, setVerifyToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [showAppSecret, setShowAppSecret] = useState(false);
  const [pageAccessToken, setPageAccessToken] = useState('');
  const [showPageToken, setShowPageToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState<any>(null);
  const [leadCount, setLeadCount] = useState(0);
  const [hasVerifyToken, setHasVerifyToken] = useState(false);
  const [hasAppSecret, setHasAppSecret] = useState(false);
  const [hasPageAccessToken, setHasPageAccessToken] = useState(false);

  const webhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/webhooks/meta-leads`
    : '';

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    setLoading(true);
    try {
      const res = await fetch('/api/webhooks/meta-leads/config');
      if (res.ok) {
        const data = await res.json();
        setEnabled(data.enabled);
        setLeadCount(data.leadCount);
        setHasVerifyToken(data.hasVerifyToken);
        setHasAppSecret(data.hasAppSecret);
        setHasPageAccessToken(data.hasPageAccessToken);
      }
    } catch {
      // Silencioso — pode estar offline
    } finally {
      setLoading(false);
    }
  }

  async function checkWebhookStatus() {
    try {
      const res = await fetch('/api/webhooks/meta-leads');
      if (res.ok) {
        const data = await res.json();
        setWebhookStatus(data);
        toast.success(data.enabled ? 'Webhook ativo e pronto' : 'Webhook configurado mas desativado');
      }
    } catch {
      toast.error('Erro ao verificar status do webhook');
    }
  }

  async function saveConfig() {
    setSaving(true);
    try {
      const res = await fetch('/api/webhooks/meta-leads/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verifyToken: verifyToken || null,
          appSecret: appSecret || null,
          pageAccessToken: pageAccessToken || null,
          enabled,
        }),
      });

      if (res.ok) {
        toast.success('Configurações do Meta Ads salvas com sucesso');
        // Limpar campos sensíveis da tela — os valores já estão salvos no servidor
        setVerifyToken('');
        setAppSecret('');
        setPageAccessToken('');
        loadConfig();
      } else {
        const data = await res.json();
        throw new Error(data.error || 'Erro ao salvar');
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar configurações');
    } finally {
      setSaving(false);
    }
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado!`);
  }

  if (loading) {
    return (
      <Card className="hover:shadow-md transition-shadow duration-200">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`hover:shadow-md transition-shadow duration-200 ${
      enabled
        ? 'border-blue-200 dark:border-blue-800/50 bg-blue-50/50 dark:bg-blue-950/20'
        : ''
    }`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
            <Megaphone className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          Meta Ads — Lead Ads
        </CardTitle>
        <CardDescription>
          Receba clientes gerados por anúncios do Facebook e Instagram diretamente no CRM
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {enabled ? (
              <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 gap-1">
                <Zap className="h-3 w-3" />
                Ativo
              </Badge>
            ) : (
              <Badge className="bg-muted text-muted-foreground gap-1">
                <Circle className="h-3 w-3" />
                Inativo
              </Badge>
            )}
            {leadCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {leadCount} lead{leadCount !== 1 ? 's' : ''} recebido{leadCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Switch id="meta-enabled" checked={enabled} onCheckedChange={setEnabled} />
            <Label htmlFor="meta-enabled" className="text-xs cursor-pointer">
              {enabled ? 'Ativado' : 'Desativado'}
            </Label>
          </div>
        </div>

        <Separator />

        {/* Webhook URL */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            URL do Webhook
          </Label>
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50 border">
            <code className="flex-1 text-xs font-mono truncate text-foreground">
              {webhookUrl}
            </code>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 flex-shrink-0"
              onClick={() => copyToClipboard(webhookUrl, 'URL do Webhook')}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Cole esta URL no campo &quot;Callback URL&quot; ao configurar o webhook no Meta for Developers ou Ads Manager
          </p>
        </div>

        {/* Verify Token */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="meta-verify-token" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Token de Verificação
            </Label>
            {hasVerifyToken && (
              <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px] px-1.5 py-0">
                <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                Configurado
              </Badge>
            )}
          </div>
          <Input
            id="meta-verify-token"
            placeholder={hasVerifyToken ? '•••••••••••••••• (valor salvo — preencha apenas para alterar)' : 'Ex: meu_token_secreto_123'}
            value={verifyToken}
            onChange={(e) => setVerifyToken(e.target.value)}
            type="text"
            className="font-mono text-sm"
          />
          <p className="text-[11px] text-muted-foreground">
            Crie uma string aleatória segura (ex: <code className="bg-muted px-1 rounded">openssl rand -hex 16</code>).
            Use o mesmo valor no campo &quot;Verify Token&quot; do Meta.
          </p>
        </div>

        {/* App Secret */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="meta-app-secret" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              App Secret (segurança)
            </Label>
            {hasAppSecret && (
              <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px] px-1.5 py-0">
                <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                Configurado
              </Badge>
            )}
          </div>
          <div className="relative">
            <Input
              id="meta-app-secret"
              placeholder={hasAppSecret ? '•••••••••••••••• (valor salvo — preencha apenas para alterar)' : 'Ex: a1b2c3d4e5f6...'}
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              type={showAppSecret ? 'text' : 'password'}
              className="font-mono text-sm pr-10"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
              onClick={() => setShowAppSecret(!showAppSecret)}
            >
              {showAppSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Encontrado em Meta for Developers → Seu App → Settings → Basic → App Secret.
            Obrigatório para validar que os leads vieram realmente do Meta (HMAC-SHA256).
          </p>
        </div>

        {/* Page Access Token */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="meta-page-token" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Page Access Token (obrigatório)
            </Label>
            {hasPageAccessToken && (
              <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px] px-1.5 py-0">
                <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                Configurado
              </Badge>
            )}
          </div>
          <div className="relative">
            <Input
              id="meta-page-token"
              placeholder={hasPageAccessToken ? '•••••••••••••••• (valor salvo — preencha apenas para alterar)' : 'EAAxxxxxxxxxxxxxxxxx...'}
              value={pageAccessToken}
              onChange={(e) => setPageAccessToken(e.target.value)}
              type={showPageToken ? 'text' : 'password'}
              className="font-mono text-sm pr-10"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
              onClick={() => setShowPageToken(!showPageToken)}
            >
              {showPageToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Necessário para buscar dados do lead (o Meta envia apenas o ID no webhook).
            Para obter: acesse o <span className="text-blue-600 dark:text-blue-400 font-medium cursor-pointer" onClick={() => window.open('https://developers.facebook.com/tools/explorer/', '_blank')}>Graph API Explorer</span>, selecione sua Página como Token User, marque a permissão <code className="bg-muted px-1 rounded">pages_read_engagement</code> e copie o token gerado.
          </p>
        </div>

        <Separator />

        {/* Botões */}
        <div className="flex items-center gap-2">
          <Button
            onClick={saveConfig}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 text-white flex-1"
          >
            {saving ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Salvando...</>
            ) : (
              <><Save className="h-4 w-4 mr-2" /> Salvar Configurações</>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={checkWebhookStatus}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Testar
          </Button>
        </div>

        {/* Tutorial colapsável */}
        <div className="space-y-2">
          <details className="group">
            <summary className="text-xs font-medium text-blue-600 dark:text-blue-400 cursor-pointer hover:underline flex items-center gap-1">
              Como configurar no Meta Ads
            </summary>
            <ol className="mt-2 text-[11px] text-muted-foreground space-y-1.5 list-decimal list-inside">
              <li>
                Acesse o{' '}
                <span
                  className="text-blue-600 dark:text-blue-400 font-medium cursor-pointer inline-flex items-center gap-0.5"
                  onClick={() => window.open('https://developers.facebook.com/apps/', '_blank')}
                >
                  Meta for Developers <ExternalLink className="h-2.5 w-2.5" />
                </span>
                {' '}e crie/abra seu App
              </li>
              <li>Vá em <strong>Settings → Basic</strong> e copie o <strong>App Secret</strong></li>
              <li>No menu lateral, vá em <strong>Webhooks → Adicionar</strong></li>
              <li>
                Cole a <strong>URL do Webhook</strong> (acima) no campo Callback URL
              </li>
              <li>
                Cole o <strong>Token de Verificação</strong> no campo Verify Token
              </li>
              <li>
                Em &quot;Subscribe to&quot;, selecione <strong>leadgen</strong> (Lead Ads)
              </li>
              <li>
                No <strong>Ads Manager</strong>, crie um formulário de Lead Ads
              </li>
              <li>
                Ao publicar o anúncio, os leads serão criados automaticamente no CRM com stage <strong>LEAD</strong>
              </li>
            </ol>
          </details>
        </div>
      </CardContent>
    </Card>
  );
}

export function SettingsView() {
  const { theme, setTheme } = useTheme();
  const { data: session, update: updateSession } = useSession();
  const userRole = (session?.user as { role?: string })?.role;
  const isAdmin = userRole === 'ADMIN';

  // Perfil do usuário
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Google Calendar
  const [gcConnected, setGcConnected] = useState(false);
  const [gcLoading, setGcLoading] = useState(true);
  const [gcConnecting, setGcConnecting] = useState(false);
  const [gcDisconnecting, setGcDisconnecting] = useState(false);

  useEffect(() => {
    // Verificar status da conexão Google Calendar
    fetch('/api/google-calendar/status')
      .then((r) => r.json())
      .then((data) => setGcConnected(data.connected === true))
      .catch(() => {})
      .finally(() => setGcLoading(false));

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
        body: JSON.stringify({ name: userName.trim() }),
      });

      if (res.ok) {
        toast.success('Nome atualizado com sucesso!');
        // Atualizar a sessão para refletir o novo nome na sidebar
        await updateSession({ name: userName.trim() });
      } else {
        const data = await res.json();
        throw new Error(data.error || 'Erro ao salvar');
      }
    } catch {
      toast.error('Erro ao atualizar nome');
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
            <Button onClick={saveProfile} disabled={savingProfile}>
              {savingProfile ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Salvando...</>
              ) : (
                <><Save className="h-4 w-4 mr-2" /> Salvar Nome</>
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

        {/* ==================== META ADS (Admin) ==================== */}
        {isAdmin && <MetaAdsCard />}

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
