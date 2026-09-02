'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  MapPin, Search, X, Phone, ExternalLink, Share2, MessageCircle,
  Building2, BedDouble, SlidersHorizontal, Store, User,
  Home, Layers, LandPlot, CircleDot, Heart, Maximize2, ChevronDown,
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
  enterpriseId: string;
  enterprise: { id: string; name: string };
}

type SortOption =
  | 'item-asc' | 'price-asc' | 'price-desc' | 'area-desc' | 'price-per-sqm';

// ============================================================
// Formatters
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
// Category icon mapping
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
export function RevendaView() {
  const [properties, setProperties] = useState<ResaleProperty[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [captors, setCaptors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProperty, setSelectedProperty] = useState<ResaleProperty | null>(null);

  // Filters (matching reference app)
  const [search, setSearch] = useState('');
  const [filterRegion, setFilterRegion] = useState<string>('__all__');
  const [filterCategory, setFilterCategory] = useState<string>('__all__');
  const [filterBedrooms, setFilterBedrooms] = useState<string>('__all__');
  const [filterCaptor, setFilterCaptor] = useState<string>('__all__');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [minArea, setMinArea] = useState('');
  const [maxArea, setMaxArea] = useState('');
  const [filterFinancing, setFilterFinancing] = useState(false);
  const [filterFgts, setFilterFgts] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('item-asc');
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Favorites
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const saved = localStorage.getItem('revenda-fav-all');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });

  const toggleFavorite = useCallback((code: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      try { localStorage.setItem('revenda-fav-all', JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/enterprises/resale-all');
      if (res.ok) {
        const data = await res.json();
        setProperties(data.properties);
        setRegions(data.regions);
        setCategories(data.categories);
        setCaptors(data.captors);
      }
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    let result = properties;

    // Text search (NFD-normalized, searches code, name, region, address, captor)
    if (search) {
      const s = search.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      result = result.filter(p =>
        (p.name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(s) ||
        p.code.toLowerCase().includes(s) ||
        (p.region || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(s) ||
        (p.address || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(s) ||
        (p.captor || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(s)
      );
    }
    if (filterRegion !== '__all__') result = result.filter(p => p.region === filterRegion);
    if (filterCategory !== '__all__') result = result.filter(p => p.category === filterCategory);
    if (filterCaptor !== '__all__') result = result.filter(p => p.captor === filterCaptor);

    // Bedrooms: 0 = no bedrooms, 1-5 exact, 4+ means >= 4
    if (filterBedrooms !== '__all__') {
      const b = parseInt(filterBedrooms, 10);
      if (b === 0) result = result.filter(p => !p.bedrooms);
      else result = result.filter(p => p.bedrooms === b);
    }

    // Price range
    const minP = minPrice ? parseFloat(minPrice) : null;
    const maxP = maxPrice ? parseFloat(maxPrice) : null;
    if (minP != null) result = result.filter(p => p.price != null && p.price >= minP);
    if (maxP != null) result = result.filter(p => p.price != null && p.price <= maxP);

    // Area range
    const minA = minArea ? parseFloat(minArea) : null;
    const maxA = maxArea ? parseFloat(maxArea) : null;
    if (minA != null) result = result.filter(p => p.area != null && p.area >= minA);
    if (maxA != null) result = result.filter(p => p.area != null && p.area <= maxA);

    // Toggles
    if (filterFinancing) result = result.filter(p => p.acceptsFinancing);
    if (filterFgts) result = result.filter(p => p.acceptsFgts);

    // Sort
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case 'item-asc':
          return a.sortOrder - b.sortOrder;
        case 'price-asc':
          return (a.price ?? Infinity) - (b.price ?? Infinity);
        case 'price-desc':
          return (b.price ?? 0) - (a.price ?? 0);
        case 'area-desc':
          return (b.area ?? 0) - (a.area ?? 0);
        case 'price-per-sqm': {
          const aSqm = a.price && a.area ? a.price / a.area : Infinity;
          const bSqm = b.price && b.area ? b.price / b.area : Infinity;
          return aSqm - bSqm;
        }
        default:
          return a.sortOrder - b.sortOrder;
      }
    });

    return result;
  }, [properties, search, filterRegion, filterCategory, filterBedrooms, filterCaptor, minPrice, maxPrice, minArea, maxArea, filterFinancing, filterFgts, sortBy]);

  const clearFilters = () => {
    setSearch(''); setFilterRegion('__all__'); setFilterCategory('__all__');
    setFilterBedrooms('__all__'); setFilterCaptor('__all__');
    setMinPrice(''); setMaxPrice(''); setMinArea(''); setMaxArea('');
    setFilterFinancing(false); setFilterFgts(false);
  };

  const hasFilters = filterRegion !== '__all__' || filterCategory !== '__all__' ||
    filterBedrooms !== '__all__' || filterCaptor !== '__all__' ||
    minPrice || maxPrice || minArea || maxArea || filterFinancing || filterFgts;

  const activeFilterCount = [
    filterRegion !== '__all__',
    filterCategory !== '__all__',
    filterBedrooms !== '__all__',
    filterCaptor !== '__all__',
    !!minPrice, !!maxPrice, !!minArea, !!maxArea,
    filterFinancing, filterFgts,
  ].filter(Boolean).length;

  const favCount = filtered.filter(p => favorites.has(p.code)).length;

  // Detail modal
  if (selectedProperty) {
    return (
      <PropertyDetailModal
        property={selectedProperty}
        isFavorite={favorites.has(selectedProperty.code)}
        onToggleFavorite={() => toggleFavorite(selectedProperty.code)}
        onClose={() => setSelectedProperty(null)}
      />
    );
  }

  return (
    <div className="space-y-4 max-w-full">
      {/* Top bar: search + filter toggle + sort + results count */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por código, nome, endereço ou captador..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 pr-8"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Filter dropdown toggle */}
        <button
          onClick={() => setFiltersOpen(!filtersOpen)}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all whitespace-nowrap',
            filtersOpen
              ? 'bg-primary text-primary-foreground border-primary shadow-md shadow-primary/20'
              : activeFilterCount > 0
                ? 'bg-primary/10 text-primary border-primary/30 dark:bg-primary/20 dark:text-primary dark:border-primary/30'
                : 'bg-background text-foreground border-border hover:bg-muted'
          )}
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span>Filtros</span>
          {activeFilterCount > 0 && !filtersOpen && (
            <span className={cn(
              'inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full text-[11px] font-bold',
              'bg-primary text-primary-foreground'
            )}>
              {activeFilterCount}
            </span>
          )}
          <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', filtersOpen && 'rotate-180')} />
        </button>

        {/* Sort */}
        <Select value={sortBy} onValueChange={v => setSortBy(v as SortOption)}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue placeholder="Ordenar resultados por..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="item-asc">Ordem original (número do item)</SelectItem>
            <SelectItem value="price-asc">Menor preço primeiro</SelectItem>
            <SelectItem value="price-desc">Maior preço primeiro</SelectItem>
            <SelectItem value="area-desc">Maior área primeiro</SelectItem>
            <SelectItem value="price-per-sqm">Menor valor por m²</SelectItem>
          </SelectContent>
        </Select>

        {/* Results count badge */}
        {properties.length > 0 && (
          <Badge variant="secondary" className="text-xs w-fit flex-shrink-0 hidden sm:flex">
            {filtered.length} de {properties.length} imóve{properties.length !== 1 ? 'is' : 'l'}
          </Badge>
        )}
      </div>

      {/* Mobile results count */}
      {properties.length > 0 && (
        <p className="text-sm text-muted-foreground sm:hidden">
          {filtered.length} imóve{filtered.length !== 1 ? 'is' : 'l'} encontrado{filtered.length !== 1 ? 's' : ''}
          {filtered.length !== properties.length && ` de ${properties.length}`}
        </p>
      )}

      {/* Collapsible Filters Panel */}
      <div className={cn(
        'overflow-hidden transition-all duration-300 ease-in-out',
        filtersOpen ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'
      )}>
        <Card className="border-primary/30 dark:border-primary/30 shadow-sm">
          <CardContent className="p-4 space-y-5">
            {/* Section: Location & Type */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Localização e tipo do imóvel</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {regions.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                      Região
                    </label>
                    <Select value={filterRegion} onValueChange={setFilterRegion}>
                      <SelectTrigger><SelectValue placeholder="Todas as regiões" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">Todas as regiões</SelectItem>
                        {regions.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {categories.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                      Tipo de imóvel
                    </label>
                    <Select value={filterCategory} onValueChange={setFilterCategory}>
                      <SelectTrigger><SelectValue placeholder="Todos os tipos" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">Todos os tipos</SelectItem>
                        {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                    <BedDouble className="h-3.5 w-3.5 text-muted-foreground" />
                    Quantidade de quartos
                  </label>
                  <Select value={filterBedrooms} onValueChange={setFilterBedrooms}>
                    <SelectTrigger><SelectValue placeholder="Qualquer quantidade" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Qualquer quantidade</SelectItem>
                      <SelectItem value="1">1 quarto</SelectItem>
                      <SelectItem value="2">2 quartos</SelectItem>
                      <SelectItem value="3">3 quartos</SelectItem>
                      <SelectItem value="4">4 quartos</SelectItem>
                      <SelectItem value="5">5 quartos ou mais</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {captors.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                      Captador do imóvel
                    </label>
                    <Select value={filterCaptor} onValueChange={setFilterCaptor}>
                      <SelectTrigger><SelectValue placeholder="Todos os captadores" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">Todos os captadores</SelectItem>
                        {captors.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>

            {/* Divider */}
            <div className="border-t" />

            {/* Section: Price Range */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Faixa de preço</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">
                    Preço mínimo (R$)
                  </label>
                  <Input
                    type="number"
                    placeholder="Ex: 300000"
                    value={minPrice}
                    onChange={e => setMinPrice(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">Deixe vazio para sem limite mínimo</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">
                    Preço máximo (R$)
                  </label>
                  <Input
                    type="number"
                    placeholder="Ex: 1000000"
                    value={maxPrice}
                    onChange={e => setMaxPrice(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">Deixe vazio para sem limite máximo</p>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t" />

            {/* Section: Area Range */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Área do imóvel</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">
                    Área mínima (m²)
                  </label>
                  <Input
                    type="number"
                    placeholder="Ex: 50"
                    value={minArea}
                    onChange={e => setMinArea(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">Tamanho mínimo da área privativa</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">
                    Área máxima (m²)
                  </label>
                  <Input
                    type="number"
                    placeholder="Ex: 200"
                    value={maxArea}
                    onChange={e => setMaxArea(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">Tamanho máximo da área privativa</p>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t" />

            {/* Section: Conditions */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Condições comerciais</h4>
              <div className="flex flex-wrap gap-3">
                <label className={cn(
                  'flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg border cursor-pointer transition-all select-none',
                  filterFinancing
                    ? 'bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary border-primary/30 dark:border-primary/30 shadow-sm'
                    : 'text-muted-foreground border-border hover:bg-muted'
                )}>
                  <input type="checkbox" checked={filterFinancing} onChange={e => setFilterFinancing(e.target.checked)} className="sr-only" />
                  <span className={cn(
                    'inline-block w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors',
                    filterFinancing
                      ? 'bg-primary border-primary'
                      : 'border-muted-foreground/40'
                  )}>
                    {filterFinancing && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                  </span>
                  Aceita financiamento
                </label>
                <label className={cn(
                  'flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-lg border cursor-pointer transition-all select-none',
                  filterFgts
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-300 dark:border-blue-700 shadow-sm'
                    : 'text-muted-foreground border-border hover:bg-muted'
                )}>
                  <input type="checkbox" checked={filterFgts} onChange={e => setFilterFgts(e.target.checked)} className="sr-only" />
                  <span className={cn(
                    'inline-block w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors',
                    filterFgts
                      ? 'bg-blue-600 border-blue-600'
                      : 'border-muted-foreground/40'
                  )}>
                    {filterFgts && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                  </span>
                  Aceita FGTS
                </label>
              </div>
            </div>

            {/* Footer: clear button */}
            {hasFilters && (
              <div className="flex justify-end pt-1">
                <button
                  onClick={clearFilters}
                  className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                  Limpar todos os filtros
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Active filter pills (shown when filters are closed) */}
      {!filtersOpen && hasFilters && (
        <div className="flex flex-wrap items-center gap-2">
          {filterRegion !== '__all__' && (
            <FilterPill icon={<MapPin className="h-3 w-3" />} label={filterRegion} onRemove={() => setFilterRegion('__all__')} />
          )}
          {filterCategory !== '__all__' && (
            <FilterPill icon={<Building2 className="h-3 w-3" />} label={filterCategory} onRemove={() => setFilterCategory('__all__')} />
          )}
          {filterBedrooms !== '__all__' && (
            <FilterPill icon={<BedDouble className="h-3 w-3" />} label={`${filterBedrooms} quarto${filterBedrooms !== '1' ? 's' : ''}`} onRemove={() => setFilterBedrooms('__all__')} />
          )}
          {filterCaptor !== '__all__' && (
            <FilterPill icon={<User className="h-3 w-3" />} label={filterCaptor} onRemove={() => setFilterCaptor('__all__')} />
          )}
          {minPrice && (
            <FilterPill label={`A partir de R$ ${Number(minPrice).toLocaleString('pt-BR')}`} onRemove={() => setMinPrice('')} />
          )}
          {maxPrice && (
            <FilterPill label={`Até R$ ${Number(maxPrice).toLocaleString('pt-BR')}`} onRemove={() => setMaxPrice('')} />
          )}
          {minArea && (
            <FilterPill label={`Área mín. ${minArea} m²`} onRemove={() => setMinArea('')} />
          )}
          {maxArea && (
            <FilterPill label={`Área máx. ${maxArea} m²`} onRemove={() => setMaxArea('')} />
          )}
          {filterFinancing && (
            <FilterPill label="Financiamento" onRemove={() => setFilterFinancing(false)} />
          )}
          {filterFgts && (
            <FilterPill label="FGTS" onRemove={() => setFilterFgts(false)} />
          )}
          <button
            onClick={clearFilters}
            className="text-xs text-muted-foreground hover:text-foreground underline ml-1"
          >
            Limpar tudo
          </button>
        </div>
      )}

      {/* Favorites row (always visible) */}
      {favorites.size > 0 && (
        <div className="flex items-center gap-2">
          <Heart className="h-4 w-4 text-rose-500" />
          <span className="text-sm text-muted-foreground">
            {favCount} favorito{favCount !== 1 ? 's' : ''} selecionado{favCount !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="h-72 rounded-xl border bg-muted animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Store className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
            <h3 className="font-semibold text-lg mb-1">{properties.length ? 'Nenhum resultado' : 'Nenhum imóvel cadastrado'}</h3>
            <p className="text-sm text-muted-foreground">
              {properties.length ? 'Tente ajustar os filtros.' : 'O administrador ainda não importou imóveis via PDF.'}
            </p>
            {hasFilters && (
              <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
                <X className="h-4 w-4 mr-1" />Limpar filtros
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(p => (
            <ResaleCard
              key={p.id}
              property={p}
              isFavorite={favorites.has(p.code)}
              onToggleFavorite={() => toggleFavorite(p.code)}
              onViewDetails={() => setSelectedProperty(p)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Filter Pill (active filter chip shown when panel is closed)
// ============================================================
function FilterPill({ icon, label, onRemove }: { icon?: React.ReactNode; label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary border border-primary/30 dark:border-primary/30 text-xs font-medium">
      {icon}
      {label}
      <button
        onClick={onRemove}
        className="ml-0.5 p-0.5 rounded-full hover:bg-primary/20 dark:hover:bg-primary/30 transition-colors"
        aria-label={`Remover filtro: ${label}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

// ============================================================
// Resale Property Card
// ============================================================
function ResaleCard({ property: p, isFavorite, onToggleFavorite, onViewDetails }: {
  property: ResaleProperty; isFavorite: boolean; onToggleFavorite: () => void; onViewDetails: () => void;
}) {
  const catStyle = getCategoryStyle(p.category);
  return (
    <Card className="group overflow-hidden hover:shadow-lg transition-all duration-300 border-border/50 hover:border-primary/30 dark:hover:border-primary/30 flex flex-col">
      {/* Top color bar */}
      <div className={cn('px-3 py-2.5 flex items-center justify-between', catStyle.bg)}>
        <div className={cn('flex items-center gap-1.5 text-xs font-semibold uppercase', catStyle.color)}>
          {catStyle.icon}
          <span>{p.category}</span>
        </div>
        <button
          onClick={onToggleFavorite}
          className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          aria-label={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
        >
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
          {p.bedrooms != null && (
            <span className="flex items-center gap-1"><BedDouble className="h-3 w-3" />{p.bedrooms} {p.bedrooms === 1 ? 'quarto' : 'quartos'}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-1 mb-2">
          {p.acceptsFinancing && <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary hover:bg-primary/20 dark:hover:bg-primary/30">Financiamento</Badge>}
          {p.acceptsFgts && <Badge variant="secondary" className="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30">FGTS</Badge>}
        </div>
        {p.captor && <p className="text-xs text-muted-foreground mb-3"><span className="font-medium">Captador:</span> {p.captor}</p>}
        <div className="mt-auto flex gap-2">
          <Button size="sm" className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold" onClick={onViewDetails}>
            Ver detalhes
          </Button>
          {p.url ? (
            <a href={p.url} target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline" className="text-xs font-semibold">
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
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
        <div className="bg-primary text-primary-foreground px-5 py-4 rounded-t-xl">
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
            <div>
              <h3 className="text-sm font-semibold mb-1.5">Condições</h3>
              <div className="flex flex-wrap gap-1.5">
                {p.acceptsFinancing && <Badge className="bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary">Aceita financiamento</Badge>}
                {p.acceptsFgts && <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Aceita FGTS</Badge>}
              </div>
            </div>
          )}

          {p.notes && <div><h3 className="text-sm font-semibold mb-1">Observações</h3><p className="text-sm text-muted-foreground">{p.notes}</p></div>}
          {p.dataNote && (
            <div className="rounded-md border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/20 p-2.5">
              <p className="text-xs text-amber-700 dark:text-amber-400"><span className="font-semibold">Nota:</span> {p.dataNote}</p>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold mb-1">Captador / Equipe</h3>
            <p className="text-sm text-muted-foreground">{p.captor || 'Não informado'}</p>
            {p.appointment && <p className="text-sm text-muted-foreground mt-0.5">{p.appointment}</p>}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 pt-2">
            {p.phone && (
              <a href={`tel:+${p.phoneDigits || p.phone.replace(/\D/g, '')}`}>
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                  <Phone className="h-4 w-4 mr-2" />Ligar
                </Button>
              </a>
            )}
            {p.phoneDigits && (
              <a href={`https://wa.me/${p.phoneDigits}?text=${encodeURIComponent(`Olá! Gostaria de informações sobre o imóvel ${p.name || p.code}, código ${p.code}.`)}`} target="_blank" rel="noreferrer">
                <Button className="bg-green-600 hover:bg-green-700 text-white">
                  <MessageCircle className="h-4 w-4 mr-2" />WhatsApp
                </Button>
              </a>
            )}
            {p.url && (
              <a href={p.url} target="_blank" rel="noreferrer">
                <Button variant="outline"><ExternalLink className="h-4 w-4 mr-2" />Anúncio</Button>
              </a>
            )}
            <Button variant="outline" onClick={handleShare}>
              <Share2 className="h-4 w-4 mr-2" />Compartilhar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
