'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2, MapPin, ArrowRight, Loader2, Search, X,
} from 'lucide-react';

/* ─── Types ─────────────────────────────────────────────── */
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
  cachedInfo: Record<string, unknown> | null;
  images: EnterpriseImage[];
}

/* ─── Main ──────────────────────────────────────────────── */
export default function EmpreendimentosPage() {
  const [enterprises, setEnterprises] = useState<Enterprise[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/enterprises/public-list');
      if (res.ok) setEnterprises(await res.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = enterprises.filter((e) =>
    !search || e.name.toLowerCase().includes(search.toLowerCase())
  );

  const getSummary = (e: Enterprise): string | null => {
    const info = e.cachedInfo as Record<string, unknown> | null;
    if (info?.summary && typeof info.summary === 'string') return info.summary;
    if (e.landingSubtitle) return e.landingSubtitle;
    return null;
  };

  const getStatus = (e: Enterprise): string | null => {
    const info = e.cachedInfo as Record<string, unknown> | null;
    const allText = [
      info?.summary,
      ...(Array.isArray(info?.differentials) ? info.differentials : []),
    ].filter(Boolean).join(' ');
    if (/entregue|pronto para morar|habite-se/i.test(allText)) return 'Entregue';
    if (/em construção|construção/i.test(allText)) return 'Em Construção';
    if (/lançamento|pré-lançamento/i.test(allText)) return 'Lançamento';
    return null;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Entregue': return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
      case 'Em Construção': return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
      case 'Lançamento': return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
      default: return 'bg-white/10 text-white/60 border-white/10';
    }
  };

  /* ─── Loading ─────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-[#C9A96E] animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white overflow-x-hidden">
      {/* ── Header ─────────────────────────────────────── */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#C9A96E]/10 to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#C9A96E_0%,_transparent_60%)] opacity-20" />
        <nav className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[#C9A96E] to-[#8B6914] flex items-center justify-center shadow-lg shadow-[#C9A96E]/20">
              <Building2 className="h-5 w-5 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight">Empreendimentos</span>
          </div>
          <div className="text-sm text-white/50 hidden sm:block">Empreendimentos</div>
        </nav>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 pt-8 pb-12 sm:pb-20 text-center">
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-tight">
            Nossos <span className="text-[#C9A96E]">Empreendimentos</span>
          </h1>
          <p className="mt-3 sm:mt-4 text-base sm:text-lg text-white/60 max-w-2xl mx-auto">
            Descubra oportunidades únicas em locais privilegiados com projetos que combinam conforto, sofisticação e qualidade de vida.
          </p>

          {/* Search */}
          {enterprises.length > 3 && (
            <div className="mt-8 max-w-md mx-auto relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
              <input
                type="text"
                placeholder="Buscar empreendimento..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-11 pr-10 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#C9A96E]/50 focus:ring-1 focus:ring-[#C9A96E]/20 transition-all"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* ── Grid ───────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pb-16 sm:pb-24">
        {filtered.length === 0 ? (
          <div className="text-center py-12 sm:py-20">
            <Building2 className="h-16 w-16 text-white/10 mx-auto mb-4" />
            <p className="text-white/40 text-lg">
              {enterprises.length ? 'Nenhum resultado encontrado.' : 'Nenhum empreendimento disponível.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((e) => {
              const hero = e.imageUrl || e.images[0]?.url || null;
              const summary = getSummary(e);
              const status = getStatus(e);
              const isHovered = hoveredId === e.id;

              return (
                <a
                  key={e.id}
                  href={e.slug ? `/empreendimentos/${e.slug}` : '#'}
                  className={!e.slug ? 'pointer-events-none opacity-60' : ''}
                  onMouseEnter={() => setHoveredId(e.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <div className="group relative h-[340px] sm:h-[420px] lg:h-[460px] rounded-2xl overflow-hidden bg-white/5 border border-white/[0.06] hover:border-[#C9A96E]/30 transition-all duration-500">
                    {/* Background image */}
                    {hero && (
                      <div
                        className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110"
                        style={{ backgroundImage: `url(${hero})` }}
                      />
                    )}
                    {/* Overlay */}
                    <div className={`absolute inset-0 transition-all duration-500 ${isHovered ? 'bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A]/60 to-[#0A0A0A]/30' : 'bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A]/70 to-[#0A0A0A]/50'}`} />

                    {/* Status badge */}
                    {status && (
                      <div className="absolute top-4 left-4 z-10">
                        <span className={`inline-flex items-center text-[11px] font-medium px-3 py-1 rounded-full border backdrop-blur-sm ${getStatusColor(status)}`}>
                          {status}
                        </span>
                      </div>
                    )}

                    {/* Content */}
                    <div className="absolute inset-0 z-10 flex flex-col justify-end p-5 sm:p-7">
                      {e.region && (
                        <div className="flex items-center gap-1.5 text-[#C9A96E] text-xs font-medium mb-2">
                          <MapPin className="h-3 w-3" />
                          <span>{e.region}</span>
                        </div>
                      )}
                      <h2 className="text-lg sm:text-2xl font-bold leading-tight mb-1.5 sm:mb-2 group-hover:text-[#C9A96E] transition-colors duration-300">
                        {e.name}
                      </h2>
                      {summary && (
                        <p className={`text-sm text-white/50 leading-relaxed line-clamp-2 mb-4 transition-all duration-500 ${isHovered ? 'line-clamp-3 opacity-60' : ''}`}>
                          {summary}
                        </p>
                      )}
                      {e.slug && (
                        <div className="flex items-center gap-2 text-[#C9A96E] text-sm font-medium mt-auto">
                          <span>Conhecer</span>
                          <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                        </div>
                      )}
                    </div>

                    {/* Gold line accent */}
                    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#C9A96E]/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </main>

      {/* ── Footer ─────────────────────────────────────── */}
      <footer className="border-t border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="py-8 sm:py-10 grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-10">
            {/* Brand */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[#C9A96E] to-[#8B6914] flex items-center justify-center shadow-lg shadow-[#C9A96E]/15">
                  <Building2 className="h-5 w-5 text-white" />
                </div>
                <span className="text-base font-bold tracking-tight">Empreendimentos</span>
              </div>
              <p className="text-sm text-white/30 leading-relaxed max-w-xs">
                Encontre o imóvel ideal para você e sua família. Qualidade, confiança e atendimento personalizado.
              </p>
            </div>

            {/* Quick links */}
            <div>
              <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4">Navegação</h4>
              <ul className="space-y-2.5">
                <li><span className="text-sm text-white/30">Todos os Empreendimentos</span></li>
              </ul>
            </div>

            {/* Info */}
            <div>
              <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4">Informações</h4>
              <p className="text-sm text-white/30 leading-relaxed">
                Conheça nossos empreendimentos imobiliários com projetos que combinam conforto, sofisticação e qualidade de vida.
              </p>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="border-t border-white/[0.04] py-5 sm:py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-white/20">&copy; {new Date().getFullYear()} Todos os direitos reservados.</p>
            <p className="text-xs text-white/15">Todos os valores e informações são sujeitos a alteração sem aviso prévio.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}