'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Globe, Search, X, ExternalLink, Copy, Check, Loader2,
  Pencil, CheckCircle2, AlertCircle, MapPin, Image as ImageIcon,
  Sparkles, Eye, EyeOff, Link2, RefreshCw, Building2, ListChecks,
  Camera,
} from 'lucide-react';
import { FormFieldManager } from './form-field-manager';
import { GalleryManager } from './gallery-manager';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/* ================================================================
   Types
   ================================================================ */
interface EnterpriseImage {
  id: string;
  url: string;
  altText: string | null;
  sortOrder: number;
}

interface Enterprise {
  id: string;
  name: string;
  slug: string | null;
  region: string | null;
  imageUrl: string | null;
  landingTitle: string | null;
  landingSubtitle: string | null;
  landingDescription: string | null;
  cachedInfo: Record<string, unknown> | null;
  images: EnterpriseImage[];
}

/* ================================================================
   Slug Generator
   ================================================================ */
function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

/* ================================================================
   Landing Pages Tab
   ================================================================ */
export function LandingPagesTab() {
  const [enterprises, setEnterprises] = useState<Enterprise[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSlug, setEditSlug] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [fieldsEnterprise, setFieldsEnterprise] = useState<{ id: string; name: string } | null>(null);
  const [galleryEnterprise, setGalleryEnterprise] = useState<{ id: string; name: string; imageUrl: string | null } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/enterprises/panel');
      if (res.ok) {
        const data = await res.json();
        setEnterprises(data.enterprises || []);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = enterprises.filter((e) => {
    const matchesSearch = !search || e.name.toLowerCase().includes(search.toLowerCase());
    const matchesActive = showInactive || !!e.slug;
    return matchesSearch && matchesActive;
  });

  const hasSlugCount = enterprises.filter((e) => !!e.slug).length;
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  async function saveSlug(id: string) {
    const slug = editSlug.trim().toLowerCase();
    if (!slug) {
      toast.error('O slug não pode ficar vazio');
      return;
    }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      toast.error('Slug inválido. Use apenas letras minúsculas, números e hífens.');
      return;
    }

    setSaving(id);
    try {
      const res = await fetch('/api/enterprises/landing-slug', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, slug }),
      });
      if (res.ok) {
        toast.success(slug ? `Landing page ativada: /empreendimentos/${slug}` : 'Landing page desativada');
        setEditingId(null);
        fetchData();
      } else {
        const data = await res.json();
        throw new Error(data.error || 'Erro ao salvar');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar slug');
    } finally {
      setSaving(null);
    }
  }

  function copyLink(slug: string, id: string) {
    navigator.clipboard.writeText(`${baseUrl}/empreendimentos/${slug}`);
    setCopiedId(id);
    toast.success('Link copiado!');
    setTimeout(() => setCopiedId(null), 2000);
  }

  function startEdit(e: Enterprise) {
    setEditingId(e.id);
    setEditSlug(e.slug || generateSlug(e.name));
  }

  function getSummary(e: Enterprise): string | null {
    const info = e.cachedInfo as Record<string, unknown> | null;
    if (info?.summary && typeof info.summary === 'string') return info.summary.slice(0, 100);
    if (e.landingSubtitle) return e.landingSubtitle.slice(0, 100);
    return null;
  }

  /* ─── Loading ─────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-44 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Stats bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Badge variant="secondary" className="text-xs gap-1.5">
            <Building2 className="h-3 w-3" />
            {enterprises.length} empreendimento{enterprises.length !== 1 ? 's' : ''}
          </Badge>
          <Badge className="text-xs gap-1.5 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
            <Globe className="h-3 w-3" />
            {hasSlugCount} ativo{hasSlugCount !== 1 ? 's' : ''}
          </Badge>
          {enterprises.length - hasSlugCount > 0 && (
            <Badge variant="secondary" className="text-xs gap-1.5">
              <Globe className="h-3 w-3" />
              {enterprises.length - hasSlugCount} sem landing
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="show-inactive"
            checked={showInactive}
            onCheckedChange={setShowInactive}
          />
          <Label htmlFor="show-inactive" className="text-xs cursor-pointer whitespace-nowrap">
            Mostrar inativos
          </Label>
          <Button variant="outline" size="sm" onClick={fetchData} className="ml-2">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar empreendimento..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Globe className="h-12 w-12 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              {enterprises.length === 0
                ? 'Nenhum empreendimento cadastrado.'
                : showInactive
                  ? 'Nenhum resultado encontrado.'
                  : 'Todos os empreendimentos possuem landing page ativa!'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((e) => {
            const hero = e.imageUrl || e.images[0]?.url || null;
            const summary = getSummary(e);
            const isEditing = editingId === e.id;
            const isSaving = saving === e.id;
            const isActive = !!e.slug;

            return (
              <Card
                key={e.id}
                className={cn(
                  'overflow-hidden transition-all duration-200 hover:shadow-md',
                  isActive
                    ? 'border-emerald-200 dark:border-emerald-800/50'
                    : 'border-border/50 opacity-70'
                )}
              >
                {/* Mini hero */}
                <div className="relative h-28 overflow-hidden bg-muted">
                  {hero ? (
                    <img src={hero} alt={e.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Building2 className="h-8 w-8 text-muted-foreground/20" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />

                  {/* Status badge */}
                  <div className="absolute top-2.5 right-2.5">
                    {isActive ? (
                      <Badge className="bg-emerald-500/90 text-white text-[10px] gap-1 backdrop-blur-sm border-0">
                        <CheckCircle2 className="h-3 w-3" /> Ativa
                      </Badge>
                    ) : (
                      <Badge className="bg-black/50 text-white/70 text-[10px] gap-1 backdrop-blur-sm border-0">
                        <EyeOff className="h-3 w-3" /> Inativa
                      </Badge>
                    )}
                  </div>

                  {/* Image count */}
                  {e.images.length > 0 && (
                    <div className="absolute top-2.5 left-2.5">
                      <Badge className="bg-black/50 text-white/80 text-[10px] gap-1 backdrop-blur-sm border-0">
                        <ImageIcon className="h-3 w-3" /> {e.images.length}
                      </Badge>
                    </div>
                  )}
                </div>

                <CardContent className="p-4 space-y-3">
                  {/* Name + region */}
                  <div>
                    <h3 className="font-semibold text-sm truncate">{e.name}</h3>
                    {e.region && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <MapPin className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate">{e.region}</span>
                      </p>
                    )}
                    {summary && (
                      <p className="text-[11px] text-muted-foreground/70 mt-1 line-clamp-1">{summary}</p>
                    )}
                  </div>

                  {/* Slug management */}
                  {isEditing ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <Link2 className="h-3 w-3" />
                        <span>/empreendimentos/</span>
                      </div>
                      <div className="flex gap-2">
                        <Input
                          value={editSlug}
                          onChange={(e) => setEditSlug(e.target.value)}
                          placeholder="slug-do-empreendimento"
                          className="h-8 text-xs font-mono"
                          onKeyDown={(ev) => {
                            if (ev.key === 'Enter') saveSlug(e.id);
                            if (ev.key === 'Escape') setEditingId(null);
                          }}
                          autoFocus
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="h-7 text-xs flex-1"
                          onClick={() => saveSlug(e.id)}
                          disabled={isSaving}
                        >
                          {isSaving ? (
                            <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Salvando...</>
                          ) : (
                            <><Check className="h-3 w-3 mr-1" /> Salvar</>
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setEditingId(null)}
                          disabled={isSaving}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {isActive ? (
                        <>
                          <div className="flex-1 min-w-0 flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/50 rounded-md px-2.5 py-1.5">
                            <Link2 className="h-3 w-3 flex-shrink-0" />
                            <span className="font-mono truncate">{e.slug}</span>
                          </div>
                          <button
                            onClick={() => copyLink(e.slug!, e.id)}
                            className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors flex-shrink-0"
                            title="Copiar link"
                          >
                            {copiedId === e.id ? (
                              <Check className="h-3.5 w-3.5 text-emerald-500" />
                            ) : (
                              <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </button>
                          <a
                            href={`/empreendimentos/${e.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors flex-shrink-0"
                            title="Abrir landing page"
                          >
                            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                          </a>
                          <button
                            onClick={() => setFieldsEnterprise({ id: e.id, name: e.name })}
                            className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors flex-shrink-0"
                            title="Campos do formulário"
                          >
                            <ListChecks className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                          <button
                            onClick={() => setGalleryEnterprise({ id: e.id, name: e.name, imageUrl: e.imageUrl })}
                            className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors flex-shrink-0"
                            title="Galeria de fotos"
                          >
                            <Camera className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        </>
                      ) : (
                        <div className="flex-1" />
                      )}
                      <button
                        onClick={() => startEdit(e)}
                        className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors flex-shrink-0"
                        title={isActive ? 'Editar slug' : 'Ativar landing page'}
                      >
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Info card */}
      <Card className="bg-blue-50/50 dark:bg-blue-950/10 border-blue-200/50 dark:border-blue-800/30">
        <CardContent className="p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-muted-foreground space-y-1.5">
            <p className="font-medium text-foreground/80">Como funcionam as Landing Pages</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Clique no ícone de <strong>editar</strong> para definir o slug (URL personalizada) do empreendimento</li>
              <li>O slug é gerado automaticamente a partir do nome, mas pode ser personalizado</li>
              <li>A landing page fica acessível em <code className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono">/empreendimentos/[slug]</code></li>
              <li>Empreendimentos com <code className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono">cachedInfo</code> e imagens terão landing pages mais completas</li>
              <li>Use o <strong>CTA de WhatsApp</strong> na landing page para receber leads diretos dos anúncios</li>
              <li>Clique no ícone de <strong>lista</strong> para adicionar campos personalizados ao formulário de cadastro (ex: orçamento, tipo de apartamento desejado)</li>
              <li>Clique no ícone de <strong>câmera</strong> para gerenciar a galeria de fotos da landing page (até 15 fotos)</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Form Fields Modal */}
      {fieldsEnterprise && (
        <FormFieldManager
          enterpriseId={fieldsEnterprise.id}
          enterpriseName={fieldsEnterprise.name}
          onClose={() => setFieldsEnterprise(null)}
        />
      )}

      {/* Gallery Manager Modal */}
      {galleryEnterprise && (
        <GalleryManager
          enterpriseId={galleryEnterprise.id}
          enterpriseName={galleryEnterprise.name}
          currentHeroUrl={galleryEnterprise.imageUrl}
          onClose={() => setGalleryEnterprise(null)}
        />
      )}
    </div>
  );
}