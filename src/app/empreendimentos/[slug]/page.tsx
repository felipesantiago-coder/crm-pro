'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Building2, MapPin, ArrowLeft, ChevronLeft, ChevronRight,
  X, Navigation, HardHat, Palette, Sparkles, Ruler, BedDouble,
  CheckCircle2, Clock, DollarSign, Phone, Mail, MessageSquare,
  Loader2, ZoomIn, Copy, Check, User, Send, AlertCircle,
  Shield, ChevronDown, CalendarDays, TrendingUp,
} from 'lucide-react';

/* ================================================================
   Types
   ================================================================ */
interface EnterpriseImage {
  id: string;
  url: string;
  altText: string | null;
  sortOrder: number;
}

interface FormField {
  id: string;
  label: string;
  fieldType: string;
  placeholder: string | null;
  options: string | null;
  required: boolean;
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
  _count?: { clients: number };
  images: EnterpriseImage[];
  formFields: FormField[];
}

/* ================================================================
   Custom Component — Scroll Reveal
   ================================================================ */
function ScrollReveal({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      } ${className}`}
    >
      {children}
    </div>
  );
}

/* ================================================================
   FAQ Data
   ================================================================ */
const faqItems = [
  {
    question: 'Como funciona o atendimento personalizado?',
    answer: 'Após preencher o formulário, um consultor exclusivo entrará em contato em até 24 horas. Você receberá atendimento individualizado com informações detalhadas sobre plantas, valores, condições de pagamento e agendamento de visita presencial ao empreendimento.',
  },
  {
    question: 'Posso financiar o imóvel?',
    answer: 'Sim! Oferecemos suporte completo para financiamento bancário. Trabalhamos com os principais bancos do mercado e nossa equipe auxilia em todo o processo, desde a simulação até a aprovação do crédito, garantindo as melhores condições para você.',
  },
  {
    question: 'Quais documentos preciso para visitar o empreendimento?',
    answer: 'Para agendar uma visita, basta preencher o formulário com seus dados. Para a visita presencial, recomendamos levar um documento de identificação com foto. Nosso consultor entrará em contato para confirmar o melhor horário e ponto de encontro.',
  },
  {
    question: 'O atendimento é exclusivo para este empreendimento?',
    answer: 'Sim, você terá um consultor dedicado que conhece todos os detalhes deste empreendimento. Nossa equipe é especializada e preparada para tirar todas as suas dúvidas sobre o projeto, localização, lazer, plantas e condições comerciais.',
  },
  {
    question: 'Posso agendar uma visita presencial?',
    answer: 'Com certeza! Após o cadastro, nosso consultor entrará em contato para agendar a visita no melhor horário para você. Oferecemos visitas presenciais guiadas ao canteiro de obras ou ao empreendimento já entregue, dependendo do status do projeto.',
  },
];

/* ================================================================
   Page
   ================================================================ */
export default function LandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = React.use(params);
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeImgIdx, setActiveImgIdx] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [queueUser, setQueueUser] = useState<{ userId: string; userName: string; userPhone: string | null } | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});

  // NEW: Floating WhatsApp bar visibility (mobile)
  const [showFloatingWhatsApp, setShowFloatingWhatsApp] = useState(false);

  // NEW: FAQ accordion state
  const [faqOpenIndex, setFaqOpenIndex] = useState<number | null>(null);

  // Tracking: form field focus timestamps
  const fieldFocusTime = useRef<Record<string, number>>({});

  // Tracking: section visibility (IntersectionObserver)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.CRMPIXEL) return;
    const sectionNames: Record<string, string> = {
      'galeria': 'galeria',
      'ficha técnica': 'ficha-tecnica',
      'detalhes do empreendimento': 'detalhes',
      'por que o': 'por-que',
      'cadastre-se': 'cadastro',
      'perguntas frequentes': 'faq',
    };
    const headings = document.querySelectorAll('h2');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const text = (entry.target.textContent || '').toLowerCase();
          for (const [key, name] of Object.entries(sectionNames)) {
            if (text.includes(key)) {
              window.CRMPIXEL.trackSectionView(name);
              break;
            }
          }
        }
      });
    }, { threshold: 0.2 });
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, []);

  // Tracking: exit intent (desktop only)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.CRMPIXEL) return;
    const handler = (e: MouseEvent) => {
      if ((e.clientY <= 0 || e.clientX <= 0 || e.clientX >= window.innerWidth) && e.relatedTarget === null) {
        window.CRMPIXEL.trackExitIntent();
      }
    };
    document.addEventListener('mouseleave', handler);
    return () => document.removeEventListener('mouseleave', handler);
  }, []);

  const fetchEnterprise = useCallback(async () => {
    if (!slug) return;
    try {
      const res = await fetch(`/api/enterprises/public/${slug}`);
      if (res.ok) {
        const data = await res.json();
        setEnterprise(data);
        document.title = `${data.landingTitle || data.name} | Empreendimentos`;
      } else {
        setError('Empreendimento não encontrado.');
      }
    } catch {
      setError('Erro de conexão.');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { fetchEnterprise(); }, [fetchEnterprise]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Fetch queue user for dynamic WhatsApp
  useEffect(() => {
    if (!slug) return;
    fetch(`/api/lead-queues/next-user?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.hasQueue && data.userPhone) {
          setQueueUser({ userId: data.userId, userName: data.userName, userPhone: data.userPhone });
        }
      })
      .catch(() => { /* silent — fallback to generic WhatsApp */ });
  }, [slug]);

  // Lightbox keyboard navigation & scroll lock (hook must be before conditional returns)
  useEffect(() => {
    if (!lightboxOpen || !enterprise) return;
    const imgs = enterprise.images.length > 0 ? enterprise.images : [];
    const len = Math.max(imgs.length, 1);
    const h = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setLightboxOpen(false);
      if (ev.key === 'ArrowRight') setActiveImgIdx((p) => (p + 1) % len);
      if (ev.key === 'ArrowLeft') setActiveImgIdx((p) => (p - 1 + len) % len);
    };
    window.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', h);
      document.body.style.overflow = '';
    };
  }, [lightboxOpen, enterprise]);

  // NEW: Floating WhatsApp bar — show after scrolling past hero
  useEffect(() => {
    const onScroll = () => {
      setShowFloatingWhatsApp(window.scrollY > window.innerHeight * 0.4);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const whatsappNumber = queueUser?.userPhone
    ? queueUser.userPhone.replace(/\D/g, '')
    : null;
  const whatsappUrl = whatsappNumber
    ? `https://wa.me/${whatsappNumber.startsWith('55') ? whatsappNumber : '55' + whatsappNumber}?text=${encodeURIComponent(`Olá! Tenho interesse no empreendimento ${enterprise?.name || ''}.`)}`
    : `https://wa.me/?text=${encodeURIComponent(`Olá! Tenho interesse no empreendimento ${enterprise?.name || ''}.`)}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch { /* silent */ }
  };

  /* ── Form handler ─────────────────────────────────────── */
  const handleFormSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setFormError('');

    if (!formName.trim() || formName.trim().length < 2) {
      setFormError('Informe seu nome completo.');
      return;
    }
    const cleanPhone = formPhone.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      setFormError('Informe um telefone válido com DDD.');
      return;
    }
    const cleanEmail = formEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setFormError('Informe um e-mail válido.');
      return;
    }

    // Validate required custom fields
    if (enterprise?.formFields) {
      for (const field of enterprise.formFields) {
        if (field.required && field.fieldType !== 'checkbox') {
          const val = customAnswers[field.id];
          if (!val || val.trim() === '') {
            setFormError(`O campo "${field.label}" é obrigatório.`);
            return;
          }
        }
      }
    }

    setFormSubmitting(true);
    try {
      // Build clean custom answers (label -> value)
      const answersData: Record<string, string> = {};
      if (enterprise?.formFields) {
        for (const field of enterprise.formFields) {
          const val = customAnswers[field.id];
          if (val !== undefined && val !== null && String(val).trim() !== '') {
            answersData[field.label] = String(val).trim();
          }
        }
      }

      const res = await fetch('/api/enterprises/public-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName.trim(),
          phone: cleanPhone,
          email: cleanEmail,
          slug: slug || undefined,
          customAnswers: Object.keys(answersData).length > 0 ? answersData : undefined,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        // Track pixel event + identify visitor with new lead
        if (typeof window !== 'undefined' && window.CRMPIXEL) {
          window.CRMPIXEL.track('form_submit', { enterprise: enterprise?.name });
          if (data.clientId) {
            window.CRMPIXEL.identify(data.clientId);
          }
        }

        // Redirect to success page
        const params = new URLSearchParams();
        params.set('empreendimento', enterprise?.name || '');
        params.set('nome', formName.trim());
        if (data.assignedUser?.userName) params.set('atendente', data.assignedUser.userName);
        if (data.assignedUser?.userPhone) params.set('telefone', data.assignedUser.userPhone);

        window.location.href = `/empreendimentos/${slug}/cadastro-sucesso?${params.toString()}`;
      } else {
        setFormError(data.error || 'Erro ao enviar. Tente novamente.');
      }
    } catch {
      setFormError('Erro de conexão. Verifique sua internet e tente novamente.');
    } finally {
      setFormSubmitting(false);
    }
  };

  /* ─── Phone mask ──────────────────────────────────────── */
  const handlePhoneChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    let masked = '';
    if (digits.length > 0) masked += `(${digits.slice(0, 2)}`;
    if (digits.length > 2) masked += `) ${digits.slice(2, 7)}`;
    if (digits.length > 7) masked += `-${digits.slice(7)}`;
    setFormPhone(masked);
  };

  /* ─── Loading ─────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-[#C9A96E] animate-spin" />
      </div>
    );
  }

  /* ─── Error ───────────────────────────────────────────── */
  if (error || !enterprise) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <Building2 className="h-16 w-16 text-white/10 mx-auto mb-6" />
          <h1 className="text-2xl font-bold text-white mb-2">Não encontrado</h1>
          <p className="text-white/40 mb-8">{error || 'Este empreendimento não existe ou foi removido.'}</p>
          <a
            href="/empreendimentos"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#C9A96E] text-[#0A0A0A] font-semibold text-sm hover:bg-[#D4B87E] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Ver todos os empreendimentos
          </a>
        </div>
      </div>
    );
  }

  /* ─── Derived ─────────────────────────────────────────── */
  const e = enterprise;
  const images = e.images.length > 0 ? e.images : [];
  const heroImage = e.imageUrl || images[0]?.url || null;
  const info = e.cachedInfo;

  const hasInfo = info && (
    info.location?.address || info.location?.neighborhood || info.location?.city ||
    info.builder || info.architecture || info.landscaping ||
    (info.differentials && info.differentials.length > 0) ||
    (info.apartmentTypes && info.apartmentTypes.length > 0) || info.summary
  );

  const allText = [info?.summary, ...(info?.differentials || [])].filter(Boolean).join(' ');
  let status: string | null = null;
  if (/entregue|pronto para morar|habite-se/i.test(allText)) status = 'Entregue';
  else if (/em construção|construção/i.test(allText)) status = 'Em Construção';
  else if (/lançamento|pré-lançamento/i.test(allText)) status = 'Lançamento';

  const priceMatch = info?.summary?.match(/a partir de\s*R\$\s*[\d.]+/i) ||
    info?.apartmentTypes?.[0]?.description?.match(/a partir de\s*R\$\s*[\d.]+/i);
  const deliveryMatch = allText.match(/entrega.*?(\d{1,2}\/[\d]{4}|outubro \d{4}|dezembro \d{4})/i);

  const goNext = () => setActiveImgIdx((p) => (p + 1) % Math.max(images.length, 1));
  const goPrev = () => setActiveImgIdx((p) => (p - 1 + images.length) % Math.max(images.length, 1));

  const displayTitle = e.landingTitle || e.name;
  const displaySubtitle = e.landingSubtitle || info?.summary?.slice(0, 120) || null;

  // NEW: Determine if urgency badge should show
  const showUrgencyBadge = status === 'Lançamento' || status === 'Em Construção';

  /* ─── Derived data for Ficha Técnica ────────────────── */
  const areas = (info?.apartmentTypes || [])
    .map(a => a.area ? parseFloat(a.area.replace(/\D/g, '')) : 0)
    .filter(a => a > 0);
  const maxArea = areas.length > 0 ? Math.max(...areas) : 0;
  const minArea = areas.length > 0 ? Math.min(...areas) : 0;
  const areaRange = maxArea > 0
    ? (minArea === maxArea ? `${maxArea}m²` : `${minArea} a ${maxArea}m²`)
    : null;
  const priceText = priceMatch ? priceMatch[0] : null;
  const deliveryText = deliveryMatch ? deliveryMatch[1] : (status === 'Entregue' ? 'Já entregue' : null);

  /* ================================================================
     Render
     ================================================================ */
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white overflow-x-hidden [word-break:break-word]">

      {/* ── Custom Keyframes ────────────────────────────── */}
      <style>{`
        @keyframes pulse-urgency {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        .animate-pulse-urgency { animation: pulse-urgency 2s ease-in-out infinite; }

        @keyframes slide-up-bar {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .animate-slide-up-bar { animation: slide-up-bar 0.4s ease-out forwards; }

        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in-up { animation: fade-in-up 0.6s ease-out forwards; }
      `}</style>

      {/* ── Navigation ─────────────────────────────────── */}
      <nav
        className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 ${
          scrolled
            ? 'bg-[#0A0A0A]/90 backdrop-blur-xl border-b border-white/[0.06] shadow-2xl'
            : 'bg-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 sm:h-20 flex items-center justify-between">
          <a href="/empreendimentos" className="flex items-center gap-3 group">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-[#C9A96E] to-[#8B6914] flex items-center justify-center shadow-lg shadow-[#C9A96E]/20 group-hover:shadow-[#C9A96E]/40 transition-shadow">
              <Building2 className="h-4 w-4 text-white" />
            </div>
            <span className="text-base font-bold tracking-tight hidden sm:block">Empreendimentos</span>
          </a>

          <div className="flex items-center gap-3">
            <button
              onClick={handleCopyLink}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-white/60 hover:text-white hover:bg-white/5 transition-colors"
            >
              {copiedLink ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              <span className="hidden sm:inline">{copiedLink ? 'Copiado!' : 'Compartilhar'}</span>
            </button>
            <a
              href="#cadastro"
              className="px-5 py-2.5 rounded-xl bg-[#C9A96E] text-[#0A0A0A] text-sm font-semibold hover:bg-[#D4B87E] transition-colors shadow-lg shadow-[#C9A96E]/20"
            >
              Cadastre-se
            </a>
          </div>
        </div>
      </nav>

      {/* ── Hero Section ───────────────────────────────── */}
      <section className="relative min-h-[75dvh] sm:min-h-[100dvh] flex items-end">
        {/* Background image */}
        {heroImage && (
          <div className="absolute inset-0">
            <img
              src={heroImage}
              alt={e.name}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A]/50 to-[#0A0A0A]/20" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#0A0A0A]/30 to-transparent" />
          </div>
        )}

        {/* Decorative gold line */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-32 bg-gradient-to-b from-[#C9A96E]/40 to-transparent" />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 pb-10 sm:pb-24 pt-24 sm:pt-32 w-full">
          {/* Breadcrumb */}
          <a
            href="/empreendimentos"
            className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-[#C9A96E] transition-colors mb-4 sm:mb-6 group"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
            Empreendimentos
          </a>

          {/* Status + Region badges */}
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-3 sm:mb-4">
            {status && (
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border backdrop-blur-sm ${
                status === 'Entregue' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
                status === 'Em Construção' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' :
                'bg-blue-500/20 text-blue-300 border-blue-500/30'
              }`}>
                <CheckCircle2 className="h-3 w-3" />
                {status}
              </span>
            )}
            {priceMatch && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 max-w-[200px] sm:max-w-none">
                <DollarSign className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{priceMatch[0]}</span>
              </span>
            )}
            {status === 'Entregue' && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
                <span>Já entregue</span>
              </span>
            )}
            {deliveryMatch && status !== 'Entregue' && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/25 max-w-[200px] sm:max-w-none">
                <Clock className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">Previsão: {deliveryMatch[1]}</span>
              </span>
            )}
            {e.region && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-white/10 text-white/70 border border-white/10 max-w-[180px] sm:max-w-none">
                <MapPin className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{e.region}</span>
              </span>
            )}
            {/* ★ NEW: Urgency Badge — only for Lançamento or Em Construção */}
            {showUrgencyBadge && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/30 animate-pulse-urgency">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-400" />
                </span>
                Vagas limitadas
              </span>
            )}
          </div>

          {/* Title */}
          <h1 className="text-3xl sm:text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1] max-w-4xl">
            {displayTitle}
          </h1>

          {/* Subtitle */}
          {displaySubtitle && (
            <p className="mt-3 sm:mt-6 text-base sm:text-xl text-white/60 max-w-2xl leading-relaxed">
              {displaySubtitle}
            </p>
          )}

          {/* CTA row */}
          <div className="mt-6 sm:mt-10 flex flex-wrap items-center gap-3 sm:gap-4">
            <a
              href="#cadastro"
              className="animate-fade-in-up inline-flex items-center gap-2.5 px-7 py-3.5 sm:px-9 sm:py-4 rounded-xl bg-[#C9A96E] text-[#0A0A0A] font-semibold text-sm sm:text-base hover:bg-[#D4B87E] transition-colors shadow-lg shadow-[#C9A96E]/25"
            >
              <MessageSquare className="h-4 w-4" />
              Quero saber mais
            </a>
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                if (typeof window !== 'undefined' && window.CRMPIXEL) {
                  window.CRMPIXEL.track('whatsapp_click', { enterprise: e.name, source: 'hero', userId: queueUser?.userId });
                }
              }}
              className="animate-fade-in-up inline-flex items-center gap-2.5 px-7 py-3.5 sm:px-9 sm:py-4 rounded-xl bg-white/[0.06] border border-white/[0.10] text-white font-semibold text-sm sm:text-base hover:bg-white/[0.10] hover:border-white/[0.18] transition-all backdrop-blur-sm"
              style={{ animationDelay: '0.1s' }}
            >
              <Phone className="h-4 w-4" />
              WhatsApp
            </a>
            {e._count && e._count.clients > 0 && (
              <div className="animate-fade-in-up flex items-center gap-2 text-xs text-white/30" style={{ animationDelay: '0.2s' }}>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#C9A96E] opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#C9A96E]" />
                </span>
                {e._count.clients} pessoa{e._count.clients !== 1 ? 's' : ''} interessada{e._count.clients !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 animate-bounce hidden sm:flex">
          <span className="text-[10px] text-white/30 uppercase tracking-widest">Scroll</span>
          <div className="w-px h-8 bg-gradient-to-b from-white/30 to-transparent" />
        </div>
      </section>

      {/* ── Gallery Section ────────────────────────────── */}
      <ScrollReveal>
        {images.length > 0 && (
          <section id="galeria" className="py-12 sm:py-24 border-t border-white/[0.04]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6">
              {/* Section header */}
              <div className="flex items-center gap-4 mb-8 sm:mb-12">
                <div className="h-px flex-1 bg-gradient-to-r from-[#C9A96E]/40 to-transparent" />
                <div className="text-center">
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Galeria</h2>
                  <p className="text-sm text-white/40 mt-1">{images.length} foto{images.length !== 1 ? 's' : ''} do empreendimento</p>
                </div>
                {images.length > 1 ? (
                  <div className="flex items-center gap-2">
                    <button onClick={goPrev} className="h-11 w-11 rounded-full border border-white/10 flex items-center justify-center hover:border-[#C9A96E]/50 hover:bg-[#C9A96E]/10 transition-all">
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button onClick={goNext} className="h-11 w-11 rounded-full border border-white/10 flex items-center justify-center hover:border-[#C9A96E]/50 hover:bg-[#C9A96E]/10 transition-all">
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </div>
                ) : (
                  <div className="h-px flex-1 bg-gradient-to-l from-[#C9A96E]/40 to-transparent" />
                )}
              </div>

              {/* Main image */}
              <div
                className="relative aspect-[4/3] sm:aspect-[16/10] lg:aspect-[16/9] rounded-2xl overflow-hidden bg-white/5 cursor-pointer group"
                onClick={() => {
                  if (typeof window !== 'undefined' && window.CRMPIXEL) window.CRMPIXEL.trackGalleryClick(activeImgIdx, images.length);
                  setLightboxOpen(true);
                }}
              >
                <img
                  src={images[activeImgIdx]?.url || heroImage || ''}
                  alt={images[activeImgIdx]?.altText || e.name}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="bg-black/50 backdrop-blur-sm rounded-full p-4">
                    <ZoomIn className="h-6 w-6 text-white" />
                  </div>
                </div>
                {images.length > 1 && (
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/50 backdrop-blur-sm text-white text-xs px-4 py-2 rounded-full">
                    {activeImgIdx + 1} / {images.length}
                  </div>
                )}
              </div>

              {/* Thumbnails */}
              {images.length > 1 && (
                <div className="flex gap-3 mt-4 overflow-x-auto pb-2">
                  {images.map((img, idx) => (
                    <button
                      key={img.id}
                      onClick={() => {
                        if (typeof window !== 'undefined' && window.CRMPIXEL) window.CRMPIXEL.trackGalleryClick(idx, images.length);
                        setActiveImgIdx(idx);
                      }}
                      className={`flex-shrink-0 w-20 h-14 sm:w-28 sm:h-20 rounded-xl overflow-hidden border-2 transition-all ${
                        idx === activeImgIdx
                          ? 'border-[#C9A96E] ring-2 ring-[#C9A96E]/20'
                          : 'border-transparent opacity-50 hover:opacity-80'
                      }`}
                    >
                      <img src={img.url} alt={img.altText || ''} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
      </ScrollReveal>

      {/* ── Ficha Técnica do Empreendimento ─────────────── */}
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
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {/* Status */}
              <div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                      status === 'Lançamento' ? 'bg-emerald-500/15' : status === 'Em Construção' ? 'bg-amber-500/15' : status === 'Entregue' ? 'bg-blue-500/15' : 'bg-white/5'
                    }`}>
                      <Clock className={`h-4 w-4 ${status === 'Lançamento' ? 'text-emerald-400' : status === 'Em Construção' ? 'text-amber-400' : status === 'Entregue' ? 'text-blue-400' : 'text-white/20'}`} />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Status</span>
                  </div>
                  <p className={`text-sm font-semibold ${status === 'Lançamento' ? 'text-emerald-400' : status === 'Em Construção' ? 'text-amber-400' : status === 'Entregue' ? 'text-blue-400' : 'text-white/40'}`}>{status || 'A definir'}</p>
                </div>

              {/* Construtora */}
              <div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-orange-500/15 flex items-center justify-center">
                      <HardHat className="h-4 w-4 text-orange-400" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Construtora</span>
                  </div>
                  <p className="text-sm font-semibold text-white/85 leading-snug truncate" title={info?.builder?.split('(')[0].trim() || ''}>{info?.builder?.split('(')[0].trim() || '—'}</p>
                </div>

              {/* Localização */}
              <div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-blue-500/15 flex items-center justify-center">
                      <MapPin className="h-4 w-4 text-blue-400" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Localização</span>
                  </div>
                  <p className="text-sm font-semibold text-white/85 leading-snug truncate" title={([info?.location?.neighborhood, info?.location?.city].filter(Boolean).join(', ')) || ''}>
                    {[info?.location?.neighborhood, info?.location?.city].filter(Boolean).join(', ') || '—'}
                  </p>
                </div>

              {/* Tipos de Unidade */}
              <div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-violet-500/15 flex items-center justify-center">
                      <Building2 className="h-4 w-4 text-violet-400" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Plantas</span>
                  </div>
                  <p className="text-sm font-semibold text-white/85">{(info?.apartmentTypes?.length || 0) > 0 ? `${info!.apartmentTypes.length} tipo${info!.apartmentTypes.length > 1 ? 's' : ''} de unidade` : 'Consulte'}</p>
                  {areaRange && <p className="text-xs text-white/40 mt-1">{areaRange}</p>}
                </div>

              {/* Arquitetura */}
              <div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-violet-500/15 flex items-center justify-center">
                      <Palette className="h-4 w-4 text-violet-400" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Arquitetura</span>
                  </div>
                  <p className="text-sm font-semibold text-white/85 leading-snug line-clamp-2">{info?.architecture || '—'}</p>
                </div>

              {/* Paisagismo */}
              <div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-emerald-500/15 flex items-center justify-center">
                      <Sparkles className="h-4 w-4 text-emerald-400" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Paisagismo</span>
                  </div>
                  <p className="text-sm font-semibold text-white/85 leading-snug line-clamp-2">{info?.landscaping || '—'}</p>
                </div>

              {/* Preço */}
              <div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-[#C9A96E]/15 flex items-center justify-center">
                      <DollarSign className="h-4 w-4 text-[#C9A96E]" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Investimento</span>
                  </div>
                  <p className="text-sm font-bold text-[#C9A96E]">{priceText || 'Consulte valores'}</p>
                </div>

              {/* Previsão de Entrega */}
              <div className={`relative group rounded-2xl border p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0 ${status === 'Entregue' ? 'bg-emerald-500/[0.06] border-emerald-500/20' : 'bg-white/[0.02] border-white/[0.06]'}`}>
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${status === 'Entregue' ? 'bg-emerald-500/20' : 'bg-amber-500/15'}`}>
                      {status === 'Entregue'
                        ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        : <CalendarDays className="h-4 w-4 text-amber-400" />
                      }
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-white/30 font-medium">Entrega</span>
                  </div>
                  <p className={`text-sm font-semibold ${status === 'Entregue' ? 'text-emerald-400' : 'text-white/85'}`}>{deliveryText || 'A definir'}</p>
                </div>

              {/* Endereço */}
              <div className="relative group rounded-2xl bg-white/[0.02] border border-white/[0.06] p-5 hover:border-[#C9A96E]/20 transition-colors min-w-0 sm:col-span-2 lg:col-span-2">
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
                </div>
            </div>
          </div>
        </section>
      </ScrollReveal>

      {/* ── Details Section ────────────────────────────── */}
      <ScrollReveal>
          <section className="py-12 sm:py-24 border-t border-white/[0.04]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6">
              {/* Section header */}
              <div className="flex items-center gap-4 mb-8 sm:mb-12">
                <div className="h-px flex-1 bg-gradient-to-r from-[#C9A96E]/40 to-transparent" />
                <div className="text-center">
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Detalhes do Empreendimento</h2>
                </div>
                <div className="h-px flex-1 bg-gradient-to-l from-[#C9A96E]/40 to-transparent" />
              </div>

              {/* Summary — Sobre o Empreendimento */}
              {info?.summary ? (
                <div className="mb-8 sm:mb-12">
                  <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#C9A96E]/[0.08] via-[#C9A96E]/[0.03] to-transparent border border-[#C9A96E]/15 p-6 sm:p-8 lg:p-10">
                    <div className="absolute top-0 right-0 w-48 h-48 bg-[#C9A96E]/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
                    <div className="relative">
                      <div className="flex items-center gap-2.5 mb-4">
                        <div className="h-1.5 w-8 rounded-full bg-[#C9A96E]" />
                        <span className="text-xs font-semibold text-[#C9A96E] uppercase tracking-widest">Sobre o empreendimento</span>
                      </div>
                      <p className="text-sm sm:text-[15px] text-white/75 leading-[1.8] max-w-4xl">{info.summary}</p>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Info blocks — stacked, full-width, each with clear visual identity */}
              <div className="space-y-4 sm:space-y-5">

                {/* Location */}
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
                  </div>

                {/* Builder */}
                <div className="group rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.12] transition-all duration-300 overflow-hidden">
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
                  </div>

                {/* Architecture / Landscaping */}
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
                  </div>

              </div>

              {/* Apartment Types */}
              <div className="mt-10 sm:mt-14">
                  <div className="flex items-center gap-3 mb-6 sm:mb-8">
                    <div className="h-9 w-9 rounded-xl bg-emerald-500/15 flex items-center justify-center">
                      <Building2 className="h-4 w-4 text-emerald-400" />
                    </div>
                    <h3 className="text-lg sm:text-xl font-semibold">Tipos de Unidades</h3>
                    <span className="text-xs text-white/25 font-medium ml-auto">{(info?.apartmentTypes?.length || 0)} tipo{(info?.apartmentTypes?.length || 0) !== 1 ? 's' : ''} disponíve{(info?.apartmentTypes?.length || 0) !== 1 ? 'is' : 'l'}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {(info?.apartmentTypes || []).map((apt, idx) => {
                      const priceInDesc = apt.description?.match(/R\$[\d.,]+/);
                      return (
                        <div
                          key={idx}
                          className="group rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-emerald-500/20 hover:bg-white/[0.03] transition-all duration-300 overflow-hidden"
                        >
                          {/* Top accent bar */}
                          <div className="h-0.5 bg-gradient-to-r from-emerald-500/40 to-transparent" />
                          <div className="p-5 sm:p-6">
                            <div className="flex items-start justify-between gap-3 mb-4">
                              <h4 className="text-sm font-semibold text-white/90 leading-tight">{apt.name}</h4>
                              {priceInDesc && (
                                <span className="text-xs font-bold text-[#C9A96E] whitespace-nowrap flex-shrink-0 bg-[#C9A96E]/10 px-2.5 py-1 rounded-lg">
                                  {priceInDesc[0]}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-5 text-xs text-white/50 mb-2">
                              {apt.area && (
                                <span className="flex items-center gap-1.5">
                                  <Ruler className="h-3.5 w-3.5 text-white/30" />{apt.area}
                                </span>
                              )}
                              {apt.bedrooms && (
                                <span className="flex items-center gap-1.5">
                                  <BedDouble className="h-3.5 w-3.5 text-white/30" />{apt.bedrooms}
                                </span>
                              )}
                            </div>
                            {apt.description && (
                              <p className="text-xs text-white/40 mt-3 leading-relaxed">{apt.description}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {(!info?.apartmentTypes || info.apartmentTypes.length === 0) && (
                    <p className="text-sm text-white/30 text-center py-8">Plantas e tipos de unidades serão disponibilizadas em breve.</p>
                  )}
                </div>

              {/* Differentials */}
              <div className="mt-10 sm:mt-14">
                  <div className="flex items-center gap-3 mb-6 sm:mb-8">
                    <div className="h-9 w-9 rounded-xl bg-[#C9A96E]/15 flex items-center justify-center">
                      <Sparkles className="h-4 w-4 text-[#C9A96E]" />
                    </div>
                    <h3 className="text-lg sm:text-xl font-semibold">Diferenciais</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {(info?.differentials || []).map((d, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-3 px-4 sm:px-5 py-3.5 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:border-[#C9A96E]/20 transition-colors min-w-0"
                      >
                        <CheckCircle2 className="h-4 w-4 text-[#C9A96E] flex-shrink-0" />
                        <span className="text-sm text-white/70 leading-relaxed min-w-0">{d}</span>
                      </div>
                    ))}
                  </div>
                {(!info?.differentials || info.differentials.length === 0) && (
                  <p className="text-sm text-white/30 text-center py-8">Diferenciais serão informados em breve.</p>
                )}
                </div>
            </div>
          </section>
      </ScrollReveal>

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

      {/* ── Fallback: Landing Description ──────────────── */}
      {!hasInfo && e.landingDescription && (
        <section className="py-12 sm:py-24 border-t border-white/[0.04]">
          <div className="max-w-3xl mx-auto px-4 sm:px-6">
            {e.landingTitle && (
              <h2 className="text-2xl sm:text-3xl font-bold mb-4">{e.landingTitle}</h2>
            )}
            {e.landingSubtitle && (
              <p className="text-lg text-[#C9A96E] mb-6">{e.landingSubtitle}</p>
            )}
            <p className="text-base text-white/60 leading-relaxed whitespace-pre-wrap">
              {e.landingDescription}
            </p>
          </div>
        </section>
      )}

      {/* ── Registration Form Section ───────────────────── */}
      <ScrollReveal>
        <section id="cadastro" className="py-12 sm:py-24 border-t border-white/[0.04]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            {/* Section header */}
            <div className="flex items-center gap-4 mb-8 sm:mb-12">
              <div className="h-px flex-1 bg-gradient-to-r from-[#C9A96E]/40 to-transparent" />
              <div className="text-center">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Cadastre-se</h2>
                <p className="text-sm text-white/40 mt-1">Receba atendimento personalizado sobre o {e.name}</p>
              </div>
              <div className="h-px flex-1 bg-gradient-to-l from-[#C9A96E]/40 to-transparent" />
            </div>

            <div className="grid lg:grid-cols-2 gap-8 lg:gap-16 items-start">
              {/* Left side — CTA text */}
              <div className="order-2 lg:order-1">
                <div className="h-10 w-10 sm:h-14 sm:w-14 rounded-2xl bg-[#C9A96E]/20 flex items-center justify-center mb-4 sm:mb-6">
                  <MessageSquare className="h-5 w-5 sm:h-7 sm:w-7 text-[#C9A96E]" />
                </div>
                <h2 className="text-2xl sm:text-4xl font-bold mb-3 sm:mb-4">
                  Interessado em <span className="text-[#C9A96E]">{e.name}</span>?
                </h2>
                <p className="text-white/50 max-w-lg text-sm sm:text-base leading-relaxed mb-6 sm:mb-8">
                  Preencha o formulário ao lado e receba atendimento personalizado sobre este empreendimento. Nossa equipe entrará em contato com você em breve para agendar uma visita ou tirar todas as suas dúvidas.
                </p>

                {/* Quick WhatsApp */}
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    if (typeof window !== 'undefined' && window.CRMPIXEL) {
                      window.CRMPIXEL.track('whatsapp_click', { enterprise: e.name, source: 'form_section', userId: queueUser?.userId });
                    }
                  }}
                  className="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-[#25D366] text-white font-semibold text-sm hover:bg-[#20bd5a] transition-colors shadow-lg shadow-[#25D366]/15"
                >
                  <Phone className="h-4 w-4" />
                  Prefere o WhatsApp? Fale agora
                </a>
              </div>

              {/* Right side — Form */}
              <div className="relative order-1 lg:order-2">
                <div className="absolute -inset-1 sm:-inset-4 bg-gradient-to-br from-[#C9A96E]/10 via-transparent to-[#C9A96E]/5 rounded-3xl blur-sm sm:blur-xl" />
                <form
                  onSubmit={handleFormSubmit}
                  className="relative z-10 rounded-2xl bg-white/[0.03] border border-white/[0.08] p-5 sm:p-8 lg:p-10 space-y-4 sm:space-y-5"
                >
                  <div className="mb-2">
                    <h3 className="text-xl font-bold">Cadastro</h3>
                    <p className="text-sm text-white/40 mt-1">Preencha seus dados para receber atendimento</p>
                  </div>

                  {/* Error */}
                  {formError && (
                    <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                      <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-red-300">{formError}</p>
                    </div>
                  )}

                  {/* Name */}
                  <div>
                    <label htmlFor="form-name" className="block text-sm font-medium text-white/70 mb-2">
                      Nome Completo <span className="text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                      <input
                        id="form-name"
                        type="text"
                        value={formName}
                        onChange={(ev) => { setFormName(ev.target.value); if (typeof window !== 'undefined' && window.CRMPIXEL) window.CRMPIXEL._setFormFieldsFilled([ev.target.value, formPhone, formEmail].filter(Boolean).length); }}
                        onFocus={() => { fieldFocusTime.current.name = Date.now(); if (typeof window !== 'undefined' && window.CRMPIXEL) window.CRMPIXEL.trackFormFocus('name'); }}
                        onBlur={() => { const t = fieldFocusTime.current.name || Date.now(); if (typeof window !== 'undefined' && window.CRMPIXEL) window.CRMPIXEL.trackFormBlur('name', Date.now() - t); }}
                        placeholder="Seu nome completo"
                        required
                        className="w-full pl-11 pr-4 py-3.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#C9A96E]/50 focus:ring-1 focus:ring-[#C9A96E]/20 transition-all"
                      />
                    </div>
                  </div>

                  {/* Phone */}
                  <div>
                    <label htmlFor="form-phone" className="block text-sm font-medium text-white/70 mb-2">
                      Telefone <span className="text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                      <input
                        id="form-phone"
                        type="tel"
                        value={formPhone}
                        onChange={(ev) => { handlePhoneChange(ev.target.value); if (typeof window !== 'undefined' && window.CRMPIXEL) window.CRMPIXEL._setFormFieldsFilled([formName, ev.target.value, formEmail].filter(Boolean).length); }}
                        onFocus={() => { fieldFocusTime.current.phone = Date.now(); if (typeof window !== 'undefined' && window.CRMPIXEL) window.CRMPIXEL.trackFormFocus('phone'); }}
                        onBlur={() => { const t = fieldFocusTime.current.phone || Date.now(); if (typeof window !== 'undefined' && window.CRMPIXEL) window.CRMPIXEL.trackFormBlur('phone', Date.now() - t); }}
                        placeholder="(11) 99999-9999"
                        required
                        className="w-full pl-11 pr-4 py-3.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#C9A96E]/50 focus:ring-1 focus:ring-[#C9A96E]/20 transition-all"
                      />
                    </div>
                  </div>

                  {/* Email */}
                  <div>
                    <label htmlFor="form-email" className="block text-sm font-medium text-white/70 mb-2">
                      E-mail <span className="text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                      <input
                        id="form-email"
                        type="email"
                        value={formEmail}
                        onChange={(ev) => { setFormEmail(ev.target.value); if (typeof window !== 'undefined' && window.CRMPIXEL) window.CRMPIXEL._setFormFieldsFilled([formName, formPhone, ev.target.value].filter(Boolean).length); }}
                        onFocus={() => { fieldFocusTime.current.email = Date.now(); if (typeof window !== 'undefined' && window.CRMPIXEL) window.CRMPIXEL.trackFormFocus('email'); }}
                        onBlur={() => { const t = fieldFocusTime.current.email || Date.now(); if (typeof window !== 'undefined' && window.CRMPIXEL) window.CRMPIXEL.trackFormBlur('email', Date.now() - t); }}
                        placeholder="seuemail@exemplo.com"
                        required
                        className="w-full pl-11 pr-4 py-3.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#C9A96E]/50 focus:ring-1 focus:ring-[#C9A96E]/20 transition-all"
                      />
                    </div>
                  </div>

                  {/* Dynamic custom fields */}
                  {e.formFields && e.formFields.length > 0 && (
                    <div className="space-y-4 pt-2">
                      <div className="h-px bg-white/[0.06]" />
                      {e.formFields.map((field) => {
                        const val = customAnswers[field.id] || '';
                        const parsedOptions = field.options ? (() => { try { return JSON.parse(field.options); } catch { return []; } })() : [];

                        return (
                          <div key={field.id}>
                            <label htmlFor={`field-${field.id}`} className="block text-sm font-medium text-white/70 mb-2">
                              {field.label}
                              {field.required && <span className="text-red-400"> *</span>}
                            </label>

                            {field.fieldType === 'text' && (
                              <input
                                id={`field-${field.id}`}
                                type="text"
                                value={val}
                                onChange={(ev) => setCustomAnswers((prev) => ({ ...prev, [field.id]: ev.target.value }))}
                                placeholder={field.placeholder || undefined}
                                required={field.required}
                                className="w-full px-4 py-3.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#C9A96E]/50 focus:ring-1 focus:ring-[#C9A96E]/20 transition-all"
                              />
                            )}

                            {field.fieldType === 'number' && (
                              <input
                                id={`field-${field.id}`}
                                type="number"
                                value={val}
                                onChange={(ev) => setCustomAnswers((prev) => ({ ...prev, [field.id]: ev.target.value }))}
                                placeholder={field.placeholder || undefined}
                                required={field.required}
                                className="w-full px-4 py-3.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#C9A96E]/50 focus:ring-1 focus:ring-[#C9A96E]/20 transition-all"
                              />
                            )}

                            {field.fieldType === 'textarea' && (
                              <textarea
                                id={`field-${field.id}`}
                                value={val}
                                onChange={(ev) => setCustomAnswers((prev) => ({ ...prev, [field.id]: ev.target.value }))}
                                placeholder={field.placeholder || undefined}
                                required={field.required}
                                rows={3}
                                className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#C9A96E]/50 focus:ring-1 focus:ring-[#C9A96E]/20 transition-all resize-none"
                              />
                            )}

                            {field.fieldType === 'select' && parsedOptions.length > 0 && (
                              <select
                                id={`field-${field.id}`}
                                value={val}
                                onChange={(ev) => setCustomAnswers((prev) => ({ ...prev, [field.id]: ev.target.value }))}
                                required={field.required}
                                className="w-full px-4 py-3.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white focus:outline-none focus:border-[#C9A96E]/50 focus:ring-1 focus:ring-[#C9A96E]/20 transition-all appearance-none cursor-pointer"
                                style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.3)' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
                              >
                                <option value="" disabled className="bg-[#1a1a1a]">{field.placeholder || 'Selecione uma opção...'}</option>
                                {parsedOptions.map((opt: string, i: number) => (
                                  <option key={i} value={opt} className="bg-[#1a1a1a]">{opt}</option>
                                ))}
                              </select>
                            )}

                            {field.fieldType === 'checkbox' && (
                              <label htmlFor={`field-${field.id}`} className="flex items-center gap-3 cursor-pointer group py-1">
                                <input
                                  id={`field-${field.id}`}
                                  type="checkbox"
                                  checked={val === 'Sim'}
                                  onChange={(ev) => setCustomAnswers((prev) => ({ ...prev, [field.id]: ev.target.checked ? 'Sim' : 'Não' }))}
                                  className="h-4 w-4 rounded border-white/20 bg-white/[0.04] text-[#C9A96E] focus:ring-[#C9A96E]/20 cursor-pointer accent-[#C9A96E]"
                                />
                                <span className="text-sm text-white/50 group-hover:text-white/70 transition-colors">
                                  {field.placeholder || field.label}
                                </span>
                              </label>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Submit */}
                  <button
                    type="submit"
                    disabled={formSubmitting}
                    className="w-full flex items-center justify-center gap-2.5 px-8 py-4 rounded-xl bg-[#C9A96E] text-[#0A0A0A] font-semibold text-base hover:bg-[#D4B87E] transition-colors shadow-lg shadow-[#C9A96E]/20 disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                  >
                    {formSubmitting ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Enviando...
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        Cadastrar e Receber Atendimento
                      </>
                    )}
                  </button>

                  {/* ★ NEW: Form Trust Signals */}
                  <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pt-1">
                    <div className="flex items-center gap-1.5 text-xs text-white/30">
                      <Shield className="h-3.5 w-3.5 text-[#C9A96E]/50" />
                      <span>Seus dados estão seguros</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-white/30">
                      <Mail className="h-3.5 w-3.5 text-[#C9A96E]/50" />
                      <span>Sem spam</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-white/30">
                      <Clock className="h-3.5 w-3.5 text-[#C9A96E]/50" />
                      <span>Atendimento em até 24h</span>
                    </div>
                  </div>

                  <p className="text-xs text-white/25 text-center">
                    Ao se cadastrar, você concorda em receber informações sobre este empreendimento.
                  </p>
                </form>
              </div>
            </div>
          </div>
        </section>
      </ScrollReveal>

      {/* ── FAQ Section ────────────────────────────────── */}
      <ScrollReveal>
        <section className="py-12 sm:py-24 border-t border-white/[0.04]">
          <div className="max-w-3xl mx-auto px-4 sm:px-6">
            {/* Section header */}
            <div className="flex items-center gap-4 mb-8 sm:mb-12">
              <div className="h-px flex-1 bg-gradient-to-r from-[#C9A96E]/40 to-transparent" />
              <div className="text-center">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Perguntas Frequentes</h2>
              </div>
              <div className="h-px flex-1 bg-gradient-to-l from-[#C9A96E]/40 to-transparent" />
            </div>

            {/* FAQ accordion */}
            <div className="space-y-3">
              {faqItems.map((item, idx) => (
                <div
                  key={idx}
                  className={`rounded-2xl border transition-all duration-300 overflow-hidden ${
                    faqOpenIndex === idx
                      ? 'border-[#C9A96E]/25 bg-[#C9A96E]/[0.04]'
                      : 'border-white/[0.06] bg-white/[0.01] hover:border-white/[0.12]'
                  }`}
                >
                  <button
                    onClick={() => {
                      if (faqOpenIndex !== idx && typeof window !== 'undefined' && window.CRMPIXEL) {
                        window.CRMPIXEL.trackFAQOpen(idx, faqItems[idx]?.question);
                      }
                      setFaqOpenIndex(faqOpenIndex === idx ? null : idx);
                    }}
                    className="w-full flex items-center justify-between gap-4 p-5 sm:p-6 text-left"
                  >
                    <span className={`text-sm sm:text-[15px] font-semibold transition-colors ${
                      faqOpenIndex === idx ? 'text-[#C9A96E]' : 'text-white/80'
                    }`}>
                      {item.question}
                    </span>
                    <ChevronDown
                      className={`h-5 w-5 flex-shrink-0 transition-transform duration-300 ${
                        faqOpenIndex === idx ? 'rotate-180 text-[#C9A96E]' : 'text-white/30'
                      }`}
                    />
                  </button>
                  <div
                    className={`overflow-hidden transition-all duration-300 ease-in-out ${
                      faqOpenIndex === idx ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
                    }`}
                  >
                    <div className="px-5 sm:px-6 pb-5 sm:pb-6">
                      <div className="h-px bg-[#C9A96E]/15 mb-4" />
                      <p className="text-sm text-white/60 leading-relaxed">{item.answer}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* CTA after FAQ */}
            <div className="mt-8 sm:mt-10 text-center">
              <p className="text-sm text-white/40 mb-4">Ainda tem dúvidas?</p>
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  if (typeof window !== 'undefined' && window.CRMPIXEL) {
                    window.CRMPIXEL.track('whatsapp_click', { enterprise: e.name, source: 'faq_cta', userId: queueUser?.userId });
                  }
                }}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#25D366] text-white font-semibold text-sm hover:bg-[#20bd5a] transition-colors shadow-lg shadow-[#25D366]/15"
              >
                <Phone className="h-4 w-4" />
                Fale com um consultor pelo WhatsApp
              </a>
            </div>
          </div>
        </section>
      </ScrollReveal>

      {/* ── Footer ─────────────────────────────────────── */}
      <footer className="border-t border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          {/* Top row */}
          <div className="py-8 sm:py-12 grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-10">
            {/* Brand */}
            <div>
              <a href="/empreendimentos" className="flex items-center gap-3 mb-4 group">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[#C9A96E] to-[#8B6914] flex items-center justify-center shadow-lg shadow-[#C9A96E]/15">
                  <Building2 className="h-5 w-5 text-white" />
                </div>
                <span className="text-base font-bold tracking-tight">Empreendimentos</span>
              </a>
              <p className="text-sm text-white/30 leading-relaxed max-w-xs">
                Encontre o imóvel ideal para você e sua família. Qualidade, confiança e atendimento personalizado.
              </p>
            </div>

            {/* Quick links */}
            <div>
              <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4">Navegação</h4>
              <ul className="space-y-2.5">
                <li>
                  <a href="/empreendimentos" className="text-sm text-white/30 hover:text-[#C9A96E] transition-colors">
                    Todos os Empreendimentos
                  </a>
                </li>
                <li>
                  <a href="#galeria" className="text-sm text-white/30 hover:text-[#C9A96E] transition-colors">
                    Galeria
                  </a>
                </li>
                <li>
                  <a href="#cadastro" className="text-sm text-white/30 hover:text-[#C9A96E] transition-colors">
                    Cadastre-se
                  </a>
                </li>
              </ul>
            </div>

            {/* Contact */}
            <div>
              <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4">Contato</h4>
              <div className="space-y-3">
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    if (typeof window !== 'undefined' && window.CRMPIXEL) {
                      window.CRMPIXEL.track('whatsapp_click', { enterprise: e.name, source: 'footer', userId: queueUser?.userId });
                    }
                  }}
                  className="flex items-center gap-2.5 text-sm text-white/30 hover:text-[#C9A96E] transition-colors"
                >
                  <div className="h-8 w-8 rounded-lg bg-[#25D366]/10 flex items-center justify-center flex-shrink-0">
                    <Phone className="h-3.5 w-3.5 text-[#25D366]" />
                  </div>
                  WhatsApp
                </a>
              </div>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="border-t border-white/[0.04] py-5 sm:py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-white/20">
              &copy; {new Date().getFullYear()} Todos os direitos reservados.
            </p>
            <p className="text-xs text-white/15">
              Todos os valores e informações são sujeitos a alteração sem aviso prévio.
            </p>
          </div>
        </div>
      </footer>

      {/* ★ NEW: Floating Sticky WhatsApp CTA (Mobile) ─── */}
      {showFloatingWhatsApp && (
        <div className="fixed bottom-0 left-0 right-0 z-50 sm:hidden animate-slide-up-bar">
          <div className="bg-gradient-to-r from-[#C9A96E] to-[#A8893E] shadow-[0_-4px_20px_rgba(201,169,110,0.3)]">
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                if (typeof window !== 'undefined' && window.CRMPIXEL) {
                  window.CRMPIXEL.track('whatsapp_click', { enterprise: e.name, source: 'floating_bar', userId: queueUser?.userId });
                }
              }}
              className="flex items-center justify-center gap-2.5 py-3.5 px-6 text-[#0A0A0A] font-semibold text-sm"
            >
              {/* WhatsApp SVG icon */}
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              Fale com um consultor
            </a>
          </div>
          {/* Safe area bottom for phones with home indicator */}
          <div className="h-[env(safe-area-inset-bottom)]" />
        </div>
      )}

      {/* ── Lightbox ───────────────────────────────────── */}
      {lightboxOpen && (
        <div className="fixed inset-0 z-[60] bg-black/95 flex items-center justify-center p-2 sm:p-0" onClick={() => setLightboxOpen(false)}>
          <button
            onClick={() => setLightboxOpen(false)}
            className="absolute top-3 right-3 sm:top-5 sm:right-5 text-white/60 hover:text-white z-10 bg-white/10 backdrop-blur-sm rounded-full p-2 sm:p-2.5 transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
          <div className="absolute top-3 left-3 sm:top-5 sm:left-5 text-white/60 text-xs sm:text-sm bg-white/10 backdrop-blur-sm px-3 py-1.5 sm:px-4 sm:py-2 rounded-full">
            {activeImgIdx + 1} / {images.length}
          </div>
          <img
            src={images[activeImgIdx]?.url}
            alt={images[activeImgIdx]?.altText || ''}
            className="max-w-[95vw] sm:max-w-[90vw] max-h-[80vh] sm:max-h-[85vh] object-contain rounded-xl"
            onClick={(ev) => ev.stopPropagation()}
          />
          {images.length > 1 && (
            <>
              <button
                onClick={(ev) => { ev.stopPropagation(); goPrev(); }}
                className="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 text-white/60 hover:text-white bg-white/10 backdrop-blur-sm rounded-full p-2.5 sm:p-3 transition-colors"
              >
                <ChevronLeft className="h-5 w-5 sm:h-6 sm:w-6" />
              </button>
              <button
                onClick={(ev) => { ev.stopPropagation(); goNext(); }}
                className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 text-white/60 hover:text-white bg-white/10 backdrop-blur-sm rounded-full p-2.5 sm:p-3 transition-colors"
              >
                <ChevronRight className="h-5 w-5 sm:h-6 sm:w-6" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}