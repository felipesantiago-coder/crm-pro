'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2, MapPin, ArrowRight, Loader2, Search, X,
  Eye, MessageCircle, Clock,
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

/* ─── Confetti Particles (CSS keyframes via style tag) ──── */
function ConfettiParticles() {
  return (
    <style>{`
      @keyframes confetti-fall {
        0%   { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
        100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
      }
      @keyframes shimmer-slide {
        0%   { transform: translateX(-100%); }
        100% { transform: translateX(200%); }
      }
    `}</style>
  );
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
      <ConfettiParticles />

      {/* ── Hero Header ──────────────────────────────────── */}
      <header className="relative overflow-hidden">
        {/* Ambient background effects */}
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

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 pt-8 pb-6 sm:pb-16 text-center">
          {/* Label */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#C9A96E]/20 bg-[#C9A96E]/5 mb-6">
            <Building2 className="h-3.5 w-3.5 text-[#C9A96E]" />
            <span className="text-xs font-medium text-[#C9A96E] tracking-wide uppercase">
              Portfólio Exclusivo
            </span>
          </div>

          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-tight">
            Empreendimentos de{' '}
            <span className="bg-gradient-to-r from-[#C9A96E] via-[#E8D5A3] to-[#C9A96E] bg-clip-text text-transparent">
              Alto Padrão
            </span>
          </h1>
          <p className="mt-4 sm:mt-5 text-base sm:text-lg text-white/50 max-w-2xl mx-auto leading-relaxed">
            Descubra imóveis exclusivos cuidadosamente selecionados para quem busca o melhor em qualidade de vida e investimento.
          </p>

          {/* Gold gradient line */}
          <div className="mt-6 mx-auto w-48 h-[2px] bg-gradient-to-r from-transparent via-[#C9A96E] to-transparent opacity-60" />

          {/* Stats bar */}
          <div className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/[0.03] border border-white/[0.06]">
            <Building2 className="h-4 w-4 text-[#C9A96E]/70" />
            <span className="text-sm text-white/60">
              <span className="text-white/90 font-semibold">{filtered.length}</span>{' '}
              empreendimento{filtered.length !== 1 ? 's' : ''} disponíve{filtered.length !== 1 ? 'is' : 'l'}
              {search && (
                <span className="text-white/30">
                  {' '}· buscando por &quot;{search}&quot;
                </span>
              )}
            </span>
          </div>

          {/* Search */}
          {enterprises.length > 3 && (
            <div className="mt-8 max-w-md mx-auto relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
              <input
                type="text"
                placeholder="Buscar empreendimento..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-11 pr-10 py-3.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#C9A96E]/50 focus:ring-1 focus:ring-[#C9A96E]/20 transition-all"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* ── Grid / Empty State ───────────────────────────── */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pb-16 sm:pb-24">
        {filtered.length === 0 ? (
          /* ─── Empty State ────────────────────────────── */
          <div className="text-center py-16 sm:py-24">
            {/* Illustration */}
            <div className="relative mx-auto w-28 h-28 sm:w-32 sm:h-32 mb-8">
              <div className="absolute inset-0 rounded-full bg-[#C9A96E]/5 blur-2xl" />
              <div className="relative h-full w-full rounded-full bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
                <Building2 className="h-12 w-12 sm:h-14 sm:w-14 text-white/15" strokeWidth={1.5} />
              </div>
            </div>

            <h2 className="text-xl sm:text-2xl font-bold text-white/70 mb-3">
              Nenhum empreendimento encontrado
            </h2>
            <p className="text-white/35 text-sm sm:text-base max-w-sm mx-auto mb-8 leading-relaxed">
              Tente buscar por outro termo ou limpe o filtro para visualizar todos os empreendimentos disponíveis.
            </p>

            <button
              onClick={() => setSearch('')}
              className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl bg-white/[0.05] border border-white/10 text-sm font-medium text-white/70 hover:bg-white/[0.08] hover:border-[#C9A96E]/30 hover:text-[#C9A96E] transition-all duration-300"
            >
              <X className="h-4 w-4" />
              Limpar filtro
            </button>
          </div>
        ) : (
          /* ─── Enterprise Cards ───────────────────────── */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((e) => {
              const hero = e.imageUrl || e.images[0]?.url || null;
              const summary = getSummary(e);
              const status = getStatus(e);
              const isHovered = hoveredId === e.id;
              const hasSlug = !!e.slug;

              return (
                <div
                  key={e.id}
                  className="relative group"
                  onMouseEnter={() => setHoveredId(e.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <div
                    className={`relative h-[340px] sm:h-[420px] lg:h-[460px] rounded-2xl overflow-hidden bg-white/5 border transition-all duration-500 ${
                      isHovered
                        ? 'border-[#C9A96E]/30 shadow-xl shadow-[#C9A96E]/[0.07]'
                        : 'border-white/[0.06]'
                    } ${!hasSlug ? 'opacity-70' : ''}`}
                  >
                    {/* Shimmer effect on hover */}
                    <div
                      className="absolute inset-0 z-20 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                      style={{
                        background: 'linear-gradient(105deg, transparent 40%, rgba(201,169,110,0.06) 45%, rgba(201,169,110,0.12) 50%, rgba(201,169,110,0.06) 55%, transparent 60%)',
                        animation: isHovered ? 'shimmer-slide 1.8s ease-in-out infinite' : 'none',
                      }}
                    />

                    {/* Background image */}
                    {hero && (
                      <div
                        className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110"
                        style={{ backgroundImage: `url(${hero})` }}
                      />
                    )}

                    {/* Image gradient overlay for text readability */}
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A]/70 to-[#0A0A0A]/40" />

                    {/* Hover darkening overlay */}
                    <div className={`absolute inset-0 transition-all duration-500 ${isHovered ? 'bg-[#0A0A0A]/20' : 'bg-transparent'}`} />

                    {/* Status badge */}
                    {status && (
                      <div className="absolute top-4 left-4 z-10">
                        <span className={`inline-flex items-center text-[11px] font-medium px-3 py-1 rounded-full border backdrop-blur-sm ${getStatusColor(status)}`}>
                          {status}
                        </span>
                      </div>
                    )}

                    {/* "Em breve" badge for enterprises without slug */}
                    {!hasSlug && (
                      <div className="absolute top-4 right-4 z-10">
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full bg-[#C9A96E]/15 text-[#C9A96E] border border-[#C9A96E]/25 backdrop-blur-sm">
                          <Clock className="h-3 w-3" />
                          Em breve
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
                        <p className={`text-sm text-white/50 leading-relaxed transition-all duration-500 ${isHovered ? 'opacity-70' : 'line-clamp-2'}`}>
                          {summary}
                        </p>
                      )}
                      <div className="mt-4">
                        {hasSlug ? (
                          <a
                            href={`/empreendimentos/${e.slug}`}
                            className={`inline-flex items-center gap-2 text-sm font-medium transition-all duration-300 ${
                              isHovered
                                ? 'bg-[#C9A96E] text-[#0A0A0A] px-5 py-2.5 rounded-xl shadow-lg shadow-[#C9A96E]/20'
                                : 'text-[#C9A96E] hover:gap-3'
                            }`}
                          >
                            <Eye className="h-4 w-4" />
                            <span>Ver detalhes</span>
                            <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                          </a>
                        ) : (
                          <span className="inline-flex items-center gap-2 text-sm font-medium text-white/30 cursor-default">
                            <Clock className="h-4 w-4" />
                            <span>Indisponível</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Gold line accent */}
                    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#C9A96E]/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* ── Footer ─────────────────────────────────────── */}
      <footer className="border-t border-white/[0.06] bg-white/[0.01]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="py-10 sm:py-14 grid grid-cols-1 sm:grid-cols-3 gap-10 sm:gap-12">
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
              <ul className="space-y-3">
                <li>
                  <a href="/empreendimentos" className="text-sm text-white/30 hover:text-[#C9A96E] transition-colors duration-200">
                    Todos os Empreendimentos
                  </a>
                </li>
                <li>
                  <span className="text-sm text-white/20 cursor-default">Condições Especiais</span>
                </li>
              </ul>
            </div>

            {/* WhatsApp */}
            <div>
              <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4">Atendimento</h4>
              <a
                href="https://wa.me/5511999999999"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2.5 text-sm text-[#25D366]/70 hover:text-[#25D366] transition-colors duration-200"
              >
                <MessageCircle className="h-4 w-4" />
                Fale pelo WhatsApp
              </a>
              <p className="text-xs text-white/20 mt-2 leading-relaxed">
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
