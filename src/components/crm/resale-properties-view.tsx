'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  MapPin, Search, X, Phone, ExternalLink, Share2, MessageCircle,
  Building2, BedDouble, Filter, ArrowLeft,
  Home, Store, Layers, LandPlot, CircleDot, Heart, Maximize2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

// ============================================================
// Types
// ============================================================
interface ResaleProperty {
  id: string;
  code: string;
  sortOrder: number;
  name: string | null;
  region: string | null;
  category: string;
  typology: string | null;
  bedrooms: number | null;
  area: number | null;
  address: string | null;
  captor: string | null;
  appointment: string | null;
  phone: string | null;
  phoneDigits: string | null;
  price: number | null;
  condo: number | null;
  iptu: number | null;
  notes: string | null;
  acceptsFinancing: boolean;
  acceptsFgts: boolean;
  url: string | null;
  dataNote: string | null;
}

interface Props {
  enterpriseId: string;
  enterpriseName: string;
  onBack: () => void;
}

type SortOption = 'code-asc' | 'price-asc' | 'price-desc' | 'area-asc' | 'area-desc' | 'name-asc';

// ============================================================
// Formatters (ported from reference app)
// ============================================================
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const dec = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

function fmtCurrency(v: number | null): string {
  return v != null ? brl.format(v) : 'Valor sob consulta';
}
function fmtArea(v: number | null): string {
  return v != null ? `${dec.format(v)} m²` : 'Área não informada';
}
function fmtPriceSqm(price: number | null, area: number | null): string {
  if (!price || !area || price <= 0 || area <= 0) return '—';
  return brl.format(price / area);
}
function fmtOpt(v: number | null): string {
  return v != null ? brl.format(v) : 'Não informado';
}

// ============================================================
// Category icon mapping (using lucide-react instead of SVGs)
// ============================================================
const categoryMeta: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  Apartamento: { icon: <Building2 className="h-3.5 w-3.5" />, color: 'text-blue-700 dark:text-blue-400', bg: 'bg-blue-100 dark:bg-blue-900/30' },
  Casa:       { icon: <Home className="h-3.5 w-3.5" />, color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/30' },
  Comercial:  { icon: <Store className="h-3.5 w-3.5" />, color: 'text-purple-700 dark:text-purple-400', bg: 'bg-purple-100 dark:bg-purple-900/30' },
  Flat:       { icon: <Layers className="h-3.5 w-3.5" />, color: 'text-cyan-700 dark:text-cyan-400', bg: 'bg-cyan-100 dark:bg-cyan-900/30' },
  Lote:       { icon: <LandPlot className="h-3.5 w-3.5" />, color: 'text-green-700 dark:text-green-400', bg: 'bg-green-100 dark:bg-green-900/30' },
  Outro:      { icon: <CircleDot className="h-3.5 w-3.5" />, color: 'text-gray-600 dark:text-gray-400', bg: 'bg-gray-100 dark:bg-gray-800/30' },
};

function getCategoryStyle(cat: string) {
  return categoryMeta[cat] || categoryMeta.Outro;
}

// ============================================================
// Main component
// ============================================================
export function ResalePropertiesView({ enterpriseId, enterpriseName, onBack }: Props) {
  const [properties, setProperties] = useState<ResaleProperty[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProperty, setSelectedProperty] = useState<ResaleProperty | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [filterRegion, setFilterRegion] = useState<string>('__all__');
  const [filterCategory, setFilterCategory] = useState<string>('__all__');
  const [filterBedrooms, setFilterBedrooms] = useState<string>('__all__');
  const [filterFinancing, setFilterFinancing] = useState(false);
  const [filterFgts, setFilterFgts] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('code-asc');

  // Favorites
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const saved = localStorage.getItem(`revenda-fav-${enterpriseId}`);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });

  const toggleFavorite = useCallback((code: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      try { localStorage.setItem(`revenda-fav-${enterpriseId}`, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, [enterpriseId]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/enterprises/${enterpriseId}/resale-properties`);
      if (res.ok) {
        const data = await res.json();
        setProperties(data.properties);
        setRegions(data.regions);
        setCategories(data.categories);
      }
    } catch {}
    finally { setLoading(false); }
  }, [enterpriseId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    let result = properties;
    if (search) {
      const s = search.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      result = result.filter(p =>
        (p.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(s) ||
        p.code.toLowerCase().includes(s) ||
        (p.address || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(s) ||
        (p.captor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(s)
      );
    }
    if (filterRegion !== '__all__') result = result.filter(p => p.region === filterRegion);
    if (filterCategory !== '__all__') result = result.filter(p => p.category === filterCategory);
    if (filterBedrooms !== '__all__') {
      const b = parseInt(filterBedrooms, 10);
      if (b === 0) result = result.filter(p => !p.bedrooms);
      else result = result.filter(p => p.bedrooms === b);
    }
    if (filterFinancing) result = result.filter(p => p.acceptsFinancing);
    if (filterFgts) result = result.filter(p => p.acceptsFgts);

    const [field, dir] = sortBy.split('-') as [string, 'asc' | 'desc'];
    result = [...result].sort((a, b) => {
      let va: any, vb: any;
      if (field === 'code') { va = a.code; vb = b.code; }
      else if (field === 'price') { va = a.price ?? Infinity; vb = b.price ?? Infinity; }
      else if (field === 'area') { va = a.area ?? Infinity; vb = b.area ?? Infinity; }
      else if (field === 'name') { va = (a.name || '').toLowerCase(); vb = (b.name || '').toLowerCase(); }
      else { va = a.sortOrder; vb = b.sortOrder; }
      if (va < vb) return dir === 'asc' ? -1 : 1;
      if (va > vb) return dir === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [properties, search, filterRegion, filterCategory, filterBedrooms, filterFinancing, filterFgts, sortBy]);

  const clearFilters = () => {
    setSearch(''); setFilterRegion('__all__'); setFilterCategory('__all__');
    setFilterBedrooms('__all__'); setFilterFinancing(false); setFilterFgts(false);
  };
  const hasFilters = search || filterRegion !== '__all__' || filterCategory !== '__all__' ||
    filterBedrooms !== '__all__' || filterFinancing || filterFgts;

  // Detail modal
  if (selectedProperty) {
    return <PropertyDetailModal property={selectedProperty} isFavorite={favorites.has(selectedProperty.code)}
      onToggleFavorite={() => toggleFavorite(selectedProperty.code)} onClose={() => setSelectedProperty(null)} />;
  }

  return (
    <div className="space-y-4 max-w-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="flex-shrink-0"><ArrowLeft className="h-5 w-5" /></Button>
        <div className="min-w-0">
          <h2 className="text-lg font-bold truncate">{enterpriseName}</h2>
          <p className="text-sm text-muted-foreground">{properties.length} imóve{properties.length !== 1 ? 'is' : 'l'} disponíve{properties.length !== 1 ? 'is' : 'l'}</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-3 sm:p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar por nome, código, endereço, captador..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
              {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>}
            </div>
            <Select value={sortBy} onValueChange={v => setSortBy(v as SortOption)}>
              <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="Ordenar" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="code-asc">Código (A-Z)</SelectItem>
                <SelectItem value="price-asc">Menor preço</SelectItem>
                <SelectItem value="price-desc">Maior preço</SelectItem>
                <SelectItem value="area-asc">Menor área</SelectItem>
                <SelectItem value="area-desc">Maior área</SelectItem>
                <SelectItem value="name-asc">Nome (A-Z)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            {regions.length > 0 && (
              <Select value={filterRegion} onValueChange={setFilterRegion}>
                <SelectTrigger className="w-40"><Filter className="h-3.5 w-3.5 mr-1" /><SelectValue placeholder="Região" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todas</SelectItem>
                  {regions.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {categories.length > 0 && (
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Categoria" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todas</SelectItem>
                  {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Select value={filterBedrooms} onValueChange={setFilterBedrooms}>
              <SelectTrigger className="w-36"><BedDouble className="h-3.5 w-3.5 mr-1" /><SelectValue placeholder="Quartos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos</SelectItem>
                <SelectItem value="0">Sem quartos</SelectItem>
                <SelectItem value="1">1 quarto</SelectItem>
                <SelectItem value="2">2 quartos</SelectItem>
                <SelectItem value="3">3 quartos</SelectItem>
                <SelectItem value="4">4+ quartos</SelectItem>
              </SelectContent>
            </Select>
            <label className={cn('flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md border cursor-pointer transition-colors',
              filterFinancing ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700' : 'text-muted-foreground border-border')}
            >
              <input type="checkbox" checked={filterFinancing} onChange={e => setFilterFinancing(e.target.checked)} className="sr-only" />
              Financiamento
            </label>
            <label className={cn('flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md border cursor-pointer transition-colors',
              filterFgts ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-300 dark:border-blue-700' : 'text-muted-foreground border-border')}
            >
              <input type="checkbox" checked={filterFgts} onChange={e => setFilterFgts(e.target.checked)} className="sr-only" />
              FGTS
            </label>
            {hasFilters && (
              <button onClick={clearFilters} className="text-xs text-muted-foreground hover:text-foreground underline ml-auto">Limpar filtros</button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Results count */}
      {!loading && (
        <p className="text-sm text-muted-foreground">
          {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
          {filtered.length !== properties.length && ` de ${properties.length}`}
        </p>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map(i => <div key={i} className="h-72 rounded-xl border bg-muted animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-16 text-center">
          <Building2 className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <h3 className="font-semibold text-lg mb-1">{properties.length ? 'Nenhum resultado' : 'Nenhum imóvel cadastrado'}</h3>
          <p className="text-sm text-muted-foreground">{properties.length ? 'Tente ajustar os filtros.' : 'O administrador ainda não importou imóveis via PDF.'}</p>
          {hasFilters && <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}><X className="h-4 w-4 mr-1" />Limpar filtros</Button>}
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(p => <ResaleCard key={p.id} property={p} isFavorite={favorites.has(p.code)} onToggleFavorite={() => toggleFavorite(p.code)} onViewDetails={() => setSelectedProperty(p)} />)}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Resale Property Card (Tailwind + shadcn, matching CRM identity)
// ============================================================
function ResaleCard({ property: p, isFavorite, onToggleFavorite, onViewDetails }: {
  property: ResaleProperty; isFavorite: boolean; onToggleFavorite: () => void; onViewDetails: () => void;
}) {
  const catStyle = getCategoryStyle(p.category);
  return (
    <Card className="group overflow-hidden hover:shadow-lg transition-all duration-300 border-border/50 hover:border-emerald-200 dark:hover:border-emerald-800/50 flex flex-col">
      {/* Top color bar */}
      <div className={cn('px-3 py-2.5 flex items-center justify-between', catStyle.bg)}>
        <div className={cn('flex items-center gap-1.5 text-xs font-semibold uppercase', catStyle.color)}>
          {catStyle.icon}
          <span>{p.category}</span>
        </div>
        <button onClick={onToggleFavorite} className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          aria-label={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}>
          <Heart className={cn('h-4 w-4 transition-colors', isFavorite ? 'fill-rose-500 text-rose-500' : 'text-muted-foreground')} />
        </button>
      </div>
      <CardContent className="p-3 flex-1 flex flex-col">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
          <MapPin className="h-3 w-3 flex-shrink-0" />
          {p.region || 'Região não informada'}
        </div>
        <p className="text-xs text-muted-foreground/60 font-mono mb-1">{p.code}</p>
        <h3 className="font-semibold text-sm leading-tight mb-1.5 line-clamp-2 min-h-[2.5rem]">{p.name || 'Imóvel sem nome'}</h3>
        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{p.address || ''}</p>
        <p className="text-lg font-bold text-foreground mb-1.5">{fmtCurrency(p.price)}</p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
          <span className="flex items-center gap-1"><Maximize2 className="h-3 w-3" />{fmtArea(p.area)}</span>
          {p.bedrooms != null && <span className="flex items-center gap-1"><BedDouble className="h-3 w-3" />{p.bedrooms} {p.bedrooms === 1 ? 'quarto' : 'quartos'}</span>}
        </div>
        <div className="flex flex-wrap gap-1 mb-2">
          {p.acceptsFinancing && <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30">Financiamento</Badge>}
          {p.acceptsFgts && <Badge variant="secondary" className="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30">FGTS</Badge>}
        </div>
        {p.captor && <p className="text-xs text-muted-foreground mb-3"><span className="font-medium">Captador:</span> {p.captor}</p>}
        <div className="mt-auto flex gap-2">
          <Button size="sm" className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold" onClick={onViewDetails}>Ver detalhes</Button>
          {p.url ? (
            <a href={p.url} target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline" className="text-xs font-semibold"><ExternalLink className="h-3.5 w-3.5" /></Button>
            </a>
          ) : (
            <Button size="sm" variant="outline" disabled className="text-xs opacity-50">Sem link</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Property Detail Modal
// ============================================================
function PropertyDetailModal({ property: p, isFavorite, onToggleFavorite, onClose }: {
  property: ResaleProperty; isFavorite: boolean; onToggleFavorite: () => void; onClose: () => void;
}) {
  const catStyle = getCategoryStyle(p.category);
  const handleShare = async () => {
    const text = `${p.name || p.code} (${p.code}) — ${p.typology?.toLowerCase() || ''}, ${fmtArea(p.area)}, ${fmtCurrency(p.price)}, em ${p.region || ''}.`;
    if (navigator.share) {
      try { await navigator.share({ title: p.name || p.code, text, url: p.url || window.location.href }); } catch {}
    } else {
      try { await navigator.clipboard.writeText(`${text} ${p.url || ''}`); } catch {}
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-background rounded-xl max-w-2xl w-full max-h-[90dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header gradient */}
        <div className="bg-gradient-to-br from-emerald-600 to-teal-700 px-5 py-4 text-white rounded-t-xl">
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-white/20 text-[11px] font-semibold uppercase mb-2">
                {catStyle.icon}
                {p.category}
              </div>
              <h2 className="text-xl font-bold truncate">{p.name || 'Imóvel sem nome'}</h2>
              <p className="text-sm opacity-80 mt-0.5">{p.code} &middot; {p.region || 'Região não informada'}</p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button onClick={onToggleFavorite} className="p-2 rounded-md hover:bg-white/10 transition-colors">
                <Heart className={cn('h-5 w-5', isFavorite ? 'fill-rose-400 text-rose-400' : 'opacity-70')} />
              </button>
              <button onClick={onClose} className="p-2 rounded-md hover:bg-white/10 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Price */}
          <div>
            <p className="text-2xl font-bold">{fmtCurrency(p.price)}</p>
            <p className="text-sm text-muted-foreground">Valor por m²: {fmtPriceSqm(p.price, p.area)}</p>
          </div>

          {/* Details grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 rounded-lg bg-muted/50">
            <div><p className="text-xs text-muted-foreground mb-0.5">Área privativa</p><p className="text-sm font-semibold">{fmtArea(p.area)}</p></div>
            <div><p className="text-xs text-muted-foreground mb-0.5">Tipologia</p><p className="text-sm font-semibold">{p.typology || 'Não informada'}</p></div>
            {p.bedrooms != null && <div><p className="text-xs text-muted-foreground mb-0.5">Quartos</p><p className="text-sm font-semibold">{p.bedrooms}</p></div>}
            <div><p className="text-xs text-muted-foreground mb-0.5">Condomínio</p><p className="text-sm font-semibold">{fmtOpt(p.condo)}</p></div>
            <div><p className="text-xs text-muted-foreground mb-0.5">IPTU</p><p className="text-sm font-semibold">{fmtOpt(p.iptu)}</p></div>
          </div>

          {p.address && <div><h3 className="text-sm font-semibold mb-1">Endereço</h3><p className="text-sm text-muted-foreground">{p.address}</p></div>}

          {(p.acceptsFinancing || p.acceptsFgts) && (
            <div><h3 className="text-sm font-semibold mb-1.5">Condições</h3><div className="flex flex-wrap gap-1.5">
              {p.acceptsFinancing && <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Aceita financiamento</Badge>}
              {p.acceptsFgts && <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Aceita FGTS</Badge>}
            </div></div>
          )}

          {p.notes && <div><h3 className="text-sm font-semibold mb-1">Observações</h3><p className="text-sm text-muted-foreground">{p.notes}</p></div>}
          {p.dataNote && <div className="rounded-md border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/20 p-2.5"><p className="text-xs text-amber-700 dark:text-amber-400"><span className="font-semibold">Nota:</span> {p.dataNote}</p></div>}

          <div><h3 className="text-sm font-semibold mb-1">Captador / Equipe</h3><p className="text-sm text-muted-foreground">{p.captor || 'Não informado'}</p>{p.appointment && <p className="text-sm text-muted-foreground mt-0.5">{p.appointment}</p>}</div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 pt-2">
            {p.phone && (
              <a href={`tel:+${p.phoneDigits || p.phone.replace(/\D/g, '')}`}>
                <Button className="bg-emerald-600 hover:bg-emerald-700 text-white"><Phone className="h-4 w-4 mr-2" />Ligar</Button>
              </a>
            )}
            {p.phoneDigits && (
              <a href={`https://wa.me/${p.phoneDigits}?text=${encodeURIComponent(`Olá! Gostaria de informações sobre o imóvel ${p.name || p.code}, código ${p.code}.`)}`} target="_blank" rel="noreferrer">
                <Button className="bg-green-600 hover:bg-green-700 text-white"><MessageCircle className="h-4 w-4 mr-2" />WhatsApp</Button>
              </a>
            )}
            {p.url && (
              <a href={p.url} target="_blank" rel="noreferrer">
                <Button variant="outline"><ExternalLink className="h-4 w-4 mr-2" />Anúncio</Button>
              </a>
            )}
            <Button variant="outline" onClick={handleShare}><Share2 className="h-4 w-4 mr-2" />Compartilhar</Button>
          </div>
        </div>
      </div>
    </div>
  );
}