'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2, MapPin, Search, Filter, X, ChevronLeft, ChevronRight,
  FileText, Users, Grid3X3, List, Maximize2,
  ZoomIn, ArrowLeft, Ruler, BedDouble, HardHat, Sparkles,
  Palette, Navigation, DollarSign, Clock, CheckCircle2, Camera, CalendarDays,
} from 'lucide-react';
import { toast } from 'sonner';
import { GalleryManager } from './gallery-manager';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

// ============================================================
// Types
// ============================================================
interface EnterpriseImage {
  id: string;
  url: string;
  altText: string | null;
  sortOrder: number;
}

interface ExtractedInfo {
  location: {
    address: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    region: string | null;
    additionalInfo: string | null;
  };
  builder: string | null;
  architecture: string | null;
  landscaping: string | null;
  differentials: string[];
  apartmentTypes: Array<{
    name: string;
    area: string | null;
    bedrooms: string | null;
    description: string | null;
  }>;
  summary: string | null;
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
  cachedInfo: ExtractedInfo | null;
  createdAt: string;
  images: EnterpriseImage[];
  _count: { clients: number };
}

interface PanelData {
  enterprises: Enterprise[];
  regions: string[];
}

// ============================================================
// Main Panel
// ============================================================
export function EnterprisePanel() {
  const [data, setData] = useState<PanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeRegion, setActiveRegion] = useState<string | null>(null);
  const [selectedEnterprise, setSelectedEnterprise] = useState<Enterprise | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/enterprises/panel');
      if (res.ok) setData(await res.json());
      else toast.error('Erro ao carregar empreendimentos');
    } catch { toast.error('Falha de conexão'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filteredEnterprises = (data?.enterprises ?? []).filter((e) => {
    const matchesSearch = !search || e.name.toLowerCase().includes(search.toLowerCase());
    const matchesRegion = !activeRegion || e.region === activeRegion;
    return matchesSearch && matchesRegion;
  });

  const [galleryEnterprise, setGalleryEnterprise] = useState<{ id: string; name: string; imageUrl: string | null } | null>(null);

  if (selectedEnterprise) {
    return (
      <>
        <EnterpriseDetail
          enterprise={selectedEnterprise}
          onBack={() => setSelectedEnterprise(null)}
          onOpenGallery={() => setGalleryEnterprise({ id: selectedEnterprise.id, name: selectedEnterprise.name, imageUrl: selectedEnterprise.imageUrl })}
        />
        {galleryEnterprise && (
          <GalleryManager
            enterpriseId={galleryEnterprise.id}
            enterpriseName={galleryEnterprise.name}
            currentHeroUrl={galleryEnterprise.imageUrl}
            onClose={() => { setGalleryEnterprise(null); fetchData(); }}
          />
        )}
      </>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 max-w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-3">
            <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg flex-shrink-0">
              <Building2 className="h-5 w-5 text-white" />
            </div>
            <span className="truncate">Empreendimentos</span>
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">Explore os empreendimentos com informações detalhadas e galeria</p>
        </div>
        {data && (
          <Badge variant="secondary" className="text-xs w-fit flex-shrink-0">
            <Building2 className="h-3 w-3 mr-1" />
            {data.enterprises.length} empreendimento{data.enterprises.length !== 1 ? 's' : ''}
          </Badge>
        )}
      </div>

      {/* Search + Filters */}
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground flex-shrink-0" />
              <Input placeholder="Buscar por nome..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
              {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>}
            </div>
            <div className="flex items-center border rounded-lg p-0.5 flex-shrink-0">
              <button onClick={() => setViewMode('grid')} className={cn('p-2 rounded-md transition-colors', viewMode === 'grid' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' : 'text-muted-foreground hover:text-foreground')}><Grid3X3 className="h-4 w-4" /></button>
              <button onClick={() => setViewMode('list')} className={cn('p-2 rounded-md transition-colors', viewMode === 'list' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' : 'text-muted-foreground hover:text-foreground')}><List className="h-4 w-4" /></button>
            </div>
          </div>
          {data && data.regions.length > 0 && (
            <>
              {/* Mobile dropdown */}
              <div className="sm:hidden mt-3">
                <Select
                  value={activeRegion || '__all__'}
                  onValueChange={(val) => setActiveRegion(val === '__all__' ? null : val)}
                >
                  <SelectTrigger className="w-full">
                    <div className="flex items-center gap-2">
                      <Filter className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <SelectValue placeholder="Filtrar por região" />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todas as regiões</SelectItem>
                    {data.regions.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* Desktop pills */}
              <div className="hidden sm:flex items-center gap-2 mt-3 flex-wrap">
                <Filter className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <button onClick={() => setActiveRegion(null)} className={cn('text-xs px-3 py-1.5 rounded-full transition-colors font-medium', !activeRegion ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-muted text-muted-foreground hover:text-foreground')}>Todas</button>
                {data.regions.map((r) => (
                  <button key={r} onClick={() => setActiveRegion(activeRegion === r ? null : r)} className={cn('text-xs px-3 py-1.5 rounded-full transition-colors font-medium', activeRegion === r ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-muted text-muted-foreground hover:text-foreground')}>{r}</button>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Content */}
      {loading ? <EnterpriseSkeleton /> : filteredEnterprises.length === 0 ? (
        <Card><CardContent className="py-12 sm:py-16 text-center">
          <Building2 className="h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground/30 mx-auto mb-4" />
          <h3 className="font-semibold text-base sm:text-lg mb-1">{data?.enterprises.length ? 'Nenhum resultado' : 'Nenhum empreendimento'}</h3>
          <p className="text-sm text-muted-foreground px-4">{data?.enterprises.length ? 'Tente ajustar os filtros.' : 'O administrador ainda não cadastrou empreendimentos.'}</p>
          {data?.enterprises.length ? <Button variant="outline" size="sm" className="mt-4" onClick={() => { setSearch(''); setActiveRegion(null); }}><X className="h-4 w-4 mr-1" />Limpar filtros</Button> : null}
        </CardContent></Card>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
          {filteredEnterprises.map((e) => <EnterpriseCard key={e.id} enterprise={e} onClick={() => setSelectedEnterprise(e)} />)}
        </div>
      ) : (
        <div className="space-y-3">{filteredEnterprises.map((e) => <EnterpriseListItem key={e.id} enterprise={e} onClick={() => setSelectedEnterprise(e)} />)}</div>
      )}
    </div>
  );
}

// ============================================================
// Enterprise Card (Grid)
// ============================================================
function EnterpriseCard({ enterprise: e, onClick }: { enterprise: Enterprise; onClick: () => void }) {
  const [imgErr, setImgErr] = useState(false);
  const hero = e.imageUrl || e.images[0]?.url || null;
  const hasMeta = e._count.clients > 0 || e.images.length > 0;
  return (
    <Card className="group cursor-pointer overflow-hidden hover:shadow-lg transition-all duration-300 border-border/50 hover:border-amber-200 dark:hover:border-amber-800/50" onClick={onClick}>
      <div className={cn('relative overflow-hidden bg-muted', hasMeta ? 'aspect-[16/11]' : 'aspect-[16/10]')}>
        {hero && !imgErr ? <img src={hero} alt={e.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" onError={() => setImgErr(true)} /> : <div className="w-full h-full flex items-center justify-center"><Building2 className="h-12 w-12 text-muted-foreground/30" /></div>}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/20" />
        {e.region && <div className="absolute top-3 left-3"><Badge className="bg-black/40 text-white backdrop-blur-sm border-0 text-[11px] gap-1"><MapPin className="h-3 w-3" />{e.region}</Badge></div>}
        {e.images.length > 1 && <div className="absolute top-3 right-3"><Badge className="bg-black/40 text-white backdrop-blur-sm border-0 text-[11px] gap-1"><Maximize2 className="h-3 w-3" />{e.images.length} fotos</Badge></div>}
        <div className="absolute bottom-0 left-0 right-0 p-3">
          <h3 className="text-white font-semibold text-lg leading-tight drop-shadow-md line-clamp-1">{e.name}</h3>
          {hasMeta && (
            <div className="flex items-center gap-3 mt-1.5 text-[11px] text-white/70">
              {e._count.clients > 0 && <span className="flex items-center gap-1"><Users className="h-3 w-3" />{e._count.clients}</span>}
              {e.images.length > 0 && <span className="flex items-center gap-1"><Maximize2 className="h-3 w-3" />{e.images.length}</span>}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ============================================================
// Enterprise List Item
// ============================================================
function EnterpriseListItem({ enterprise: e, onClick }: { enterprise: Enterprise; onClick: () => void }) {
  const [imgErr, setImgErr] = useState(false);
  const hero = e.imageUrl || e.images[0]?.url || null;
  return (
    <Card className="group cursor-pointer hover:shadow-md transition-all duration-200 border-border/50 hover:border-amber-200 dark:hover:border-amber-800/50" onClick={onClick}>
      <CardContent className="p-3 sm:p-4">
        <div className="flex gap-3 sm:gap-4 min-w-0">
          <div className="w-24 h-16 sm:w-28 sm:h-20 rounded-lg overflow-hidden bg-muted flex-shrink-0">
            {hero && !imgErr ? <img src={hero} alt={e.name} className="w-full h-full object-cover" onError={() => setImgErr(true)} /> : <div className="w-full h-full flex items-center justify-center"><Building2 className="h-8 w-8 text-muted-foreground/30" /></div>}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm truncate">{e.name}</h3>
            {e.region && <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1"><MapPin className="h-3 w-3 flex-shrink-0" /><span className="truncate">{e.region}</span></p>}
            <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
              {e._count.clients > 0 && <span className="flex items-center gap-1"><Users className="h-3 w-3" />{e._count.clients}</span>}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Enterprise Detail — reads from cachedInfo (no AI calls)
// ============================================================
function EnterpriseDetail({ enterprise: e, onBack, onOpenGallery }: { enterprise: Enterprise; onBack: () => void; onOpenGallery: () => void }) {
  const [activeImgIdx, setActiveImgIdx] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const images = e.images.length > 0 ? e.images : [];
  const heroImage = e.imageUrl || images[0]?.url || null;
  const info = e.cachedInfo;

  const hasInfo = info && (
    info.location?.address || info.location?.neighborhood || info.location?.city ||
    info.builder || info.architecture || info.landscaping ||
    (info.differentials && info.differentials.length > 0) ||
    (info.apartmentTypes && info.apartmentTypes.length > 0) || info.summary
  );

  const goNext = () => setActiveImgIdx((p) => (p + 1) % Math.max(images.length, 1));
  const goPrev = () => setActiveImgIdx((p) => (p - 1 + images.length) % Math.max(images.length, 1));

  return (
    <div className="space-y-4 sm:space-y-6 max-w-full">
      {/* Back + Title */}
      <div className="flex items-start gap-3 sm:gap-4 max-w-full">
        <Button variant="ghost" size="sm" onClick={onBack} className="mt-0.5 sm:mt-1 flex-shrink-0"><ArrowLeft className="h-4 w-4 mr-1" /><span className="hidden sm:inline">Voltar</span></Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight break-words">{e.name}</h1>
          {e.region && <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5"><MapPin className="h-4 w-4 flex-shrink-0" /><span className="truncate">{e.region}</span></p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {e._count.clients > 0 && <Badge variant="secondary" className="text-xs"><Users className="h-3 w-3 mr-1" />{e._count.clients} cliente{e._count.clients !== 1 ? 's' : ''}</Badge>}
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={onOpenGallery}>
            <Camera className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Galeria</span>
            {e.images.length > 0 && <Badge variant="secondary" className="ml-0.5 text-[10px] px-1.5 py-0 h-4">{e.images.length}</Badge>}
          </Button>
        </div>
      </div>

      {/* Image Gallery */}
      {images.length > 0 ? (
        <div className="space-y-3 max-w-full">
          <div className="relative aspect-[16/10] sm:aspect-[16/9] rounded-xl overflow-hidden bg-muted cursor-pointer group" onClick={() => setLightboxOpen(true)}>
            <img src={images[activeImgIdx]?.url || heroImage || ''} alt={images[activeImgIdx]?.altText || e.name} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
              <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 backdrop-blur-sm rounded-full p-3"><ZoomIn className="h-6 w-6 text-white" /></div>
            </div>
            {images.length > 1 && (
              <>
                <button onClick={(ev) => { ev.stopPropagation(); goPrev(); }} className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white rounded-full p-1.5 sm:p-2 transition-colors"><ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5" /></button>
                <button onClick={(ev) => { ev.stopPropagation(); goNext(); }} className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white rounded-full p-1.5 sm:p-2 transition-colors"><ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" /></button>
                <div className="absolute bottom-2 sm:bottom-3 left-1/2 -translate-x-1/2 bg-black/40 backdrop-blur-sm text-white text-[11px] sm:text-xs px-2.5 sm:px-3 py-1 rounded-full">{activeImgIdx + 1} / {images.length}</div>
              </>
            )}
          </div>
          {images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
              {images.map((img, idx) => (
                <button key={img.id} onClick={() => setActiveImgIdx(idx)} className={cn('flex-shrink-0 w-16 h-11 sm:w-20 sm:h-14 rounded-lg overflow-hidden border-2 transition-all', idx === activeImgIdx ? 'border-amber-500 ring-2 ring-amber-500/20' : 'border-transparent opacity-70 hover:opacity-100')}>
                  <img src={img.url} alt={img.altText || `${e.name} ${idx + 1}`} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : heroImage ? (
        <div className="relative aspect-[16/10] sm:aspect-[16/9] rounded-xl overflow-hidden bg-muted cursor-pointer group max-w-full" onClick={() => setLightboxOpen(true)}>
          <img src={heroImage} alt={e.name} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
            <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 backdrop-blur-sm rounded-full p-3"><ZoomIn className="h-6 w-6 text-white" /></div>
          </div>
        </div>
      ) : null}

      {/* Cached structured info — no AI calls */}
      {hasInfo ? (
        <div className="space-y-3 sm:space-y-4 max-w-full">
          {/* Summary */}
          {info!.summary && (
            <Card className="border-amber-200 dark:border-amber-800/50 bg-amber-50/30 dark:bg-amber-950/10">
              <CardContent className="p-3 sm:p-4 flex items-start gap-3">
                <Sparkles className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
                <p className="text-sm leading-relaxed">{info!.summary}</p>
              </CardContent>
            </Card>
          )}

          {/* Location + Builder + Architecture */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
            {/* Location */}
            {(info!.location.address || info!.location.neighborhood || info!.location.city || info!.location.region) && (
              <Card className="min-w-0">
                <CardContent className="p-3 sm:p-4 space-y-2 sm:space-y-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0"><Navigation className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-blue-600 dark:text-blue-400" /></div>
                    <h3 className="text-sm font-semibold truncate">Localização</h3>
                  </div>
                  <div className="space-y-1.5 sm:pl-10">
                    {info!.location.address && <p className="text-sm text-foreground break-words">{info!.location.address}</p>}
                    {(info!.location.neighborhood || info!.location.city) && (
                      <p className="text-sm text-muted-foreground break-words">
                        {[info!.location.neighborhood, info!.location.city, info!.location.state].filter(Boolean).join(', ')}
                      </p>
                    )}
                    {info!.location.region && (
                      <Badge variant="secondary" className="text-xs"><MapPin className="h-3 w-3 mr-1" />{info!.location.region}</Badge>
                    )}
                    {info!.location.additionalInfo && <p className="text-xs text-muted-foreground mt-1 break-words">{info!.location.additionalInfo}</p>}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Builder */}
            {info!.builder && (
              <Card className="min-w-0">
                <CardContent className="p-3 sm:p-4 space-y-2 sm:space-y-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center flex-shrink-0"><HardHat className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-orange-600 dark:text-orange-400" /></div>
                    <h3 className="text-sm font-semibold truncate">Construtora</h3>
                  </div>
                  <p className="text-sm text-foreground sm:pl-10 break-words">{info!.builder}</p>
                </CardContent>
              </Card>
            )}

            {/* Architecture / Landscaping */}
            {(info!.architecture || info!.landscaping) && (
              <Card className="min-w-0 sm:col-span-2 xl:col-span-1">
                <CardContent className="p-3 sm:p-4 space-y-2 sm:space-y-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center flex-shrink-0"><Palette className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-violet-600 dark:text-violet-400" /></div>
                    <h3 className="text-sm font-semibold truncate">Projeto</h3>
                  </div>
                  <div className="space-y-1 sm:pl-10">
                    {info!.architecture && <p className="text-sm text-foreground break-words"><span className="text-muted-foreground">Arquitetura: </span>{info!.architecture}</p>}
                    {info!.landscaping && <p className="text-sm text-foreground break-words"><span className="text-muted-foreground">Paisagismo: </span>{info!.landscaping}</p>}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Status & Delivery Card — always visible */}
          {(() => {
            const allText = [info!.summary, ...(info!.differentials || [])].filter(Boolean).join(' ');
            let status: string | null = null;
            let statusColor = 'bg-gray-100 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400';
            let statusIcon = <Clock className="h-3 w-3 mr-1" />;
            if (/entregue|pronto para morar|habite-se/i.test(allText)) { status = 'Entregue'; statusColor = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'; statusIcon = <CheckCircle2 className="h-3 w-3 mr-1" />; }
            else if (/em construção|construção/i.test(allText)) { status = 'Em Construção'; statusColor = 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'; statusIcon = <HardHat className="h-3 w-3 mr-1" />; }
            else if (/lançamento|pré-lançamento/i.test(allText)) { status = 'Lançamento'; statusColor = 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'; }
            const priceMatch = info!.summary?.match(/a partir de\s*R\$\s*[\d.]+/i) || info!.apartmentTypes?.[0]?.description?.match(/a partir de\s*R\$\s*[\d.]+/i);
            const deliveryMatch = allText.match(/entrega.*?(\d{1,2}\/[\d]{4}|outubro \d{4}|dezembro \d{4}|30\/10\/\d{4})/i);
            const deliveryText = deliveryMatch ? deliveryMatch[1] : (status === 'Entregue' ? 'Já entregue' : null);
            return (
              <Card className="min-w-0 border-l-4 border-l-[#C9A96E]">
                <CardContent className="p-3 sm:p-4 space-y-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-[#C9A96E]/15 flex items-center justify-center flex-shrink-0"><CalendarDays className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-[#C9A96E]" /></div>
                    <h3 className="text-sm font-semibold truncate">Situação do Empreendimento</h3>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:pl-10">
                    <Badge className={cn('text-xs font-semibold px-2.5 py-1', statusColor)}>{statusIcon}{status || 'A definir'}</Badge>
                    {deliveryText && (
                      <Badge className={cn('text-xs font-medium px-2.5 py-1',
                        status === 'Entregue'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                      )}>
                        {status === 'Entregue' ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <Clock className="h-3 w-3 mr-1" />}
                        {status === 'Entregue' ? deliveryText : `Previsão: ${deliveryText}`}
                      </Badge>
                    )}
                    {priceMatch && <Badge className="text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-2.5 py-1"><DollarSign className="h-3 w-3 mr-1" />{priceMatch[0]}</Badge>}
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* Apartment Types */}
          {info!.apartmentTypes && info!.apartmentTypes.length > 0 && (
            <Card className="min-w-0">
              <CardContent className="p-3 sm:p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0"><Building2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-emerald-600 dark:text-emerald-400" /></div>
                  <h3 className="text-sm font-semibold">Tipos de Unidades</h3>
                  <Badge variant="secondary" className="text-[10px] ml-auto">{info!.apartmentTypes.length} tipo{info!.apartmentTypes.length !== 1 ? 's' : ''}</Badge>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                  {info!.apartmentTypes.map((apt, idx) => {
                    const priceInDesc = apt.description?.match(/R\$[\d.,]+/);
                    return (
                      <div key={idx} className="rounded-lg border p-3 space-y-2 hover:border-emerald-200 dark:hover:border-emerald-800/50 transition-colors min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-sm font-medium break-words">{apt.name}</h4>
                          {priceInDesc && <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap flex-shrink-0">{priceInDesc[0]}</span>}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {apt.area && <span className="flex items-center gap-1"><Ruler className="h-3 w-3 flex-shrink-0" />{apt.area}</span>}
                          {apt.bedrooms && <span className="flex items-center gap-1"><BedDouble className="h-3 w-3 flex-shrink-0" />{apt.bedrooms}</span>}
                        </div>
                        {apt.description && <p className="text-xs text-muted-foreground mt-1 break-words leading-relaxed">{apt.description}</p>}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Differentials */}
          {info!.differentials && info!.differentials.length > 0 && (
            <Card className="min-w-0">
              <CardContent className="p-3 sm:p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0"><Sparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-amber-600 dark:text-amber-400" /></div>
                  <h3 className="text-sm font-semibold">Diferenciais</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  {info!.differentials.map((d, i) => (
                    <Badge key={i} variant="secondary" className="text-xs py-1.5 px-3 font-normal bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800/50">{d}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        /* Fallback when no cached info */
        <>
          {e.landingDescription && (
            <Card>
              <CardContent className="p-4 sm:p-5">
                {e.landingTitle && <h2 className="text-lg font-semibold mb-1 break-words">{e.landingTitle}</h2>}
                {e.landingSubtitle && <p className="text-sm font-medium text-amber-600 dark:text-amber-400 mb-2">{e.landingSubtitle}</p>}
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">{e.landingDescription}</p>
              </CardContent>
            </Card>
          )}
          {!info && !e.landingDescription && (
            <Card>
              <CardContent className="p-6 sm:p-8 text-center">
                <FileText className="h-10 w-10 sm:h-12 sm:w-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Nenhuma informação detalhada disponível para este empreendimento.</p>
                <p className="text-xs text-muted-foreground mt-1">O administrador pode adicionar documentos na seção de Administração.</p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Lightbox */}
      {lightboxOpen && (
        <Lightbox images={heroImage && !images.length ? [{ id: 'hero', url: heroImage, altText: e.name, sortOrder: 0 }] : images} initialIndex={images.length > 0 ? activeImgIdx : 0} onClose={() => setLightboxOpen(false)} />
      )}
    </div>
  );
}

// ============================================================
// Lightbox
// ============================================================
function Lightbox({ images, initialIndex, onClose }: { images: EnterpriseImage[]; initialIndex: number; onClose: () => void }) {
  const [idx, setIdx] = useState(initialIndex);
  useEffect(() => {
    const h = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
      if (ev.key === 'ArrowRight') setIdx((p) => (p + 1) % images.length);
      if (ev.key === 'ArrowLeft') setIdx((p) => (p - 1 + images.length) % images.length);
    };
    window.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = ''; };
  }, [images.length, onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 text-white/70 hover:text-white z-10 bg-black/50 backdrop-blur-sm rounded-full p-2"><X className="h-6 w-6" /></button>
      <div className="absolute top-4 left-4 text-white/70 text-sm bg-black/50 backdrop-blur-sm px-3 py-1 rounded-full">{idx + 1} / {images.length}</div>
      <img src={images[idx]?.url} alt={images[idx]?.altText || ''} className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg" onClick={(ev) => ev.stopPropagation()} />
      {images.length > 1 && (
        <>
          <button onClick={(ev) => { ev.stopPropagation(); setIdx((p) => (p - 1 + images.length) % images.length); }} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white bg-black/50 backdrop-blur-sm rounded-full p-3"><ChevronLeft className="h-6 w-6" /></button>
          <button onClick={(ev) => { ev.stopPropagation(); setIdx((p) => (p + 1) % images.length); }} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white bg-black/50 backdrop-blur-sm rounded-full p-3"><ChevronRight className="h-6 w-6" /></button>
        </>
      )}
    </div>
  );
}

// ============================================================
// Skeleton
// ============================================================
function EnterpriseSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-muted animate-pulse" />
        <div className="space-y-2"><div className="h-6 w-48 bg-muted animate-pulse rounded" /><div className="h-4 w-64 bg-muted animate-pulse rounded" /></div>
      </div>
      <div className="h-14 bg-muted animate-pulse rounded-xl" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="rounded-xl border overflow-hidden"><div className="aspect-[16/10] bg-muted animate-pulse" /><div className="p-4 space-y-2"><div className="h-4 w-3/4 bg-muted animate-pulse rounded" /><div className="h-3 w-1/2 bg-muted animate-pulse rounded" /></div></div>
        ))}
      </div>
    </div>
  );
}