'use client';

import React, { useEffect, useState } from 'react';
import { Moon, Sun, Database, Wifi, WifiOff, CheckCircle2, Circle, Copy, ExternalLink, User, Loader2, Save, CalendarDays, Link2, Unlink } from 'lucide-react';
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
