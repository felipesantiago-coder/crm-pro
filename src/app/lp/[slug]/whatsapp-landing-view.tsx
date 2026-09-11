'use client';

import { useEffect, useRef } from 'react';
import { MapPin } from 'lucide-react';

/**
 * View da landing "Clique para Entrar" — página mínima com um único
 * CTA: botão centralizado e chamativo que abre a conversa de WhatsApp
 * (via /go, que contabiliza o clique antes do redirect para wa.me).
 *
 * Tráfego é ~100% mobile (anúncios Meta): mobile-first, alvo de toque
 * generoso (>= 64px) e sem dependências além do lucide.
 */
export function WhatsAppLandingView({ slug, region }: { slug: string; region: string }) {
  const viewSent = useRef(false);

  // Métrica de visita: beacon de saída (não bloqueia navegação, falha em silêncio)
  useEffect(() => {
    if (viewSent.current) return;
    viewSent.current = true;
    const payload = JSON.stringify({ slug });
    try {
      if (typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon('/api/lp-view', new Blob([payload], { type: 'application/json' }));
        return;
      }
    } catch {
      /* cai para o fetch abaixo */
    }
    fetch('/api/lp-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  }, [slug]);

  return (
    <div className="relative min-h-dvh w-full overflow-hidden bg-[#0b0e0c]">
      {/* Glows verdes discretos no fundo escuro — profundidade sem ruído */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 0%, rgba(37,211,102,0.14) 0%, rgba(37,211,102,0) 70%), radial-gradient(50% 40% at 50% 100%, rgba(37,211,102,0.08) 0%, rgba(37,211,102,0) 70%)',
        }}
      />

      <main className="relative flex min-h-dvh flex-col items-center justify-center px-6 py-16 text-center">
        {/* Região anunciada */}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-300 sm:text-xs">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Oportunidades em {region}
        </span>

        <h1 className="mt-5 text-4xl font-bold tracking-tight text-white sm:text-5xl">
          Clique para Entrar
        </h1>

        <p className="mt-3 max-w-sm text-sm leading-relaxed text-stone-300/80 sm:text-base">
          Toque no botão abaixo e fale agora com nosso time sobre outras
          oportunidades na região <strong className="font-semibold text-stone-100">{region}</strong>.
        </p>

        {/* CTA único — centralizado, pulsante, alvo de toque 64px+ */}
        <a
          href={`/lp/${slug}/go`}
          aria-label={`Clique aqui para falar no WhatsApp sobre oportunidades em ${region}`}
          className="group relative mt-10 inline-flex"
        >
          <span
            aria-hidden
            className="absolute inset-0 rounded-2xl bg-[#25D366]/30 animate-[ping_2.2s_ease-in-out_infinite]"
          />
          <span className="relative inline-flex min-h-[64px] items-center justify-center gap-3 rounded-2xl bg-[#25D366] px-7 py-4 text-base font-bold text-white shadow-[0_10px_40px_-5px_rgba(37,211,102,0.55)] transition-all duration-200 hover:bg-[#1eb857] hover:shadow-[0_12px_48px_-5px_rgba(37,211,102,0.65)] active:scale-95 sm:px-9 sm:py-5 sm:min-h-[72px] sm:text-lg">
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
              className="h-6 w-6 shrink-0 sm:h-7 sm:w-7"
            >
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
            </svg>
            Clique aqui para falar no WhatsApp
          </span>
        </a>

        <p className="mt-6 text-[11px] leading-relaxed text-stone-400/60 sm:text-xs">
          Você será direcionado ao WhatsApp — atendimento direto, sem cadastro.
        </p>
      </main>
    </div>
  );
}
