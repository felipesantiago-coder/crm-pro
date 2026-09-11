'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  MessageCircle, MapPin, ExternalLink, Copy, Check, Loader2,
  Pencil, Trash2, RefreshCw, Eye, MousePointerClick, X, Plus,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatPhoneNumber } from '@/lib/phone-utils';
import {
  DEFAULT_WHATSAPP_LANDING_MESSAGE,
  generateLandingSlug,
  isValidLandingSlug,
  landingPublicPath,
  normalizeLandingPhone,
} from '@/lib/whatsapp-landing';

/* ================================================================
   Types
   ================================================================ */
interface WhatsAppLanding {
  id: string;
  slug: string;
  region: string;
  phone: string;
  message: string;
  active: boolean;
  views: number;
  clicks: number;
  createdAt: string;
}

interface FormState {
  region: string;
  phone: string;
  message: string;
  slug: string;
  active: boolean;
}

const EMPTY_FORM: FormState = { region: '', phone: '', message: '', slug: '', active: true };

/* ================================================================
   WhatsApp Landing Section — "Clique para Entrar"
   CRUD de landings públicas de redirecionamento para WhatsApp,
   vinculadas a uma região anunciada (anúncios Meta).
   ================================================================ */
export function WhatsAppLandingSection() {
  const [landings, setLandings] = useState<WhatsAppLanding[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/whatsapp-landings');
      if (res.ok) {
        const data = await res.json();
        setLandings(data.landings || []);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onRegionChange(region: string) {
    setForm((f) => ({
      ...f,
      region,
      // Slug acompanha a região até o admin editar o campo manualmente
      slug: slugTouched ? f.slug : generateLandingSlug(region),
    }));
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setSlugTouched(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const region = form.region.trim();
    const slug = form.slug.trim().toLowerCase();

    if (!region) { toast.error('Informe a região da landing'); return; }
    const phone = normalizeLandingPhone(form.phone);
    if (!phone.ok) { toast.error(phone.error); return; }
    if (!slug || !isValidLandingSlug(slug)) {
      toast.error('Slug inválido. Use apenas letras minúsculas, números e hífens.');
      return;
    }

    setSaving(true);
    try {
      const isEdit = !!editingId;
      const res = await fetch(
        isEdit ? `/api/whatsapp-landings/${editingId}` : '/api/whatsapp-landings',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ region, phone: form.phone, message: form.message, slug, active: form.active }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar landing');
      toast.success(
        isEdit
          ? `Landing de "${region}" atualizada`
          : `Landing criada! Link público: ${landingPublicPath(slug)}`,
      );
      resetForm();
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar landing');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(l: WhatsAppLanding) {
    setEditingId(l.id);
    setSlugTouched(true);
    setForm({
      region: l.region,
      phone: formatPhoneNumber(l.phone),
      message: l.message === DEFAULT_WHATSAPP_LANDING_MESSAGE ? '' : l.message,
      slug: l.slug,
      active: l.active,
    });
    // Rola o formulário (no topo da seção) para a vista
    document.getElementById('whatsapp-landing-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function toggleActive(l: WhatsAppLanding) {
    try {
      const res = await fetch(`/api/whatsapp-landings/${l.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !l.active }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Erro ao alterar status');
      toast.success(
        l.active
          ? `Landing de "${l.region}" inativada — /lp/${l.slug} responde 404 até reativar`
          : `Landing de "${l.region}" ativa de novo`,
      );
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao alterar status');
    }
  }

  async function remove(l: WhatsAppLanding) {
    if (!window.confirm(
      `Excluir a landing de "${l.region}"?\n\n` +
      `O link /lp/${l.slug} deixará de funcionar e as métricas (visualizações/cliques) serão perdidas.\n` +
      `Leads já atendidos no WhatsApp NÃO são afetados.`,
    )) return;
    setDeletingId(l.id);
    try {
      const res = await fetch(`/api/whatsapp-landings/${l.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Erro ao excluir');
      toast.success(`Landing de "${l.region}" excluída`);
      if (editingId === l.id) resetForm();
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir landing');
    } finally {
      setDeletingId(null);
    }
  }

  function copyLink(l: WhatsAppLanding) {
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    navigator.clipboard.writeText(`${base}${landingPublicPath(l.slug)}`).catch(() => toast.error('Falha ao copiar link'));
    setCopiedId(l.id);
    toast.success('Link copiado! Use na campanha do anúncio.');
    setTimeout(() => setCopiedId(null), 2000);
  }

  const activeCount = landings.filter((l) => l.active).length;

  return (
    <Card className="border-emerald-500/20 dark:border-emerald-500/20">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
              <MessageCircle className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm">Landing de WhatsApp — Clique para Entrar</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                Página mínima para anúncios de leads sem qualificação: botão centralizado que abre direto a conversa do WhatsApp.
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs gap-1.5">
              <MessageCircle className="h-3 w-3" />
              {landings.length} landing{landings.length !== 1 ? 's' : ''}
            </Badge>
            <Badge className="text-xs gap-1.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              {activeCount} ativa{activeCount !== 1 ? 's' : ''}
            </Badge>
            <Button variant="outline" size="sm" onClick={load} title="Atualizar métricas">
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── Formulário ─────────────────────────────────── */}
        <form id="whatsapp-landing-form" onSubmit={handleSubmit} className="rounded-lg border bg-muted/30 p-4 space-y-3">
          <p className="text-xs font-medium text-foreground/80 flex items-center gap-1.5">
            {editingId ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {editingId ? 'Editar landing' : 'Criar nova landing'}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="wl-region" className="text-xs">Região anunciada *</Label>
              <Input
                id="wl-region"
                value={form.region}
                onChange={(e) => onRegionChange(e.target.value)}
                placeholder="Ex.: Portal do Parque"
                maxLength={120}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wl-phone" className="text-xs">WhatsApp de destino *</Label>
              <Input
                id="wl-phone"
                value={form.phone}
                onChange={(e) => setField('phone', e.target.value)}
                placeholder="(11) 99999-9999"
                inputMode="tel"
                className="h-9 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wl-message" className="text-xs">Mensagem pré-preenchida da conversa</Label>
            <Textarea
              id="wl-message"
              value={form.message}
              onChange={(e) => setField('message', e.target.value)}
              placeholder={DEFAULT_WHATSAPP_LANDING_MESSAGE}
              rows={2}
              className="text-sm min-h-[60px]"
            />
            <p className="text-[11px] text-muted-foreground">
              Deixe vazio para usar a mensagem padrão &quot;{DEFAULT_WHATSAPP_LANDING_MESSAGE}&quot;.{' '}
              Use <code className="bg-muted px-1 py-0.5 rounded text-[10px] font-mono">{'{regiao}'}</code> para inserir a região automaticamente.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
            <div className="space-y-1.5">
              <Label htmlFor="wl-slug" className="text-xs">Endereço público</Label>
              <div className="flex items-center gap-0 rounded-md border h-9 overflow-hidden bg-background">
                <span className="pl-2.5 pr-1 text-xs text-muted-foreground font-mono shrink-0">/lp/</span>
                <Input
                  id="wl-slug"
                  value={form.slug}
                  onChange={(e) => { setSlugTouched(true); setField('slug', e.target.value); }}
                  placeholder="portal-do-parque"
                  className="h-9 text-xs font-mono border-0 rounded-none focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 pb-0.5">
              <div className="flex items-center gap-2">
                <Switch
                  id="wl-active"
                  checked={form.active}
                  onCheckedChange={(v) => setField('active', v)}
                />
                <Label htmlFor="wl-active" className="text-xs cursor-pointer whitespace-nowrap">Ativa</Label>
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" disabled={saving}>
              {saving ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Salvando...</>
              ) : editingId ? (
                <><Check className="h-3.5 w-3.5 mr-1.5" /> Salvar alterações</>
              ) : (
                <><Plus className="h-3.5 w-3.5 mr-1.5" /> Criar landing</>
              )}
            </Button>
            {editingId && (
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={resetForm} disabled={saving}>
                <X className="h-3.5 w-3.5 mr-1.5" /> Cancelar
              </Button>
            )}
          </div>
        </form>

        {/* ── Lista ──────────────────────────────────────── */}
        {loading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />)}
          </div>
        ) : landings.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-center">
            <MessageCircle className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">
              Nenhuma landing de WhatsApp ainda — crie a primeira acima e use o link no anúncio da região.
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {landings.map((l) => (
              <div
                key={l.id}
                className={cn(
                  'rounded-lg border p-3 flex items-center gap-3 flex-wrap sm:flex-nowrap transition-colors',
                  l.active ? 'bg-background' : 'bg-muted/40 opacity-75',
                )}
              >
                <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      {l.region}
                    </span>
                    {l.active ? (
                      <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px]">Ativa</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">Inativa · 404</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap text-[11px] text-muted-foreground">
                    <span className="font-mono">{landingPublicPath(l.slug)}</span>
                    <span>{formatPhoneNumber(l.phone)}</span>
                    <span className="flex items-center gap-1" title="Visualizações da página">
                      <Eye className="h-3 w-3" /> {l.views}
                    </span>
                    <span className="flex items-center gap-1" title="Cliques no botão do WhatsApp">
                      <MousePointerClick className="h-3 w-3" /> {l.clicks}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 ml-auto shrink-0">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => copyLink(l)} title="Copiar link público">
                    {copiedId === l.id ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                  </Button>
                  <a
                    href={landingPublicPath(l.slug)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
                    title="Abrir landing page"
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </a>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => startEdit(l)} title="Editar">
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                  <div className="flex items-center mr-1">
                    <Switch
                      checked={l.active}
                      onCheckedChange={() => toggleActive(l)}
                      aria-label={l.active ? `Inativar landing de ${l.region}` : `Ativar landing de ${l.region}`}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 hover:bg-red-500/10"
                    onClick={() => remove(l)}
                    disabled={deletingId === l.id}
                    title="Excluir landing"
                  >
                    {deletingId === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin text-red-500" /> : <Trash2 className="h-3.5 w-3.5 text-red-500" />}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
