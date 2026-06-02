'use client';

import React, { useEffect, useState } from 'react';
import { Moon, Sun, Database, Monitor, Globe, Wifi, WifiOff, CheckCircle2, Circle, Copy, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

export function SettingsView() {
  const { theme, setTheme } = useTheme();
  const [crmName, setCrmName] = useState('CRM Pro');
  const [defaultRegion, setDefaultRegion] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const isSupabaseConfigured = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  useEffect(() => {
    fetchSettings();
  }, []);

  async function fetchSettings() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (data.crmName) setCrmName(data.crmName);
      if (data.defaultRegion) setDefaultRegion(data.defaultRegion);
    } catch (err) {
      console.error('Error fetching settings:', err);
    } finally {
      setLoading(false);
    }
  }

  async function saveSetting(key: string, value: string) {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      if (res.ok) {
        toast.success('Configuração salva com sucesso!');
      } else {
        throw new Error('Erro ao salvar');
      }
    } catch {
      toast.error('Erro ao salvar configuração');
    } finally {
      setSaving(false);
    }
  }

  function handleSaveCrmName() {
    if (!crmName.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }
    saveSetting('crmName', crmName.trim());
  }

  function handleSaveDefaultRegion() {
    saveSetting('defaultRegion', defaultRegion.trim());
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado!`);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground mt-1">
          Personalize o seu CRM
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Theme */}
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

        {/* CRM Name */}
        <Card className="hover:shadow-md transition-shadow duration-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Monitor className="h-4 w-4 text-emerald-500" />
              Nome do CRM
            </CardTitle>
            <CardDescription>
              Personalize o nome exibido no sistema
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="crm-name">Nome</Label>
              <Input
                id="crm-name"
                placeholder="CRM Pro"
                value={crmName}
                onChange={(e) => setCrmName(e.target.value)}
                disabled={loading}
              />
            </div>
            <Button onClick={handleSaveCrmName} disabled={saving || loading}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </CardContent>
        </Card>

        {/* Default Region */}
        <Card className="hover:shadow-md transition-shadow duration-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Globe className="h-4 w-4 text-emerald-500" />
              Região Padrão
            </CardTitle>
            <CardDescription>
              Defina uma região padrão para novos clientes
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="default-region">Região Padrão</Label>
              <Input
                id="default-region"
                placeholder="Ex: São Paulo"
                value={defaultRegion}
                onChange={(e) => setDefaultRegion(e.target.value)}
                disabled={loading}
              />
            </div>
            <Button onClick={handleSaveDefaultRegion} disabled={saving || loading}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar
            </Button>
          </CardContent>
        </Card>

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
            {/* Connection Status */}
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

            {/* Features List */}
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
                  <span>
                    <strong>PostgreSQL na nuvem</strong> — Banco de dados relacional
                    robusto e escalável hospedado na infraestrutura do Supabase
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  {isSupabaseConfigured ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                  )}
                  <span>
                    <strong>Real-time subscriptions</strong> — Alterações nos dados
                    são refletidas instantaneamente em todas as sessões conectadas
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  {isSupabaseConfigured ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                  )}
                  <span>
                    <strong>Connection Pooling</strong> — Conexões otimizadas para
                    serverless (Vercel) usando PgBouncer na porta 6543
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  {isSupabaseConfigured ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                  )}
                  <span>
                    <strong>Prisma ORM</strong> — Type-safe queries com migrations
                    automáticas para PostgreSQL
                  </span>
                </li>
              </ul>
            </div>

            <Separator />

            {/* Setup Instructions */}
            {!isSupabaseConfigured && (
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Como configurar o Supabase
                </h4>
                <ol className="text-xs text-muted-foreground space-y-2 list-decimal list-inside">
                  <li>
                    Crie um projeto em{' '}
                    <span
                      className="text-emerald-600 dark:text-emerald-400 font-medium cursor-pointer inline-flex items-center gap-1"
                      onClick={() => window.open('https://supabase.com', '_blank')}
                    >
                      supabase.com <ExternalLink className="h-2.5 w-2.5" />
                    </span>
                  </li>
                  <li>
                    Acesse <strong>Settings → API</strong> e copie a URL e a chave anônima
                  </li>
                  <li>
                    Acesse <strong>Settings → Database</strong> e copie a string de conexão
                    (use a versão com Connection Pooling - porta 6543)
                  </li>
                  <li>
                    No painel do Vercel, adicione as variáveis de ambiente:
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center gap-2 p-2 rounded bg-muted/50 font-mono text-[10px]">
                        <code className="flex-1">DATABASE_URL</code>
                        <button onClick={() => copyToClipboard('DATABASE_URL', 'Variável')} className="text-muted-foreground hover:text-foreground">
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 p-2 rounded bg-muted/50 font-mono text-[10px]">
                        <code className="flex-1">NEXT_PUBLIC_SUPABASE_URL</code>
                        <button onClick={() => copyToClipboard('NEXT_PUBLIC_SUPABASE_URL', 'Variável')} className="text-muted-foreground hover:text-foreground">
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 p-2 rounded bg-muted/50 font-mono text-[10px]">
                        <code className="flex-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
                        <button onClick={() => copyToClipboard('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'Variável')} className="text-muted-foreground hover:text-foreground">
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </li>
                  <li>
                    No Supabase, acesse <strong>Database → Enable Realtime</strong> e
                    ative as tabelas: clients, tags, client_tags, reminders, user_settings
                  </li>
                  <li>
                    Execute <code className="px-1 py-0.5 rounded bg-muted text-[10px]">npx prisma db push</code>{' '}
                    para criar as tabelas no Supabase PostgreSQL
                  </li>
                </ol>
              </div>
            )}

            {/* Architecture Info */}
            {isSupabaseConfigured && (
              <div className="p-3 rounded-lg bg-emerald-100/50 dark:bg-emerald-900/20">
                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  Seu CRM está conectado ao Supabase com atualizações em tempo real.
                  Todas as alterações feitas por qualquer dispositivo ou sessão serão
                  refletidas automaticamente na interface.
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

              <div className="flex justify-center">
                <div className="h-6 w-px bg-border" />
              </div>

              <div className="flex items-center gap-3 p-3 rounded-lg border">
                <div className="h-8 w-8 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm">⚡</span>
                </div>
                <div className="flex-1">
                  <p className="font-medium">Supabase Realtime</p>
                  <p className="text-[10px]">Detecta mudança no PostgreSQL e broadcasts via WebSocket</p>
                </div>
              </div>

              <div className="flex justify-center">
                <div className="h-6 w-px bg-border" />
              </div>

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
      </div>
    </div>
  );
}
