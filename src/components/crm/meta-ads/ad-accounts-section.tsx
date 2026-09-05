'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Building2,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

// ============================================================
// AdAccountsSection — Gestão de contas de anúncios Meta (multi-conta)
// Cada conta tem token próprio (captação webhook/polling), verify
// token e app secret opcionais de webhook, page_ids, form_ids e fila
// default. Campanhas de contas diferentes ficam independentes.
// ============================================================

interface AdAccountItem {
  id: string;
  name: string;
  adAccountId: string;
  accessTokenMasked?: string | null;
  hasVerifyToken?: boolean;
  hasAppSecret?: boolean;
  pageIds?: string | null;
  formIds?: string | null;
  enabled: boolean;
  isDefault: boolean;
  queueId: string | null;
  queue?: { id: string; name: string; isActive: boolean } | null;
  _count?: { campaignBindings: number; formMappings: number; capiConfigs: number };
}

interface QueueOption {
  id: string;
  name: string;
  isActive: boolean;
}

interface AdAccountFormState {
  name: string;
  adAccountId: string;
  accessToken: string;
  verifyToken: string;
  appSecret: string;
  pageIds: string;
  formIds: string;
  queueId: string;
  enabled: boolean;
  isDefault: boolean;
}

const EMPTY_FORM: AdAccountFormState = {
  name: '',
  adAccountId: '',
  accessToken: '',
  verifyToken: '',
  appSecret: '',
  pageIds: '',
  formIds: '',
  queueId: '',
  enabled: true,
  isDefault: false,
};

function parseLines(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {}
  return [];
}

export function AdAccountsSection() {
  const [accounts, setAccounts] = useState<AdAccountItem[]>([]);
  const [queues, setQueues] = useState<QueueOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<AdAccountItem | null>(null);
  const [form, setForm] = useState<AdAccountFormState>(EMPTY_FORM);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [accRes, queueRes] = await Promise.all([
        fetch('/api/meta-ad-accounts'),
        fetch('/api/lead-queues'),
      ]);
      const accData = await accRes.json();
      const queueData = await queueRes.json();
      setAccounts(Array.isArray(accData) ? accData : []);
      setQueues(Array.isArray(queueData) ? queueData : []);
    } catch (err) {
      console.error('[Ad Accounts UI] Falha ao carregar:', err);
      toast.error('Erro ao carregar contas de anúncios');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowToken(false);
    setShowDialog(true);
  };

  const openEdit = (account: AdAccountItem) => {
    setEditing(account);
    setForm({
      name: account.name,
      adAccountId: account.adAccountId,
      accessToken: '',
      verifyToken: '',
      appSecret: '',
      pageIds: parseLines(account.pageIds).join('\n'),
      formIds: parseLines(account.formIds).join('\n'),
      queueId: account.queueId || '',
      enabled: account.enabled,
      isDefault: account.isDefault,
    });
    setShowToken(false);
    setShowDialog(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.adAccountId.trim() || (!editing && !form.accessToken.trim())) {
      toast.error('Preencha nome, ID da conta e access token');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        adAccountId: form.adAccountId.trim(),
        pageIds: form.pageIds.split(/[\n,;]/).map((s) => s.trim()).filter(Boolean),
        formIds: form.formIds.split(/[\n,;]/).map((s) => s.trim()).filter(Boolean),
        queueId: form.queueId || null,
        enabled: form.enabled,
        isDefault: form.isDefault,
      };
      if (form.accessToken.trim()) payload.accessToken = form.accessToken.trim();

      const res = editing
        ? await fetch(`/api/meta-ad-accounts/${editing.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/meta-ad-accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...payload, accessToken: form.accessToken.trim() }),
          });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || 'Erro ao salvar conta');
        return;
      }
      toast.success(editing ? 'Conta atualizada!' : 'Conta criada! Leads dela serão capturados com o token dela.');
      setShowDialog(false);
      await load();
    } catch (err) {
      console.error('[Ad Accounts UI] Erro ao salvar:', err);
      toast.error('Erro ao salvar conta');
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (account: AdAccountItem) => {
    try {
      const res = await fetch(`/api/meta-ad-accounts/${account.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !account.enabled }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data?.error || 'Erro ao alterar conta');
        return;
      }
      toast.success(account.enabled ? 'Conta desativada' : 'Conta ativada');
      await load();
    } catch {
      toast.error('Erro ao alterar conta');
    }
  };

  const remove = async (account: AdAccountItem) => {
    if (!confirm(`Remover a conta "${account.name}"? Vínculos de campanhas e formulários serão mantidos, mas sem conta associada.`)) return;
    try {
      const res = await fetch(`/api/meta-ad-accounts/${account.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data?.error || 'Erro ao remover conta');
        return;
      }
      toast.success('Conta removida');
      await load();
    } catch {
      toast.error('Erro ao remover conta');
    }
  };

  const syncForms = async (account: AdAccountItem) => {
    setSyncingId(account.id);
    try {
      const res = await fetch(`/api/meta-ad-accounts/${account.id}/sync-forms`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || 'Erro ao sincronizar formulários');
        return;
      }
      toast.success(data?.message || 'Formulários sincronizados');
      await load();
    } catch {
      toast.error('Erro ao sincronizar formulários');
    } finally {
      setSyncingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* O que faz */}
      <div className="rounded-lg bg-accent/40 dark:bg-accent/20 border border-accent p-3 space-y-2">
        <p className="text-xs font-semibold text-accent-foreground">O que esta seção faz</p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Cadastre <strong>contas de anúncios diferentes</strong>, cada uma com o seu <strong>access token próprio</strong>. O polling consulta os formulários de cada conta com o token dela, e o webhook usa o token da conta (resolvida pela página) para buscar os dados dos leads. Assim campanhas de <strong>contas diferentes</strong> são capturadas e geridas de forma <strong>independente</strong>.
        </p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          <strong>Campos opcionais:</strong> <em>Verify Token</em> e <em>App Secret</em> permitem assinar o webhook de cada conta separadamente; <em>Page IDs</em> ligam páginas do Facebook à conta (o webhook usa o ID da página para identificar a origem); <em>Fila</em> define a fila default para leads da conta (a fila da campanha/formulário, quando definida, tem prioridade).
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          Contas cadastradas ({accounts.length})
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" /> Nova conta
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Carregando contas...
        </div>
      ) : accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nenhuma conta cadastrada. O CRM segue funcionando com o token global (Seções 1 e 2).
          Cadastre contas para capturar leads de contas de anúncios diferentes de forma independente.
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map((account) => (
            <Card key={account.id} className={!account.enabled ? 'opacity-60' : ''}>
              <CardContent className="p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex-1 min-w-[180px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{account.name}</span>
                      <Badge variant="outline" className="text-[10px] font-mono">{account.adAccountId}</Badge>
                      {account.isDefault && (
                        <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-[10px]">padrão</Badge>
                      )}
                      {account.enabled ? (
                        <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px] gap-1">
                          <CheckCircle2 className="h-2.5 w-2.5" /> ativa
                        </Badge>
                      ) : (
                        <Badge className="bg-muted text-muted-foreground text-[10px]">inativa</Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>Token: {account.accessTokenMasked || '—'}</span>
                      {account.hasVerifyToken && <span className="text-green-600 dark:text-green-400">verify próprio</span>}
                      {account.hasAppSecret && <span className="text-green-600 dark:text-green-400">secret próprio</span>}
                      <span>{parseLines(account.pageIds).length} página(s)</span>
                      <span>{parseLines(account.formIds).length} form(s)</span>
                      <span>Fila: {account.queue?.name || 'padrão global'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Switch
                      checked={account.enabled}
                      onCheckedChange={() => toggleEnabled(account)}
                      aria-label={`Ativar/desativar conta ${account.name}`}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => syncForms(account)}
                      disabled={syncingId === account.id}
                      title="Busca os formulários de lead desta conta via Graph API (com o token dela)"
                    >
                      {syncingId === account.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      <span className="ml-1 hidden sm:inline">Sync Forms</span>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openEdit(account)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" onClick={() => remove(account)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog criar/editar */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Editar conta: ${editing.name}` : 'Nova conta de anúncios'}</DialogTitle>
            <DialogDescription>
              A conta permite capturar leads com o próprio token dela — webhook (por página) e polling (por formulários da conta).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="acc-name">Nome *</Label>
              <Input
                id="acc-name"
                placeholder='ex: "Porto - Conta Principal"'
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="acc-id">ID da conta *</Label>
                <Input
                  id="acc-id"
                  placeholder="act_123456789 ou 123456789"
                  value={form.adAccountId}
                  onChange={(e) => setForm({ ...form, adAccountId: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acc-token">Access Token {editing ? '(vazio = manter)' : '*'}</Label>
                <div className="flex gap-1">
                  <Input
                    id="acc-token"
                    type={showToken ? 'text' : 'password'}
                    placeholder="System User / Page token"
                    value={form.accessToken}
                    onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowToken((v) => !v)}>
                    {showToken ? 'Ocultar' : 'Ver'}
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="acc-verify">Verify Token (opcional)</Label>
                <Input
                  id="acc-verify"
                  placeholder="verify token do webhook desta conta"
                  value={form.verifyToken}
                  onChange={(e) => setForm({ ...form, verifyToken: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acc-secret">App Secret (opcional)</Label>
                <Input
                  id="acc-secret"
                  type="password"
                  placeholder="valida HMAC do webhook desta conta"
                  value={form.appSecret}
                  onChange={(e) => setForm({ ...form, appSecret: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="acc-pages">Page IDs (opcional)</Label>
                <Textarea
                  id="acc-pages"
                  rows={2}
                  placeholder={'Um por linha:\n111222333\n444555666'}
                  value={form.pageIds}
                  onChange={(e) => setForm({ ...form, pageIds: e.target.value })}
                />
                <p className="text-[10px] text-muted-foreground">O webhook usa o ID da página (entry) para saber de qual conta veio o lead e usar o token dela.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acc-forms">Form IDs (opcional)</Label>
                <Textarea
                  id="acc-forms"
                  rows={2}
                  placeholder={'Um por linha (ou use "Sync Forms"):\n123456789012345\n654321098765432'}
                  value={form.formIds}
                  onChange={(e) => setForm({ ...form, formIds: e.target.value })}
                />
                <p className="text-[10px] text-muted-foreground">O polling consulta estes formulários com o token desta conta. O botão “Sync Forms” preenche automaticamente.</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Fila default da conta</Label>
                <Select
                  value={form.queueId || 'none'}
                  onValueChange={(v) => setForm({ ...form, queueId: v === 'none' ? '' : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Fila padrão global" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Fila padrão global</SelectItem>
                    {queues.map((q) => (
                      <SelectItem key={q.id} value={q.id}>
                        {q.name}{!q.isActive ? ' (inativa)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">Usada quando a campanha e o formulário não têm fila própria.</p>
              </div>
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between rounded-lg border p-2.5">
                  <Label htmlFor="acc-enabled" className="text-xs cursor-pointer">Conta ativa</Label>
                  <Switch
                    id="acc-enabled"
                    checked={form.enabled}
                    onCheckedChange={(v) => setForm({ ...form, enabled: v })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-2.5">
                  <Label htmlFor="acc-default" className="text-xs cursor-pointer">Conta padrão</Label>
                  <Switch
                    id="acc-default"
                    checked={form.isDefault}
                    onCheckedChange={(v) => setForm({ ...form, isDefault: v })}
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editing ? 'Salvar alterações' : 'Criar conta'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
