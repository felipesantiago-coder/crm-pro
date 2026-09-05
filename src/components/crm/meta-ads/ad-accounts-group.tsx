'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Building2, Info, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  AccountConfigCard,
  type AdAccountData,
  type BindingItem,
  type CapiOption,
  type GroupedMapping,
  type QueueOption,
} from './account-config-card';

// ============================================================
// AdAccountsGroup — Grupo "Contas de Anúncio": cada conta agrupa as
// PRÓPRIAS configurações (webhook, polling, campanhas, formulários,
// CAPI e fila default) de maneira clara, sem se misturar com as
// demais contas nem com a configuração global (fallback).
// ============================================================

interface AccountDialogState {
  name: string;
  adAccountId: string;
  accessToken: string;
  isDefault: boolean;
  enabled: boolean;
}

const EMPTY_DIALOG: AccountDialogState = { name: '', adAccountId: '', accessToken: '', isDefault: false, enabled: true };

export function AdAccountsGroup() {
  const [accounts, setAccounts] = useState<AdAccountData[]>([]);
  const [queues, setQueues] = useState<QueueOption[]>([]);
  const [capiConfigs, setCapiConfigs] = useState<CapiOption[]>([]);
  const [bindings, setBindings] = useState<BindingItem[]>([]);
  const [mappings, setMappings] = useState<GroupedMapping[]>([]);
  const [loading, setLoading] = useState(true);

  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<AdAccountData | null>(null);
  const [form, setForm] = useState<AccountDialogState>(EMPTY_DIALOG);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [accRes, queueRes, capiRes, bindRes, mapRes] = await Promise.all([
        fetch('/api/meta-ad-accounts'),
        fetch('/api/lead-queues'),
        fetch('/api/meta-capi-configs'),
        fetch('/api/meta-campaign-bindings'),
        fetch('/api/meta-capi-configs/form-mappings?grouped=true'),
      ]);
      const [accData, queueData, capiData, bindData, mapData] = await Promise.all([
        accRes.json().catch(() => []),
        queueRes.json().catch(() => []),
        capiRes.json().catch(() => []),
        bindRes.json().catch(() => []),
        mapRes.json().catch(() => []),
      ]);
      setAccounts(Array.isArray(accData) ? accData : []);
      setQueues(Array.isArray(queueData) ? queueData : []);
      setCapiConfigs(Array.isArray(capiData) ? capiData : []);
      setBindings(Array.isArray(bindData) ? bindData : []);
      setMappings(Array.isArray(mapData) ? mapData : []);
    } catch (err) {
      console.error('[Ad Accounts Group] Falha ao carregar:', err);
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
    setForm(EMPTY_DIALOG);
    setShowDialog(true);
  };

  const openEdit = (account: AdAccountData) => {
    setEditing(account);
    setForm({
      name: account.name,
      adAccountId: account.adAccountId,
      accessToken: '',
      isDefault: account.isDefault,
      enabled: account.enabled,
    });
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
        isDefault: form.isDefault,
        enabled: form.enabled,
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
      toast.success(editing ? 'Dados da conta atualizados' : 'Conta criada! Agora configure o webhook e o polling dentro do card dela.');
      setShowDialog(false);
      await load();
    } catch (err) {
      console.error('[Ad Accounts Group] Erro ao salvar:', err);
      toast.error('Erro ao salvar conta');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (account: AdAccountData) => {
    if (!confirm(`Remover a conta "${account.name}"? Vínculos de campanhas e formulários serão mantidos, mas sem conta associada (voltam para o grupo global).`)) return;
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

  return (
    <div className="space-y-4">
      {/* O que faz */}
      <div className="rounded-lg bg-teal-50/60 dark:bg-teal-950/10 border border-teal-100 dark:border-teal-900/30 p-3 space-y-2">
        <p className="text-xs font-semibold text-teal-800 dark:text-teal-200 flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5" /> Configurações agrupadas por conta
        </p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Cada conta de anúncios abaixo <strong>agrupa as próprias configurações</strong>: webhook (verify token, app secret, páginas e toggle próprios), polling (formulários consultados com o token dela e toggle próprio), campanhas (fila por campaignId), formulários aprendidos, datasets CAPI e fila default. <strong>Nada se mistura</strong> entre contas — desligar o webhook ou o polling de uma conta não afeta as outras.
        </p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          A configuração <strong>global</strong> (seções abaixo) funciona como <em>fallback</em>: é usada para leads sem conta associada e quando a conta não tem o próprio valor preenchido.
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
          Nenhuma conta cadastrada. O CRM segue funcionando com a configuração global (seções abaixo).
          Cadastre contas para que cada uma tenha webhook, polling, campanhas e CAPI próprios, isolados das demais.
        </div>
      ) : (
        <div className="space-y-2.5">
          {accounts.map((account) => (
            <AccountConfigCard
              key={account.id}
              account={account}
              queues={queues}
              capiConfigs={capiConfigs}
              bindings={bindings}
              mappings={mappings}
              onChanged={load}
              onEdit={openEdit}
              onDelete={remove}
            />
          ))}
        </div>
      )}

      {/* Dialog criar/editar — dados de identidade da conta */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? `Editar conta: ${editing.name}` : 'Nova conta de anúncios'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Dados de identificação e token. As configurações de webhook/polling/campanhas ficam no card da conta.'
                : 'Depois de criar, abra o card da conta para configurar o webhook, o polling e as filas dela — cada conta guarda as próprias configurações.'}
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
                <Input
                  id="acc-token"
                  type="password"
                  placeholder="System User / Page token"
                  value={form.accessToken}
                  onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg border p-2.5">
                <Label htmlFor="acc-enabled" className="text-xs cursor-pointer">Conta ativa (captação ligada)</Label>
                <Switch id="acc-enabled" checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-2.5">
                <Label htmlFor="acc-default" className="text-xs cursor-pointer">Conta padrão</Label>
                <Switch id="acc-default" checked={form.isDefault} onCheckedChange={(v) => setForm({ ...form, isDefault: v })} />
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
