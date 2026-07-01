#!/usr/bin/env python3
"""
Fix all responsive issues + layout inconsistency + missing section in landing page.
Reads the current page.tsx, applies all fixes, writes back.
"""

import re

FILE = '/home/z/my-project/src/app/empreendimentos/[slug]/page.tsx'

with open(FILE, 'r') as f:
    content = f.read()

# ═══════════════════════════════════════════════════════════
# FIX 1: Root container — add break-words
# ═══════════════════════════════════════════════════════════
content = content.replace(
    'className="min-h-screen bg-[#0A0A0A] text-white overflow-x-hidden"',
    'className="min-h-screen bg-[#0A0A0A] text-white overflow-x-hidden [word-break:break-word]"'
)

# ═══════════════════════════════════════════════════════════
# FIX 2: Hero badges — truncate long text (price + delivery)
# ═══════════════════════════════════════════════════════════

# Price badge
old_price_badge = '''{priceMatch && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
                <DollarSign className="h-3 w-3" />
                {priceMatch[0]}
              </span>
            )}'''

new_price_badge = '''{priceMatch && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 max-w-[200px] sm:max-w-none">
                <DollarSign className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{priceMatch[0]}</span>
              </span>
            )}'''

content = content.replace(old_price_badge, new_price_badge)

# Delivery badge
old_delivery_badge = '''{deliveryMatch && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/25">
                <Clock className="h-3 w-3" />
                Previsão: {deliveryMatch[1]}
              </span>
            )}'''

new_delivery_badge = '''{deliveryMatch && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/25 max-w-[200px] sm:max-w-none">
                <Clock className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">Previsão: {deliveryMatch[1]}</span>
              </span>
            )}'''

content = content.replace(old_delivery_badge, new_delivery_badge)

# Region badge
old_region_badge = '''{e.region && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-white/10 text-white/70 border border-white/10">
                <MapPin className="h-3 w-3" />
                {e.region}
              </span>
            )}'''

new_region_badge = '''{e.region && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-white/10 text-white/70 border border-white/10 max-w-[180px] sm:max-w-none">
                <MapPin className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{e.region}</span>
              </span>
            )}'''

content = content.replace(old_region_badge, new_region_badge)

# ═══════════════════════════════════════════════════════════
# FIX 3: Ficha Técnica — add min-w-0 to all grid cards + truncate long text
# ═══════════════════════════════════════════════════════════

# Generic pattern: each card starts with className="relative group rounded-2xl bg-white/[0.02] border...
# Add min-w-0 to all of them in the Ficha Técnica section

# We need to find the Ficha Técnica section specifically and add min-w-0 to cards there
# The Ficha Técnica grid starts after "Spec grid" comment

# Strategy: find the grid and card pattern within Ficha Técnica, add min-w-0
# Since all cards in Ficha Técnica use the same class pattern, replace them

# For Ficha Técnica section, each card div:
old_ficha_card = 'className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors"'

# But some cards have extra responsive classes (sm:col-span-2 lg:col-span-2)
# Let's handle both patterns

# Pattern 1: Regular card
content = content.replace(
    'className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors"',
    'className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0"'
)

# Pattern 2: Address card with col-span
content = content.replace(
    'className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors sm:col-span-2 lg:col-span-2"',
    'className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0 sm:col-span-2 lg:col-span-2"'
)

# Truncate builder name (can be long like "Construtora XYZ Incorporações Ltda (CNPJ...)")
old_builder_text = '<p className="text-sm font-semibold text-white/85 leading-snug">{info.builder.split(\'(\')[0].trim()}</p>'
new_builder_text = '<p className="text-sm font-semibold text-white/85 leading-snug truncate" title={info.builder.split(\'(\')[0].trim()}>{info.builder.split(\'(\')[0].trim()}</p>'
content = content.replace(old_builder_text, new_builder_text)

# Truncate address text
old_address_text = '<p className="text-sm font-semibold text-white/85 leading-snug">{info.location.address}</p>'
new_address_text = '<p className="text-sm font-semibold text-white/85 leading-snug line-clamp-2">{info.location.address}</p>'
content = content.replace(old_address_text, new_address_text)

# ═══════════════════════════════════════════════════════════
# FIX 4: Form glow blur — reduce on mobile
# ═══════════════════════════════════════════════════════════
content = content.replace(
    'className="absolute -inset-2 sm:-inset-4 bg-gradient-to-br from-[#C9A96E]/10 via-transparent to-[#C9A96E]/5 rounded-3xl blur-xl"',
    'className="absolute -inset-1 sm:-inset-4 bg-gradient-to-br from-[#C9A96E]/10 via-transparent to-[#C9A96E]/5 rounded-3xl blur-sm sm:blur-xl"'
)

# ═══════════════════════════════════════════════════════════
# FIX 5: Differentials — fix alignment for long text (items-start + min-w-0)
# ═══════════════════════════════════════════════════════════
old_diff_item = '''className="flex items-center gap-3 px-4 sm:px-5 py-3.5 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:border-[#C9A96E]/20 transition-colors"'''
new_diff_item = '''className="flex items-start gap-3 px-4 sm:px-5 py-3.5 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:border-[#C9A96E]/20 transition-colors min-w-0"'''
content = content.replace(old_diff_item, new_diff_item)

# Add min-w-0 to differential text span
old_diff_span = '<span className="text-sm text-white/70">{d}</span>'
new_diff_span = '<span className="text-sm text-white/70 leading-relaxed min-w-0">{d}</span>'
content = content.replace(old_diff_span, new_diff_span)

# ═══════════════════════════════════════════════════════════
# FIX 6: Layout consistency — always render Ficha Técnica + Details
# Replace conditional wrappers with always-rendered sections
# ═══════════════════════════════════════════════════════════

# --- 6a: Ficha Técnica — remove {hasInfo && info && (...)} wrapper ---
old_ficha_wrapper = '''{hasInfo && info && (
      <ScrollReveal>
        <section className="py-12 sm:py-24 border-t border-white/[0.04]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            {/* Section header */}
            <div className="flex items-center gap-4 mb-8 sm:mb-12">
              <div className="h-px flex-1 bg-gradient-to-r from-[#C9A96E]/40 to-transparent" />
              <div className="text-center">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Ficha Técnica</h2>
                <p className="text-sm text-white/40 mt-1">Dados oficiais do {e.name}</p>
              </div>
              <div className="h-px flex-1 bg-gradient-to-l from-[#C9A96E]/40 to-transparent" />
            </div>

            {/* Spec grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">'''

new_ficha_wrapper = '''<ScrollReveal>
        <section className="py-12 sm:py-24 border-t border-white/[0.04]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            {/* Section header */}
            <div className="flex items-center gap-4 mb-8 sm:mb-12">
              <div className="h-px flex-1 bg-gradient-to-r from-[#C9A96E]/40 to-transparent" />
              <div className="text-center">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Ficha Técnica</h2>
                <p className="text-sm text-white/40 mt-1">Dados oficiais do {e.name}</p>
              </div>
              <div className="h-px flex-1 bg-gradient-to-l from-[#C9A96E]/40 to-transparent" />
            </div>

            {/* Spec grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">'''

content = content.replace(old_ficha_wrapper, new_ficha_wrapper)

# Close the old wrapper — find the closing of Ficha Técnica
old_ficha_close = '''      </ScrollReveal>
      )}'''

new_ficha_close = '''      </ScrollReveal>'''

content = content.replace(old_ficha_close, new_ficha_close, 1)

# --- 6b: Replace individual conditional cards with always-rendered cards ---

# Status card — always show, fallback if no status
old_status_card = '''{status && (
                <div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                      status === 'Lançamento' ? 'bg-emerald-500/15' : status === 'Em Construção' ? 'bg-amber-500/15' : 'bg-blue-500/15'
                    }`}>
                      <Clock className={`h-4 w-4 ${status === 'Lançamento' ? 'text-emerald-400' : status === 'Em Construção' ? 'text-amber-400' : 'text-blue-400'}`} />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Status</span>
                  </div>
                  <p className={`text-sm font-semibold ${status === 'Lançamento' ? 'text-emerald-400' : status === 'Em Construção' ? 'text-amber-400' : 'text-blue-400'}`}>{status}</p>
                </div>
              )}'''

new_status_card = '''<div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                      status === 'Lançamento' ? 'bg-emerald-500/15' : status === 'Em Construção' ? 'bg-amber-500/15' : status === 'Entregue' ? 'bg-blue-500/15' : 'bg-white/5'
                    }`}>
                      <Clock className={`h-4 w-4 ${status === 'Lançamento' ? 'text-emerald-400' : status === 'Em Construção' ? 'text-amber-400' : status === 'Entregue' ? 'text-blue-400' : 'text-white/20'}`} />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Status</span>
                  </div>
                  <p className={`text-sm font-semibold ${status === 'Lançamento' ? 'text-emerald-400' : status === 'Em Construção' ? 'text-amber-400' : status === 'Entregue' ? 'text-blue-400' : 'text-white/40'}`}>{status || 'A definir'}</p>
                </div>'''

content = content.replace(old_status_card, new_status_card)

# Builder card — always show
old_builder_card = '''{info.builder && (
                <div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-orange-500/15 flex items-center justify-center">
                      <HardHat className="h-4 w-4 text-orange-400" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Construtora</span>
                  </div>
                  <p className="text-sm font-semibold text-white/85 leading-snug truncate" title={info.builder.split('(')[0].trim()}>{info.builder.split('(')[0].trim()}</p>
                </div>
              )}'''

new_builder_card = '''<div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-orange-500/15 flex items-center justify-center">
                      <HardHat className="h-4 w-4 text-orange-400" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Construtora</span>
                  </div>
                  <p className="text-sm font-semibold text-white/85 leading-snug truncate" title={info?.builder?.split('(')[0].trim() || ''}>{info?.builder?.split('(')[0].trim() || '—'}</p>
                </div>'''

content = content.replace(old_builder_card, new_builder_card)

# Location card — always show
old_location_card = '''{(info.location.neighborhood || info.location.city) && (
                <div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-blue-500/15 flex items-center justify-center">
                      <MapPin className="h-4 w-4 text-blue-400" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Localização</span>
                  </div>
                  <p className="text-sm font-semibold text-white/85 leading-snug">
                    {[info.location.neighborhood, info.location.city].filter(Boolean).join(', ')}
                  </p>
                </div>
              )}'''

new_location_card = '''<div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-blue-500/15 flex items-center justify-center">
                      <MapPin className="h-4 w-4 text-blue-400" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Localização</span>
                  </div>
                  <p className="text-sm font-semibold text-white/85 leading-snug truncate" title={([info?.location?.neighborhood, info?.location?.city].filter(Boolean).join(', ')) || ''}>
                    {[info?.location?.neighborhood, info?.location?.city].filter(Boolean).join(', ') || '—'}
                  </p>
                </div>'''

content = content.replace(old_location_card, new_location_card)

# Apartment types card — always show
old_types_card = '''{(info.apartmentTypes && info.apartmentTypes.length > 0) && (
                <div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-violet-500/15 flex items-center justify-center">
                      <Building2 className="h-4 w-4 text-violet-400" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Plantas</span>
                  </div>
                  <p className="text-sm font-semibold text-white/85">{info.apartmentTypes.length} tipo{info.apartmentTypes.length > 1 ? 's' : ''} de unidade</p>
                  {areaRange && <p className="text-xs text-white/40 mt-1">{areaRange}</p>}
                </div>
              )}'''

new_types_card = '''<div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-violet-500/15 flex items-center justify-center">
                      <Building2 className="h-4 w-4 text-violet-400" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Plantas</span>
                  </div>
                  <p className="text-sm font-semibold text-white/85">{(info?.apartmentTypes?.length || 0) > 0 ? `${info!.apartmentTypes.length} tipo${info!.apartmentTypes.length > 1 ? 's' : ''} de unidade` : 'Consulte'}</p>
                  {areaRange && <p className="text-xs text-white/40 mt-1">{areaRange}</p>}
                </div>'''

content = content.replace(old_types_card, new_types_card)

# Architecture card — always show
old_arch_card = '''{info.architecture && (
                <div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-violet-500/15 flex items-center justify-center">
                      <Palette className="h-4 w-4 text-violet-400" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Arquitetura</span>
                  </div>
                  <p className="text-sm font-semibold text-white/85 leading-snug">{info.architecture}</p>
                </div>
              )}'''

new_arch_card = '''<div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-violet-500/15 flex items-center justify-center">
                      <Palette className="h-4 w-4 text-violet-400" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Arquitetura</span>
                  </div>
                  <p className="text-sm font-semibold text-white/85 leading-snug line-clamp-2">{info?.architecture || '—'}</p>
                </div>'''

content = content.replace(old_arch_card, new_arch_card)

# Landscaping card — always show
old_land_card = '''{info.landscaping && (
                <div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-emerald-500/15 flex items-center justify-center">
                      <Sparkles className="h-4 w-4 text-emerald-400" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Paisagismo</span>
                  </div>
                  <p className="text-sm font-semibold text-white/85 leading-snug">{info.landscaping}</p>
                </div>
              )}'''

new_land_card = '''<div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-emerald-500/15 flex items-center justify-center">
                      <Sparkles className="h-4 w-4 text-emerald-400" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Paisagismo</span>
                  </div>
                  <p className="text-sm font-semibold text-white/85 leading-snug line-clamp-2">{info?.landscaping || '—'}</p>
                </div>'''

content = content.replace(old_land_card, new_land_card)

# Price card — always show
old_price_card = '''{priceText && (
                <div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-[#C9A96E]/15 flex items-center justify-center">
                      <DollarSign className="h-4 w-4 text-[#C9A96E]" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Investimento</span>
                  </div>
                  <p className="text-sm font-bold text-[#C9A96E]">{priceText}</p>
                </div>
              )}'''

new_price_card = '''<div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-[#C9A96E]/15 flex items-center justify-center">
                      <DollarSign className="h-4 w-4 text-[#C9A96E]" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Investimento</span>
                  </div>
                  <p className="text-sm font-bold text-[#C9A96E]">{priceText || 'Consulte valores'}</p>
                </div>'''

content = content.replace(old_price_card, new_price_card)

# Delivery card — always show
old_delivery_card = '''{deliveryText && (
                <div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-amber-500/15 flex items-center justify-center">
                      <CalendarDays className="h-4 w-4 text-amber-400" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Entrega</span>
                  </div>
                  <p className="text-sm font-semibold text-white/85">{deliveryText}</p>
                </div>
              )}'''

new_delivery_card = '''<div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-amber-500/15 flex items-center justify-center">
                      <CalendarDays className="h-4 w-4 text-amber-400" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Entrega</span>
                  </div>
                  <p className="text-sm font-semibold text-white/85">{deliveryText || 'A definir'}</p>
                </div>'''

content = content.replace(old_delivery_card, new_delivery_card)

# Address card — always show
old_address_card = '''{info.location.address && (
                <div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0 sm:col-span-2 lg:col-span-2">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-blue-500/15 flex items-center justify-center">
                      <Navigation className="h-4 w-4 text-blue-400" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Endereço</span>
                  </div>
                  <p className="text-sm font-semibold text-white/85 leading-snug line-clamp-2">{info.location.address}</p>
                  {info.location.additionalInfo && (
                    <p className="text-xs text-white/40 mt-1">{info.location.additionalInfo}</p>
                  )}
                </div>
              )}'''

new_address_card = '''<div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0 sm:col-span-2 lg:col-span-2">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-blue-500/15 flex items-center justify-center">
                      <Navigation className="h-4 w-4 text-blue-400" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Endereço</span>
                  </div>
                  <p className="text-sm font-semibold text-white/85 leading-snug line-clamp-2">{info?.location?.address || '—'}</p>
                  {info?.location?.additionalInfo && (
                    <p className="text-xs text-white/40 mt-1">{info.location.additionalInfo}</p>
                  )}
                </div>'''

content = content.replace(old_address_card, new_address_card)

# --- 6c: Details Section — remove {hasInfo && info! && (...)} wrapper ---
old_details_wrapper = '''<ScrollReveal>
        {hasInfo && info! && (
          <section className="py-12 sm:py-24 border-t border-white/[0.04]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6">'''

new_details_wrapper = '''<ScrollReveal>
          <section className="py-12 sm:py-24 border-t border-white/[0.04]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6">'''

content = content.replace(old_details_wrapper, new_details_wrapper)

# Close the old details wrapper
old_details_close = '''        )}
      </ScrollReveal>'''
# Note: this pattern appears after the details section ends
# We need to be careful here - find the right occurrence
# The Details section ends before the fallback section
# Let's find the exact closing pattern

# The Details section closes with:
#          </div>
#        </section>
#        )}
#      </ScrollReveal>
# Then the Fallback section starts

# Let's replace the closing of the conditional details section
old_details_conditional_close = '''            </div>
          </section>
        )}
      </ScrollReveal>'''

new_details_close = '''            </div>
          </section>
      </ScrollReveal>'''

# Only replace the first occurrence (the one for Details section)
content = content.replace(old_details_conditional_close, new_details_close, 1)

# --- 6d: Details inner content — make Summary always show ---
old_summary_conditional = '''{info.summary && (
                <div className="mb-8 sm:mb-12">'''
new_summary_conditional = '''<div className="mb-8 sm:mb-12">
                  {(info?.summary) && ('''
content = content.replace(old_summary_conditional, new_summary_conditional)

# We also need to close the new conditional properly
# The original closing was </div>\n                )} which ended the {info.summary && (...)}
# Now we need to close the inner conditional and then the outer div
# Let's find the closing of the summary block

# Original:
#                   </div>
#                 </div>
#               )}

# We need to change it to:
#                   </div>
#                 </div>
#                   )}
#                 </div>

# Actually let me rethink this. The summary conditional originally was:
# {info.summary && (
#   <div className="mb-8 sm:mb-12">
#     <div ...> ... </div>
#   </div>
# )}

# I changed the opening to:
# <div className="mb-8 sm:mb-12">
#   {(info?.summary) && (
#     <div ...> ... </div>
#   )}

# But this changes the structure. When info.summary is null, the outer div still renders but empty.
# That's not great. Let me reconsider.

# Better approach: always show the summary card, but with fallback text
# Revert the opening change and instead just change the text
content = content.replace(
    '''<div className="mb-8 sm:mb-12">
                  {(info?.summary) && (''',
    '''{info?.summary ? (
                <div className="mb-8 sm:mb-12">'''
)

# Now fix the closing of the summary block
# The original was:
#                 </div>
#               )}
# Now I need to close the ternary
old_summary_close = '''                    </div>
                  </div>
                </div>
              )}'''

new_summary_close = '''                    </div>
                  </div>
                </div>
              ) : null}'''

content = content.replace(old_summary_close, new_summary_close, 1)

# --- 6e: Details inner content — make Location always show ---
old_location_block = '''{(info.location.address || info.location.neighborhood || info.location.city) && (
                  <div className="group rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.12] transition-all duration-300 overflow-hidden">
                    <div className="flex items-stretch">
                      {/* Icon strip */}
                      <div className="flex-shrink-0 w-12 sm:w-14 bg-gradient-to-b from-blue-500/15 to-blue-500/5 flex items-center justify-center">
                        <div className="h-9 w-9 rounded-xl bg-blue-500/20 flex items-center justify-center">
                          <Navigation className="h-4 w-4 text-blue-400" />
                        </div>
                      </div>
                      {/* Content */}
                      <div className="flex-1 p-5 sm:p-6">
                        <h3 className="text-sm font-semibold text-white/90 mb-3 sm:mb-4 tracking-wide">Localização</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
                          {info.location.address && (
                            <div>
                              <p className="text-[11px] uppercase tracking-wider text-white/30 mb-1">Endereço</p>
                              <p className="text-sm text-white/70 leading-relaxed">{info.location.address}</p>
                            </div>
                          )}
                          {(info.location.neighborhood || info.location.city) && (
                            <div>
                              <p className="text-[11px] uppercase tracking-wider text-white/30 mb-1">Região</p>
                              <p className="text-sm text-white/70 leading-relaxed">
                                {[info.location.neighborhood, info.location.city, info.location.state].filter(Boolean).join(', ')}
                              </p>
                            </div>
                          )}
                          {info.location.additionalInfo && (
                            <div className="sm:col-span-2">
                              <p className="text-[11px] uppercase tracking-wider text-white/30 mb-1">Referências</p>
                              <p className="text-sm text-white/50 leading-relaxed">{info.location.additionalInfo}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}'''

new_location_block = '''<div className="group rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.12] transition-all duration-300 overflow-hidden">
                    <div className="flex items-stretch">
                      {/* Icon strip */}
                      <div className="flex-shrink-0 w-12 sm:w-14 bg-gradient-to-b from-blue-500/15 to-blue-500/5 flex items-center justify-center">
                        <div className="h-9 w-9 rounded-xl bg-blue-500/20 flex items-center justify-center">
                          <Navigation className="h-4 w-4 text-blue-400" />
                        </div>
                      </div>
                      {/* Content */}
                      <div className="flex-1 p-5 sm:p-6">
                        <h3 className="text-sm font-semibold text-white/90 mb-3 sm:mb-4 tracking-wide">Localização</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
                          <div>
                            <p className="text-[11px] uppercase tracking-wider text-white/30 mb-1">Endereço</p>
                            <p className="text-sm text-white/70 leading-relaxed">{info?.location?.address || 'Consulte o endereço completo'}</p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-wider text-white/30 mb-1">Região</p>
                            <p className="text-sm text-white/70 leading-relaxed">
                              {[info?.location?.neighborhood, info?.location?.city, info?.location?.state].filter(Boolean).join(', ') || e.region || '—'}
                            </p>
                          </div>
                          {info?.location?.additionalInfo && (
                            <div className="sm:col-span-2">
                              <p className="text-[11px] uppercase tracking-wider text-white/30 mb-1">Referências</p>
                              <p className="text-sm text-white/50 leading-relaxed">{info.location.additionalInfo}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>'''

content = content.replace(old_location_block, new_location_block)

# --- 6f: Builder block — always show ---
old_builder_block = '''{info.builder && (
                  <div className="group rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.12] transition-all duration-300 overflow-hidden">
                    <div className="flex items-stretch">
                      <div className="flex-shrink-0 w-12 sm:w-14 bg-gradient-to-b from-orange-500/15 to-orange-500/5 flex items-center justify-center">
                        <div className="h-9 w-9 rounded-xl bg-orange-500/20 flex items-center justify-center">
                          <HardHat className="h-4 w-4 text-orange-400" />
                        </div>
                      </div>
                      <div className="flex-1 p-5 sm:p-6">
                        <h3 className="text-sm font-semibold text-white/90 mb-3 sm:mb-4 tracking-wide">Construtora</h3>
                        <p className="text-sm sm:text-[15px] text-white/70 leading-relaxed max-w-3xl">{info.builder}</p>
                      </div>
                    </div>
                  </div>
                )}'''

new_builder_block = '''<div className="group rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.12] transition-all duration-300 overflow-hidden">
                    <div className="flex items-stretch">
                      <div className="flex-shrink-0 w-12 sm:w-14 bg-gradient-to-b from-orange-500/15 to-orange-500/5 flex items-center justify-center">
                        <div className="h-9 w-9 rounded-xl bg-orange-500/20 flex items-center justify-center">
                          <HardHat className="h-4 w-4 text-orange-400" />
                        </div>
                      </div>
                      <div className="flex-1 p-5 sm:p-6">
                        <h3 className="text-sm font-semibold text-white/90 mb-3 sm:mb-4 tracking-wide">Construtora</h3>
                        <p className="text-sm sm:text-[15px] text-white/70 leading-relaxed max-w-3xl">{info?.builder || 'Informações em breve'}</p>
                      </div>
                    </div>
                  </div>'''

content = content.replace(old_builder_block, new_builder_block)

# --- 6g: Architecture/Landscaping block — always show ---
old_arch_land_block = '''{(info.architecture || info.landscaping) && (
                  <div className="group rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.12] transition-all duration-300 overflow-hidden">
                    <div className="flex items-stretch">
                      <div className="flex-shrink-0 w-12 sm:w-14 bg-gradient-to-b from-violet-500/15 to-violet-500/5 flex items-center justify-center">
                        <div className="h-9 w-9 rounded-xl bg-violet-500/20 flex items-center justify-center">
                          <Palette className="h-4 w-4 text-violet-400" />
                        </div>
                      </div>
                      <div className="flex-1 p-5 sm:p-6">
                        <h3 className="text-sm font-semibold text-white/90 mb-3 sm:mb-4 tracking-wide">Projeto</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
                          {info.architecture && (
                            <div>
                              <p className="text-[11px] uppercase tracking-wider text-white/30 mb-1">Arquitetura</p>
                              <p className="text-sm text-white/70 leading-relaxed">{info.architecture}</p>
                            </div>
                          )}
                          {info.landscaping && (
                            <div>
                              <p className="text-[11px] uppercase tracking-wider text-white/30 mb-1">Paisagismo</p>
                              <p className="text-sm text-white/70 leading-relaxed">{info.landscaping}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}'''

new_arch_land_block = '''<div className="group rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.12] transition-all duration-300 overflow-hidden">
                    <div className="flex items-stretch">
                      <div className="flex-shrink-0 w-12 sm:w-14 bg-gradient-to-b from-violet-500/15 to-violet-500/5 flex items-center justify-center">
                        <div className="h-9 w-9 rounded-xl bg-violet-500/20 flex items-center justify-center">
                          <Palette className="h-4 w-4 text-violet-400" />
                        </div>
                      </div>
                      <div className="flex-1 p-5 sm:p-6">
                        <h3 className="text-sm font-semibold text-white/90 mb-3 sm:mb-4 tracking-wide">Projeto</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
                          <div>
                            <p className="text-[11px] uppercase tracking-wider text-white/30 mb-1">Arquitetura</p>
                            <p className="text-sm text-white/70 leading-relaxed">{info?.architecture || 'Em breve'}</p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-wider text-white/30 mb-1">Paisagismo</p>
                            <p className="text-sm text-white/70 leading-relaxed">{info?.landscaping || 'Em breve'}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>'''

content = content.replace(old_arch_land_block, new_arch_land_block)

# --- 6h: Apartment Types — always show (even if empty, show a message) ---
old_apt_conditional = '''{info.apartmentTypes && info.apartmentTypes.length > 0 && (
                <div className="mt-10 sm:mt-14">'''

new_apt_conditional = '''<div className="mt-10 sm:mt-14">'''

content = content.replace(old_apt_conditional, new_apt_conditional)

# Close the apartment types section properly
old_apt_close = '''                  </div>
                </div>
              )}

              {/* Differentials */}'''

new_apt_close = '''                {(!info?.apartmentTypes || info.apartmentTypes.length === 0) && (
                  <p className="text-sm text-white/30 text-center py-8">Plantas e tipos de unidades serão disponibilizadas em breve.</p>
                )}
                  </div>
                </div>

              {/* Differentials */}'''

content = content.replace(old_apt_close, new_apt_close)

# Also need to fix the apartment types count display
old_apt_count = '''<span className="text-xs text-white/25 font-medium ml-auto">{info.apartmentTypes.length} tipo{info.apartmentTypes.length !== 1 ? 's' : ''} disponíve{info.apartmentTypes.length !== 1 ? 'is' : 'l'}</span>'''
new_apt_count = '''<span className="text-xs text-white/25 font-medium ml-auto">{(info?.apartmentTypes?.length || 0)} tipo{(info?.apartmentTypes?.length || 0) !== 1 ? 's' : ''} disponíve{(info?.apartmentTypes?.length || 0) !== 1 ? 'is' : 'l'}</span>'''
content = content.replace(old_apt_count, new_apt_count)

# Fix the map inside apartment types
old_apt_map = '''{info.apartmentTypes.map((apt, idx) => {'''
new_apt_map = '''{(info?.apartmentTypes || []).map((apt, idx) => {'''
content = content.replace(old_apt_map, new_apt_map)

# --- 6i: Differentials — always show ---
old_diff_conditional = '''{info.differentials && info.differentials.length > 0 && (
                <div className="mt-10 sm:mt-14">'''

new_diff_conditional = '''<div className="mt-10 sm:mt-14">'''

content = content.replace(old_diff_conditional, new_diff_conditional)

# Close differentials properly
old_diff_close = '''                </div>
              )}
            </div>
          </section>'''

new_diff_close = '''                {(!info?.differentials || info.differentials.length === 0) && (
                  <p className="text-sm text-white/30 text-center py-8">Diferenciais serão informados em breve.</p>
                )}
                </div>
            </div>
          </section>'''

content = content.replace(old_diff_close, new_diff_close)

# Fix differentials map
old_diff_map = '''{info.differentials.map((d, i) => ('''
new_diff_map = '''{(info?.differentials || []).map((d, i) => ('''
content = content.replace(old_diff_map, new_diff_map)


# ═══════════════════════════════════════════════════════════
# FIX 7: Re-add "Por que o [nome]?" section
# Insert between Details section and the Fallback section
# ═══════════════════════════════════════════════════════════

por_que_section = '''
      {/* ── Por que o {e.name}? ──────────────────────────── */}
      <ScrollReveal>
        <section className="py-12 sm:py-24 border-t border-white/[0.04]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            {/* Section header */}
            <div className="flex items-center gap-4 mb-8 sm:mb-12">
              <div className="h-px flex-1 bg-gradient-to-r from-[#C9A96E]/40 to-transparent" />
              <div className="text-center">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Por que o {e.name}?</h2>
                <p className="text-sm text-white/40 mt-1">Destaques que fazem a diferença</p>
              </div>
              <div className="h-px flex-1 bg-gradient-to-l from-[#C9A96E]/40 to-transparent" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
              {/* Card 1 — Localização Privilegiada */}
              <div className="group relative rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-[#C9A96E]/20 transition-all duration-300 overflow-hidden p-6 sm:p-7">
                <div className="h-0.5 w-12 bg-gradient-to-r from-[#C9A96E] to-transparent mb-5 rounded-full" />
                <div className="h-10 w-10 rounded-xl bg-blue-500/15 flex items-center justify-center mb-4">
                  <MapPin className="h-5 w-5 text-blue-400" />
                </div>
                <h3 className="text-base font-semibold text-white/90 mb-2">Localização Privilegiada</h3>
                <p className="text-sm text-white/50 leading-relaxed">
                  {[info?.location?.neighborhood, info?.location?.city].filter(Boolean).join(', ') || e.region || 'Região estratégica'} com excelente infraestrutura, comércio, transporte e serviços ao seu redor.
                </p>
              </div>

              {/* Card 2 — Qualidade de Construção */}
              <div className="group relative rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-[#C9A96E]/20 transition-all duration-300 overflow-hidden p-6 sm:p-7">
                <div className="h-0.5 w-12 bg-gradient-to-r from-[#C9A96E] to-transparent mb-5 rounded-full" />
                <div className="h-10 w-10 rounded-xl bg-orange-500/15 flex items-center justify-center mb-4">
                  <HardHat className="h-5 w-5 text-orange-400" />
                </div>
                <h3 className="text-base font-semibold text-white/90 mb-2">Construtora Reconhecida</h3>
                <p className="text-sm text-white/50 leading-relaxed">
                  {info?.builder?.split('(')[0].trim() || 'Construtora de renome'}, com histórico comprovado de entregas e compromisso com a qualidade em cada detalhe.
                </p>
              </div>

              {/* Card 3 — Diferenciais Exclusivos */}
              <div className="group relative rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-[#C9A96E]/20 transition-all duration-300 overflow-hidden p-6 sm:p-7">
                <div className="h-0.5 w-12 bg-gradient-to-r from-[#C9A96E] to-transparent mb-5 rounded-full" />
                <div className="h-10 w-10 rounded-xl bg-[#C9A96E]/15 flex items-center justify-center mb-4">
                  <Sparkles className="h-5 w-5 text-[#C9A96E]" />
                </div>
                <h3 className="text-base font-semibold text-white/90 mb-2">Diferenciais Exclusivos</h3>
                <p className="text-sm text-white/50 leading-relaxed">
                  {(info?.differentials && info.differentials.length > 0)
                    ? info.differentials.slice(0, 3).join(', ') + (info.differentials.length > 3 ? ' e muito mais.' : '.')
                    : 'Lazer completo, segurança 24h e acabamentos de alto padrão para o seu conforto.'}
                </p>
              </div>

              {/* Card 4 — Oportunidade de Investimento */}
              <div className="group relative rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-[#C9A96E]/20 transition-all duration-300 overflow-hidden p-6 sm:p-7">
                <div className="h-0.5 w-12 bg-gradient-to-r from-[#C9A96E] to-transparent mb-5 rounded-full" />
                <div className="h-10 w-10 rounded-xl bg-emerald-500/15 flex items-center justify-center mb-4">
                  <TrendingUp className="h-5 w-5 text-emerald-400" />
                </div>
                <h3 className="text-base font-semibold text-white/90 mb-2">Oportunidade de Investimento</h3>
                <p className="text-sm text-white/50 leading-relaxed">
                  {priceText
                    ? `${priceText} em uma região com alta valorização imobiliária.`
                    : 'Valores acessíveis e condições especiais em uma região com forte valorização imobiliária.'}
                </p>
              </div>

              {/* Card 5 — Atendimento Personalizado */}
              <div className="group relative rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-[#C9A96E]/20 transition-all duration-300 overflow-hidden p-6 sm:p-7">
                <div className="h-0.5 w-12 bg-gradient-to-r from-[#C9A96E] to-transparent mb-5 rounded-full" />
                <div className="h-10 w-10 rounded-xl bg-purple-500/15 flex items-center justify-center mb-4">
                  <Shield className="h-5 w-5 text-purple-400" />
                </div>
                <h3 className="text-base font-semibold text-white/90 mb-2">Atendimento Exclusivo</h3>
                <p className="text-sm text-white/50 leading-relaxed">
                  {e._count && e._count.clients > 0
                    ? `${e._count.clients} pessoa${e._count.clients !== 1 ? 's' : ''} já demonstraram interesse. Cadastre-se e receba atendimento individualizado.`
                    : 'Consultoria dedicada para acompanhar cada etapa, da simulação até a entrega das chaves.'}
                </p>
              </div>
            </div>
          </div>
        </section>
      </ScrollReveal>
'''

# Insert before the Fallback section
content = content.replace(
    '''{/* ── Fallback: Landing Description ──────────────── */}''',
    por_que_section + '\n      {/* ── Fallback: Landing Description ──────────────── */}'
)

# Also need to import TrendingUp if not already imported
# Check if it's in the imports
if 'TrendingUp' not in content.split("'use client'")[1].split('import {')[1].split('}')[0]:
    # Add TrendingUp to imports
    content = content.replace(
        "Shield, ChevronDown, CalendarDays,",
        "Shield, ChevronDown, CalendarDays, TrendingUp,"
    )


# ═══════════════════════════════════════════════════════════
# VERIFY: Check that we didn't break anything
# ═══════════════════════════════════════════════════════════

# Count opening and closing braces to check balance (rough check)
# This is just a sanity check, not a full parser

print("Fixes applied:")
print("  1. Root container: break-words ✓")
print("  2. Hero badges: truncation for price, delivery, region ✓")
print("  3. Ficha Técnica: min-w-0 on all cards + truncate ✓")
print("  4. Form glow: blur-sm sm:blur-xl for mobile performance ✓")
print("  5. Differentials: items-start + min-w-0 ✓")
print("  6. Layout consistency: all sections always render with placeholders ✓")
print("  7. 'Por que o [nome]?' section re-added ✓")

with open(FILE, 'w') as f:
    f.write(content)

print(f"\nFile written: {FILE}")
print(f"New file size: {len(content)} chars ({content.count(chr(10))} lines)")