'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Megaphone, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

// ============================================================
// CampaignBindingsSection — Fila ESPECÍFICA por campanha (campaignId)
// As campanhas são auto-registradas quando um lead chega (webhook ou
// polling). Aqui o admin atribui a fila de cada campanha e corrige a
// conta de anúncios de origem — campanhas de contas diferentes ficam
// independentes entre si. Prioridade máxima no roteamento.
// ============================================================

interface CampaignBindingItem {
  id: string;
  campaignId: string;
  campaignName: string | null;
  adAccountId: string | null;
  account?: { id: string; name: string; adAccountId: string; enabled: boolean } | null;
  queueId: string | null;
  queue?: { id: string; name: string; isActive: boolean } | null;
  leadCount: number;
  lastSeenAt: string;
}

interface QueueOption {
  id: string;
  name: string;
  isActive: boolean;
}

interface AdAccountOption {
  id: string;
  name: string;
  adAccountId: string;
  enabled: boolean;
}

export function CampaignBindingsSection() {
  const [bindings, setBindings] = useState<CampaignBindingItem[]>([]);
  const [queues, setQueues] = useState<QueueOption[]>([]);
  const [accounts, setAccounts] = useState<AdAccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [newCampaignId, setNewCampaignId] = useState('');
  const [newCampaignName, setNewCampaignName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bindRes, queueRes, accRes] = await Promise.all([
        fetch('/api/meta-campaign-bindings'),
        fetch('/api/lead-queues'),
        fetch('/api/meta-ad-accounts'),
      ]);
      const [bindData, queueData, accData] = await Promise.all([
        bindRes.json(),
        queueRes.json(),
        accRes.json(),
      ]);
      setBindings(Array.isArray(bindData) ? bindData : []);
      setQueues(Array.isArray(queueData) ? queueData : []);
      setAccounts(Array.isArray(accData) ? accData : []);
    } catch (err) {
      console.error('[Campaign Bindings UI] Falha ao carregar:', err);
      toast.error('Erro ao carregar vínculos de campanhas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const updateBinding = async (
    binding: CampaignBindingItem,
    patch: { queueId?: string | null; adAccountId?: string | null }
  ) => {
    setSavingId(binding.id);
    try {
      const res = await fetch('/api/meta-campaign-bindings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: binding.campaignId, ...patch }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || 'Erro ao salvar vínculo');
        return;
      }
      toast.success('Vínculo salvo — leads desta campanha usarão a fila definida');
      await load();
    } catch {
      toast.error('Erro ao salvar vínculo');
    } finally {
      setSavingId(null);
    }
  };

  const createBinding = async () => {
    if (!newCampaignId.trim()) {
      toast.error('Informe o Campaign ID');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/meta-campaign-bindings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: newCampaignId.trim(),
          campaignName: newCampaignName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || 'Erro ao registrar campanha');
        return;
      }
      toast.success('Campanha registrada — agora defina a fila dela');
      setNewCampaignId('');
      setNewCampaignName('');
      await load();
    } catch {
      toast.error('Erro ao registrar campanha');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-accent/40 dark:bg-accent/20 border border-accent p-3 space-y-2">
        <p className="text-xs font-semibold text-accent-foreground">Fila por campanha (campaignId)</p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Campanhas são detectadas <strong>automaticamente</strong> quando leads chegam (webhook ou polling). Vincule a <strong>fila de atendimento de cada campanha</strong> — tem <strong>prioridade</strong> sobre o vínculo por formulário e sobre a fila da conta. Assim campanhas de contas diferentes podem ser atendidas por equipes diferentes, de forma independente.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Carregando campanhas...
        </div>
      ) : bindings.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          Nenhuma campanha detectada ainda. Assim que o primeiro lead chegar com campaign_id, ela aparece aqui automaticamente. Você também pode registrar uma campanha manualmente abaixo.
        </div>
      ) : (
        <div className="space-y-2">
          {bindings.map((binding) => (
            <Card key={binding.id}>
              <CardContent className="p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Megaphone className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm font-medium">{binding.campaignName || 'Campanha sem nome'}</span>
                      <Badge variant="outline" className="text-[10px] font-mono">{binding.campaignId}</Badge>
                      {binding.account && (
                        <Badge variant="outline" className="text-[10px]">
                          {binding.account.name}
                        </Badge>
                      )}
                      <Badge variant="secondary" className="text-[10px]">{binding.leadCount} lead(s)</Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Último lead: {new Date(binding.lastSeenAt).toLocaleString('pt-BR')}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Conta de anúncios</Label>
                      <Select
                        value={binding.adAccountId || 'none'}
                        onValueChange={(v) => updateBinding(binding, { adAccountId: v === 'none' ? null : v })}
                        disabled={savingId === binding.id}
                      >
                        <SelectTrigger className="h-8 w-[170px] text-xs">
                          <SelectValue placeholder="Sem conta" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sem conta</SelectItem>
                          {accounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.name}{!a.enabled ? ' (inativa)' : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Fila da campanha</Label>
                      <Select
                        value={binding.queueId || 'default'}
                        onValueChange={(v) => updateBinding(binding, { queueId: v === 'default' ? null : v })}
                        disabled={savingId === binding.id}
                      >
                        <SelectTrigger className="h-8 w-[170px] text-xs">
                          <SelectValue placeholder="Fila padrão" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">Fila padrão</SelectItem>
                          {queues.map((q) => (
                            <SelectItem key={q.id} value={q.id}>
                              {q.name}{!q.isActive ? ' (inativa)' : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {savingId === binding.id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Registro manual */}
      <div className="rounded-lg border p-3 space-y-2">
        <p className="text-xs font-medium">Registrar campanha manualmente</p>
        <div className="flex flex-wrap gap-2">
          <Input
            className="h-8 flex-1 min-w-[160px] text-xs font-mono"
            placeholder="Campaign ID (ex: 120210456789012345)"
            value={newCampaignId}
            onChange={(e) => setNewCampaignId(e.target.value)}
          />
          <Input
            className="h-8 flex-1 min-w-[160px] text-xs"
            placeholder="Nome da campanha (opcional)"
            value={newCampaignName}
            onChange={(e) => setNewCampaignName(e.target.value)}
          />
          <Button size="sm" onClick={createBinding} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            Registrar
          </Button>
        </div>
      </div>
    </div>
  );
}
