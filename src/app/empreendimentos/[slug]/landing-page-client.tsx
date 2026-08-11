'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import {
  Building2, MapPin, ArrowLeft, ChevronLeft, ChevronRight,
  X, Navigation, HardHat, Palette, Sparkles, Ruler, BedDouble,
  CheckCircle2, Clock, DollarSign, Phone, Mail, MessageSquare,
  Loader2, ZoomIn, Copy, Check, User, Send, AlertCircle,
  Shield, ChevronDown, CalendarDays, TrendingUp, Users, Layers, Car, LayoutGrid,
  UserCheck,
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

interface FloorPlan {
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
  status: string | null;
  deliveryDate: string | null;
  price: string | null;
  totalUnits: number | null;
  floors: number | null;
  parkingSpots: number | null;
  differentials: string[];
  apartmentTypes: Array<{
    name: string;
    area: string | null;
    bedrooms: string | null;
    description: string | null;
    price: string | null;
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
  floorPlans: FloorPlan[];
  formFields: FormField[];
}

/* ================================================================
   Custom Component — Scroll Reveal
   ================================================================ */
function ScrollReveal({ children, className = '' }: React.PropsWithChildren<{ className?: string }>) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }
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
interface LandingPageClientProps {
  params: Promise<{ slug: string }>;
  initialData?: Enterprise | null;
  initialQueueUser?: { userId: string; userName: string; userPhone: string | null } | null;
}

export default function LandingPageClient({ params, initialData, initialQueueUser }: LandingPageClientProps) {
  const { slug } = React.use(params);

  const [enterprise, setEnterprise] = useState<Enterprise | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);
  const [activeImgIdx, setActiveImgIdx] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [activeFloorIdx, setActiveFloorIdx] = useState(0);
  const [floorLightboxOpen, setFloorLightboxOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [queueUser, setQueueUser] = useState<{ userId: string; userName: string; userPhone: string | null } | null>(initialQueueUser ?? null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});

  // Track all form fields (standard + custom) for pixel abandonment
  const updatePixelFormFields = useCallback((name: string, phone: string, email: string, custom: Record<string, string>) => {
    if (typeof window === 'undefined' || !window.CRMPIXEL) return;
    const fields: Record<string, string> = { nome: name, telefone: phone, email };
    // Add custom fields with their labels for readability
    for (const [id, val] of Object.entries(custom)) {
      const f = enterprise?.formFields?.find((ff: FormField) => ff.id === id);
      fields[f?.label || id] = val;
    }
    window.CRMPIXEL._setFormFieldsFilled(fields);
  }, [enterprise?.formFields]);

  // NEW: Floating WhatsApp bar visibility (mobile)
  const [showFloatingWhatsApp, setShowFloatingWhatsApp] = useState(false);

  // NEW: Sticky form submit visibility (mobile) — shows when form section is in viewport
  const [showStickyFormSubmit, setShowStickyFormSubmit] = useState(false);
  const formSectionRef = useRef<HTMLDivElement>(null);
  const isSubmittingRef = useRef(false); // prevent double-submit
  const handleFormSubmitRef = useRef<(ev: React.FormEvent) => Promise<void> | null>(null); // for sticky button
  const utmParamsRef = useRef<Record<string, string>>({});

  // ── SAFETY NET: Auto-save form data to localStorage (debounced) ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hasData = formName.trim() || formEmail.trim() || formPhone.trim();
    if (!hasData) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(`lp_draft_${slug || 'default'}`, JSON.stringify({
          name: formName,
          phone: formPhone,
          email: formEmail,
          customAnswers,
          utmSource: utmParamsRef.current.utm_source || null,
          utmMedium: utmParamsRef.current.utm_medium || null,
          utmCampaign: utmParamsRef.current.utm_campaign || null,
          utmContent: utmParamsRef.current.utm_content || null,
          utmTerm: utmParamsRef.current.utm_term || null,
          savedAt: Date.now(),
        }));
      } catch { /* localStorage full or unavailable */ }
    }, 1000);
    return () => clearTimeout(timer);
  }, [formName, formPhone, formEmail, customAnswers, slug]);

  // ── SAFETY NET: Restore draft from localStorage on mount ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const draft = localStorage.getItem(`lp_draft_${slug || 'default'}`);
      if (draft) {
        const data = JSON.parse(draft);
        if (data.name) setFormName(data.name);
        if (data.phone) setFormPhone(data.phone);
        if (data.email) setFormEmail(data.email);
        if (data.customAnswers) setCustomAnswers(data.customAnswers);
        localStorage.removeItem(`lp_draft_${slug || 'default'}`);
      }
    } catch { /* ignore */ }
  }, [slug]);

  // ── SAFETY NET: Retry failed submissions on mount ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    async function retryFailed() {
      try {
        const raw = localStorage.getItem('lp_failed_queue');
        if (!raw) return;
        const queue: Array<{ payload: Record<string, unknown>; timestamp: number }> = JSON.parse(raw);
        if (!Array.isArray(queue) || queue.length === 0) return;
        const fresh = queue.filter((item) => Date.now() - item.timestamp < 24 * 60 * 60 * 1000);
        if (fresh.length === 0) { localStorage.removeItem('lp_failed_queue'); return; }
        for (const item of fresh) {
          if (cancelled) return;
          try { await fetch('/api/enterprises/public-lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item.payload) }); } catch { /* will retry next visit */ }
        }
        localStorage.removeItem('lp_failed_queue');
      } catch { /* ignore */ }
    }
    const timer = setTimeout(retryFailed, 2000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  // ── SAFETY NET: sendBeacon on page close if form has data ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    function handleUnload() {
      const hasSignificantData = formName.trim().length >= 2 && formEmail.trim().length >= 5;
      if (!hasSignificantData) return;
      try {
        const payload = new URLSearchParams();
        payload.set('name', formName.trim());
        if (formPhone.trim()) payload.set('phone', formPhone.replace(/\D/g, ''));
        payload.set('email', formEmail.trim());
        payload.set('slug', slug || '');
        payload.set('source', 'beacon');
        const utm = utmParamsRef.current;
        if (utm.utm_source) payload.set('utmSource', utm.utm_source);
        if (utm.utm_campaign) payload.set('utmCampaign', utm.utm_campaign);
        if (utm.utm_medium) payload.set('utmMedium', utm.utm_medium);
        if (utm.utm_content) payload.set('utmContent', utm.utm_content);
        if (utm.utm_term) payload.set('utmTerm', utm.utm_term);
        navigator.sendBeacon('/api/leads/safety-net', payload);
      } catch { /* sendBeacon can fail silently */ }
    }
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [formName, formPhone, formEmail, slug]);

  // NEW: Exit-intent popup (medium priority #8)
  const [exitPopupOpen, setExitPopupOpen] = useState(false);
  const exitPopupShownRef = useRef(false); // show only once per session
  const [exitPopupCountdown, setExitPopupCountdown] = useState(0);
  const exitPopupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // NEW: Sticky desktop CTA — show only after scrolling past hero
  const [showDesktopSticky, setShowDesktopSticky] = useState(false);
  const [isFormSectionVisible, setIsFormSectionVisible] = useState(false);

  // Meta Pixel helper — fires fbq events only if Meta Pixel is loaded
  // Wrapped in try/catch to prevent third-party script errors from blocking the page
  const trackMetaPixel = useCallback((event: string, data?: Record<string, unknown>, eventId?: string) => {
    try {
      if (typeof window !== 'undefined' && typeof (window as unknown as Record<string, unknown>).fbq === 'function') {
        const fbq = (window as unknown as Record<string, unknown>).fbq as (...args: unknown[]) => void;
        if (data && eventId) {
          fbq('track', event, data, { eventID: eventId });
        } else if (data) {
          fbq('track', event, data);
        } else {
          fbq('track', event);
        }
      }
    } catch (e) {
      // Meta Pixel errors should never block page functionality
      console.warn('[Meta Pixel] Track error:', e instanceof Error ? e.message : e);
    }
  }, []);

  // Generate unique event_id for deduplication (Meta CAPI + browser pixel)
  const generateMetaEventId = useCallback(() => {
    return `lp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }, []);

  // NEW: FAQ accordion state
  const [faqOpenIndex, setFaqOpenIndex] = useState<number | null>(null);

  // Calculate form progress (for progress bar — medium priority #9)
  const formProgress = React.useMemo(() => {
    let total = 2; // name + email are required
    let filled = 0;
    if (formName.trim().length >= 2) filled++;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formEmail.trim().toLowerCase())) filled++;
    // Count optional phone as bonus
    const phoneDigits = formPhone.replace(/\D/g, '');
    if (phoneDigits.length >= 10) total++ , filled++;
    // Count required custom fields
    if (enterprise?.formFields) {
      for (const field of enterprise.formFields) {
        if (field.required) {
          total++;
          const val = customAnswers[field.id];
          if (val && val.trim() !== '') filled++;
        }
      }
    }
    return Math.min(100, Math.round((filled / total) * 100));
  }, [formName, formEmail, formPhone, customAnswers, enterprise?.formFields]);

  // Tracking: form field focus timestamps
  const fieldFocusTime = useRef<Record<string, number>>({});

  // Capture UTM params from URL once on mount (persists for form submission)
  const utmParams = React.useMemo(() => {
    if (typeof window === 'undefined') return {} as Record<string, string>;
    const sp = new URLSearchParams(window.location.search);
    const map: Record<string, string> = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach((k) => {
      const v = sp.get(k);
      if (v) map[k] = v;
    });
    return map;
  }, []);
  utmParamsRef.current = utmParams;

  // Tracking: section visibility (IntersectionObserver)
  // Retry up to 5 times (2s apart) in case pixel.js loads after mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof IntersectionObserver === 'undefined') return;
    const sectionNames: Record<string, string> = {
      'galeria': 'galeria',
      'ficha técnica': 'ficha-tecnica',
      'detalhes do empreendimento': 'detalhes',
      'por que o': 'por-que',
      'cadastre-se': 'cadastro',
      'perguntas frequentes': 'faq',
    };
    let observer: IntersectionObserver | null = null;
    let retries = 0;
    const maxRetries = 5;
    function initObserver() {
      if (!window.CRMPIXEL || retries >= maxRetries) return;
      const headings = document.querySelectorAll('h2');
      if (headings.length === 0) return;
      observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const text = (entry.target.textContent || '').toLowerCase();
            for (const [key, name] of Object.entries(sectionNames)) {
              if (text.includes(key)) {
                try { window.CRMPIXEL?.trackSectionView(name); } catch { /* non-critical */ }
                break;
              }
            }
          }
        });
      }, { threshold: 0.2 });
      headings.forEach((h) => observer?.observe(h));
    }
    initObserver();
    if (!observer && retries < maxRetries) {
      const timer = setInterval(() => {
        retries++;
        initObserver();
        if (observer || retries >= maxRetries) clearInterval(timer);
      }, 2000);
      return () => clearInterval(timer);
    }
    return () => observer?.disconnect();
  }, []);

  // Tracking: exit intent — desktop (mouseleave from top only) + mobile (visibilitychange)
  // IMPROVEMENT: Added scroll-depth gate — only show after user has scrolled past 20%
  // This prevents false positives from users who haven't engaged yet.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const showExitPopup = () => {
      if (typeof window !== 'undefined' && window.CRMPIXEL) window.CRMPIXEL?.trackExitIntent();
      if (!exitPopupShownRef.current && !formSubmitting) {
        exitPopupShownRef.current = true;
        setExitPopupCountdown(15);
        setExitPopupOpen(true);
        if (typeof window !== 'undefined' && window.CRMPIXEL) {
          const docH = document.documentElement.scrollHeight - window.innerHeight;
          window.CRMPIXEL.track('exit_popup_shown', { enterprise: enterprise?.name, scroll_depth: docH > 0 ? Math.round((window.scrollY / docH) * 100) : 0 });
        }
      }
    };

    const getScrollPct = () => {
      const docH = document.documentElement.scrollHeight - window.innerHeight;
      return docH > 0 ? window.scrollY / docH : 0;
    };

    // Desktop: mouse leaves viewport from TOP only (not left/right/bottom)
    const mouseHandler = (e: MouseEvent) => {
      // Only trigger when mouse leaves from the TOP edge
      if (e.clientY <= 0 && e.relatedTarget === null && getScrollPct() > 0.2) {
        showExitPopup();
      }
    };
    document.addEventListener('mouseleave', mouseHandler);

    // Mobile: page visibility hidden (user switches app/tab)
    // Increased to 5s debounce — avoids false positives when user briefly switches to WhatsApp
    let mobileTimer: ReturnType<typeof setTimeout> | null = null;
    const visibilityHandler = () => {
      if (document.visibilityState === 'hidden' && getScrollPct() > 0.2) {
        mobileTimer = setTimeout(showExitPopup, 5000);
      } else {
        if (mobileTimer) { clearTimeout(mobileTimer); mobileTimer = null; }
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);

    return () => {
      document.removeEventListener('mouseleave', mouseHandler);
      document.removeEventListener('visibilitychange', visibilityHandler);
      if (mobileTimer) clearTimeout(mobileTimer);
    };
  }, [formSubmitting, enterprise?.name]);

  // Exit popup countdown timer
  useEffect(() => {
    if (exitPopupOpen && exitPopupCountdown > 0) {
      exitPopupTimerRef.current = setInterval(() => {
        setExitPopupCountdown((c) => {
          if (c <= 1) {
            if (exitPopupTimerRef.current) clearInterval(exitPopupTimerRef.current);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    }
    return () => {
      if (exitPopupTimerRef.current) clearInterval(exitPopupTimerRef.current);
    };
  }, [exitPopupOpen, exitPopupCountdown]);

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

  // Fetch queue user for dynamic WhatsApp (skip if already provided via SSR)
  useEffect(() => {
    if (!slug || queueUser) return;
    fetch(`/api/lead-queues/next-user?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.hasQueue && data.userPhone && data.userId && data.userName) {
          setQueueUser({ userId: data.userId, userName: data.userName, userPhone: data.userPhone });
        }
      })
      .catch(() => { /* silent — fallback to generic WhatsApp */ });
  }, [slug, queueUser]);

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

  // Floor-plan lightbox keyboard navigation & scroll lock
  useEffect(() => {
    if (!floorLightboxOpen || !enterprise) return;
    const plans = enterprise.floorPlans || [];
    const len = Math.max(plans.length, 1);
    const h = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setFloorLightboxOpen(false);
      if (ev.key === 'ArrowRight') setActiveFloorIdx((p) => (p + 1) % len);
      if (ev.key === 'ArrowLeft') setActiveFloorIdx((p) => (p - 1 + len) % len);
    };
    window.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', h);
      document.body.style.overflow = '';
    };
  }, [floorLightboxOpen, enterprise]);

  // Floating WhatsApp bar — show after scrolling past hero
  // Sticky form submit — show when form section is visible on mobile
  // Desktop sticky — show only after scrolling past hero, hide when form is visible
  useEffect(() => {
    const onScroll = () => {
      const scrollY = window.scrollY;
      const heroHeight = window.innerHeight;
      // Always show WhatsApp bar on mobile (even at top) — critical for 96% mobile traffic
      setShowFloatingWhatsApp(window.innerWidth < 640);

      // Sticky form submit: show on mobile when form section is in viewport
      if (formSectionRef.current && window.innerWidth < 640) {
        const rect = formSectionRef.current.getBoundingClientRect();
        const isVisible = rect.top < window.innerHeight && rect.bottom > 0;
        setShowStickyFormSubmit(isVisible);
      }

      // Desktop sticky CTA: show after scrolling past hero (medium priority #11)
      if (window.innerWidth >= 640) {
        setShowDesktopSticky(scrollY > heroHeight * 0.7);
        if (formSectionRef.current) {
          const rect = formSectionRef.current.getBoundingClientRect();
          setIsFormSectionVisible(rect.top < window.innerHeight * 0.8 && rect.bottom > 0);
        }
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    // Run once on mount so floating WhatsApp bar shows immediately on mobile
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  const whatsappNumber = queueUser?.userPhone
    ? queueUser.userPhone.replace(/\D/g, '')
    : null;
  const whatsappUrl = whatsappNumber
    ? `https://wa.me/${whatsappNumber.startsWith('55') ? whatsappNumber : '55' + whatsappNumber}?text=${encodeURIComponent(`Olá! Tenho interesse no empreendimento ${enterprise?.name || ''}.`)}`
    : `https://wa.me/?text=${encodeURIComponent(`Olá! Tenho interesse no empreendimento ${enterprise?.name || ''}.`)}`;

  // Register WhatsApp click as a queue assignment (fire-and-forget)
  // Uses sendBeacon so the navigation to wa.me isn't blocked
  const whatsappAssignRef = useRef(false);
  const registerWhatsAppClick = useCallback((source: string) => {
    if (whatsappAssignRef.current || !queueUser?.userId) return;
    // Prevent double-registration within the same session for this queue user
    whatsappAssignRef.current = true;
    const payload = JSON.stringify({
      source: `whatsapp_click:${slug}:${source}`,
    });
    // Use Blob to force application/json content-type (sendBeacon defaults to text/plain)
    const blob = new Blob([payload], { type: 'application/json' });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/lead-queues/assign', blob);
    } else {
      fetch('/api/lead-queues/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  }, [queueUser?.userId, slug]);


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
    const cleanEmail = formEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setFormError('Informe um e-mail válido.');
      return;
    }
    const cleanPhone = formPhone.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      setFormError('Informe um telefone válido com DDD (mínimo 10 dígitos).');
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
    isSubmittingRef.current = true;
    // Generate a shared event_id for Meta CAPI deduplication (browser + server use same ID)
    const metaEventId = generateMetaEventId();
    // Build clean custom answers (label -> value) — outside try so catch can access it
    const answersData: Record<string, string> = {};
    if (enterprise?.formFields) {
      for (const field of enterprise.formFields) {
        const val = customAnswers[field.id];
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          answersData[field.label] = String(val).trim();
        }
      }
    }
    try {
      const res = await fetch('/api/enterprises/public-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName.trim(),
          phone: cleanPhone,
          email: cleanEmail,
          slug: slug || undefined,
          customAnswers: Object.keys(answersData).length > 0 ? answersData : undefined,
          utmSource: utmParams.utm_source || undefined,
          utmMedium: utmParams.utm_medium || undefined,
          utmCampaign: utmParams.utm_campaign || undefined,
          utmContent: utmParams.utm_content || undefined,
          utmTerm: utmParams.utm_term || undefined,
          metaEventId,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        // SAFETY NET: Clear draft data on success
        try { localStorage.removeItem(`lp_draft_${slug || 'default'}`); } catch { /* ignore */ }

        // Track CRM pixel event + identify visitor with new lead
        if (typeof window !== 'undefined' && window.CRMPIXEL) {
          window.CRMPIXEL.track('form_submit', { enterprise: enterprise?.name });
          if (data.clientId) {
            window.CRMPIXEL.identify(data.clientId);
          }
        }
        // Track Meta Pixel — Lead event with eventID for CAPI deduplication
        trackMetaPixel('Lead', {
          content_name: enterprise?.name,
          content_category: 'empreendimento',
          value: 1,
          currency: 'BRL',
        }, metaEventId);

        // Redirect to success page
        const params = new URLSearchParams();
        params.set('empreendimento', enterprise?.name || '');
        params.set('nome', formName.trim());
        params.set('slug', slug);
        if (data.assignedUser?.userName) params.set('atendente', data.assignedUser.userName);
        if (data.assignedUser?.userPhone) params.set('telefone', data.assignedUser.userPhone);

        window.location.href = `/empreendimentos/${slug}/cadastro-sucesso?${params.toString()}`;
      } else {
        setFormError(data.error || 'Erro ao enviar. Tente novamente.');
      }
    } catch (submitErr) {
      // SAFETY NET: Save failed submission to localStorage retry queue
      try {
        const failQueueRaw = localStorage.getItem('lp_failed_queue');
        const failQueue: Array<{ payload: Record<string, unknown>; timestamp: number }> = failQueueRaw ? JSON.parse(failQueueRaw) : [];
        failQueue.push({
          payload: {
            name: formName.trim(),
            phone: cleanPhone,
            email: cleanEmail,
            slug: slug || undefined,
            customAnswers: Object.keys(answersData).length > 0 ? answersData : undefined,
            utmSource: utmParams.utm_source || undefined,
            utmMedium: utmParams.utm_medium || undefined,
            utmCampaign: utmParams.utm_campaign || undefined,
            utmContent: utmParams.utm_content || undefined,
            utmTerm: utmParams.utm_term || undefined,
          },
          timestamp: Date.now(),
        });
        localStorage.setItem('lp_failed_queue', JSON.stringify(failQueue));
      } catch { /* localStorage unavailable */ }
      setFormError('Erro de conexão. Verifique sua internet e tente novamente.');
    } finally {
      setFormSubmitting(false);
      isSubmittingRef.current = false;
    }
  };

  // Keep ref updated so sticky button always calls the latest closure
  handleFormSubmitRef.current = handleFormSubmit;

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
      <div className="min-h-screen bg-[#F7F6F3] flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-[#33492F] animate-spin" />
      </div>
    );
  }

  /* ─── Error ───────────────────────────────────────────── */
  if (error || !enterprise) {
    return (
      <div className="min-h-screen bg-[#F7F6F3] flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <Building2 className="h-16 w-16 text-[#33492F]/20 mx-auto mb-6" />
          <h1 className="text-2xl font-bold text-[#1a1a1a] mb-2">Não encontrado</h1>
          <p className="text-gray-500 mb-8">{error || 'Este empreendimento não existe ou foi removido.'}</p>
          <a
            href="/empreendimentos"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#33492F] text-white font-semibold text-sm hover:bg-[#33492F]/90 transition-colors"
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

  // ── Social Proof System ──────────────────────────────
  // Threshold: only show real count when >= MIN_COUNT; below that, use
  // activity-based messaging + floating toast to convey credibility.
  const MIN_SOCIAL_COUNT = 5;
  const clientCount = e._count?.clients ?? 0;
  const showRealCount = clientCount >= MIN_SOCIAL_COUNT;

  const [socialProofIdx, setSocialProofIdx] = useState(0);
  const [toastVisible, setToastVisible] = useState(false);

  const socialProofPool = React.useMemo(() => [
    { message: 'Mais uma pessoa acabou de se cadastrar', time: 'agora' },
    { message: 'Alguém acabou de solicitar informações', time: '1 min' },
    { message: 'Mais uma pessoa se cadastrou agora', time: '2 min' },
    { message: 'Alguém solicitou condições de pagamento', time: '3 min' },
    { message: 'Outra pessoa acabou de se cadastrar', time: '5 min' },
  ], []);

  // Cycle social proof every 8s; show toast after 10s initial delay
  useEffect(() => {
    if (socialProofPool.length === 0) return;
    const showDelay = setTimeout(() => setToastVisible(true), 10000);
    const timer = setInterval(() => {
      setSocialProofIdx((prev) => (prev + 1) % socialProofPool.length);
    }, 8000);
    return () => { clearTimeout(showDelay); clearInterval(timer); };
  }, [socialProofPool.length]);

  // Adblocker-resistant WhatsApp navigation — AdGuard blocks <a href="https://wa.me/...">
  // Using button + window.open avoids having wa.me in the DOM as an href attribute
  const openWhatsApp = useCallback((source: string) => {
    try {
      registerWhatsAppClick(source);
      if (typeof window !== 'undefined' && window.CRMPIXEL) {
        window.CRMPIXEL.track('whatsapp_click', { enterprise: e?.name, source, userId: queueUser?.userId });
      }
      trackMetaPixel('Contact', { content_name: e?.name, content_category: 'empreendimento' });
    } catch { /* tracking errors must never block navigation */ }
    try { window.open(whatsappUrl, '_blank', 'noopener'); } catch { /* IAB may block window.open */ }
  }, [whatsappUrl, e?.name, queueUser?.userId, registerWhatsAppClick, trackMetaPixel]);

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

  // Status: prefer dedicated field from AI extraction, fallback to regex on text
  let status: string | null = info?.status || null;
  if (!status) {
    if (/entregue|pronto para morar|habite-se/i.test(allText)) status = 'Entregue';
    else if (/em construção|construção/i.test(allText)) status = 'Em Construção';
    else if (/lançamento|pré-lançamento/i.test(allText)) status = 'Lançamento';
  }

  // Price: prefer dedicated field, fallback to regex on summary
  const priceText = info?.price || (() => {
    const m = info?.summary?.match(/a partir de\s*R\$\s*[\d.]+/i) ||
      info?.apartmentTypes?.[0]?.description?.match(/a partir de\s*R\$\s*[\d.]+/i);
    return m ? m[0] : null;
  })();

  // Delivery: prefer dedicated field, fallback to broader regex
  const deliveryText = (() => {
    if (info?.deliveryDate) return info.deliveryDate;
    if (status === 'Entregue') return 'Já entregue';
    // Broader regex: capture various date formats after "entrega" mentions
    const m = allText.match(/entrega[^A-Z]*(?:prevista\s*(?:para\s*)?)?([^.;\n]{3,40}?)(?:\.|;|\n|$)/i)
      || allText.match(/(\d{1,2}\/\d{2,4}|\d{4})\s*$/);
    return m ? m[1].trim() : null;
  })();

  const goNext = () => setActiveImgIdx((p) => (p + 1) % Math.max(images.length, 1));
  const goPrev = () => setActiveImgIdx((p) => (p - 1 + images.length) % Math.max(images.length, 1));

  const displayTitle = e.landingTitle || e.name;

  // NEW: Determine if urgency badge should show
  const showUrgencyBadge = status === 'Lançamento' || status === 'Em Construção';

  /* ─── Derived data for Ficha Técnica ────────────────── */
  const areas = (info?.apartmentTypes || []).flatMap(a => {
    if (!a.area) return [];
    let cleaned = a.area.trim();
    // Normalize Brazilian decimal comma to dot
    cleaned = cleaned.replace(/,/g, '.');
    // Remove unit variants: m², m2, M², M2
    cleaned = cleaned.replace(/m[²2]/gi, '').trim();
    // Remove common prefixes (De, de, desde, entre, a partir de)
    cleaned = cleaned.replace(/^(de|desde|entre|a\s+partir\s+de)\s+/i, '').trim();
    // Extract ALL valid numbers from the cleaned string
    const nums: number[] = [];
    const numRe = /(\d+(?:\.\d+)?)/g;
    let m;
    while ((m = numRe.exec(cleaned)) !== null) {
      const val = parseFloat(m[1]);
      if (!isNaN(val) && val > 0) nums.push(val);
    }
    return nums;
  }).filter(a => a > 0 && a < 5000); // sanity: no apartment > 5000 m²
  const maxArea = areas.length > 0 ? Math.max(...areas) : 0;
  const minArea = areas.length > 0 ? Math.min(...areas) : 0;
  const areaRange = maxArea > 0
    ? (minArea === maxArea ? `${maxArea}m²` : `${minArea} a ${maxArea}m²`)
    : null;

  // Smart subtitle: use landingSubtitle, then AI summary, then generate from data
  const displaySubtitle = e.landingSubtitle
    || info?.summary?.slice(0, 120)
    || (() => {
      const parts: string[] = [];
      if (info?.location?.city || info?.location?.neighborhood) {
        parts.push(`Em ${info.location.neighborhood || info.location.city}${info.location.city && info.location.neighborhood ? ', ' + info.location.city : ''}`);
      }
      if (priceText) {
        parts.push(priceText);
      } else if (areaRange) {
        parts.push(`Áreas de ${areaRange}`);
      }
      if (deliveryText && deliveryText !== 'Já entregue') {
        parts.push(`Entrega ${deliveryText}`);
      }
      return parts.length > 0 ? parts.join(' · ') : null;
    })() || null;

  /* ================================================================
     Render
     ================================================================ */

  // ── Differential categorization for tab-based display ──
  const diffCategories = React.useMemo(() => {
    if (!info?.differentials || info.differentials.length === 0) return [];
    const cats: { name: string; keywords: string[]; icon: string }[] = [
      { name: 'Social & Lazer', keywords: ['churrasqueira', 'salão', 'festa', 'playground', 'brinquedoteca', 'piscina', 'spa', 'quadra', 'sauna', 'jogos', 'cinema', 'pet', 'dog', 'bike', 'bicicleta', 'gourmet', 'esport', 'lazer', 'ginásio', 'ginasio'], icon: 'Users' },
      { name: 'Conforto & Conveniência', keywords: ['varanda', 'sacada', 'terraço', 'cozinha', 'armário', 'closet', 'depósito', 'elevador', 'portaria', 'lavanderia', 'delivery', 'estacionamento', 'garagem', 'água quente', 'ar condicionado', 'ventilação', 'iluminação natural', 'pé-direito', 'acabamento', 'porcelanato', 'hidráulica', 'mármore', 'amplo'], icon: 'LayoutGrid' },
      { name: 'Tecnologia & Segurança', keywords: ['automat', 'smart', 'inteligente', 'fibra', 'internet', 'digital', 'biometria', 'segurança', 'camer', 'monitoramento', 'cerca', 'alarme', 'câmera', 'vigilância', 'porteiro', 'controle', '24h', '24 horas'], icon: 'Shield' },
      { name: 'Sustentabilidade', keywords: ['sustent', 'solar', 'painel', 'energia', 'reaproveitamento', 'recicl', 'verde', 'natural', 'ecol', 'permeável', 'jardim', 'paisagism', 'biodiversidade', 'captação', 'reuso', 'água pluvial'], icon: 'TrendingUp' },
    ];
    const assigned: number[] = [];
    const result: { name: string; icon: string; items: string[] }[] = [];
    for (const cat of cats) {
      const items: string[] = [];
      (info!.differentials).forEach((d, i) => {
        if (assigned.includes(i)) return;
        const lower = d.toLowerCase();
        if (cat.keywords.some((k) => lower.includes(k))) {
          items.push(d);
          assigned.push(i);
        }
      });
      if (items.length > 0) result.push({ name: cat.name, icon: cat.icon, items });
    }
    const remaining = info!.differentials.filter((_, i) => !assigned.includes(i));
    if (remaining.length > 0) {
      result.push({ name: 'Outros Diferenciais', icon: 'Sparkles', items: remaining });
    }
    return result;
  }, [info?.differentials]);

  const [activeDiffTab, setActiveDiffTab] = React.useState(0);

  const diffIconMap: Record<string, React.ReactNode> = {
    Users: <Users className="h-4 w-4" />,
    LayoutGrid: <LayoutGrid className="h-4 w-4" />,
    Shield: <Shield className="h-4 w-4" />,
    TrendingUp: <TrendingUp className="h-4 w-4" />,
    Sparkles: <Sparkles className="h-4 w-4" />,
  };


  /* ================================================================
     Render
     ================================================================ */
  return (
    <div className="min-h-screen bg-[#F7F6F3] text-[#1a1a1a] [word-break:break-word]" style={{ overflowX: 'clip' }}>

      {/* ── Custom Keyframes ────────────────────────────── */}
      <style>{`
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

        /* Mobile: prevent iOS bounce/overscroll on horizontal scroll containers */
        .mobile-scroll-x {
          -webkit-overflow-scrolling: touch;
          overscroll-behavior-x: contain;
        }

        /* Mobile: prevent zoom on input focus (font-size >= 16px rule) */
        @media screen and (max-width: 640px) {
          .lp-input-mobile {
            font-size: 16px !important;
          }
        }
      `}</style>

      {/* ── Navigation ─────────────────────────────────── */}
      <nav
        className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 ${
          scrolled
            ? 'bg-white/95 backdrop-blur-xl border-b border-[#1a1a1a]/[0.06] shadow-lg shadow-black/[0.04]'
            : 'bg-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 sm:h-20 flex items-center justify-between">
          <a href="/empreendimentos" className="flex items-center gap-3 group">
            <div className="h-9 w-9 rounded-xl bg-[#33492F] flex items-center justify-center shadow-lg shadow-[#33492F]/20 group-hover:shadow-[#33492F]/40 transition-shadow">
              <Building2 className="h-4 w-4 text-white" />
            </div>
            <span className={`text-base font-bold tracking-tight hidden sm:block ${scrolled ? 'text-[#1a1a1a]' : 'text-white'}`}>Empreendimentos</span>
          </a>

          <div className="flex items-center gap-3">
            <button
              onClick={handleCopyLink}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors ${
                scrolled ? 'text-[#1a1a1a]/50 hover:text-[#1a1a1a] hover:bg-[#1a1a1a]/[0.04]' : 'text-white/60 hover:text-white hover:bg-white/10'
              }`}
            >
              {copiedLink ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              <span className="hidden sm:inline">{copiedLink ? 'Copiado!' : 'Compartilhar'}</span>
            </button>
            <a
              href="#cadastro"
              className="min-h-[44px] inline-flex items-center justify-center px-5 py-3 rounded-xl bg-[#33492F] text-white text-sm font-semibold hover:bg-[#33492F]/90 transition-colors shadow-lg shadow-[#33492F]/20"
            >
              Quero saber mais
            </a>
          </div>
        </div>
      </nav>

      {/* ── Hero Section ───────────────────────────────── */}
      <section className="relative min-h-[100dvh] min-h-[640px] flex items-end">
        {/* Background image */}
        {heroImage && (
          <div className="absolute inset-0">
            <Image
              src={heroImage}
              alt={e.name}
              fill
              className="object-cover"
              priority
              sizes="100vw"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-black/10" />
          </div>
        )}

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 pb-12 sm:pb-24 pt-28 sm:pt-36 w-full">
          {/* Breadcrumb */}
          <a
            href="/empreendimentos"
            className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors mb-4 sm:mb-6 group"
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
                'bg-[#33492F]/20 text-[#a8c4a0] border-[#33492F]/30'
              }`}>
                <CheckCircle2 className="h-3 w-3" />
                {status}
              </span>
            )}
            {priceText && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-[#C9A96E]/15 text-[#C9A96E] border border-[#C9A96E]/25 max-w-[200px] sm:max-w-none">
                <DollarSign className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{priceText}</span>
              </span>
            )}
            {status === 'Entregue' && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
                <span>Já entregue</span>
              </span>
            )}
            {deliveryText && status !== 'Entregue' && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-white/10 text-white/80 border border-white/20 max-w-[200px] sm:max-w-none">
                <Clock className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">Previsão: {deliveryText}</span>
              </span>
            )}
            {e.region && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-white/10 text-white/70 border border-white/15 max-w-[180px] sm:max-w-none">
                <MapPin className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{e.region}</span>
              </span>
            )}
            {showUrgencyBadge && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-[#C9A96E]/15 text-[#C9A96E] border border-[#C9A96E]/25">
                <Clock className="h-3 w-3 flex-shrink-0" />
                Condições de lançamento
              </span>
            )}
          </div>

          {/* Title */}
          <h1 className="text-3xl sm:text-5xl lg:text-7xl font-bold tracking-tight leading-[1.1] max-w-4xl text-white drop-shadow-lg">
            {displayTitle}
          </h1>

          {/* Subtitle */}
          {displaySubtitle && (
            <p className="mt-3 sm:mt-6 text-base sm:text-xl text-white/70 max-w-2xl leading-relaxed">
              {displaySubtitle}
            </p>
          )}

          {/* Mini-form directly in hero */}
          <div className="mt-6 sm:mt-10 animate-fade-in-up">
            <form
              id="hero-mini-form"
              onSubmit={(ev) => {
                ev.preventDefault();
                try {
                  const heroName = (document.getElementById('hero-name') as HTMLInputElement)?.value?.trim() || '';
                  const heroPhone = (document.getElementById('hero-phone') as HTMLInputElement)?.value?.replace(/\D/g, '') || '';
                  if (heroName.length < 2) {
                    setFormName(heroName);
                    const form = document.getElementById('landing-form') as HTMLFormElement | null;
                    if (form) {
                      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      setTimeout(() => {
                        const nameInput = document.getElementById('form-name') as HTMLInputElement | null;
                        if (nameInput) {
                          nameInput.focus();
                          nameInput.classList.add('ring-2', 'ring-[#33492F]');
                          setTimeout(() => nameInput.classList.remove('ring-2', 'ring-[#33492F]'), 3000);
                        }
                      }, 600);
                    }
                    return;
                  }
                  if (heroPhone.length < 10 && heroPhone.length > 0) return;
                  setFormName(heroName);
                  setFormPhone(heroPhone.length >= 10 ? (document.getElementById('hero-phone') as HTMLInputElement)?.value || '' : '');
                  const form = document.getElementById('landing-form') as HTMLFormElement | null;
                  if (form) {
                    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    setTimeout(() => {
                      const emailInput = document.getElementById('form-email') as HTMLInputElement | null;
                      if (emailInput && !formEmail.trim()) {
                        emailInput.focus();
                        emailInput.classList.add('ring-2', 'ring-[#33492F]');
                        setTimeout(() => emailInput.classList.remove('ring-2', 'ring-[#33492F]'), 3000);
                      }
                    }, 600);
                  }
                } catch {
                  /* defensive — never break page interaction */
                }
              }}
              className="w-full max-w-lg"
            >
              <div className="flex flex-col sm:flex-row gap-2.5">
                <div className="flex-1 relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                  <input
                    id="hero-name"
                    type="text"
                    placeholder="Seu nome"
                    autoComplete="name"
                    required
                    className="lp-input-mobile w-full min-h-[44px] pl-10 pr-4 py-3.5 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[#33492F]/50 focus:ring-1 focus:ring-[#33492F]/20 transition-all"
                  />
                </div>
                <div className="flex-1 relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                  <input
                    id="hero-phone"
                    type="tel"
                    inputMode="numeric"
                    placeholder="(11) 99999-9999"
                    autoComplete="tel"
                    required
                    onChange={(ev) => {
                      const digits = ev.target.value.replace(/\D/g, '').slice(0, 11);
                      let masked = '';
                      if (digits.length > 0) masked += `(${digits.slice(0, 2)}`;
                      if (digits.length > 2) masked += `) ${digits.slice(2, 7)}`;
                      if (digits.length > 7) masked += `-${digits.slice(7)}`;
                      ev.target.value = masked;
                    }}
                    className="lp-input-mobile w-full min-h-[44px] pl-10 pr-4 py-3.5 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[#33492F]/50 focus:ring-1 focus:ring-[#33492F]/20 transition-all"
                  />
                </div>
                <button
                  type="submit"
                  className="flex-shrink-0 min-h-[44px] flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-[#33492F] text-white font-bold text-sm hover:bg-[#33492F]/90 transition-all shadow-lg shadow-[#33492F]/25 hover:shadow-[#33492F]/40 active:scale-[0.98]"
                >
                  <Send className="h-4 w-4" />
                  <span className="sm:hidden">Saber mais</span>
                  <span className="hidden sm:inline">Quero saber mais</span>
                </button>
              </div>
              <p className="text-[11px] text-white/30 mt-2 text-center sm:text-left">Sem compromisso · Resposta em até 24h</p>
            </form>
          </div>

          {/* Secondary CTAs */}
          <div className="mt-3 flex flex-wrap items-center gap-3 sm:gap-4">
            <a
              href="#cadastro"
              className="min-h-[44px] inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white/[0.08] border border-white/[0.15] text-white font-medium text-xs sm:text-sm hover:bg-white/[0.15] hover:border-white/[0.25] transition-all backdrop-blur-sm"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Ver mais detalhes
            </a>
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                try {
                  registerWhatsAppClick('hero');
                  if (typeof window !== 'undefined' && window.CRMPIXEL) {
                    window.CRMPIXEL.track('whatsapp_click', { enterprise: e.name, source: 'hero', userId: queueUser?.userId });
                  }
                  trackMetaPixel('Contact', {
                    content_name: e.name,
                    content_category: 'empreendimento',
                  });
                } catch {
                  /* tracking errors must never block navigation */
                }
              }}
              className="min-h-[44px] inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white/[0.08] border border-white/[0.15] text-white font-medium text-xs sm:text-sm hover:bg-white/[0.15] hover:border-white/[0.25] transition-all backdrop-blur-sm"
            >
              <Phone className="h-3.5 w-3.5" />
              Falar com consultor
            </a>
            {e._count && e._count.clients > 0 ? (
              <div className="animate-fade-in-up flex items-center gap-2 text-xs text-white/40" style={{ animationDelay: '0.2s' }}>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#33492F] opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#33492F]" />
                </span>
                {showRealCount ? (
                  <>
                    <span className="font-medium">{clientCount} pessoa{clientCount !== 1 ? 's' : ''}</span> já cadastrada{clientCount !== 1 ? 's' : ''} — não fique de fora
                  </>
                ) : (
                  <>
                    <span className="font-medium">Pessoas estão demonstrando interesse</span> — garanta sua vaga
                  </>
                )}
              </div>
            ) : (
              <div className="animate-fade-in-up flex items-center gap-2 text-xs text-white/40" style={{ animationDelay: '0.2s' }}>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#33492F] opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#33492F]" />
                </span>
                <span>{socialProofPool[socialProofIdx]?.name} {socialProofPool[socialProofIdx]?.action.toLowerCase()} há {socialProofPool[socialProofIdx]?.time}</span>
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

      {/* ── Quick-Access Gallery Teaser ── */}
      {images.length > 0 && (
        <section className="bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1a1a1a]">Conheça o empreendimento</h2>
                <p className="text-sm text-[#1a1a1a]/50 mt-1">Veja as imagens, plantas e detalhes</p>
              </div>
              <a
                href="#galeria"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[#33492F] hover:text-[#33492F]/80 transition-colors group"
              >
                Ver galeria
                <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </a>
            </div>
            {/* Thumbnail strip */}
            <div className="mobile-scroll-x flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 sm:overflow-visible sm:grid sm:grid-cols-4 lg:grid-cols-5">
              {images.slice(0, 5).map((img, idx) => (
                <a
                  key={img.id}
                  href="#galeria"
                  onClick={() => { setActiveImgIdx(idx); }}
                  className="relative flex-shrink-0 w-40 sm:w-full aspect-[4/3] rounded-2xl overflow-hidden group shadow-sm hover:shadow-md transition-shadow bg-gray-100"
                >
                  <img
                    src={img.url}
                    alt={img.altText || `${e.name} - Imagem ${idx + 1}`}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                    loading={idx === 0 ? 'eager' : 'lazy'}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <ZoomIn className="h-5 w-5 text-white" />
                  </div>
                </a>
              ))}
            </div>
            {/* Inline CTA */}
            <div className="mt-6 flex items-center justify-between rounded-2xl bg-[#33492F]/[0.04] border border-[#33492F]/10 px-5 py-4">
              <p className="text-sm text-[#1a1a1a]/50">
                <span className="text-[#1a1a1a]/70 font-medium">Quer ver valores e plantas?</span> Solicite informações gratuitas.
              </p>
              <a
                href="#cadastro"
                className="flex-shrink-0 inline-flex items-center gap-1.5 text-sm font-semibold text-[#33492F] hover:text-[#33492F]/80 transition-colors ml-3"
              >
                Solicitar
                <ChevronRight className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </section>
      )}

      {/* ── Numbers / Stats Section ───────────────────── */}
      <ScrollReveal>
        {(info?.totalUnits || areaRange || deliveryText) ? (
          <section className="bg-[#F7F6F3]">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-12">
                {info?.totalUnits != null && info.totalUnits > 0 && (
                  <div className="text-center">
                    <p className="text-5xl sm:text-6xl font-bold text-[#33492F]">{info.totalUnits}</p>
                    <p className="text-sm text-[#1a1a1a]/50 mt-2">Unidades</p>
                  </div>
                )}
                {areaRange && (
                  <div className="text-center">
                    <p className="text-4xl sm:text-5xl font-bold text-[#33492F]">{areaRange}</p>
                    <p className="text-sm text-[#1a1a1a]/50 mt-2">Metragem</p>
                  </div>
                )}
                {deliveryText && (
                  <div className="text-center">
                    <p className="text-2xl sm:text-3xl font-bold text-[#33492F]">{deliveryText}</p>
                    <p className="text-sm text-[#1a1a1a]/50 mt-2">Previsão de Entrega</p>
                  </div>
                )}
              </div>
            </div>
          </section>
        ) : null}
      </ScrollReveal>

      {/* ── Gallery Section ────────────────────────────── */}
      <ScrollReveal>
        {images.length > 0 && (
          <section id="galeria" className="bg-white">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-24">
              {/* Section header */}
              <div className="flex items-center gap-4 mb-8 sm:mb-12">
                <div className="h-px flex-1 bg-[#1a1a1a]/[0.08]" />
                <div className="text-center">
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1a1a1a]">Galeria</h2>
                  <p className="text-sm text-[#1a1a1a]/40 mt-1">{images.length} foto{images.length !== 1 ? 's' : ''} do empreendimento</p>
                </div>
                {images.length > 1 ? (
                  <div className="flex items-center gap-2">
                    <button onClick={goPrev} className="h-11 w-11 rounded-full border border-[#1a1a1a]/[0.12] flex items-center justify-center hover:border-[#33492F]/40 hover:bg-[#33492F]/[0.06] transition-all text-[#1a1a1a]/60">
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button onClick={goNext} className="h-11 w-11 rounded-full border border-[#1a1a1a]/[0.12] flex items-center justify-center hover:border-[#33492F]/40 hover:bg-[#33492F]/[0.06] transition-all text-[#1a1a1a]/60">
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </div>
                ) : (
                  <div className="h-px flex-1 bg-[#1a1a1a]/[0.08]" />
                )}
              </div>

              {/* Main image */}
              <div
                className="relative aspect-[3/2] sm:aspect-[16/9] rounded-2xl overflow-hidden bg-gray-100 cursor-pointer group shadow-sm"
                onClick={() => {
                  if (typeof window !== 'undefined' && window.CRMPIXEL) window.CRMPIXEL.trackGalleryClick(activeImgIdx, images.length);
                  setLightboxOpen(true);
                }}
              >
                <Image
                  src={images[activeImgIdx]?.url || heroImage || ''}
                  alt={images[activeImgIdx]?.altText || e.name}
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 80vw, 960px"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-black/5 pointer-events-none" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors" />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="bg-white/80 backdrop-blur-sm rounded-full p-4 shadow-lg">
                    <ZoomIn className="h-6 w-6 text-[#1a1a1a]" />
                  </div>
                </div>
                {images.length > 1 && (
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/80 backdrop-blur-sm text-[#1a1a1a] text-xs px-4 py-2 rounded-full shadow-sm">
                    {activeImgIdx + 1} / {images.length}
                  </div>
                )}
              </div>

              {/* Thumbnails */}
              {images.length > 1 && (
                <div className="mobile-scroll-x flex gap-3 mt-4 overflow-x-auto pb-2">
                  {images.map((img, idx) => (
                    <button
                      key={img.id}
                      onClick={() => {
                        if (typeof window !== 'undefined' && window.CRMPIXEL) window.CRMPIXEL.trackGalleryClick(idx, images.length);
                        setActiveImgIdx(idx);
                      }}
                      className={`relative flex-shrink-0 w-20 h-14 sm:w-28 sm:h-20 rounded-xl overflow-hidden border-2 transition-all ${
                        idx === activeImgIdx
                          ? 'border-[#33492F] ring-2 ring-[#33492F]/20'
                          : 'border-transparent opacity-50 hover:opacity-80'
                      }`}
                    >
                      <Image src={img.url} alt={img.altText || ''} fill className="object-cover" sizes="112px" />
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
        <section className="bg-[#F7F6F3]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-24">
            {/* Section header */}
            <div className="text-center mb-10 sm:mb-14">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#1a1a1a]">Ficha Técnica</h2>
              <p className="text-sm text-[#1a1a1a]/50 mt-2">Dados oficiais do {e.name}</p>
            </div>

            {/* Spec grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
              {/* Status */}
              <div className="relative group rounded-2xl bg-white border border-[#1a1a1a]/[0.06] p-5 sm:p-6 hover:border-[#33492F]/20 hover:shadow-sm transition-all min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                      status === 'Lançamento' ? 'bg-emerald-50' : status === 'Em Construção' ? 'bg-amber-50' : status === 'Entregue' ? 'bg-blue-50' : 'bg-gray-50'
                    }`}>
                      <Clock className={`h-4 w-4 ${status === 'Lançamento' ? 'text-emerald-600' : status === 'Em Construção' ? 'text-amber-600' : status === 'Entregue' ? 'text-blue-600' : 'text-gray-400'}`} />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-[#1a1a1a]/30 font-medium">Status</span>
                  </div>
                  <p className={`text-sm font-semibold ${status === 'Lançamento' ? 'text-emerald-700' : status === 'Em Construção' ? 'text-amber-700' : status === 'Entregue' ? 'text-blue-700' : 'text-[#1a1a1a]/40'}`}>{status || 'A definir'}</p>
                </div>

              {/* Construtora */}
              <div className="relative group rounded-2xl bg-white border border-[#1a1a1a]/[0.06] p-5 sm:p-6 hover:border-[#33492F]/20 hover:shadow-sm transition-all min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-orange-50 flex items-center justify-center">
                      <HardHat className="h-4 w-4 text-orange-600" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-[#1a1a1a]/30 font-medium">Construtora</span>
                  </div>
                  <p className="text-sm font-semibold text-[#1a1a1a]/85 leading-snug truncate" title={info?.builder?.split('(')[0].trim() || ''}>{info?.builder?.split('(')[0].trim() || '—'}</p>
                </div>

              {/* Localização */}
              <div className="relative group rounded-2xl bg-white border border-[#1a1a1a]/[0.06] p-5 sm:p-6 hover:border-[#33492F]/20 hover:shadow-sm transition-all min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center">
                      <MapPin className="h-4 w-4 text-blue-600" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-[#1a1a1a]/30 font-medium">Localização</span>
                  </div>
                  <p className="text-sm font-semibold text-[#1a1a1a]/85 leading-snug truncate" title={([info?.location?.neighborhood, info?.location?.city].filter(Boolean).join(', ')) || ''}>
                    {[info?.location?.neighborhood, info?.location?.city].filter(Boolean).join(', ') || '—'}
                  </p>
                </div>

              {/* Tipos de Unidade */}
              <div className="relative group rounded-2xl bg-white border border-[#1a1a1a]/[0.06] p-5 sm:p-6 hover:border-[#33492F]/20 hover:shadow-sm transition-all min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-violet-50 flex items-center justify-center">
                      <Building2 className="h-4 w-4 text-violet-600" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-[#1a1a1a]/30 font-medium">Plantas</span>
                  </div>
                  <p className="text-sm font-semibold text-[#1a1a1a]/85">{(info?.apartmentTypes?.length || 0) > 0 ? `${info?.apartmentTypes.length} tipo${(info?.apartmentTypes.length ?? 0) > 1 ? 's' : ''} de unidade` : 'Consulte'}</p>
                  {areaRange && <p className="text-xs text-[#1a1a1a]/40 mt-1">{areaRange}</p>}
                </div>

              {/* Arquitetura */}
              {info?.architecture && (
                <div className="relative group rounded-2xl bg-white border border-[#1a1a1a]/[0.06] p-5 sm:p-6 hover:border-[#33492F]/20 hover:shadow-sm transition-all min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-violet-50 flex items-center justify-center">
                      <Palette className="h-4 w-4 text-violet-600" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-[#1a1a1a]/30 font-medium">Arquitetura</span>
                  </div>
                  <p className="text-sm font-semibold text-[#1a1a1a]/85 leading-snug line-clamp-2">{info.architecture}</p>
                </div>
              )}

              {/* Paisagismo */}
              {info?.landscaping && (
                <div className="relative group rounded-2xl bg-white border border-[#1a1a1a]/[0.06] p-5 sm:p-6 hover:border-[#33492F]/20 hover:shadow-sm transition-all min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                      <Sparkles className="h-4 w-4 text-emerald-600" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-[#1a1a1a]/30 font-medium">Paisagismo</span>
                  </div>
                  <p className="text-sm font-semibold text-[#1a1a1a]/85 leading-snug line-clamp-2">{info.landscaping}</p>
                </div>
              )}

              {/* Preço */}
              <div className="relative group rounded-2xl bg-white border border-[#1a1a1a]/[0.06] p-5 sm:p-6 hover:border-[#33492F]/20 hover:shadow-sm transition-all min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-[#C9A96E]/10 flex items-center justify-center">
                      <DollarSign className="h-4 w-4 text-[#C9A96E]" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-[#1a1a1a]/30 font-medium">Investimento</span>
                  </div>
                  <p className="text-sm font-bold text-[#33492F]">{priceText || 'Consulte valores'}</p>
                </div>

              {/* Previsão de Entrega */}
              <div className={`relative group rounded-2xl border p-5 hover:border-[#33492F]/20 hover:shadow-sm transition-all min-w-0 ${status === 'Entregue' ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-[#1a1a1a]/[0.06]'}`}>
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${status === 'Entregue' ? 'bg-emerald-100' : 'bg-amber-50'}`}>
                      {status === 'Entregue'
                        ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        : <CalendarDays className="h-4 w-4 text-amber-600" />
                      }
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-[#1a1a1a]/30 font-medium">Entrega</span>
                  </div>
                  <p className={`text-sm font-semibold ${status === 'Entregue' ? 'text-emerald-700' : 'text-[#1a1a1a]/85'}`}>{deliveryText || 'A definir'}</p>
                </div>

              {/* Unidades */}
              {info?.totalUnits != null && info.totalUnits > 0 && (
                <div className="relative group rounded-2xl bg-white border border-[#1a1a1a]/[0.06] p-5 sm:p-6 hover:border-[#33492F]/20 hover:shadow-sm transition-all min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-cyan-50 flex items-center justify-center">
                      <Users className="h-4 w-4 text-cyan-600" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-[#1a1a1a]/30 font-medium">Unidades</span>
                  </div>
                  <p className="text-sm font-semibold text-[#1a1a1a]/85">{info.totalUnits} {info.totalUnits === 1 ? 'unidade' : 'unidades'}</p>
                </div>
              )}

              {/* Pavimentos */}
              {info?.floors != null && info.floors > 0 && (
                <div className="relative group rounded-2xl bg-white border border-[#1a1a1a]/[0.06] p-5 sm:p-6 hover:border-[#33492F]/20 hover:shadow-sm transition-all min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                      <Layers className="h-4 w-4 text-indigo-600" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-[#1a1a1a]/30 font-medium">Pavimentos</span>
                  </div>
                  <p className="text-sm font-semibold text-[#1a1a1a]/85">{info.floors} {info.floors === 1 ? 'pavimento' : 'pavimentos'}</p>
                </div>
              )}

              {/* Vagas */}
              {info?.parkingSpots != null && info.parkingSpots > 0 && (
                <div className="relative group rounded-2xl bg-white border border-[#1a1a1a]/[0.06] p-5 sm:p-6 hover:border-[#33492F]/20 hover:shadow-sm transition-all min-w-0">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-teal-50 flex items-center justify-center">
                      <Car className="h-4 w-4 text-teal-600" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-[#1a1a1a]/30 font-medium">Vagas</span>
                  </div>
                  <p className="text-sm font-semibold text-[#1a1a1a]/85">{info.parkingSpots} {info.parkingSpots === 1 ? 'vaga' : 'vagas'}</p>
                </div>
              )}

              {/* Endereço */}
              <div className="relative group rounded-2xl bg-white border border-[#1a1a1a]/[0.06] p-5 sm:p-6 hover:border-[#33492F]/20 hover:shadow-sm transition-all min-w-0 sm:col-span-2 lg:col-span-2">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center">
                      <Navigation className="h-4 w-4 text-blue-600" />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-[#1a1a1a]/30 font-medium">Endereço</span>
                  </div>
                  <p className="text-sm font-semibold text-[#1a1a1a]/85 leading-snug line-clamp-2">{info?.location?.address || '—'}</p>
                  {info?.location?.additionalInfo && (
                    <p className="text-xs text-[#1a1a1a]/40 mt-1">{info.location.additionalInfo}</p>
                  )}
                </div>
            </div>
          </div>
        </section>
      </ScrollReveal>

      {/* ── Details Section ────────────────────────────── */}
      <ScrollReveal>
          <section className="bg-white">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-24">
              {/* Section header */}
              <div className="text-center mb-10 sm:mb-14">
                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#1a1a1a]">Detalhes do Empreendimento</h2>
              </div>

              {/* Summary */}
              {info?.summary ? (
                <div className="mb-10 sm:mb-14">
                  <div className="relative overflow-hidden rounded-2xl bg-[#33492F]/[0.04] border border-[#33492F]/10 p-6 sm:p-8 lg:p-12">
                    <div className="relative">
                      <div className="flex items-center gap-2.5 mb-4">
                        <div className="h-1.5 w-8 rounded-full bg-[#33492F]" />
                        <span className="text-xs font-semibold text-[#33492F] uppercase tracking-widest">Sobre o empreendimento</span>
                      </div>
                      <p className="text-sm sm:text-[15px] text-[#1a1a1a]/80 leading-[1.8] max-w-5xl">{info.summary}</p>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Info blocks */}
              <div className="space-y-4 sm:space-y-5">

                {/* Location */}
                <div className="group rounded-2xl bg-[#F7F6F3] border border-[#1a1a1a]/[0.04] hover:border-[#33492F]/15 transition-all duration-300 overflow-hidden">
                    <div className="flex items-stretch">
                      <div className="flex-shrink-0 w-12 sm:w-14 bg-blue-50 flex items-center justify-center">
                        <div className="h-9 w-9 rounded-xl bg-blue-100 flex items-center justify-center">
                          <Navigation className="h-4 w-4 text-blue-600" />
                        </div>
                      </div>
                      <div className="flex-1 p-5 sm:p-6">
                        <h3 className="text-sm font-semibold text-[#1a1a1a]/90 mb-3 sm:mb-4 tracking-wide">Localização</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
                          <div>
                            <p className="text-[11px] uppercase tracking-wider text-[#1a1a1a]/30 mb-1">Endereço</p>
                            <p className="text-sm text-[#1a1a1a]/70 leading-relaxed">{info?.location?.address || 'Consulte o endereço completo'}</p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-wider text-[#1a1a1a]/30 mb-1">Região</p>
                            <p className="text-sm text-[#1a1a1a]/70 leading-relaxed">
                              {[info?.location?.neighborhood, info?.location?.city, info?.location?.state].filter(Boolean).join(', ') || e.region || '—'}
                            </p>
                          </div>
                          {info?.location?.additionalInfo && (
                            <div className="sm:col-span-2">
                              <p className="text-[11px] uppercase tracking-wider text-[#1a1a1a]/30 mb-1">Referências</p>
                              <p className="text-sm text-[#1a1a1a]/50 leading-relaxed">{info.location.additionalInfo}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                {/* Builder */}
                {info?.builder && (
                <div className="group rounded-2xl bg-[#F7F6F3] border border-[#1a1a1a]/[0.04] hover:border-[#33492F]/15 transition-all duration-300 overflow-hidden">
                    <div className="flex items-stretch">
                      <div className="flex-shrink-0 w-12 sm:w-14 bg-orange-50 flex items-center justify-center">
                        <div className="h-9 w-9 rounded-xl bg-orange-100 flex items-center justify-center">
                          <HardHat className="h-4 w-4 text-orange-600" />
                        </div>
                      </div>
                      <div className="flex-1 p-5 sm:p-6">
                        <h3 className="text-sm font-semibold text-[#1a1a1a]/90 mb-3 sm:mb-4 tracking-wide">Construtora</h3>
                        <p className="text-sm sm:text-[15px] text-[#1a1a1a]/70 leading-relaxed max-w-3xl">{info.builder}</p>
                      </div>
                    </div>
                  </div>
                  )}

                {/* Architecture / Landscaping */}
                {(info?.architecture || info?.landscaping) && (
                <div className="group rounded-2xl bg-[#F7F6F3] border border-[#1a1a1a]/[0.04] hover:border-[#33492F]/15 transition-all duration-300 overflow-hidden">
                    <div className="flex items-stretch">
                      <div className="flex-shrink-0 w-12 sm:w-14 bg-violet-50 flex items-center justify-center">
                        <div className="h-9 w-9 rounded-xl bg-violet-100 flex items-center justify-center">
                          <Palette className="h-4 w-4 text-violet-600" />
                        </div>
                      </div>
                      <div className="flex-1 p-5 sm:p-6">
                        <h3 className="text-sm font-semibold text-[#1a1a1a]/90 mb-3 sm:mb-4 tracking-wide">Projeto</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
                          {info?.architecture && (
                          <div>
                            <p className="text-[11px] uppercase tracking-wider text-[#1a1a1a]/30 mb-1">Arquitetura</p>
                            <p className="text-sm text-[#1a1a1a]/70 leading-relaxed">{info.architecture}</p>
                          </div>
                          )}
                          {info?.landscaping && (
                          <div>
                            <p className="text-[11px] uppercase tracking-wider text-[#1a1a1a]/30 mb-1">Paisagismo</p>
                            <p className="text-sm text-[#1a1a1a]/70 leading-relaxed">{info.landscaping}</p>
                          </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  )}

              </div>

              {/* Apartment Types */}
              {info?.apartmentTypes && info.apartmentTypes.length > 0 && (
              <div className="mt-10 sm:mt-14">
                  <div className="flex items-center gap-3 mb-6 sm:mb-8">
                    <div className="h-9 w-9 rounded-xl bg-emerald-50 flex items-center justify-center">
                      <Building2 className="h-4 w-4 text-emerald-600" />
                    </div>
                    <h3 className="text-lg sm:text-xl font-semibold text-[#1a1a1a]">Tipos de Unidades</h3>
                    <span className="text-xs text-[#1a1a1a]/25 font-medium ml-auto">{(info?.apartmentTypes?.length || 0)} tipo{(info?.apartmentTypes?.length || 0) !== 1 ? 's' : ''} disponíve{(info?.apartmentTypes?.length || 0) !== 1 ? 'is' : 'l'}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {(info?.apartmentTypes || []).map((apt, idx) => {
                      const priceInDesc = apt.description?.match(/R\$[\d.,]+/);
                      return (
                        <div
                          key={idx}
                          className="group rounded-2xl bg-[#F7F6F3] border border-[#1a1a1a]/[0.04] hover:border-[#33492F]/20 hover:shadow-sm hover:scale-[1.01] transition-all duration-300 overflow-hidden"
                        >
                          <div className="h-0.5 bg-gradient-to-r from-[#33492F]/40 to-transparent" />
                          <div className="p-5 sm:p-6">
                            <div className="flex items-start justify-between gap-3 mb-4">
                              <h4 className="text-sm font-semibold text-[#1a1a1a]/90 leading-tight">{apt.name}</h4>
                              {priceInDesc && (
                                <span className="text-xs font-bold text-[#C9A96E] whitespace-nowrap flex-shrink-0 bg-[#C9A96E]/10 px-2.5 py-1 rounded-lg">
                                  {priceInDesc[0]}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-5 text-xs text-[#1a1a1a]/50 mb-2">
                              {apt.area && (
                                <span className="flex items-center gap-1.5">
                                  <Ruler className="h-3.5 w-3.5 text-[#33492F]/50" />{apt.area}
                                </span>
                              )}
                              {apt.bedrooms && (
                                <span className="flex items-center gap-1.5">
                                  <BedDouble className="h-3.5 w-3.5 text-[#33492F]/50" />{apt.bedrooms}
                                </span>
                              )}
                            </div>
                            {apt.description && (
                              <p className="text-xs text-[#1a1a1a]/40 mt-3 leading-relaxed">{apt.description}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Floor Plans */}
              {e.floorPlans && e.floorPlans.length > 0 && (
              <div className="mt-10 sm:mt-14">
                  <div className="flex items-center gap-3 mb-6 sm:mb-8">
                      <div className="h-9 w-9 rounded-xl bg-blue-50 flex items-center justify-center">
                        <LayoutGrid className="h-4 w-4 text-blue-600" />
                      </div>
                      <h3 className="text-lg sm:text-xl font-semibold text-[#1a1a1a]">Plantas das Unidades</h3>
                      <span className="text-xs text-[#1a1a1a]/25 font-medium">{e.floorPlans.length} planta{e.floorPlans.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                    {e.floorPlans.map((plan, idx) => (
                      <button
                        key={plan.id}
                        onClick={() => { setActiveFloorIdx(idx); setFloorLightboxOpen(true); }}
                        className="group relative rounded-2xl bg-[#F7F6F3] border border-[#1a1a1a]/[0.04] hover:border-[#33492F]/20 hover:shadow-sm transition-all duration-300 overflow-hidden cursor-pointer"
                      >
                        <div className="aspect-[4/3] bg-white flex items-center justify-center p-3">
                          <img
                            src={plan.url}
                            alt={plan.altText || `Planta ${idx + 1}`}
                            className="w-full h-full object-contain"
                          />
                        </div>
                        {plan.altText && (
                          <div className="px-3 py-2 border-t border-[#1a1a1a]/[0.04]">
                            <p className="text-[11px] sm:text-xs text-[#1a1a1a]/50 leading-tight line-clamp-2">{plan.altText}</p>
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-3">
                          <span className="text-[10px] text-white bg-black/40 backdrop-blur-sm px-2 py-0.5 rounded-full">Visualizar</span>
                        </div>
                      </button>
                    ))}
                  </div>

                </div>
              )}

              {/* Differentials — Tabbed Categories */}
              {diffCategories.length > 0 && (
              <div className="mt-10 sm:mt-14">
                  <div className="flex items-center gap-3 mb-3 sm:mb-4">
                    <div className="h-9 w-9 rounded-xl bg-[#33492F]/10 flex items-center justify-center">
                      <Sparkles className="h-4 w-4 text-[#33492F]" />
                    </div>
                    <h3 className="text-lg sm:text-xl font-semibold text-[#1a1a1a]">Diferenciais pensados para cada fase da sua vida</h3>
                  </div>
                  <p className="text-sm text-[#1a1a1a]/40 mb-6 sm:mb-8">Conheça tudo que o {e.name} tem a oferecer</p>

                  {/* Tab buttons */}
                  {diffCategories.length > 1 && (
                    <div className="mobile-scroll-x flex gap-2 mb-8 overflow-x-auto pb-1">
                      {diffCategories.map((cat, i) => (
                        <button
                          key={i}
                          onClick={() => setActiveDiffTab(i)}
                          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                            activeDiffTab === i
                              ? 'bg-[#33492F] text-white shadow-sm'
                              : 'bg-[#F7F6F3] text-[#1a1a1a]/60 hover:bg-[#F7F6F3] hover:text-[#1a1a1a]/80 border border-[#1a1a1a]/[0.06]'
                          }`}
                        >
                          {diffIconMap[cat.icon]}
                          {cat.name}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                            activeDiffTab === i ? 'bg-white/20' : 'bg-[#1a1a1a]/[0.06]'
                          }`}>{cat.items.length}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Tab content */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {(diffCategories[activeDiffTab]?.items || []).map((d, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-3 px-5 sm:px-6 py-4 rounded-xl bg-[#F7F6F3] border border-[#1a1a1a]/[0.04] hover:border-[#33492F]/20 transition-colors min-w-0"
                      >
                        <CheckCircle2 className="h-4 w-4 text-[#33492F] flex-shrink-0 mt-0.5" />
                        <span className="text-sm text-[#1a1a1a]/70 leading-relaxed min-w-0">{d}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Fallback: simple differentials list (if categorization returns empty) */}
              {diffCategories.length === 0 && info?.differentials && info.differentials.length > 0 && (
              <div className="mt-10 sm:mt-14">
                  <div className="flex items-center gap-3 mb-6 sm:mb-8">
                    <div className="h-9 w-9 rounded-xl bg-[#C9A96E]/10 flex items-center justify-center">
                      <Sparkles className="h-4 w-4 text-[#C9A96E]" />
                    </div>
                    <h3 className="text-lg sm:text-xl font-semibold text-[#1a1a1a]">Diferenciais</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(info?.differentials || []).map((d, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-3 px-5 sm:px-6 py-4 rounded-xl bg-[#F7F6F3] border border-[#1a1a1a]/[0.04] hover:border-[#33492F]/20 transition-colors min-w-0"
                      >
                        <CheckCircle2 className="h-4 w-4 text-[#33492F] flex-shrink-0" />
                        <span className="text-sm text-[#1a1a1a]/70 leading-relaxed min-w-0">{d}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
      </ScrollReveal>

      {/* ── Por que o {e.name}? ──────────────────────────── */}
      <ScrollReveal>
        <section className="bg-[#F7F6F3]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-24">
            {/* Section header */}
            <div className="text-center mb-10 sm:mb-14">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#1a1a1a]">Por que o {e.name}?</h2>
              <p className="text-sm text-[#1a1a1a]/50 mt-2">Destaques que fazem a diferença</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
              {/* Card 1 — Localização Privilegiada */}
              <div className="group relative rounded-2xl bg-white border border-[#1a1a1a]/[0.04] hover:border-[#33492F]/20 hover:shadow-sm transition-all duration-300 overflow-hidden p-6 sm:p-7">
                <div className="h-0.5 w-12 bg-gradient-to-r from-blue-400 to-transparent mb-5 rounded-full" />
                <div className="h-10 w-10 rounded-xl bg-blue-50 flex items-center justify-center mb-4">
                  <MapPin className="h-5 w-5 text-blue-600" />
                </div>
                <h3 className="text-base font-semibold text-[#1a1a1a] mb-2">Localização Privilegiada</h3>
                <p className="text-sm text-[#1a1a1a]/50 leading-relaxed">
                  {[info?.location?.neighborhood, info?.location?.city].filter(Boolean).join(', ') || e.region || 'Região estratégica'} com excelente infraestrutura, comércio, transporte e serviços ao seu redor.
                </p>
              </div>

              {/* Card 2 — Qualidade de Construção */}
              <div className="group relative rounded-2xl bg-white border border-[#1a1a1a]/[0.04] hover:border-[#33492F]/20 hover:shadow-sm transition-all duration-300 overflow-hidden p-6 sm:p-7">
                <div className="h-0.5 w-12 bg-gradient-to-r from-orange-400 to-transparent mb-5 rounded-full" />
                <div className="h-10 w-10 rounded-xl bg-orange-50 flex items-center justify-center mb-4">
                  <HardHat className="h-5 w-5 text-orange-600" />
                </div>
                <h3 className="text-base font-semibold text-[#1a1a1a] mb-2">Construtora Reconhecida</h3>
                <p className="text-sm text-[#1a1a1a]/50 leading-relaxed">
                  {info?.builder?.split('(')[0].trim() || 'Construtora de renome'}, com histórico comprovado de entregas e compromisso com a qualidade em cada detalhe.
                </p>
              </div>

              {/* Card 3 — Diferenciais Exclusivos */}
              <div className="group relative rounded-2xl bg-white border border-[#1a1a1a]/[0.04] hover:border-[#33492F]/20 hover:shadow-sm transition-all duration-300 overflow-hidden p-6 sm:p-7">
                <div className="h-0.5 w-12 bg-gradient-to-r from-[#33492F] to-transparent mb-5 rounded-full" />
                <div className="h-10 w-10 rounded-xl bg-[#33492F]/10 flex items-center justify-center mb-4">
                  <Sparkles className="h-5 w-5 text-[#33492F]" />
                </div>
                <h3 className="text-base font-semibold text-[#1a1a1a] mb-2">Diferenciais Exclusivos</h3>
                <p className="text-sm text-[#1a1a1a]/50 leading-relaxed">
                  {(info?.differentials && info.differentials.length > 0)
                    ? info.differentials.slice(0, 3).join(', ') + (info.differentials.length > 3 ? ' e muito mais.' : '.')
                    : 'Lazer completo, segurança 24h e acabamentos de alto padrão para o seu conforto.'}
                </p>
              </div>

              {/* Card 4 — Oportunidade de Investimento */}
              <div className="group relative rounded-2xl bg-white border border-[#1a1a1a]/[0.04] hover:border-[#33492F]/20 hover:shadow-sm transition-all duration-300 overflow-hidden p-6 sm:p-7">
                <div className="h-0.5 w-12 bg-gradient-to-r from-emerald-400 to-transparent mb-5 rounded-full" />
                <div className="h-10 w-10 rounded-xl bg-emerald-50 flex items-center justify-center mb-4">
                  <TrendingUp className="h-5 w-5 text-emerald-600" />
                </div>
                <h3 className="text-base font-semibold text-[#1a1a1a] mb-2">Oportunidade de Investimento</h3>
                <p className="text-sm text-[#1a1a1a]/50 leading-relaxed">
                  {priceText
                    ? `${priceText} em uma região com alta valorização imobiliária.`
                    : 'Valores acessíveis e condições especiais em uma região com forte valorização imobiliária.'}
                </p>
              </div>

              {/* Card 5 — Atendimento Personalizado */}
              <div className="group relative rounded-2xl bg-white border border-[#1a1a1a]/[0.04] hover:border-[#33492F]/20 hover:shadow-sm transition-all duration-300 overflow-hidden p-6 sm:p-7">
                <div className="h-0.5 w-12 bg-gradient-to-r from-purple-400 to-transparent mb-5 rounded-full" />
                <div className="h-10 w-10 rounded-xl bg-purple-50 flex items-center justify-center mb-4">
                  <Shield className="h-5 w-5 text-purple-600" />
                </div>
                <h3 className="text-base font-semibold text-[#1a1a1a] mb-2">Atendimento Exclusivo</h3>
                <p className="text-sm text-[#1a1a1a]/50 leading-relaxed">
                  {e._count && e._count.clients > 0
                    ? `${e._count.clients} pessoa${e._count.clients !== 1 ? 's' : ''} já solicitaram informações. Preencha o formulário e receba atendimento individualizado.`
                    : 'Consultoria dedicada para acompanhar cada etapa, da simulação até a entrega das chaves.'}
                </p>
              </div>
            </div>
          </div>
        </section>
      </ScrollReveal>

      {/* ── Fallback: Landing Description ──────────────── */}
      {!hasInfo && e.landingDescription && (
        <section className="bg-white">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-24">
            {e.landingTitle && (
              <h2 className="text-2xl sm:text-3xl font-bold mb-4 text-[#1a1a1a]">{e.landingTitle}</h2>
            )}
            {e.landingSubtitle && (
              <p className="text-lg text-[#33492F] mb-6">{e.landingSubtitle}</p>
            )}
            <p className="text-base text-[#1a1a1a]/60 leading-relaxed whitespace-pre-wrap">
              {e.landingDescription}
            </p>
          </div>
        </section>
      )}

      {/* ── Location Section (NEW) ─────────────────────── */}
      {info?.location && (info.location.neighborhood || info.location.city) && (
        <ScrollReveal>
          <section className="bg-white">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16 sm:py-24 lg:py-32">
              <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
                <div>
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="h-1.5 w-8 rounded-full bg-[#33492F]" />
                    <span className="text-xs font-semibold text-[#33492F] uppercase tracking-widest">Localização</span>
                  </div>
                  <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-[#1a1a1a] leading-tight">
                    Um novo horizonte em{' '}
                    <span className="text-[#33492F]">{info.location.neighborhood || info.location.city}</span>
                  </h2>
                  <p className="mt-4 sm:mt-6 text-base sm:text-lg text-[#1a1a1a]/60 leading-relaxed max-w-lg">
                    {info.location.additionalInfo
                      ? info.location.additionalInfo
                      : `Viva em uma região privilegiada com excelente infraestrutura, comércio diversificado, transporte público e serviços essenciais ao seu alcance. ${info.location.neighborhood || info.location.city} é um bairro em constante crescimento.`}
                  </p>
                  <div className="mt-6 sm:mt-8 space-y-3">
                    {info.location.address && (
                      <div className="flex items-start gap-3">
                        <Navigation className="h-4 w-4 text-[#33492F] flex-shrink-0 mt-1" />
                        <span className="text-sm text-[#1a1a1a]/70">{info.location.address}{info.location.city ? `, ${info.location.city}` : ''}{info.location.state ? ` - ${info.location.state}` : ''}</span>
                      </div>
                    )}
                    {[info.location.neighborhood, info.location.city, info.location.state].filter(Boolean).length > 0 && (
                      <div className="flex items-start gap-3">
                        <MapPin className="h-4 w-4 text-[#33492F] flex-shrink-0 mt-1" />
                        <span className="text-sm text-[#1a1a1a]/70">{[info.location.neighborhood, info.location.city, info.location.state].filter(Boolean).join(', ')}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="rounded-2xl bg-[#F7F6F3] p-8 sm:p-10">
                  <h3 className="text-lg font-semibold text-[#1a1a1a] mb-4">Vantagens do bairro</h3>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="h-4 w-4 text-[#33492F] flex-shrink-0 mt-0.5" />
                      <span className="text-sm text-[#1a1a1a]/70">Excelente infraestrutura urbana e serviços ao redor</span>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="h-4 w-4 text-[#33492F] flex-shrink-0 mt-0.5" />
                      <span className="text-sm text-[#1a1a1a]/70">Região com alta valorização imobiliária</span>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="h-4 w-4 text-[#33492F] flex-shrink-0 mt-0.5" />
                      <span className="text-sm text-[#1a1a1a]/70">Fácil acesso a transporte público e vias principais</span>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="h-4 w-4 text-[#33492F] flex-shrink-0 mt-0.5" />
                      <span className="text-sm text-[#1a1a1a]/70">Comércio, escolas, hospitais e lazer próximos</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </ScrollReveal>
      )}

      {/* ── Trust / Social Proof Strip ────────────────── */}
      <ScrollReveal>
        <section className="bg-[#33492F]">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-8">
              <div className="flex flex-col items-center gap-2 text-center">
                <Shield className="h-5 w-5 text-white/40" />
                <span className="text-xs sm:text-sm text-white/60 font-medium">Dados Protegidos</span>
              </div>
              <div className="flex flex-col items-center gap-2 text-center">
                <CheckCircle2 className="h-5 w-5 text-white/40" />
                <span className="text-xs sm:text-sm text-white/60 font-medium">Sem Compromisso</span>
              </div>
              <div className="flex flex-col items-center gap-2 text-center">
                <Clock className="h-5 w-5 text-white/40" />
                <span className="text-xs sm:text-sm text-white/60 font-medium">Resposta em até 24h</span>
              </div>
              {showRealCount ? (
                <div className="flex flex-col items-center gap-2 text-center">
                  <Users className="h-5 w-5 text-white/40" />
                  <span className="text-xs sm:text-sm text-white/60 font-medium">{e._count.clients} pessoas interessadas</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-center">
                  <Navigation className="h-5 w-5 text-white/40" />
                  <span className="text-xs sm:text-sm text-white/60 font-medium">Agende uma visita</span>
                </div>
              )}
            </div>
          </div>
        </section>
      </ScrollReveal>

      {/* ── Registration Form Section ───────────────────── */}
      <ScrollReveal>
        <section id="cadastro" className="bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16 sm:py-24 lg:py-32">
            <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-start">
              {/* Left side — Emotional CTA */}
              <div className="order-2 lg:order-1">
                <div className="h-10 w-10 sm:h-14 sm:w-14 rounded-2xl bg-[#33492F]/10 flex items-center justify-center mb-4 sm:mb-6">
                  <MessageSquare className="h-5 w-5 sm:h-7 sm:w-7 text-[#33492F]" />
                </div>
                <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-3 sm:mb-4 text-[#1a1a1a] leading-tight">
                  Vamos conversar sobre o{' '}
                  <span className="text-[#33492F]">seu próximo lar</span>?
                </h2>
                <p className="text-[#33492F]/80 text-sm sm:text-base font-medium mb-2">
                  {showUrgencyBadge ? `${status} — solicite informações e conheça as condições disponíveis.` : priceText ? `A partir de ${priceText.replace('a partir de ', '')} — condições especiais para você.` : 'Condições especiais disponíveis para este empreendimento.'}
                </p>
                <p className="text-[#1a1a1a]/50 max-w-lg text-sm sm:text-base leading-relaxed mb-6 sm:mb-8">
                  {e.landingDescription
                    ? e.landingDescription
                    : `Um novo capítulo começa aqui. Solicite informações e receba atendimento personalizado sobre o ${e.name}${info?.location?.neighborhood ? ` no ${info.location.neighborhood}` : ''}. Sem compromisso.`}
                </p>
                {/* Quick-value bullets */}
                <ul className="space-y-2 mb-6 sm:mb-8">
                  {areaRange && (
                    <li className="flex items-center gap-2 text-sm text-[#1a1a1a]/50">
                      <Ruler className="h-3.5 w-3.5 text-[#33492F]/50" />
                      Unidades de {areaRange}
                    </li>
                  )}
                  {info?.totalUnits && info.totalUnits > 0 && (
                    <li className="flex items-center gap-2 text-sm text-[#1a1a1a]/50">
                      <Building2 className="h-3.5 w-3.5 text-[#33492F]/50" />
                      {info.totalUnits} unidades disponíveis
                    </li>
                  )}
                  {deliveryText && deliveryText !== 'Já entregue' && (
                    <li className="flex items-center gap-2 text-sm text-[#1a1a1a]/50">
                      <CalendarDays className="h-3.5 w-3.5 text-[#33492F]/50" />
                      Previsão de entrega: {deliveryText}
                    </li>
                  )}
                </ul>

                {/* Trust signals */}
                <div className="flex flex-wrap items-center gap-4 mb-6 sm:mb-8 text-sm text-[#1a1a1a]/50">
                  <span className="flex items-center gap-1.5"><Shield className="h-3.5 w-3.5 text-[#33492F]/50" /> Atendimento personalizado</span>
                  <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-[#33492F]/50" /> Resposta em até 24h</span>
                  <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-[#33492F]/50" /> Sem compromisso</span>
                </div>

                {/* WhatsApp */}
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    try {
                      registerWhatsAppClick('form_section');
                      if (typeof window !== 'undefined' && window.CRMPIXEL) {
                        window.CRMPIXEL.track('whatsapp_click', { enterprise: e.name, source: 'form_section', userId: queueUser?.userId });
                      }
                      trackMetaPixel('Contact', { content_name: e.name, content_category: 'empreendimento' });
                    } catch {
                      /* tracking errors must never block navigation */
                    }
                  }}
                  className="min-h-[44px] inline-flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-[#25D366] text-white font-semibold text-sm hover:bg-[#20bd5a] transition-colors shadow-lg shadow-[#25D366]/15"
                >
                  <Phone className="h-4 w-4" />
                  Prefere o WhatsApp? Fale conosco
                </a>
              </div>

              {/* Right side — Form (mobile: shown first via order-1) */}
              <div ref={formSectionRef} className="relative order-1 lg:order-2">
                <div className="absolute -inset-1 sm:-inset-4 bg-[#33492F]/[0.03] rounded-3xl blur-xl" />
                <form
                  id="landing-form"
                  onSubmit={handleFormSubmit}
                  className="relative z-10 rounded-2xl bg-white border border-[#1a1a1a]/[0.08] shadow-lg p-5 sm:p-8 lg:p-10 space-y-4 sm:space-y-5"
                >
                  <div className="mb-2">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-xl font-bold text-[#1a1a1a]">Cadastro</h3>
                      {formProgress > 0 && formProgress < 100 && (
                        <span className="text-xs text-[#33492F]/70 font-medium">{formProgress}% completo</span>
                      )}
                    </div>
                    {/* Progress bar */}
                    {formProgress > 0 && (
                      <div className="h-1 w-full bg-[#1a1a1a]/[0.06] rounded-full overflow-hidden mb-1">
                        <div
                          className="h-full rounded-full transition-all duration-500 ease-out"
                          style={{
                            width: `${formProgress}%`,
                            backgroundColor: formProgress === 100 ? '#25D366' : '#33492F',
                          }}
                        />
                      </div>
                    )}
                    <p className="text-sm text-[#1a1a1a]/40 mt-1">Preencha para receber informações e condições</p>
                  </div>

                  {/* Error */}
                  {formError && (
                    <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-100">
                      <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-red-700">{formError}</p>
                    </div>
                  )}

                  {/* Name */}
                  <div>
                    <label htmlFor="form-name" className="block text-sm font-medium text-[#1a1a1a]/70 mb-2">
                      Nome Completo <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#1a1a1a]/30" />
                      <input
                        id="form-name"
                        type="text"
                        value={formName}
                        onChange={(ev) => { setFormName(ev.target.value); updatePixelFormFields(ev.target.value, formPhone, formEmail, customAnswers); }}
                        onFocus={() => { fieldFocusTime.current.name = Date.now(); if (typeof window !== 'undefined' && window.CRMPIXEL) window.CRMPIXEL.trackFormFocus('name'); }}
                        onBlur={() => { const t = fieldFocusTime.current.name || Date.now(); if (typeof window !== 'undefined' && window.CRMPIXEL) window.CRMPIXEL.trackFormBlur('name', Date.now() - t); }}
                        placeholder="Seu nome completo"
                        autoComplete="name"
                        required
                        className={`lp-input-mobile w-full min-h-[44px] pl-11 pr-10 py-3.5 rounded-xl bg-white border text-sm text-[#1a1a1a] placeholder:text-[#1a1a1a]/30 focus:outline-none focus:ring-1 transition-all ${
                          formName.trim().length >= 2
                            ? 'border-emerald-400 focus:border-emerald-500 focus:ring-emerald-500/20'
                            : 'border-[#1a1a1a]/[0.12] focus:border-[#33492F] focus:ring-[#33492F]/20'
                        }`}
                      />
                      {formName.trim().length >= 2 && (
                        <Check className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-500" />
                      )}
                    </div>
                  </div>

                  {/* Email */}
                  <div>
                    <label htmlFor="form-email" className="block text-sm font-medium text-[#1a1a1a]/70 mb-2">
                      E-mail <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#1a1a1a]/30" />
                      <input
                        id="form-email"
                        type="email"
                        value={formEmail}
                        onChange={(ev) => { setFormEmail(ev.target.value); updatePixelFormFields(formName, formPhone, ev.target.value, customAnswers); }}
                        onFocus={() => { fieldFocusTime.current.email = Date.now(); if (typeof window !== 'undefined' && window.CRMPIXEL) window.CRMPIXEL.trackFormFocus('email'); }}
                        onBlur={() => { const t = fieldFocusTime.current.email || Date.now(); if (typeof window !== 'undefined' && window.CRMPIXEL) window.CRMPIXEL.trackFormBlur('email', Date.now() - t); }}
                        placeholder="seuemail@exemplo.com"
                        autoComplete="email"
                        required
                        className={`lp-input-mobile w-full min-h-[44px] pl-11 pr-10 py-3.5 rounded-xl bg-white border text-sm text-[#1a1a1a] placeholder:text-[#1a1a1a]/30 focus:outline-none focus:ring-1 transition-all ${
                          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formEmail.trim().toLowerCase())
                            ? 'border-emerald-400 focus:border-emerald-500 focus:ring-emerald-500/20'
                            : 'border-[#1a1a1a]/[0.12] focus:border-[#33492F] focus:ring-[#33492F]/20'
                        }`}
                      />
                      {/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formEmail.trim().toLowerCase()) && (
                        <Check className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-500" />
                      )}
                    </div>
                  </div>

                  {/* Phone */}
                  <div>
                    <label htmlFor="form-phone" className="block text-sm font-medium text-[#1a1a1a]/70 mb-1.5">
                      Telefone <span className="text-[#1a1a1a]/30 font-normal text-xs">(opcional)</span>
                    </label>
                    <p className="text-[11px] text-[#1a1a1a]/30 mb-2 -mt-1">Seu consultor poderá entrar em contato mais rapidamente.</p>
                    <div className="relative">
                      <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#1a1a1a]/30" />
                      <input
                        id="form-phone"
                        type="tel"
                        value={formPhone}
                        required
                        onChange={(ev) => { handlePhoneChange(ev.target.value); updatePixelFormFields(formName, ev.target.value, formEmail, customAnswers); }}
                        onFocus={() => { fieldFocusTime.current.phone = Date.now(); if (typeof window !== 'undefined' && window.CRMPIXEL) window.CRMPIXEL.trackFormFocus('phone'); }}
                        onBlur={() => { const t = fieldFocusTime.current.phone || Date.now(); if (typeof window !== 'undefined' && window.CRMPIXEL) window.CRMPIXEL.trackFormBlur('phone', Date.now() - t); }}
                        placeholder="(11) 99999-9999"
                        inputMode="numeric"
                        autoComplete="tel"
                        className={`lp-input-mobile w-full min-h-[44px] pl-11 pr-10 py-3.5 rounded-xl bg-white border text-sm text-[#1a1a1a] placeholder:text-[#1a1a1a]/30 focus:outline-none focus:ring-1 transition-all ${
                          formPhone.replace(/\D/g, '').length >= 10
                            ? 'border-emerald-400 focus:border-emerald-500 focus:ring-emerald-500/20'
                            : 'border-[#1a1a1a]/[0.12] focus:border-[#33492F] focus:ring-[#33492F]/20'
                        }`}
                      />
                      {formPhone.replace(/\D/g, '').length >= 10 && (
                        <Check className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-500" />
                      )}
                    </div>
                  </div>

                  {/* Dynamic custom fields */}
                  {e.formFields && e.formFields.length > 0 && (
                    <div className="space-y-4 pt-2">
                      <div className="h-px bg-[#1a1a1a]/[0.06]" />
                      {e.formFields.map((field) => {
                        const val = customAnswers[field.id] || '';
                        const parsedOptions = field.options ? (() => { try { return JSON.parse(field.options); } catch { return []; } })() : [];

                        return (
                          <div key={field.id}>
                            <label htmlFor={`field-${field.id}`} className="block text-sm font-medium text-[#1a1a1a]/70 mb-2">
                              {field.label}
                              {field.required && <span className="text-red-500"> *</span>}
                            </label>

                            {field.fieldType === 'text' && (
                              <input
                                id={`field-${field.id}`}
                                type="text"
                                value={val}
                                onChange={(ev) => { const next = { ...customAnswers, [field.id]: ev.target.value }; setCustomAnswers(next); updatePixelFormFields(formName, formPhone, formEmail, next); }}
                                placeholder={field.placeholder || undefined}
                                required={field.required}
                                className="w-full px-4 py-3.5 rounded-xl bg-white border border-[#1a1a1a]/[0.12] text-sm text-[#1a1a1a] placeholder:text-[#1a1a1a]/30 focus:outline-none focus:border-[#33492F] focus:ring-1 focus:ring-[#33492F]/20 transition-all"
                              />
                            )}

                            {field.fieldType === 'number' && (
                              <input
                                id={`field-${field.id}`}
                                type="number"
                                value={val}
                                onChange={(ev) => { const next = { ...customAnswers, [field.id]: ev.target.value }; setCustomAnswers(next); updatePixelFormFields(formName, formPhone, formEmail, next); }}
                                placeholder={field.placeholder || undefined}
                                required={field.required}
                                className="w-full px-4 py-3.5 rounded-xl bg-white border border-[#1a1a1a]/[0.12] text-sm text-[#1a1a1a] placeholder:text-[#1a1a1a]/30 focus:outline-none focus:border-[#33492F] focus:ring-1 focus:ring-[#33492F]/20 transition-all"
                              />
                            )}

                            {field.fieldType === 'textarea' && (
                              <textarea
                                id={`field-${field.id}`}
                                value={val}
                                onChange={(ev) => { const next = { ...customAnswers, [field.id]: ev.target.value }; setCustomAnswers(next); updatePixelFormFields(formName, formPhone, formEmail, next); }}
                                placeholder={field.placeholder || undefined}
                                required={field.required}
                                rows={3}
                                className="w-full px-4 py-3 rounded-xl bg-white border border-[#1a1a1a]/[0.12] text-sm text-[#1a1a1a] placeholder:text-[#1a1a1a]/30 focus:outline-none focus:border-[#33492F] focus:ring-1 focus:ring-[#33492F]/20 transition-all resize-none"
                              />
                            )}

                            {field.fieldType === 'select' && parsedOptions.length > 0 && (
                              <select
                                id={`field-${field.id}`}
                                value={val}
                                onChange={(ev) => { const next = { ...customAnswers, [field.id]: ev.target.value }; setCustomAnswers(next); updatePixelFormFields(formName, formPhone, formEmail, next); }}
                                required={field.required}
                                className="w-full px-4 py-3.5 rounded-xl bg-white border border-[#1a1a1a]/[0.12] text-sm text-[#1a1a1a] focus:outline-none focus:border-[#33492F] focus:ring-1 focus:ring-[#33492F]/20 transition-all appearance-none cursor-pointer"
                                style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='rgba(0,0,0,0.3)' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
                              >
                                <option value="" disabled className="bg-white">{field.placeholder || 'Selecione uma opção...'}</option>
                                {parsedOptions.map((opt: string, i: number) => (
                                  <option key={i} value={opt} className="bg-white">{opt}</option>
                                ))}
                              </select>
                            )}

                            {field.fieldType === 'checkbox' && (
                              <label htmlFor={`field-${field.id}`} className="flex items-center gap-3 cursor-pointer group py-1">
                                <input
                                  id={`field-${field.id}`}
                                  type="checkbox"
                                  checked={val === 'Sim'}
                                  onChange={(ev) => { const next = { ...customAnswers, [field.id]: ev.target.checked ? 'Sim' : 'Não' }; setCustomAnswers(next); updatePixelFormFields(formName, formPhone, formEmail, next); }}
                                  className="h-4 w-4 rounded border-[#1a1a1a]/20 bg-white text-[#33492F] focus:ring-[#33492F]/20 cursor-pointer accent-[#33492F]"
                                />
                                <span className="text-sm text-[#1a1a1a]/50 group-hover:text-[#1a1a1a]/70 transition-colors">
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
                    className={`w-full min-h-[44px] flex items-center justify-center gap-2.5 px-8 py-4 rounded-xl font-bold text-base sm:text-lg transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed mt-2 hover:scale-[1.01] active:scale-[0.99] ${
                      formProgress === 100
                        ? 'bg-emerald-500 text-white shadow-emerald-500/20 hover:bg-emerald-600 hover:shadow-emerald-500/30'
                        : 'bg-[#33492F] text-white shadow-[#33492F]/20 hover:bg-[#33492F]/90 hover:shadow-[#33492F]/30'
                    }`}
                  >
                    {formSubmitting ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Enviando...
                      </>
                    ) : formProgress === 100 ? (
                      <>
                        <Send className="h-4 w-4" />
                        Receber informações
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        Quero saber mais
                      </>
                    )}
                  </button>

                  {/* Form Trust Signals */}
                  <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pt-1">
                    <div className="flex items-center gap-1.5 text-xs text-[#1a1a1a]/30">
                      <Shield className="h-3.5 w-3.5 text-[#33492F]/50" />
                      <span>Seus dados estão seguros</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-[#1a1a1a]/30">
                      <Mail className="h-3.5 w-3.5 text-[#33492F]/50" />
                      <span>Sem spam</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-[#1a1a1a]/30">
                      <Clock className="h-3.5 w-3.5 text-[#33492F]/50" />
                      <span>Atendimento em até 24h</span>
                    </div>
                  </div>

                  <p className="text-xs text-[#1a1a1a]/25 text-center">
                    Ao solicitar informações, você concorda em receber detalhes sobre este empreendimento.
                  </p>
                </form>
              </div>
            </div>
          </div>
        </section>
      </ScrollReveal>

      {/* ── FAQ Section ────────────────────────────────── */}
      <ScrollReveal>
        <section className="bg-[#F7F6F3]">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-24">
            {/* Section header */}
            <div className="text-center mb-10 sm:mb-12">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#1a1a1a]">Perguntas Frequentes</h2>
            </div>

            {/* FAQ accordion */}
            <div className="space-y-3">
              {faqItems.map((item, idx) => (
                <div
                  key={idx}
                  className={`rounded-2xl border transition-all duration-300 overflow-hidden ${
                    faqOpenIndex === idx
                      ? 'border-[#33492F]/25 bg-white shadow-sm'
                      : 'border-[#1a1a1a]/[0.06] bg-white hover:border-[#1a1a1a]/[0.12]'
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
                      faqOpenIndex === idx ? 'text-[#33492F]' : 'text-[#1a1a1a]/80'
                    }`}>
                      {item.question}
                    </span>
                    <ChevronDown
                      className={`h-5 w-5 flex-shrink-0 transition-transform duration-300 ${
                        faqOpenIndex === idx ? 'rotate-180 text-[#33492F]' : 'text-[#1a1a1a]/30'
                      }`}
                    />
                  </button>
                  <div
                    className={`overflow-hidden transition-all duration-300 ease-in-out ${
                      faqOpenIndex === idx ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
                    }`}
                  >
                    <div className="px-5 sm:px-6 pb-5 sm:pb-6">
                      <div className="h-px bg-[#33492F]/10 mb-4" />
                      <p className="text-sm text-[#1a1a1a]/60 leading-relaxed">{item.answer}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* CTA after FAQ */}
            <div className="mt-8 sm:mt-10 text-center">
              <p className="text-sm text-[#1a1a1a]/40 mb-4">Ficou com alguma dúvida?</p>
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  try {
                    registerWhatsAppClick('faq_cta');
                    if (typeof window !== 'undefined' && window.CRMPIXEL) {
                      window.CRMPIXEL.track('whatsapp_click', { enterprise: e.name, source: 'faq_cta', userId: queueUser?.userId });
                    }
                    trackMetaPixel('Contact', { content_name: e.name, content_category: 'empreendimento' });
                  } catch {
                    /* tracking errors must never block navigation */
                  }
                }}
                className="min-h-[44px] inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#25D366] text-white font-semibold text-sm hover:bg-[#20bd5a] transition-colors shadow-lg shadow-[#25D366]/15"
              >
                <Phone className="h-4 w-4" />
                Fale com um consultor pelo WhatsApp
              </a>
            </div>
          </div>
        </section>
      </ScrollReveal>

      {/* ── Footer ─────────────────────────────────────── */}
      <footer className="bg-[#33492F]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          {/* Top row */}
          <div className="py-8 sm:py-12 grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-10">
            {/* Brand */}
            <div>
              <a href="/empreendimentos" className="flex items-center gap-3 mb-4 group">
                <div className="h-10 w-10 rounded-xl bg-white/10 flex items-center justify-center">
                  <Building2 className="h-5 w-5 text-white" />
                </div>
                <span className="text-base font-bold tracking-tight text-white">Empreendimentos</span>
              </a>
              <p className="text-sm text-white/50 leading-relaxed max-w-xs">
                Encontre o imóvel ideal para você e sua família. Qualidade, confiança e atendimento personalizado.
              </p>
            </div>

            {/* Quick links */}
            <div>
              <h4 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-4">Navegação</h4>
              <ul className="space-y-2.5">
                <li>
                  <a href="/empreendimentos" className="text-sm text-white/40 hover:text-white transition-colors">
                    Todos os Empreendimentos
                  </a>
                </li>
                <li>
                  <a href="#galeria" className="text-sm text-white/40 hover:text-white transition-colors">
                    Galeria
                  </a>
                </li>
                <li>
                  <a href="#cadastro" className="text-sm text-white/40 hover:text-white transition-colors">
                    Solicitar informações
                  </a>
                </li>
              </ul>
            </div>

            {/* Contact */}
            <div>
              <h4 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-4">Contato</h4>
              <div className="space-y-3">
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    try {
                      registerWhatsAppClick('footer');
                      if (typeof window !== 'undefined' && window.CRMPIXEL) {
                        window.CRMPIXEL.track('whatsapp_click', { enterprise: e.name, source: 'footer', userId: queueUser?.userId });
                      }
                      trackMetaPixel('Contact', { content_name: e.name, content_category: 'empreendimento' });
                    } catch {
                      /* tracking errors must never block navigation */
                    }
                  }}
                  className="min-h-[44px] flex items-center gap-2.5 text-sm text-white/40 hover:text-white transition-colors"
                >
                  <div className="h-8 w-8 rounded-lg bg-[#25D366]/15 flex items-center justify-center flex-shrink-0">
                    <Phone className="h-3.5 w-3.5 text-[#25D366]" />
                  </div>
                  WhatsApp
                </a>
              </div>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="border-t border-white/10 py-5 sm:py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-white/30">
              &copy; {new Date().getFullYear()} Todos os direitos reservados.
            </p>
            <p className="text-xs text-white/20">
              Todos os valores e informações são sujeitos a alteração sem aviso prévio.
            </p>
          </div>
        </div>
      </footer>

      {/* ★ Floating Sticky WhatsApp CTA (Mobile) */}
      {showFloatingWhatsApp && !showStickyFormSubmit && (
        <div className="fixed bottom-0 left-0 right-0 z-50 sm:hidden animate-slide-up-bar">
          <div className="bg-[#33492F] shadow-[0_-4px_20px_rgba(51,73,47,0.3)]">
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                try {
                  registerWhatsAppClick('floating_bar');
                  if (typeof window !== 'undefined' && window.CRMPIXEL) {
                    window.CRMPIXEL.track('whatsapp_click', { enterprise: e.name, source: 'floating_bar', userId: queueUser?.userId });
                  }
                  trackMetaPixel('Contact', { content_name: e.name, content_category: 'empreendimento' });
                } catch {
                  /* tracking errors must never block navigation */
                }
              }}
              className="min-h-[44px] flex items-center justify-center gap-2.5 py-3.5 px-6 text-white font-semibold text-sm"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              Fale pelo WhatsApp
            </a>
          </div>
          <div className="h-[env(safe-area-inset-bottom)]" />
        </div>
      )}

      {/* ★ Sticky Form Submit (Mobile) */}
      {showStickyFormSubmit && !formSubmitting && (
        <div className="fixed bottom-0 left-0 right-0 z-50 sm:hidden animate-slide-up-bar">
          <div className="bg-white/95 backdrop-blur-xl border-t border-[#33492F]/20 shadow-[0_-4px_20px_rgba(51,73,47,0.1)]">
            <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[#1a1a1a]/60 truncate">{e.name}</p>
                <p className="text-[11px] text-[#1a1a1a]/30">Apenas nome + e-mail</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (isSubmittingRef.current) return;
                  try {
                    isSubmittingRef.current = true;
                    if (handleFormSubmitRef.current) {
                      handleFormSubmitRef.current({ preventDefault: () => {} } as unknown as React.FormEvent);
                    } else {
                      const form = document.getElementById('landing-form') as HTMLFormElement | null;
                      if (form) {
                        form.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }
                    }
                    setTimeout(() => { isSubmittingRef.current = false; }, 3000);
                  } catch {
                    isSubmittingRef.current = false;
                    const form = document.getElementById('landing-form') as HTMLFormElement | null;
                    if (form) {
                      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                  }
                }}
                className="flex-shrink-0 min-h-[44px] flex items-center gap-2 px-5 py-3 rounded-xl bg-[#33492F] text-white font-bold text-sm hover:bg-[#33492F]/90 transition-all active:scale-95 shadow-lg shadow-[#33492F]/20"
              >
                <Send className="h-4 w-4" />
                Quero saber mais
              </button>
            </div>
            <div className="h-[env(safe-area-inset-bottom)]" />
          </div>
        </div>
      )}

      {/* Sticky Desktop CTA */}
      {showDesktopSticky && !isFormSectionVisible && (
        <div className="hidden sm:block fixed bottom-0 left-0 right-0 z-40 animate-slide-up-bar">
          <div className="bg-white/95 backdrop-blur-xl border-t border-[#1a1a1a]/[0.06] shadow-lg shadow-black/[0.04]">
            <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span className="text-sm font-semibold text-[#1a1a1a]/80">{displayTitle}</span>
                {status && (
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                    status === 'Lançamento' ? 'bg-emerald-50 text-emerald-700' :
                    status === 'Em Construção' ? 'bg-amber-50 text-amber-700' :
                    'bg-blue-50 text-blue-700'
                  }`}>{status}</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <a href="#cadastro" className="px-5 py-2.5 rounded-xl bg-[#33492F] text-white text-sm font-bold hover:bg-[#33492F]/90 transition-all hover:shadow-[#33492F]/20">
                  Quero saber mais
                </a>
                <button type="button" onClick={() => openWhatsApp('desktop_sticky')} className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#25D366] text-white text-sm font-semibold hover:bg-[#20bd5a] transition-colors cursor-pointer">
                  WhatsApp
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Exit-Intent Popup ── */}
      {exitPopupOpen && (
        <div
          className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setExitPopupOpen(false)}
        >
          <div
            className="relative max-w-md w-full rounded-2xl bg-white border border-[#1a1a1a]/[0.08] p-6 sm:p-8 shadow-2xl"
            onClick={(ev) => ev.stopPropagation()}
          >
            <button
              onClick={() => setExitPopupOpen(false)}
              className="absolute top-4 right-4 text-[#1a1a1a]/30 hover:text-[#1a1a1a] transition-colors"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center justify-center mb-5">
              <div className="h-14 w-14 rounded-2xl bg-[#33492F]/10 flex items-center justify-center">
                <MessageSquare className="h-7 w-7 text-[#33492F]" />
              </div>
            </div>

            <h3 className="text-xl font-bold text-center mb-2 text-[#1a1a1a]">
              Tem interesse no {e.name}?
            </h3>
            <p className="text-sm text-[#1a1a1a]/50 text-center mb-6 leading-relaxed">
              Receba materiais, valores e condições comerciais diretamente no seu e-mail ou WhatsApp. Sem compromisso.
            </p>

            <div className="space-y-3">
              <button
                type="button"
                onClick={() => { setExitPopupOpen(false); openWhatsApp('exit_popup'); }}
                className="w-full min-h-[44px] flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-[#25D366] text-white font-semibold text-sm hover:bg-[#20bd5a] transition-colors cursor-pointer"
              >
                <Phone className="h-4 w-4" />
                Falar pelo WhatsApp
              </button>
              <a
                href="#cadastro"
                onClick={() => {
                  setExitPopupOpen(false);
                  if (typeof window !== 'undefined' && window.CRMPIXEL) {
                    window.CRMPIXEL.track('exit_popup_cta', { enterprise: e.name, action: 'form' });
                  }
                }}
                className="w-full min-h-[44px] flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-[#33492F] text-white font-bold text-sm hover:bg-[#33492F]/90 transition-all shadow-lg shadow-[#33492F]/20"
              >
                <Send className="h-4 w-4" />
                Quero saber mais
              </a>
            </div>

            <p className="text-[11px] text-[#1a1a1a]/25 text-center mt-4">
              <Shield className="h-3 w-3 inline-block mr-1 text-[#33492F]/40" />
              Seus dados estão seguros e não enviamos spam.
              {showRealCount && (
                <span className="ml-2 text-emerald-400/60">{clientCount} pessoa{clientCount !== 1 ? 's' : ''} já se cadastraram.</span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* ── Floor Plans Lightbox ────────────────────── */}
      {floorLightboxOpen && enterprise?.floorPlans && enterprise.floorPlans.length > 0 && (
        <div className="fixed inset-0 z-[60] bg-black/95 flex flex-col items-center justify-center p-2 sm:p-0" onClick={() => setFloorLightboxOpen(false)}>
          <button
            onClick={() => setFloorLightboxOpen(false)}
            className="absolute top-3 right-3 sm:top-5 sm:right-5 text-white/60 hover:text-white z-10 bg-white/10 backdrop-blur-sm rounded-full p-2 sm:p-2.5 transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
          <div className="absolute top-3 left-3 sm:top-5 sm:left-5 text-white/60 text-xs sm:text-sm bg-white/10 backdrop-blur-sm px-3 py-1.5 sm:px-4 sm:py-2 rounded-full">
            Planta {activeFloorIdx + 1} / {enterprise.floorPlans.length}
          </div>
          <img
            src={enterprise.floorPlans[activeFloorIdx]?.url}
            alt={enterprise.floorPlans[activeFloorIdx]?.altText || `Planta ${activeFloorIdx + 1}`}
            className="max-w-[95vw] sm:max-w-[90vw] max-h-[80vh] object-contain rounded-xl"
            onClick={(ev) => ev.stopPropagation()}
          />
          {enterprise.floorPlans[activeFloorIdx]?.altText && (
            <div className="mt-3 sm:mt-4 max-w-lg px-4">
              <p className="text-sm sm:text-base text-white/90 font-medium text-center leading-relaxed">
                {enterprise.floorPlans[activeFloorIdx].altText}
              </p>
            </div>
          )}
          {enterprise.floorPlans.length > 1 && (
            <>
              <button
                onClick={(ev) => { ev.stopPropagation(); setActiveFloorIdx((p) => (p - 1 + enterprise.floorPlans.length) % enterprise.floorPlans.length); }}
                className="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 text-white/60 hover:text-white bg-white/10 backdrop-blur-sm rounded-full p-2.5 sm:p-3 transition-colors"
              >
                <ChevronLeft className="h-5 w-5 sm:h-6 sm:w-6" />
              </button>
              <button
                onClick={(ev) => { ev.stopPropagation(); setActiveFloorIdx((p) => (p + 1) % enterprise.floorPlans.length); }}
                className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 text-white/60 hover:text-white bg-white/10 backdrop-blur-sm rounded-full p-2.5 sm:p-3 transition-colors"
              >
                <ChevronRight className="h-5 w-5 sm:h-6 sm:w-6" />
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Floating Social Proof Toast ─────────────────── */}
      {toastVisible && socialProofPool.length > 0 && (
        <div
          className="fixed bottom-4 left-4 z-50 animate-fade-in-up"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-3 bg-[#1A1A1A]/95 backdrop-blur-md border border-white/10 rounded-2xl px-4 py-3 shadow-2xl shadow-black/40 max-w-[280px]">
            <div className="flex-shrink-0 h-9 w-9 rounded-full bg-[#C9A96E]/20 flex items-center justify-center">
              <UserCheck className="h-4 w-4 text-[#C9A96E]" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-white/90 font-medium leading-tight">
                {socialProofPool[socialProofIdx].message}
              </p>
              <p className="text-[10px] text-white/35 mt-0.5">
                há {socialProofPool[socialProofIdx].time}
              </p>
            </div>
          </div>
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
          <Image
            src={images[activeImgIdx]?.url}
            alt={images[activeImgIdx]?.altText || ''}
            width={1200}
            height={800}
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

      {/* ── Social Proof Toast ── */}
      <div className="fixed bottom-20 sm:bottom-6 left-4 z-30 sm:hidden">
        <div className="bg-white rounded-xl shadow-lg border border-[#1a1a1a]/[0.06] px-4 py-3 flex items-center gap-3 max-w-[280px]">
          <div className="h-8 w-8 rounded-full bg-[#33492F]/10 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="h-4 w-4 text-[#33492F]" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-[#1a1a1a] truncate">{socialProofPool[socialProofIdx]?.name}</p>
            <p className="text-[10px] text-[#1a1a1a]/40">{socialProofPool[socialProofIdx]?.action} há {socialProofPool[socialProofIdx]?.time}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
