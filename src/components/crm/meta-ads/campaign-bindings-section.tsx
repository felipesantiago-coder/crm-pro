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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Megaphone, Loader2, Save, Building2, ChevronsUpDown, Check, ImageOff, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

// ============================================================
// CampaignBindingsSection — Fila ESPECÍFICA por campanha (campaignId)
// As campanhas são auto-registradas quando um lead chega (webhook ou
// polling). Aqui o admin atribui a fila de cada campanha, corrige a
// conta de anúncios de origem e define o EMPREENDIMENTO da campanha —
// fonte da imagem do cartão de notificação (vínculo EXPLÍCITO; nunca
// por similaridade de nome, §9 do redesign).
//
// Uso duplo (settings agrupadas por conta):
//   • Global (sem props): todas as campanhas, com select de conta e
//     registro manual — mostra contagem total no grupo global/fallback.
//   • Dentro do card da conta (adAccountId + hideAccountSelect +
//     compact): mostra SOMENTE as campanhas desta conta, sem misturar
//     com as demais.
// ============================================================

interface CampaignBindingItem {
  id: string;
  campaignId: string;
  campaignName: string | null;
  adAccountId: string | null;
  account?: { id: string; name: string; adAccountId: string; enabled: boolean } | null;
  queueId: string | null;
  queue?: { id: string; name: string; isActive: boolean } | null;
  enterpriseId?: string | null;
  enterprise?: { id: string; name: string; imageUrl: string | null } | null;
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

interface EnterpriseOption {
  id: string;
  name: string;
  imageUrl: string | null;
}

interface CampaignBindingsSectionProps {
  /** Modo "dentro da conta": mostra somente campanhas desta conta. */
  adAccountId?: string;
  /** Esconde o select de conta de anúncios (contexto do card da conta). */
  hideAccountSelect?: boolean;
  /** Modo compacto: sem caixa explicativa e sem registro manual. */
  compact?: boolean;
  /** Modo global: mostra somente campanhas sem conta associada. */
  unassignedOnly?: boolean;
  /** Recarrega dados do pai após salvar (usado pelo card da conta). */
  onChanged?: () => void;
}

export function CampaignBindingsSection({ adAccountId, hideAccountSelect, compact, unassignedOnly, onChanged }: CampaignBindingsSectionProps = {}) {
  const [bindings, setBindings] = useState<CampaignBindingItem[]>([]);
  const [queues, setQueues] = useState<QueueOption[]>([]);
  const [accounts, setAccounts] = useState<AdAccountOption[]>([]);
  const [enterprises, setEnterprises] = useState<EnterpriseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [enterprisePopoverId, setEnterprisePopoverId] = useState<string | null>(null);
  const [newCampaignId, setNewCampaignId] = useState('');
  const [newCampaignName, setNewCampaignName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bindRes, queueRes, accRes, entRes] = await Promise.all([
        fetch('/api/meta-campaign-bindings'),
        fetch('/api/lead-queues'),
        fetch('/api/meta-ad-accounts'),
        fetch('/api/enterprises'),
      ]);
      const [bindData, queueData, accData, entData] = await Promise.all([
        bindRes.json(),
        queueRes.json(),
        accRes.json(),
        entRes.json(),
      ]);
      setBindings(Array.isArray(bindData) ? bindData : []);
      setQueues(Array.isArray(queueData) ? queueData : []);
      setAccounts(Array.isArray(accData) ? accData : []);
      setEnterprises(
        Array.isArray(entData)
          ? entData.map((e: { id: string; name: string; imageUrl?: string | null }) => ({
              id: e.id,
              name: e.name,
              imageUrl: e.imageUrl ?? null,
            }))
          : [],
      );
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
    patch: { queueId?: string | null; adAccountId?: string | null; enterpriseId?: string | null }
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
      toast.success(
        'enterpriseId' in patch
          ? 'Empreendimento da campanha salvo — o cartão usará a imagem dele'
          : 'Vínculo salvo — leads desta campanha usarão a fila definida',
      );
      await load();
      onChanged?.();
    } catch {
      toast.error('Erro ao salvar vínculo');
    } finally {
      setSavingId(null);
    }
  };

  /** Troca de empreendimento exige confirmação quando já existe vínculo ativo (§9.3). */
  const handleEnterpriseChange = (binding: CampaignBindingItem, nextEnterpriseId: string | null) => {
    if (binding.enterpriseId && nextEnterpriseId !== binding.enterpriseId) {
      const nextName = nextEnterpriseId
        ? enterprises.find((e) => e.id === nextEnterpriseId)?.name || 'novo empreendimento'
        : '(sem empreendimento)';
      const confirmed = window.confirm(
        `A campanha "${binding.campaignName || binding.campaignId}" já está vinculada a ` +
        `"${binding.enterprise?.name || binding.enterpriseId}".\n\n` +
        `Trocar o empreendimento altera a imagem enviada nos próximos cartões de lead. ` +
        `Confirmar troca para "${nextName}"?`,
      );
      if (!confirmed) return;
    }
    setEnterprisePopoverId(null);
    updateBinding(binding, { enterpriseId: nextEnterpriseId });
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
      onChanged?.();
    } catch {
      toast.error('Erro ao registrar campanha');
    } finally {
      setCreating(false);
    }
  };

  // Agrupamento por conta: filtra as campanhas exibidas conforme o modo.
  const visibleBindings = bindings.filter((b) => {
    if (adAccountId) return b.adAccountId === adAccountId;
    if (unassignedOnly) return !b.adAccountId;
    return true;
  });

  return (
    <div className="space-y-3">
      {!compact && (
        <div className="rounded-lg bg-accent/40 dark:bg-accent/20 border border-accent p-3 space-y-2">
          <p className="text-xs font-semibold text-accent-foreground">Fila por campanha (campaignId)</p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Campanhas são detectadas <strong>automaticamente</strong> quando leads chegam (webhook ou polling). Vincule a <strong>fila de atendimento de cada campanha</strong> — tem <strong>prioridade</strong> sobre o vínculo por formulário e sobre a fila da conta. Assim campanhas de contas diferentes podem ser atendidas por equipes diferentes, de forma independente.
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <strong>Empreendimento:</strong> define a imagem do cartão de lead no Telegram. A precedência da imagem é: <strong>anúncio</strong> &gt; <strong>campanha</strong> (aqui) &gt; <strong>formulário</strong> &gt; cliente. Sem vínculo, o cartão sai sem foto — nunca com a imagem de outro empreendimento.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Carregando campanhas...
        </div>
      ) : visibleBindings.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          {adAccountId
            ? 'Nenhuma campanha desta conta ainda. Assim que leads chegarem com campaign_id de páginas desta conta, elas aparecem aqui automaticamente.'
            : unassignedOnly
              ? 'Nenhuma campanha sem conta. Campanhas com conta aparecem dentro do card da conta correspondente.'
              : 'Nenhuma campanha detectada ainda. Assim que o primeiro lead chegar com campaign_id, ela aparece aqui automaticamente. Você também pode registrar uma campanha manualmente abaixo.'}
        </div>
      ) : (
        <div className="space-y-2">
          {visibleBindings.map((binding) => (
            <Card key={binding.id}>
              <CardContent className="p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {binding.enterprise?.imageUrl && (
                    <img
                      src={binding.enterprise.imageUrl}
                      alt={binding.enterprise.name}
                      className="h-9 w-9 rounded-md object-cover border"
                    />
                  )}
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
                      {binding.enterprise ? (
                        binding.enterprise.imageUrl ? (
                          <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Pronto para notificar
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400">
                            <ImageOff className="h-3 w-3 mr-1" /> Empreendimento sem imagem
                          </Badge>
                        )
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          Sem empreendimento
                        </Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Último lead: {new Date(binding.lastSeenAt).toLocaleString('pt-BR')}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!hideAccountSelect && (
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
                    )}
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Empreendimento (imagem do cartão)</Label>
                      <Popover
                        open={enterprisePopoverId === binding.id}
                        onOpenChange={(open) => setEnterprisePopoverId(open ? binding.id : null)}
                      >
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 w-[190px] justify-between text-xs font-normal"
                            disabled={savingId === binding.id}
                          >
                            <span className="truncate flex items-center gap-1">
                              <Building2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                              {binding.enterprise?.name || 'Sem empreendimento'}
                            </span>
                            <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="p-0 w-[260px]" align="end">
                          <Command>
                            <CommandInput placeholder="Buscar empreendimento..." />
                            <CommandList>
                              <CommandEmpty>Nenhum empreendimento encontrado.</CommandEmpty>
                              <CommandGroup>
                                <CommandItem
                                  onSelect={() => handleEnterpriseChange(binding, null)}
                                >
                                  <span className="text-muted-foreground">Sem empreendimento</span>
                                </CommandItem>
                                {enterprises.map((e) => (
                                  <CommandItem
                                    key={e.id}
                                    value={e.name}
                                    onSelect={() => handleEnterpriseChange(binding, e.id)}
                                  >
                                    <Check
                                      className={`mr-1 h-3.5 w-3.5 ${binding.enterpriseId === e.id ? 'opacity-100' : 'opacity-0'}`}
                                    />
                                    {e.imageUrl && (
                                      <img src={e.imageUrl} alt="" className="h-5 w-5 rounded object-cover" />
                                    )}
                                    <span className="truncate">{e.name}</span>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
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

      {/* Registro manual — só no modo global (fora do card da conta) */}
      {!compact && !adAccountId && (
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
      )}
    </div>
  );
}
