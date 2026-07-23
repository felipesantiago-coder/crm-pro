'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Trash2, RefreshCw, Eye, EyeOff, CheckCircle2, Circle,
  Loader2, Pencil, ExternalLink, Wallet, Building2, AlertCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface Account {
  id: string;
  label: string;
  adAccountId: string;
  isActive: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function AccountsTab({ onAccountsChanged }: { onAccountsChanged?: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Form state
  const [formLabel, setFormLabel] = useState('');
  const [formAdAccountId, setFormAdAccountId] = useState('');
  const [formToken, setFormToken] = useState('');
  const [showToken, setShowToken] = useState(false);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/meta-ads/accounts');
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
      }
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  async function handleSave() {
    if (!formAdAccountId.trim()) {
      toast.error('ID da conta é obrigatório (ex: act_123456789)');
      return;
    }
    if (!formToken.trim()) {
      toast.error('Access Token é obrigatório');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/meta-ads/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: formLabel.trim() || undefined,
          adAccountId: formAdAccountId.trim(),
          accessToken: formToken.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok) {
        toast.success(data.message);
        setShowForm(false);
        setFormLabel('');
        setFormAdAccountId('');
        setFormToken('');
        fetchAccounts();
        onAccountsChanged?.();
      } else {
        toast.error(data.error || 'Erro ao conectar conta');
      }
    } catch {
      toast.error('Falha de conexão');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(id: string, currentActive: boolean) {
    try {
      const res = await fetch('/api/meta-ads/accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isActive: !currentActive }),
      });
      if (res.ok) {
        fetchAccounts();
        onAccountsChanged?.();
      }
    } catch {
      toast.error('Erro ao alterar status');
    }
  }

  async function deleteAccount(id: string) {
    if (!confirm('Remover esta conta? Os dados de campanhas não serão afetados, mas as métricas em tempo real pararão de atualizar.'))
      return;

    setDeleting(id);
    try {
      const res = await fetch(`/api/meta-ads/accounts?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Conta removida');
        fetchAccounts();
        onAccountsChanged?.();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Erro ao remover');
      }
    } catch {
      toast.error('Falha de conexão');
    } finally {
      setDeleting(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Contas de Anúncios</h2>
          <p className="text-sm text-muted-foreground">
            Conecte suas contas do Meta Ads para gerenciar campanhas
          </p>
        </div>
        <Button
          onClick={() => setShowForm(!showForm)}
          size="sm"
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          <Plus className="h-4 w-4 mr-1" />
          Adicionar Conta
        </Button>
      </div>

      {/* Add Form */}
      {showForm && (
        <Card className="border-blue-200 dark:border-blue-800/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Conectar Conta de Anúncios</CardTitle>
            <CardDescription className="text-xs">
              Você precisa de um System User Token com a permissão <code className="bg-muted px-1 rounded">ads_read</code> do Meta Business Manager.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Label (nome da conta no CRM)</Label>
              <Input
                placeholder="Ex: Imobiliária Central"
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Ad Account ID *</Label>
              <Input
                placeholder="act_123456789012345"
                value={formAdAccountId}
                onChange={(e) => setFormAdAccountId(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Access Token *</Label>
              <div className="relative">
                <Input
                  type={showToken ? 'text' : 'password'}
                  placeholder="EAAxxxxxxxxxxxxxxxxx..."
                  value={formToken}
                  onChange={(e) => setFormToken(e.target.value)}
                  className="font-mono text-sm pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                  onClick={() => setShowToken(!showToken)}
                >
                  {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving} size="sm" className="bg-blue-600 hover:bg-blue-700 text-white">
                {saving ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Conectando...</> : 'Conectar'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancelar</Button>
            </div>
            <details className="group">
              <summary className="text-[11px] text-blue-600 dark:text-blue-400 cursor-pointer hover:underline">
                Como obter o Token?
              </summary>
              <ol className="mt-1.5 text-[11px] text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Acesse o <strong>Meta Business Settings</strong></li>
                <li>Vá em <strong>Users → System Users</strong> e crie um usuário (ou use existente)</li>
                <li>Atribua permissões de <strong>ads_read</strong> e <strong>pages_read_engagement</strong></li>
                <li>Gere um <strong>System User Token</strong> com essas permissões</li>
                <li>Copie o <strong>Ad Account ID</strong> em Business Settings → Accounts</li>
              </ol>
            </details>
          </CardContent>
        </Card>
      )}

      {/* Accounts List */}
      {accounts.length === 0 && !showForm ? (
        <Card className="py-12">
          <CardContent className="text-center text-muted-foreground">
            <Building2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">Nenhuma conta conectada</p>
            <p className="text-xs mt-1">Adicione sua conta do Meta Ads para ver campanhas e métricas em tempo real</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => (
            <Card key={account.id} className={!account.isActive ? 'opacity-60' : ''}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{account.label}</span>
                      {account.isActive ? (
                        <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px]">
                          <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> Ativa
                        </Badge>
                      ) : (
                        <Badge className="bg-muted text-muted-foreground text-[10px]">
                          <Circle className="h-2.5 w-2.5 mr-0.5" /> Inativa
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span className="font-mono">{account.adAccountId}</span>
                      {account.lastSyncedAt && (
                        <span>Sinc: {format(parseISO(account.lastSyncedAt), "dd/MM HH:mm", { locale: ptBR })}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Switch
                      checked={account.isActive}
                      onCheckedChange={() => toggleActive(account.id, account.isActive)}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                      onClick={() => deleteAccount(account.id)}
                      disabled={deleting === account.id}
                    >
                      {deleting === account.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
