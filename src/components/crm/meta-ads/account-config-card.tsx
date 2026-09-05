'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eraser,
  Eye,
  EyeOff,
  Loader2,
  MinusCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { CampaignBindingsSection } from './campaign-bindings-section';

// ============================================================
// AccountConfigCard — Card de UMA conta de anúncios com as PRÓPRIAS
// configurações agrupadas dentro dela (sem misturar com as demais):
//
//   Webhook      → verify token, app secret, page IDs e toggle próprio
//   Polling      → form IDs da conta + Sync Forms + toggle próprio
//   Campanhas    → fila por campaignId aprendida/atribuída nesta conta
//   Formulários  → form mappings aprendidos nesta conta (fila + CAPI)
//   CAPI         → datasets vinculados à conta (testar/vincular/criar)
//
// Toda alteração usa PATCH/POST nos endpoints existentes e chama
// onChanged() para o pai recarregar os dados.
// ============================================================

export interface QueueOption {
  id: string;
  name: string;
  isActive: boolean;
}

export interface AdAccountData {
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
  webhookEnabled: boolean;
  pollingEnabled: boolean;
  queueId: string | null;
  queue?: { id: string; name: string; isActive: boolean } | null;
  _count?: { campaignBindings: number; formMappings: number; capiConfigs: number };
}

export interface CapiOption {
  id: string;
  name: string;
  datasetId: string;
  enabled: boolean;
  isDefault: boolean;
  adAccountId: string | null;
  queueId?: string | null;
  accessTokenMasked?: string | null;
  _count?: { clients: number };
}

export interface GroupedMapping {
  formId: string;
  formName: string | null;
  totalLeads: number;
  capiConfigId: string | null;
  capiConfig: { id: string; name: string; enabled: boolean } | null;
  queueId: string | null;
  queue: { id: string; name: string; isActive: boolean } | null;
  adAccountId: string | null;
  adAccount: { id: string; name: string; adAccountId: string; enabled: boolean } | null;
  campaigns: Array<{ campaignId: string | null; campaignName: string | null; adName: string | null; leadCount: number }>;
}

export interface BindingItem {
  id: string;
  campaignId: string;
  campaignName: string | null;
  adAccountId: string | null;
  queueId: string | null;
  queue?: { id: string; name: string; isActive: boolean } | null;
  leadCount: number;
  lastSeenAt: string;
}

interface AccountConfigCardProps {
  account: AdAccountData;
  queues: QueueOption[];
  capiConfigs: CapiOption[];
  bindings: BindingItem[];
  mappings: GroupedMapping[];
  onChanged: () => void;
  onEdit: (account: AdAccountData) => void;
  onDelete: (account: AdAccountData) => void;
}

function parseLines(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {}
  return [];
}

type AccountTab = 'webhook' | 'polling' | 'campaigns' | 'forms' | 'capi' | 'tests';

export function AccountConfigCard({ account, queues, capiConfigs, bindings, mappings, onChanged, onEdit, onDelete }: AccountConfigCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<AccountTab>('webhook');
  const [patching, setPatching] = useState(false);

  // ── Webhook (drafts) ──
  const [verifyDraft, setVerifyDraft] = useState('');
  const [secretDraft, setSecretDraft] = useState('');
  const [pagesDraft, setPagesDraft] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [savingWebhook, setSavingWebhook] = useState(false);

  // ── Polling (drafts) ──
  const [formDrafts, setFormDrafts] = useState<string[]>(['']);
  const [savingForms, setSavingForms] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // ── CAPI ──
  const [linkCapiId, setLinkCapiId] = useState('');
  const [showNewCapi, setShowNewCapi] = useState(false);
  const [newCapi, setNewCapi] = useState({ name: '', datasetId: '', accessToken: '' });
  const [savingCapi, setSavingCapi] = useState(false);
  const [testingCapiId, setTestingCapiId] = useState<string | null>(null);

  // ── Testes & Diagnóstico (por conta) ──
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagResult, setDiagResult] = useState<any>(null);
  const [pollingNow, setPollingNow] = useState(false);
  const [pollNowResult, setPollNowResult] = useState<any>(null);

  // Re-sincroniza os drafts com a conta ao expandir o card
  useEffect(() => {
    if (expanded) {
      setPagesDraft(parseLines(account.pageIds).join('\n'));
      setFormDrafts(parseLines(account.formIds).length ? parseLines(account.formIds) : ['']);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, account.id]);

  async function patchAccount(payload: Record<string, unknown>, successMsg: string) {
    setPatching(true);
    try {
      const res = await fetch(`/api/meta-ad-accounts/${account.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || 'Erro ao salvar configuração da conta');
        return false;
      }
      toast.success(successMsg);
      onChanged();
      return true;
    } catch {
      toast.error('Falha de conexão ao salvar configuração da conta');
      return false;
    } finally {
      setPatching(false);
    }
  }

  async function saveWebhook() {
    const payload: Record<string, unknown> = {
      pageIds: pagesDraft.split(/[\n,;]/).map((s) => s.trim()).filter(Boolean),
    };
    if (verifyDraft.trim()) payload.verifyToken = verifyDraft.trim();
    if (secretDraft.trim()) payload.appSecret = secretDraft.trim();
    setSavingWebhook(true);
    const ok = await patchAccount(payload, 'Webhook da conta salvo — vale só para esta conta');
    if (ok) {
      setVerifyDraft('');
      setSecretDraft('');
    }
    setSavingWebhook(false);
  }

  async function clearField(field: 'verifyToken' | 'appSecret') {
    const ok = await patchAccount({ [field]: null }, field === 'verifyToken' ? 'Verify token da conta removido' : 'App secret da conta removido');
    if (ok && field === 'verifyToken') setVerifyDraft('');
    if (ok && field === 'appSecret') setSecretDraft('');
  }

  async function saveForms() {
    const ids = formDrafts.map((f) => f.trim()).filter(Boolean);
    setSavingForms(true);
    const ok = await patchAccount({ formIds: ids }, `Polling da conta salvo — ${ids.length} formulário(s) com o token dela`);
    setSavingForms(false);
    if (ok) setFormDrafts(ids.length ? ids : ['']);
  }

  async function syncForms() {
    setSyncing(true);
    try {
      const res = await fetch(`/api/meta-ad-accounts/${account.id}/sync-forms`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || 'Erro ao sincronizar formulários');
        return;
      }
      toast.success(data?.message || 'Formulários sincronizados com o token desta conta');
      onChanged();
    } catch {
      toast.error('Erro ao sincronizar formulários');
    } finally {
      setSyncing(false);
    }
  }

  async function linkFormToQueue(formId: string, queueId: string | null) {
    try {
      const res = await fetch('/api/meta-capi-configs/form-mappings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formId, queueId }),
      });
      if (res.ok) {
        toast.success(queueId ? 'Fila do formulário atualizada' : 'Roteamento de fila removido');
        onChanged();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || 'Erro ao vincular fila');
      }
    } catch {
      toast.error('Falha de conexão');
    }
  }

  async function linkFormToConfig(formId: string, capiConfigId: string | null) {
    try {
      const res = await fetch('/api/meta-capi-configs/form-mappings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formId, capiConfigId }),
      });
      if (res.ok) {
        toast.success(capiConfigId ? 'CAPI do formulário atualizado' : 'Vinculação CAPI removida');
        onChanged();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || 'Erro ao vincular CAPI');
      }
    } catch {
      toast.error('Falha de conexão');
    }
  }

  async function linkCapiToAccount(configId: string) {
    if (!configId) return;
    try {
      const res = await fetch(`/api/meta-capi-configs/${configId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adAccountId: account.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || 'Erro ao vincular config CAPI');
        return;
      }
      toast.success('Config CAPI vinculado a esta conta');
      setLinkCapiId('');
      onChanged();
    } catch {
      toast.error('Falha de conexão');
    }
  }

  async function unlinkCapi(configId: string) {
    try {
      const res = await fetch(`/api/meta-capi-configs/${configId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adAccountId: null }),
      });
      if (res.ok) {
        toast.success('Config CAPI desvinculado da conta (voltou para o grupo global)');
        onChanged();
      }
    } catch {
      toast.error('Erro ao desvincular config CAPI');
    }
  }

  async function testCapi(configId: string) {
    setTestingCapiId(configId);
    try {
      const res = await fetch(`/api/meta-capi-configs/${configId}`);
      if (!res.ok) { toast.error('Erro ao buscar config'); return; }
      const config = await res.json();
      const testRes = await fetch('/api/webhooks/meta-leads/capi-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: config.accessToken, datasetId: config.datasetId }),
      });
      if (testRes.ok) {
        const data = await testRes.json();
        toast[data.success ? 'success' : 'error'](data.message);
      }
    } catch {
      toast.error('Falha ao testar CAPI');
    } finally {
      setTestingCapiId(null);
    }
  }

  async function createCapiForAccount() {
    if (!newCapi.name.trim() || !newCapi.datasetId.trim() || !newCapi.accessToken.trim()) {
      toast.error('Nome, Dataset ID e Access Token são obrigatórios');
      return;
    }
    setSavingCapi(true);
    try {
      const res = await fetch('/api/meta-capi-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCapi.name.trim(),
          datasetId: newCapi.datasetId.trim(),
          accessToken: newCapi.accessToken.trim(),
          adAccountId: account.id,
          enabled: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || 'Erro ao criar config CAPI');
        return;
      }
      toast.success('Config CAPI criado e vinculado a esta conta');
      setShowNewCapi(false);
      setNewCapi({ name: '', datasetId: '', accessToken: '' });
      onChanged();
    } catch {
      toast.error('Falha de conexão ao criar config CAPI');
    } finally {
      setSavingCapi(false);
    }
  }

  async function runDiagnostics() {
    setDiagnosing(true);
    setDiagResult(null);
    try {
      const res = await fetch(`/api/meta-ad-accounts/${account.id}/diagnose`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || 'Erro ao executar diagnóstico da conta');
        return;
      }
      setDiagResult(data);
      const errs = data.summary?.errors ?? 0;
      const warns = data.summary?.warnings ?? 0;
      if (errs > 0) toast.error(`Diagnóstico de "${account.name}": ${errs} erro(s)`);
      else if (warns > 0) toast.warning(`Diagnóstico de "${account.name}": ${warns} aviso(s)`);
      else toast.success(`Diagnóstico de "${account.name}": tudo OK!`);
    } catch {
      toast.error('Falha de conexão ao executar diagnóstico');
    } finally {
      setDiagnosing(false);
    }
  }

  async function pollAccountNow() {
    setPollingNow(true);
    setPollNowResult(null);
    try {
      const res = await fetch(`/api/cron/fetch-meta-leads?accountId=${account.id}`);
      const data = await res.json().catch(() => ({}));
      setPollNowResult(data);
      if (res.status === 401) {
        toast.error('Sessão expirada. Faça login novamente.');
      } else if (res.status === 404 || res.status === 400) {
        toast.error(data?.message || data?.error || 'Erro ao executar polling da conta');
      } else if (data?.status === 'idle') {
        toast.info(data?.message || 'Nada para consultar nesta conta');
      } else if (res.ok) {
        toast.success(`Polling da conta executado: ${data.totalFetched ?? 0} encontrados, ${data.totalImported ?? 0} importados, ${data.totalDeduped ?? 0} já existentes (${data.elapsed ?? '?'})`);
        onChanged();
      } else {
        toast.error(data?.message || data?.error || 'Erro ao executar polling da conta');
      }
    } catch {
      toast.error('Falha de conexão ao executar polling da conta');
    } finally {
      setPollingNow(false);
    }
  }

  async function copyWebhookUrl() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/api/webhooks/meta-leads`);
      toast.success('URL do webhook copiada!');
    } catch {
      toast.error('Falha ao copiar');
    }
  }

  // Dados DESTE account (agrupamento sem mistura)
  const accountBindings = bindings.filter((b) => b.adAccountId === account.id);
  const accountMappings = mappings.filter((m) => m.adAccountId === account.id);
  const accountCapiConfigs = capiConfigs.filter((c) => c.adAccountId === account.id);
  const unlinkedCapiConfigs = capiConfigs.filter((c) => !c.adAccountId);
  const formCount = parseLines(account.formIds).length;
  const pageCount = parseLines(account.pageIds).length;

  return (
    <Card className={`overflow-hidden transition-colors ${account.enabled ? 'border-teal-200 dark:border-teal-900/50' : 'opacity-70'}`}>
      <CardContent className="p-0">
        {/* ── Header da conta ── */}
        <div className="flex flex-wrap items-center gap-2 p-3">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex flex-1 min-w-[220px] items-center gap-2.5 text-left hover:opacity-80"
            aria-expanded={expanded}
          >
            <span className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-teal-100 dark:bg-teal-900/30">
              {expanded ? <ChevronDown className="h-4 w-4 text-teal-700 dark:text-teal-300" /> : <ChevronRight className="h-4 w-4 text-teal-700 dark:text-teal-300" />}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold">{account.name}</span>
                <Badge variant="outline" className="text-[10px] font-mono">{account.adAccountId}</Badge>
                {account.isDefault && <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-[10px]">padrão</Badge>}
                {account.enabled ? (
                  <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px] gap-1"><CheckCircle2 className="h-2.5 w-2.5" /> ativa</Badge>
                ) : (
                  <Badge className="bg-muted text-muted-foreground text-[10px]">inativa</Badge>
                )}
              </span>
              <span className="flex items-center gap-2.5 mt-0.5 text-[11px] text-muted-foreground flex-wrap">
                <span className={account.webhookEnabled ? 'text-teal-700 dark:text-teal-300 font-medium' : ''}>Webhook: {account.webhookEnabled ? 'próprio' : 'desligado'}{account.hasVerifyToken ? ' ✓verify' : ''}{account.hasAppSecret ? ' ✓secret' : ''}</span>
                <span className={account.pollingEnabled && formCount > 0 ? 'text-teal-700 dark:text-teal-300 font-medium' : ''}>Polling: {account.pollingEnabled ? `${formCount} form(s)` : 'desligado'}</span>
                <span>Campanhas: {accountBindings.length}</span>
                <span>Formulários: {accountMappings.length}</span>
                <span>CAPI: {accountCapiConfigs.length}</span>
                <span>Fila: {account.queue?.name || 'padrão global'}</span>
              </span>
            </span>
          </button>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Switch
              checked={account.enabled}
              onCheckedChange={(v) => patchAccount({ enabled: v }, v ? 'Conta ativada' : 'Conta desativada — webhook e polling dela ignorados')}
              aria-label={`Ativar/desativar conta ${account.name}`}
            />
            <Button size="sm" variant="outline" onClick={() => onEdit(account)} title="Editar dados da conta (nome, ID, token)">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" onClick={() => onDelete(account)} title="Remover conta">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* ── Configurações AGRUPADAS da conta ── */}
        {expanded && (
          <div className="border-t px-3 pb-3 pt-3 space-y-3 bg-muted/20 dark:bg-muted/10">
            {/* Fila default da conta — sempre visível */}
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-xs font-medium">Fila default desta conta</Label>
              <Select
                value={account.queueId || 'none'}
                onValueChange={(v) => patchAccount({ queueId: v === 'none' ? null : v }, 'Fila default da conta salva')}
                disabled={patching}
              >
                <SelectTrigger className="h-8 w-[220px] text-xs">
                  <SelectValue placeholder="Fila padrão global" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Fila padrão global</SelectItem>
                  {queues.map((q) => (
                    <SelectItem key={q.id} value={q.id} disabled={!q.isActive}>
                      {q.name}{!q.isActive ? ' (inativa)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">Usada quando a campanha e o formulário não têm fila própria (prioridade: campanha &gt; formulário &gt; conta).</p>
            </div>

            <Tabs value={tab} onValueChange={(v) => setTab(v as AccountTab)}>
              <TabsList className="w-full flex-wrap h-auto">
                <TabsTrigger value="webhook" className="text-xs gap-1.5 flex-1">Webhook</TabsTrigger>
                <TabsTrigger value="polling" className="text-xs gap-1.5 flex-1">Polling</TabsTrigger>
                <TabsTrigger value="campaigns" className="text-xs gap-1.5 flex-1">Campanhas ({accountBindings.length})</TabsTrigger>
                <TabsTrigger value="forms" className="text-xs gap-1.5 flex-1">Formulários ({accountMappings.length})</TabsTrigger>
                <TabsTrigger value="capi" className="text-xs gap-1.5 flex-1">CAPI ({accountCapiConfigs.length})</TabsTrigger>
                <TabsTrigger value="tests" className="text-xs gap-1.5 flex-1">Testes</TabsTrigger>
              </TabsList>

              {/* ══════════ WEBHOOK DA CONTA ══════════ */}
              <TabsContent value="webhook" className="space-y-3 mt-3">
                <div className="flex items-center justify-between rounded-lg border p-2.5 bg-background">
                  <div>
                    <Label className="text-xs cursor-pointer">Webhook desta conta ativo</Label>
                    <p className="text-[10px] text-muted-foreground">Desligado: verify/secret próprios deixam de valer e pages da conta não resolvem conta (as demais contas não são afetadas).</p>
                  </div>
                  <Switch
                    checked={account.webhookEnabled}
                    onCheckedChange={(v) => patchAccount({ webhookEnabled: v }, v ? 'Webhook da conta ativado' : 'Webhook da conta desativado')}
                    disabled={patching}
                  />
                </div>

                <p className="text-[11px] text-muted-foreground">
                  Não existe webhook global: <strong>cada conta usa os próprios</strong> <strong>verify token</strong>, <strong>app secret</strong> e <strong>page IDs</strong> — todos obrigatórios para esta conta receber leads. O endpoint é único: <code className="font-mono text-[10px]">/api/webhooks/meta-leads</code>.
                </p>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-medium">Verify Token desta conta (obrigatório)</Label>
                    {account.hasVerifyToken && <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px] px-1.5 py-0"><CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> configurado</Badge>}
                    {account.hasVerifyToken && (
                      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] text-muted-foreground" onClick={() => clearField('verifyToken')} title="Remover verify token desta conta">
                        <Eraser className="h-3 w-3 mr-0.5" /> remover
                      </Button>
                    )}
                  </div>
                  <Input
                    placeholder={account.hasVerifyToken ? '•••••••• (salvo — preencha apenas para trocar)' : 'verify token dedicado desta conta'}
                    value={verifyDraft}
                    onChange={(e) => setVerifyDraft(e.target.value)}
                    className="font-mono text-xs h-8"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-medium">App Secret desta conta (obrigatório)</Label>
                    {account.hasAppSecret && <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[10px] px-1.5 py-0"><CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> configurado</Badge>}
                    {account.hasAppSecret && (
                      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] text-muted-foreground" onClick={() => clearField('appSecret')} title="Remover app secret desta conta">
                        <Eraser className="h-3 w-3 mr-0.5" /> remover
                      </Button>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      type={showSecret ? 'text' : 'password'}
                      placeholder={account.hasAppSecret ? '•••••••• (salvo — preencha apenas para trocar)' : 'app secret dedicado desta conta (HMAC)'}
                      value={secretDraft}
                      onChange={(e) => setSecretDraft(e.target.value)}
                      className="font-mono text-xs h-8 pr-9"
                    />
                    <Button type="button" variant="ghost" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0" onClick={() => setShowSecret(!showSecret)}>
                      {showSecret ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Page IDs desta conta ({pageCount})</Label>
                  <Textarea
                    rows={2}
                    placeholder={'Um por linha:\n111222333\n444555666'}
                    value={pagesDraft}
                    onChange={(e) => setPagesDraft(e.target.value)}
                    className="font-mono text-xs"
                  />
                  <p className="text-[10px] text-muted-foreground">O webhook usa o ID da página (entry) para saber se o lead veio desta conta e usar o token dela.</p>
                </div>

                <Button onClick={saveWebhook} disabled={savingWebhook || patching} size="sm" className="bg-teal-600 hover:bg-teal-700 text-white">
                  {savingWebhook ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Salvando...</> : <><Save className="h-3.5 w-3.5 mr-1.5" /> Salvar Webhook da conta</>}
                </Button>
              </TabsContent>

              {/* ══════════ POLLING DA CONTA ══════════ */}
              <TabsContent value="polling" className="space-y-3 mt-3">
                <div className="flex items-center justify-between rounded-lg border p-2.5 bg-background">
                  <div>
                    <Label className="text-xs cursor-pointer">Polling desta conta ativo</Label>
                    <p className="text-[10px] text-muted-foreground">Desligado: os formulários desta conta deixam de ser consultados (polling das demais contas segue normal).</p>
                  </div>
                  <Switch
                    checked={account.pollingEnabled}
                    onCheckedChange={(v) => patchAccount({ pollingEnabled: v }, v ? 'Polling da conta ativado' : 'Polling da conta desativado')}
                    disabled={patching}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium">Form IDs consultados com o token DESTA conta</Label>
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-teal-700 dark:text-teal-300" onClick={() => setFormDrafts([...formDrafts, ''])}>
                        <Plus className="h-3.5 w-3.5 mr-0.5" /> Adicionar
                      </Button>
                      <Button size="sm" variant="outline" className="h-7" onClick={syncForms} disabled={syncing} title="Busca os formulários de lead desta conta via Graph API (com o token dela)">
                        {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        <span className="ml-1">Sync Forms</span>
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {formDrafts.map((formId, index) => (
                      <div key={index} className="flex gap-2 items-center">
                        <Input
                          placeholder="Ex: 123456789012345"
                          value={formId}
                          onChange={(e) => {
                            const updated = [...formDrafts];
                            updated[index] = e.target.value.replace(/\D/g, '');
                            setFormDrafts(updated);
                          }}
                          className="font-mono text-xs h-8"
                          inputMode="numeric"
                          maxLength={30}
                        />
                        {formDrafts.length > 1 && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0 text-destructive hover:text-destructive" onClick={() => setFormDrafts(formDrafts.filter((_, i) => i !== index))}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground">Consultados com o token DESTA conta pelo polling automático (cron). Não existe polling global — o que não estiver aqui não é consultado. Teste com &quot;Executar polling agora&quot; na aba Testes.</p>
                </div>

                <Button onClick={saveForms} disabled={savingForms || patching} size="sm" className="bg-teal-600 hover:bg-teal-700 text-white">
                  {savingForms ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Salvando...</> : <><Save className="h-3.5 w-3.5 mr-1.5" /> Salvar Polling da conta</>}
                </Button>
              </TabsContent>

              {/* ══════════ TESTES & DIAGNÓSTICO DA CONTA ══════════ */}
              <TabsContent value="tests" className="space-y-3 mt-3">
                <div className="rounded-lg border p-2.5 bg-background space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs font-medium">URL do webhook (para o Meta desta conta)</Label>
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => copyWebhookUrl()}>
                      Copiar
                    </Button>
                  </div>
                  <code className="block text-[10px] font-mono break-all text-muted-foreground">
                    {typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/meta-leads
                  </code>
                  <p className="text-[10px] text-muted-foreground">No Meta for Developers, use esta URL + o verify token DESTA conta (aba Webhook) e inscreva as páginas dela no campo leadgen.</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={runDiagnostics} disabled={diagnosing} size="sm" className="bg-teal-600 hover:bg-teal-700 text-white">
                    {diagnosing ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Diagnosticando...</> : <><Zap className="h-3.5 w-3.5 mr-1.5" /> Diagnóstico completo</>}
                  </Button>
                  <Button onClick={pollAccountNow} disabled={pollingNow} size="sm" variant="outline">
                    {pollingNow ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Executando...</> : <><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Executar polling agora (só esta conta)</>}
                  </Button>
                </div>

                {diagResult && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                      <Badge className={diagResult.summary?.errors > 0 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-[9px] px-1.5 py-0' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[9px] px-1.5 py-0'}>
                        {diagResult.summary?.errors ?? 0} erro(s)
                      </Badge>
                      <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-[9px] px-1.5 py-0">{diagResult.summary?.warnings ?? 0} aviso(s)</Badge>
                      <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[9px] px-1.5 py-0">{diagResult.summary?.ok ?? 0} OK</Badge>
                      {diagResult.evaluation?.webhookReady && <Badge className="bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400 text-[9px] px-1.5 py-0">webhook pronto</Badge>}
                      {diagResult.evaluation?.pollingReady && <Badge className="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 text-[9px] px-1.5 py-0">polling pronto</Badge>}
                    </div>
                    <div className="space-y-1 max-h-72 overflow-y-auto">
                      {(diagResult.checks || []).map((check: any) => (
                        <div key={check.key} className="rounded-md border p-2 text-[11px] bg-background flex items-start gap-2">
                          <span className="flex-shrink-0 mt-0.5">
                            {check.status === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> :
                             check.status === 'error' ? <XCircle className="h-3.5 w-3.5 text-red-500" /> :
                             check.status === 'warn' ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> :
                             <MinusCircle className="h-3.5 w-3.5 text-muted-foreground" />}
                          </span>
                          <span className="min-w-0">
                            <span className={check.status === 'error' ? 'text-red-600 dark:text-red-400' : check.status === 'warn' ? 'text-amber-600 dark:text-amber-400' : ''}>{check.details}</span>
                            {check.fix && <span className="block text-[10px] text-muted-foreground mt-0.5">→ {check.fix}</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {pollNowResult && (
                  <div className="rounded-md border p-2 text-[11px] bg-background space-y-1">
                    <p className="font-medium">Resultado do polling desta conta</p>
                    {pollNowResult.status && pollNowResult.status !== 'ok' && (
                      <p className="text-amber-600 dark:text-amber-400">{pollNowResult.message || pollNowResult.error}</p>
                    )}
                    {pollNowResult.status === 'ok' && (
                      <>
                        <p className="text-muted-foreground">{pollNowResult.totalFetched ?? 0} lead(s) encontrados · {pollNowResult.totalImported ?? 0} importado(s) · {pollNowResult.totalDeduped ?? 0} já existente(s) · {pollNowResult.formsChecked ?? 0} form(s) · {pollNowResult.elapsed ?? ''}</p>
                        {(pollNowResult.perForm || []).map((f: any) => (
                          <p key={f.formId} className="text-muted-foreground font-mono text-[10px]">{f.formId}: {f.fetched} buscado(s), {f.imported} importado(s){f.deduped ? `, ${f.deduped} já existente(s)` : ''}{f.error ? ` — ${f.error}` : ''}</p>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </TabsContent>

              {/* ══════════ FORMULÁRIOS DA CONTA ══════════ */}
              <TabsContent value="forms" className="space-y-2 mt-3">
                {accountMappings.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                    Nenhum formulário aprendido nesta conta ainda. Assim que leads chegarem via webhook/polling com página desta conta, os Form IDs aparecem aqui automaticamente (ou use &quot;Sync Forms&quot; na aba Polling).
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {accountMappings.map((mapping) => (
                      <div key={mapping.formId} className="rounded-md border p-2.5 text-xs bg-background">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono font-medium text-[11px]">{mapping.formId}</span>
                              {mapping.capiConfig ? (
                                <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-[9px] px-1.5 py-0">{mapping.capiConfig.name}</Badge>
                              ) : (
                                <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-[9px] px-1.5 py-0">Sem CAPI</Badge>
                              )}
                              {mapping.queue && <Badge className="bg-primary/10 text-primary text-[9px] px-1.5 py-0">Fila: {mapping.queue.name}</Badge>}
                            </div>
                            {mapping.formName && <p className="text-muted-foreground mt-0.5 truncate">{mapping.formName}</p>}
                            <p className="text-[10px] text-muted-foreground mt-0.5">{mapping.totalLeads} lead(s){mapping.campaigns[0]?.campaignName ? ` · ${mapping.campaigns[0].campaignName}` : ''}</p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <Select value={mapping.capiConfigId || '__none__'} onValueChange={(val) => linkFormToConfig(mapping.formId, val === '__none__' ? null : val)}>
                              <SelectTrigger className="h-7 w-[120px] text-[11px]"><SelectValue placeholder="Vincular CAPI" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">Nenhum</SelectItem>
                                {capiConfigs.filter((c) => c.enabled).map((cfg) => (
                                  <SelectItem key={cfg.id} value={cfg.id}>{cfg.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Select value={mapping.queueId || '__default__'} onValueChange={(val) => linkFormToQueue(mapping.formId, val === '__default__' ? null : val)}>
                              <SelectTrigger className="h-7 w-[120px] text-[11px]" title="Fila de atendimento deste formulário">
                                <SelectValue placeholder="Fila padrão" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__default__">Fila padrão</SelectItem>
                                {queues.map((q) => (
                                  <SelectItem key={q.id} value={q.id} disabled={!q.isActive}>
                                    {q.name}{!q.isActive ? ' (inativa)' : ''}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* ══════════ CAPI DA CONTA ══════════ */}
              <TabsContent value="capi" className="space-y-3 mt-3">
                {accountCapiConfigs.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                    Nenhum dataset CAPI vinculado a esta conta. Crie um abaixo ou vincule um config existente que esteja no grupo global.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {accountCapiConfigs.map((config) => (
                      <div key={config.id} className="rounded-md border p-2.5 text-xs bg-background flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium text-[11px]">{config.name}</span>
                            {config.isDefault && <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-[9px] px-1.5 py-0">padrão</Badge>}
                            {!config.enabled && <Badge className="bg-muted text-muted-foreground text-[9px] px-1.5 py-0">inativo</Badge>}
                          </div>
                          <p className="font-mono text-[10px] text-muted-foreground mt-0.5">Dataset: {config.datasetId}</p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => testCapi(config.id)} disabled={testingCapiId === config.id} title="Testar envio CAPI">
                            {testingCapiId === config.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground" onClick={() => unlinkCapi(config.id)} title="Desvincular desta conta (volta para o global)">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {unlinkedCapiConfigs.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Vincular config CAPI existente (sem conta)</Label>
                    <Select value={linkCapiId || '__pick__'} onValueChange={(v) => { if (v !== '__pick__') linkCapiToAccount(v); }}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Selecionar config global..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__pick__" disabled>Selecionar config global...</SelectItem>
                        {unlinkedCapiConfigs.map((cfg) => (
                          <SelectItem key={cfg.id} value={cfg.id}>{cfg.name} ({cfg.datasetId})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <Button size="sm" variant="outline" className="border-teal-300 dark:border-teal-800 text-teal-700 dark:text-teal-300" onClick={() => setShowNewCapi(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Novo config CAPI nesta conta
                </Button>
              </TabsContent>
              {/* ══════════ CAMPANHAS DA CONTA ══════════ */}
              <TabsContent value="campaigns" className="mt-3">
                <CampaignBindingsSection
                  adAccountId={account.id}
                  hideAccountSelect
                  compact
                  onChanged={onChanged}
                />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </CardContent>

      {/* Dialog: novo config CAPI nesta conta */}
      <Dialog open={showNewCapi} onOpenChange={setShowNewCapi}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo config CAPI — {account.name}</DialogTitle>
            <DialogDescription>
              O dataset será criado já vinculado a esta conta (eventos de conversão vão para ele quando o lead for desta conta).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Nome *</Label>
              <Input placeholder='Ex: "Cliente X - Pixel"' value={newCapi.name} onChange={(e) => setNewCapi({ ...newCapi, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Dataset ID *</Label>
              <Input placeholder="Ex: 1482541132653965" value={newCapi.datasetId} onChange={(e) => setNewCapi({ ...newCapi, datasetId: e.target.value })} className="font-mono text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Access Token *</Label>
              <Input type="password" placeholder="Token com permissão ads_management" value={newCapi.accessToken} onChange={(e) => setNewCapi({ ...newCapi, accessToken: e.target.value })} className="font-mono text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewCapi(false)}>Cancelar</Button>
            <Button onClick={createCapiForAccount} disabled={savingCapi} className="bg-teal-600 hover:bg-teal-700 text-white">
              {savingCapi ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Criando...</> : <><Save className="h-4 w-4 mr-1.5" /> Criar e vincular</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
