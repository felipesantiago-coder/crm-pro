'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo, startTransition, Suspense } from 'react';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import LanguageSwitcher from '@/i18n/LanguageSwitcher';
import {
  Building2, MapPin, ArrowLeft, ChevronLeft, ChevronRight,
  X, Clock, DollarSign, Phone, Mail, MessageSquare,
  Loader2, ZoomIn, Check, User, Send, AlertCircle,
  Shield, ChevronDown, CalendarDays, TrendingUp, Users, Layers, Car, LayoutGrid,
  Sparkles, CheckCircle2, Ruler, BedDouble, Navigation, UserCheck, Home, Map,
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
  url: string | null;
  altText: string | null;
  sortOrder: number;
  name: string | null;
  area: string | null;
  bedrooms: number | null;
  suites: number | null;
  hasBalcony: boolean | null;
  isGarden: boolean | null;
  isPenthouse: boolean | null;
  description: string | null;
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
  mapLatitude: number | null;
  mapLongitude: number | null;
  _count?: { clients: number };
  images: EnterpriseImage[];
  floorPlans: FloorPlan[];
  formFields: FormField[];
}

/* ================================================================
   Dynamic imports (heavy deps)
   ================================================================ */
const LandingLightbox = dynamic(() => import('./landing-lightbox'), { ssr: false });
const LandingExitPopup = dynamic(() => import('./landing-exit-popup'), { ssr: false });
const LocationMap = dynamic(() => import('@/components/location-map'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[260px] sm:h-[320px] rounded-2xl bg-[#1a1a1a]/[0.04] flex items-center justify-center">
      <div className="flex flex-col items-center gap-2 text-[#1a1a1a]/20">
        <svg className="animate-spin h-6 w-6" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="text-xs">Carregando mapa...</span>
      </div>
    </div>
  ),
});

/* ================================================================
   ScrollReveal Component
   ================================================================ */
function ScrollReveal({ children, className = '' }: React.PropsWithChildren<{ className?: string }>) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setIsVisible(true); return; }
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setIsVisible(true); observer.unobserve(el); } },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`transition-all duration-700 ease-out ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'} ${className}`}>
      {children}
    </div>
  );
}

const WHATSAPP_ICON = '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>';


/* ================================================================
   Page Component
   ================================================================ */
interface LandingPageClientProps {
  params: Promise<{ slug: string }>;
  initialData?: Enterprise | null;
  initialQueueUser?: { userId: string; userPhone: string | null } | null;
}

export default function LandingPageClient({ params, initialData, initialQueueUser }: LandingPageClientProps) {
  const { slug } = React.use(params);
  const t = useTranslations();

  const faqItemsRaw = t.raw('faq.items') as Array<{ question?: string; answer?: string; q?: string; a?: string }>;
  const faqItems = faqItemsRaw.map(item => ({
    question: item.question || item.q || '',
    answer: item.answer || item.a || '',
  }));

  const buildPlantLabel = useCallback((plan: FloorPlan): string => {
    const parts: string[] = [];
    if (plan.bedrooms) {
      parts.push(`${plan.bedrooms} ${t('plantLabels.bedroom', { count: plan.bedrooms })}`);
    }
    if (plan.suites && plan.suites > 0) {
      if (parts.length > 0) parts[parts.length - 1] += ` (${plan.suites} ${t('plantLabels.suite', { count: plan.suites })})`;
      else parts.push(`${plan.suites} ${t('plantLabels.suite', { count: plan.suites })}`);
    }
    if (plan.hasBalcony) {
      if (parts.length > 0) parts[0] += ` ${t('plantLabels.withBalcony')}`;
      else parts.push(t('plantLabels.withBalconyStart'));
    }
    if (plan.isGarden) {
      parts.unshift(t('plantLabels.garden'));
    }
    if (plan.isPenthouse) {
      parts.unshift(t('plantLabels.penthouse'));
    }
    return parts.length > 0 ? parts.join(' ') : t('plantLabels.default');
  }, [t]);

  /* ── State ─────────────────────────────────────────── */
  const [enterprise, setEnterprise] = useState<Enterprise | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);
  const [activeImgIdx, setActiveImgIdx] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [queueUser, setQueueUser] = useState<{ userId: string; userPhone: string | null } | null>(initialQueueUser ?? null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});

  // Refs
  const isSubmittingRef = useRef(false);
  const handleFormSubmitRef = useRef<(ev: React.FormEvent) => Promise<void> | null>(null);
  const utmParamsRef = useRef<Record<string, string>>({});
  const fieldFocusTime = useRef<Record<string, number>>({});
  const formSectionRef = useRef<HTMLDivElement>(null);
  const exitPopupShownRef = useRef(false);
  const whatsappAssignRef = useRef(false);

  // UI State
  const [showBottomBar, setShowBottomBar] = useState(false);
  const [showFloatingWhatsApp, setShowFloatingWhatsApp] = useState(false);
  const [isFormSectionVisible, setIsFormSectionVisible] = useState(false);
  const [exitPopupOpen, setExitPopupOpen] = useState(false);
  const [exitPopupCountdown, setExitPopupCountdown] = useState(0);
  const [faqOpenIndex, setFaqOpenIndex] = useState<number | null>(null);
  const [activeDiffTab, setActiveDiffTab] = useState(0);
  const [socialProofIdx, setSocialProofIdx] = useState(0);
  const [toastVisible, setToastVisible] = useState(false);
  const [toastFading, setToastFading] = useState(false);
  const [animatedCount, setAnimatedCount] = useState(0);
  const [selectedPlanIdx, setSelectedPlanIdx] = useState<number>(-1);
  const countAnimatedRef = useRef(false);
  /* lightboxScrollRef removed — now in LandingLightbox component */

  // ── Pixel form fields updater ──
  const updatePixelFormFields = useCallback((name: string, phone: string, email: string, custom: Record<string, string>) => {
    if (typeof window === 'undefined' || !window.CRMPIXEL) return;
    const fields: Record<string, string> = { nome: name, telefone: phone, email };
    for (const [id, val] of Object.entries(custom)) {
      const f = enterprise?.formFields?.find((ff: FormField) => ff.id === id);
      fields[f?.label || id] = val;
    }
    window.CRMPIXEL._setFormFieldsFilled(fields);
  }, [enterprise?.formFields]);

  // ── Meta Pixel helper ──
  const trackMetaPixel = useCallback((event: string, data?: Record<string, unknown>, eventId?: string) => {
    try {
      if (typeof window !== 'undefined' && typeof (window as unknown as Record<string, unknown>).fbq === 'function') {
        const fbq = (window as unknown as Record<string, unknown>).fbq as (...args: unknown[]) => void;
        if (data && eventId) fbq('track', event, data, { eventID: eventId });
        else if (data) fbq('track', event, data);
        else fbq('track', event);
      }
    } catch (e) { console.warn('[Meta Pixel] Track error:', e instanceof Error ? e.message : e); }
  }, []);

  const generateMetaEventId = useCallback(() => `lp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`, []);

  // ── UTM params capture ──
  const utmParams = React.useMemo(() => {
    if (typeof window === 'undefined') return {} as Record<string, string>;
    const sp = new URLSearchParams(window.location.search);
    const map: Record<string, string> = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach((k) => {
      const v = sp.get(k); if (v) map[k] = v;
    });
    return map;
  }, []);
  utmParamsRef.current = utmParams;

  /* ── SAFETY NET: Auto-save form draft to localStorage (debounced 1s) ── */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hasData = formName.trim() || formEmail.trim() || formPhone.trim();
    if (!hasData) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(`lp_draft_${slug || 'default'}`, JSON.stringify({
          name: formName, phone: formPhone, email: formEmail, customAnswers,
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

  /* ── SAFETY NET: Restore draft from localStorage on mount ── */
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

  /* ── SAFETY NET: Retry failed submissions on mount ── */
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
          try { await fetch('/api/enterprises/public-lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item.payload) }); } catch { /* retry next visit */ }
        }
        localStorage.removeItem('lp_failed_queue');
      } catch { /* ignore */ }
    }
    const timer = setTimeout(retryFailed, 2000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  /* ── SAFETY NET: sendBeacon on page close ── */
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

  /* ── Section view tracking via IntersectionObserver ── */
  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return;
    const sectionIds = ['hero', 'social-proof', 'summary', 'why-vitta', 'differentials', 'apartments', 'plantas', 'galeria', 'location', 'faq', 'cadastro'];
    let observer: IntersectionObserver | null = null;
    let retries = 0;
    function initObserver() {
      if (!window.CRMPIXEL || retries >= 5) return;
      observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            try { (window as any).CRMPIXEL?.trackSectionView(entry.target.id); } catch { /* non-critical */ }
          }
        });
      }, { threshold: 0.3, rootMargin: '0px 0px -10% 0px' });
      sectionIds.forEach((id) => { const el = document.getElementById(id); if (el) observer?.observe(el); });
      // Track form view
      const formObs = new IntersectionObserver((entries) => {
        entries.forEach((entry) => { if (entry.isIntersecting) { try { (window as any).CRMPIXEL?.trackFormView('landing_form'); } catch {} } });
      }, { threshold: 0.1 });
      const formEl = document.getElementById('landing-form');
      if (formEl) formObs.observe(formEl);
      // Store for cleanup
      (observer as any)._formObs = formObs;
    }
    initObserver();
    if (!observer && retries < 5) {
      const timer = setInterval(() => { retries++; initObserver(); if (observer || retries >= 5) clearInterval(timer); }, 2000);
      return () => clearInterval(timer);
    }
    return () => { observer?.disconnect(); (observer as any)?._formObs?.disconnect(); };
  }, []);

  /* ── Exit intent detection ── */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const showExitPopup = () => {
      try { if (window.CRMPIXEL) window.CRMPIXEL.trackExitIntent(); } catch {}
      if (!exitPopupShownRef.current && !formSubmitting) {
        exitPopupShownRef.current = true;
        setExitPopupCountdown(15);
        setExitPopupOpen(true);
        try {
          const docH = document.documentElement.scrollHeight - window.innerHeight;
          (window as any).CRMPIXEL.track('exit_popup_shown', { enterprise: enterprise?.name, scroll_depth: docH > 0 ? Math.round((window.scrollY / docH) * 100) : 0 });
        } catch {}
      }
    };
    const getScrollPct = () => { const docH = document.documentElement.scrollHeight - window.innerHeight; return docH > 0 ? window.scrollY / docH : 0; };
    const mouseHandler = (e: MouseEvent) => { if (e.clientY <= 0 && e.relatedTarget === null && getScrollPct() > 0.2) showExitPopup(); };
    document.addEventListener('mouseleave', mouseHandler);
    let mobileTimer: ReturnType<typeof setTimeout> | null = null;
    const visibilityHandler = () => {
      if (document.visibilityState === 'hidden' && getScrollPct() > 0.2) { mobileTimer = setTimeout(showExitPopup, 5000); }
      else { if (mobileTimer) { clearTimeout(mobileTimer); mobileTimer = null; } }
    };
    document.addEventListener('visibilitychange', visibilityHandler);
    return () => { document.removeEventListener('mouseleave', mouseHandler); document.removeEventListener('visibilitychange', visibilityHandler); if (mobileTimer) clearTimeout(mobileTimer); };
  }, [formSubmitting, enterprise?.name]);

  // Exit popup countdown
  useEffect(() => {
    if (exitPopupOpen && exitPopupCountdown > 0) {
      const timer = setInterval(() => {
        setExitPopupCountdown((c) => { if (c <= 1) return 0; return c - 1; });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [exitPopupOpen, exitPopupCountdown]);

  /* ── Fetch enterprise (skip if server already provided initialData) ── */
  const fetchEnterprise = useCallback(async () => {
    if (!slug) return;
    if (initialData) { setLoading(false); return; }
    try {
      const res = await fetch(`/api/enterprises/public/${slug}`);
      if (res.ok) { const data = await res.json(); setEnterprise(data); document.title = `${data.landingTitle || data.name} | Empreendimentos`; }
      else setError(t('errors.fetchFailed'));
    } catch { setError(t('errors.connectionError')); }
    finally { setLoading(false); }
  }, [slug, initialData, t]);
  useEffect(() => { fetchEnterprise(); }, [fetchEnterprise]);

  /* ── Scroll / resize listeners ── */
  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 60);
      const heroHeight = window.innerHeight;
      setShowBottomBar(window.scrollY > heroHeight * 0.6 && window.innerWidth < 1024);
      if (formSectionRef.current && window.innerWidth < 640) {
        const rect = formSectionRef.current.getBoundingClientRect();
        const visible = rect.top < window.innerHeight && rect.bottom > 0;
        setIsFormSectionVisible(visible);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onScroll();
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, []);

  // Floating WhatsApp button — show after 3s
  useEffect(() => {
    // Show floating WhatsApp faster (1.5s) — visitors from IAB may leave quickly
    const timer = setTimeout(() => setShowFloatingWhatsApp(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  // Social proof cycling
  const socialProofMessages = t.raw('socialProof.messages') as string[];
  const socialProofTimes = t.raw('socialProof.times') as string[];
  const socialProofPool = React.useMemo(() => {
    const msgs = Array.isArray(socialProofMessages) ? socialProofMessages : [];
    const times = Array.isArray(socialProofTimes) ? socialProofTimes : [];
    return msgs.map((message, i) => ({ message, time: times[i] || '' }));
  }, [socialProofMessages, socialProofTimes]);
  useEffect(() => {
    if (socialProofPool.length === 0) return;
    const showDelay = setTimeout(() => {
      setToastVisible(true);
      // Start cycling: each message appears for 3s then fades out (2s fade), 5s total cycle
      const cycleTimer = setInterval(() => {
        setSocialProofIdx((prev) => (prev + 1) % socialProofPool.length);
        setToastFading(false);
      }, 5000);
      // Fade out 3s into each 5s cycle
      const fadeTimer = setInterval(() => { setToastFading(true); }, 3000);
      // Store for cleanup
      return () => { clearInterval(cycleTimer); clearInterval(fadeTimer); };
    }, 10000);
    return () => { clearTimeout(showDelay); };
  }, [socialProofPool.length]);

  /* ── Fetch queue user for WhatsApp ── */
  useEffect(() => {
    if (!slug || queueUser) return;
    fetch(`/api/lead-queues/next-user?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((data) => { if (data.hasQueue && data.userPhone && data.userId) setQueueUser({ userId: data.userId, userPhone: data.userPhone }); })
      .catch(() => {});
  }, [slug, queueUser]);

  /* ── Lightbox: lock body scroll ── */
  useEffect(() => {
    if (!lightboxOpen) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [lightboxOpen]);

  // Animated counter for social proof
  useEffect(() => {
    if (!enterprise || countAnimatedRef.current) return;
    const count = enterprise._count?.clients ?? 0;
    if (count < 5) return;
    const el = document.getElementById('social-proof-counter');
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !countAnimatedRef.current) {
        countAnimatedRef.current = true;
        let current = 0; const step = Math.max(1, Math.floor(count / 40)); const interval = setInterval(() => { current = Math.min(current + step, count); setAnimatedCount(current); if (current >= count) clearInterval(interval); }, 30);
      }
    }, { threshold: 0.5 });
    obs.observe(el); return () => obs.disconnect();
  }, [enterprise]);

  /* ── WhatsApp helpers ── */
  const whatsappNumber = queueUser?.userPhone ? queueUser.userPhone.replace(/\D/g, '') : null;
  const whatsappUrl = whatsappNumber
    ? `https://wa.me/${whatsappNumber.startsWith('55') ? whatsappNumber : '55' + whatsappNumber}?text=${encodeURIComponent(t('whatsapp.landingMessage', { name: enterprise?.name || '' }))}`
    : `https://wa.me/?text=${encodeURIComponent(t('whatsapp.landingMessage', { name: enterprise?.name || '' }))}`;

  const registerWhatsAppClick = useCallback((source: string) => {
    if (whatsappAssignRef.current || !queueUser?.userId) return;
    whatsappAssignRef.current = true;
    const payload = JSON.stringify({ source: `whatsapp_click:${slug}:${source}` });
    const blob = new Blob([payload], { type: 'application/json' });
    if (navigator.sendBeacon) navigator.sendBeacon('/api/lead-queues/assign', blob);
    else fetch('/api/lead-queues/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
  }, [queueUser?.userId, slug]);

  const openWhatsApp = useCallback((source: string, section?: string | null, position?: string | null) => {
    try {
      registerWhatsAppClick(source);
      if (typeof window !== 'undefined' && window.CRMPIXEL) {
        window.CRMPIXEL.track('whatsapp_click', { enterprise: enterprise?.name, source, userId: queueUser?.userId });
        (window as any).CRMPIXEL.trackCTA('whatsapp_' + source, 'WhatsApp ' + source, section || null, position || 'floating');
      }
      trackMetaPixel('Contact', { content_name: enterprise?.name, content_category: 'empreendimento' });
    } catch {}
    try { window.open(whatsappUrl, '_blank', 'noopener'); } catch {}
  }, [whatsappUrl, enterprise?.name, queueUser?.userId, registerWhatsAppClick, trackMetaPixel]);

  /* ── Phone mask ── */
  const handlePhoneChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    let masked = '';
    if (digits.length > 0) masked += `(${digits.slice(0, 2)}`;
    if (digits.length > 2) masked += `) ${digits.slice(2, 7)}`;
    if (digits.length > 7) masked += `-${digits.slice(7)}`;
    setFormPhone(masked);
  };

  /* ── Form handler ── */
  const handleFormSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault(); setFormError('');
    if (!formName.trim() || formName.trim().length < 2) { setFormError(t('form.validation.nameRequired')); return; }
    const cleanEmail = formEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) { setFormError(t('form.validation.emailInvalid')); return; }
    const cleanPhone = formPhone.replace(/\D/g, '');
    if (cleanPhone.length < 10) { setFormError(t('form.validation.phoneInvalid')); return; }
    if (enterprise?.formFields) {
      for (const field of enterprise.formFields) {
        if (field.required && field.fieldType !== 'checkbox') {
          const val = customAnswers[field.id];
          if (!val || val.trim() === '') { setFormError(t('form.validation.fieldRequired', { label: field.label })); return; }
        }
      }
    }
    setFormSubmitting(true); isSubmittingRef.current = true;
    try { (window as any).CRMPIXEL?.trackFormSubmitAttempt('landing_form'); } catch {}
    const metaEventId = generateMetaEventId();
    const answersData: Record<string, string> = {};
    if (enterprise?.formFields) { for (const field of enterprise.formFields) { const val = customAnswers[field.id]; if (val !== undefined && val !== null && String(val).trim() !== '') answersData[field.label] = String(val).trim(); } }
    try {
      const res = await fetch('/api/enterprises/public-lead', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName.trim(), phone: cleanPhone, email: cleanEmail, slug: slug || undefined, customAnswers: Object.keys(answersData).length > 0 ? answersData : undefined, utmSource: utmParams.utm_source || undefined, utmMedium: utmParams.utm_medium || undefined, utmCampaign: utmParams.utm_campaign || undefined, utmContent: utmParams.utm_content || undefined, utmTerm: utmParams.utm_term || undefined, metaEventId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        try { localStorage.removeItem(`lp_draft_${slug || 'default'}`); } catch {}
        if (typeof window !== 'undefined' && window.CRMPIXEL) { window.CRMPIXEL.track('form_submit', { enterprise: enterprise?.name }); if (data.clientId) window.CRMPIXEL.identify(data.clientId); }
        trackMetaPixel('Lead', { content_name: enterprise?.name, content_category: 'empreendimento', value: 1, currency: 'BRL' }, metaEventId);
        const params = new URLSearchParams();
        params.set('empreendimento', enterprise?.name || ''); params.set('nome', formName.trim()); params.set('slug', slug);
        if (data.assignedUser?.userName) params.set('atendente', data.assignedUser.userName);
        if (data.assignedUser?.userPhone) params.set('telefone', data.assignedUser.userPhone);
        window.location.href = `/empreendimentos/${slug}/cadastro-sucesso?${params.toString()}`;
      } else { setFormError(data.error || t('errors.submitError')); }
    } catch {
      try {
        const failQueueRaw = localStorage.getItem('lp_failed_queue');
        const failQueue: Array<{ payload: Record<string, unknown>; timestamp: number }> = failQueueRaw ? JSON.parse(failQueueRaw) : [];
        failQueue.push({ payload: { name: formName.trim(), phone: cleanPhone, email: cleanEmail, slug: slug || undefined, customAnswers: Object.keys(answersData).length > 0 ? answersData : undefined, utmSource: utmParams.utm_source || undefined, utmMedium: utmParams.utm_medium || undefined, utmCampaign: utmParams.utm_campaign || undefined, utmContent: utmParams.utm_content || undefined, utmTerm: utmParams.utm_term || undefined }, timestamp: Date.now() });
        localStorage.setItem('lp_failed_queue', JSON.stringify(failQueue));
      } catch {}
      setFormError(t('errors.connectionErrorFull'));
    } finally { setFormSubmitting(false); isSubmittingRef.current = false; }
  };
  handleFormSubmitRef.current = handleFormSubmit;

  /* ── Loading ── */
  if (loading) {
    return <div className="min-h-screen bg-[#F7F6F3] flex items-center justify-center"><Loader2 className="h-8 w-8 text-[#33492F] animate-spin" /></div>;
  }
  if (error || !enterprise) {
    return (
      <div className="min-h-screen bg-[#F7F6F3] flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <Building2 className="h-16 w-16 text-[#33492F]/20 mx-auto mb-6" />
          <h1 className="text-2xl font-bold text-[#1a1a1a] mb-2">{t('errors.notFound')}</h1>
          <p className="text-gray-500 mb-8">{error || t('errors.notFoundDesc')}</p>
          <a href="/empreendimentos" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#33492F] text-white font-semibold text-sm hover:bg-[#33492F]/90 transition-colors"><ArrowLeft className="h-4 w-4" /> {t('errors.notFoundCta')}</a>
        </div>
      </div>
    );
  }

  /* ════════════════════════════════════════════════════════
     Derived Data
     ════════════════════════════════════════════════════════ */
  const e = enterprise;
  const info = e.cachedInfo as ExtractedInfo | null;
  const images = e.images || [];
  const heroImage = e.imageUrl || images[0]?.url || '';

  // Geocoding address for map
  const mapAddress = useMemo(() => {
    const loc = info?.location;
    if (!loc) return '';
    return [loc.address, loc.neighborhood, loc.city, loc.state].filter(Boolean).join(', ');
  }, [info?.location]);

  /* ── Lightbox scroll handler removed — now in LandingLightbox component ── */

  // Status detection
  const allText = [info?.summary, ...(info?.differentials || [])].filter(Boolean).join(' ');
  let status: string | null = info?.status || null;
  if (!status) {
    if (/entregue|pronto para morar|habite-se/i.test(allText)) status = 'Entregue';
    else if (/em construção|construção/i.test(allText)) status = 'Em Construção';
    else if (/lançamento|pré-lançamento/i.test(allText)) status = 'Lançamento';
  }
  const deliveryText = info?.deliveryDate || (() => {
    if (status === 'Entregue') return t('summary.delivered');
    const m = allText.match(/entrega[^A-Z]*(?:prevista\s*(?:para\s*)?)?([^.;\n]{3,40}?)(?:\.|;|\n|$)/i) || allText.match(/(\d{1,2}\/\d{2,4}|\d{4})\s*$/);
    return m ? m[1].trim() : null;
  })();
  const priceText = info?.price || (() => {
    const m = info?.summary?.match(/a partir de\s*R\$\s*[\d.]+/i) || info?.apartmentTypes?.[0]?.description?.match(/a partir de\s*R\$\s*[\d.]+/i);
    return m ? m[0] : null;
  })();

  // Area range — prioridade: admin floorPlans > cachedInfo apartmentTypes (fallback)
  const hasAdminFloorPlans = (e.floorPlans || []).length > 0;
  const areas = hasAdminFloorPlans
    ? (e.floorPlans || []).flatMap(p => {
        if (!p.area) return [];
        const cleaned = p.area.trim().replace(/,/g, '.').replace(/m[²2]/gi, '').trim();
        const nums: number[] = [];
        const numRe = /(\d+(?:\.\d+)?)/g;
        let m;
        while ((m = numRe.exec(cleaned)) !== null) { const val = parseFloat(m[1]); if (!isNaN(val) && val > 0) nums.push(val); }
        return nums;
      }).filter(a => a > 0 && a < 5000)
    : (info?.apartmentTypes || []).flatMap(a => {
        if (!a.area) return []; let cleaned = a.area.trim().replace(/,/g, '.').replace(/m[²2]/gi, '').trim().replace(/^(de|desde|entre|a\s+partir\s+de)\s+/i, '').trim();
        const nums: number[] = []; const numRe = /(\d+(?:\.\d+)?)/g; let m;
        while ((m = numRe.exec(cleaned)) !== null) { const val = parseFloat(m[1]); if (!isNaN(val) && val > 0) nums.push(val); }
        return nums;
      }).filter(a => a > 0 && a < 5000);
  const maxArea = areas.length > 0 ? Math.max(...areas) : 0;
  const minArea = areas.length > 0 ? Math.min(...areas) : 0;
  const areaRange = maxArea > 0 ? (minArea === maxArea ? `${maxArea}m²` : `${minArea} ${t('summary.rangeTo')} ${maxArea}m²`) : null;

  const displayTitle = e.landingTitle || e.name;
  const displaySubtitle = e.landingSubtitle || info?.summary?.slice(0, 120) || (() => {
    const parts: string[] = [];
    if (info?.location?.city || info?.location?.neighborhood) parts.push(t('subtitle.inLocation', { location: `${info.location.neighborhood || info.location.city}${info.location.city && info.location.neighborhood ? ', ' + info.location.city : ''}` }));
    if (priceText) parts.push(priceText);
    else if (areaRange) parts.push(t('subtitle.areas', { areaRange }));
    if (deliveryText && deliveryText !== t('summary.delivered')) parts.push(t('subtitle.delivery', { deliveryText }));
    return parts.length > 0 ? parts.join(' · ') : null;
  })() || null;

  // Social proof
  const MIN_SOCIAL_COUNT = 5;
  const clientCount = e._count?.clients ?? 0;
  const showRealCount = clientCount >= MIN_SOCIAL_COUNT;
  const showUrgencyBadge = status === 'Lançamento' || status === 'Em Construção';

  // Form progress
  const formProgress = React.useMemo(() => {
    let total = 2; let filled = 0;
    if (formName.trim().length >= 2) filled++;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formEmail.trim().toLowerCase())) filled++;
    const phoneDigits = formPhone.replace(/\D/g, '');
    if (phoneDigits.length >= 10) total++, filled++;
    if (enterprise?.formFields) { for (const field of enterprise.formFields) { if (field.required) { total++; const val = customAnswers[field.id]; if (val && val.trim() !== '') filled++; } } }
    return Math.min(100, Math.round((filled / total) * 100));
  }, [formName, formEmail, formPhone, customAnswers, enterprise?.formFields]);

  // Differential categorization
  const diffCategories = React.useMemo(() => {
    if (!info?.differentials || info.differentials.length === 0) return [];
    const cats: { name: string; keywords: string[]; icon: string }[] = [
      { name: t('differentials.tabs.social'), keywords: ['churrasqueira', 'salão', 'festa', 'playground', 'brinquedoteca', 'piscina', 'spa', 'quadra', 'sauna', 'jogos', 'cinema', 'pet', 'dog', 'bike', 'bicicleta', 'gourmet', 'esport', 'lazer', 'ginásio', 'ginasio'], icon: 'Users' },
      { name: t('differentials.tabs.comfort'), keywords: ['varanda', 'sacada', 'terraço', 'cozinha', 'armário', 'closet', 'depósito', 'elevador', 'portaria', 'lavanderia', 'delivery', 'estacionamento', 'garagem', 'água quente', 'ar condicionado', 'ventilação', 'iluminação natural', 'pé-direito', 'acabamento', 'porcelanato', 'hidráulica', 'mármore', 'amplo'], icon: 'LayoutGrid' },
      { name: t('differentials.tabs.tech'), keywords: ['automat', 'smart', 'inteligente', 'fibra', 'internet', 'digital', 'biometria', 'segurança', 'camer', 'monitoramento', 'cerca', 'alarme', 'câmera', 'vigilância', 'porteiro', 'controle', '24h', '24 horas'], icon: 'Shield' },
      { name: t('differentials.tabs.sustainability'), keywords: ['sustent', 'solar', 'painel', 'energia', 'reaproveitamento', 'recicl', 'verde', 'natural', 'ecol', 'permeável', 'jardim', 'paisagism', 'biodiversidade', 'captação', 'reuso', 'água pluvial'], icon: 'TrendingUp' },
    ];
    const assigned: number[] = []; const result: { name: string; icon: string; items: string[] }[] = [];
    for (const cat of cats) {
      const items: string[] = [];
      (info!.differentials).forEach((d, i) => { if (assigned.includes(i)) return; const lower = d.toLowerCase(); if (cat.keywords.some((k) => lower.includes(k))) { items.push(d); assigned.push(i); } });
      if (items.length > 0) result.push({ name: cat.name, icon: cat.icon, items });
    }
    const remaining = info!.differentials.filter((_, i) => !assigned.includes(i));
    if (remaining.length > 0) result.push({ name: t('differentials.tabs.others'), icon: 'Sparkles', items: remaining });
    return result;
  }, [info?.differentials, t]);

  const diffIconMap: Record<string, React.ReactNode> = {
    Users: <Users className="h-4 w-4" />, LayoutGrid: <LayoutGrid className="h-4 w-4" />, Shield: <Shield className="h-4 w-4" />, TrendingUp: <TrendingUp className="h-4 w-4" />, Sparkles: <Sparkles className="h-4 w-4" />,
  };

  /* goPrev/goNext removed — now in LandingLightbox component */

  const scrollToForm = () => {
    const form = document.getElementById('cadastro');
    if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* ════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════ */
  return (
    <div className="min-h-screen bg-[#F7F6F3] text-[#1a1a1a] [word-break:break-word]" style={{ overflowX: 'clip' }}>

      {/* ── Keyframes ── */}
      <style>{`
        @keyframes slide-up-bar { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .animate-slide-up-bar { animation: slide-up-bar 0.4s ease-out forwards; }
        @keyframes fade-in-up { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in-up { animation: fade-in-up 0.6s ease-out forwards; }
        @keyframes pulse-ring { 0% { transform: scale(1); opacity: 0.6; } 100% { transform: scale(1.8); opacity: 0; } }
        .animate-pulse-ring { animation: pulse-ring 2s ease-out infinite; }
        @media screen and (max-width: 640px) { .lp-input-mobile { font-size: 16px !important; } }
        .lp-scrollbar::-webkit-scrollbar { height: 4px; }
        .lp-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .lp-scrollbar::-webkit-scrollbar-thumb { background: #1a1a1a/15; border-radius: 999px; }
        .lp-gallery-card { transition: transform 0.3s ease, box-shadow 0.3s ease; }
        .lp-gallery-card:active { transform: scale(0.98); }
      `}</style>

      {/* ══════════════════════════════════════════════════
          1. NAVIGATION
          ══════════════════════════════════════════════════ */}
      <nav className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 ${scrolled ? 'bg-white/95 backdrop-blur-xl border-b border-[#1a1a1a]/[0.06] shadow-lg shadow-black/[0.04]' : 'bg-transparent'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between">
          <a href="/empreendimentos" className="flex items-center gap-2.5 group">
            <div className="h-8 w-8 rounded-lg bg-[#33492F] flex items-center justify-center shadow-lg shadow-[#33492F]/20 group-hover:shadow-[#33492F]/40 transition-shadow">
              <Building2 className="h-3.5 w-3.5 text-white" />
            </div>
            <span className={`text-sm font-bold tracking-tight hidden sm:block ${scrolled ? 'text-[#1a1a1a]' : 'text-white'}`}>{t('nav.brand')}</span>
          </a>
          <a
            href="#cadastro"
            className="min-h-[44px] inline-flex items-center justify-center px-5 sm:px-6 py-2.5 sm:py-3 rounded-full bg-[#33492F] text-white text-xs sm:text-sm font-semibold hover:bg-[#33492F]/90 transition-colors shadow-lg shadow-[#33492F]/20"
          >
            {t('nav.cta')}
          </a>
          <LanguageSwitcher />
        </div>
      </nav>

      {/* ══════════════════════════════════════════════════
          2. HERO SECTION
          ══════════════════════════════════════════════════ */}
      <section id="hero" className="relative min-h-[100dvh] min-h-[640px] flex items-end">
        {heroImage && (
          <div className="absolute inset-0">
            <Image src={heroImage} alt={e.name} fill className="object-cover" priority sizes="(max-width: 640px) 100vw, (max-width: 1024px) 80vw, 1200px" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/40 to-black/15" />
          </div>
        )}
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 pb-10 sm:pb-20 pt-28 sm:pt-36 w-full">
          {/* Title */}
          <h1 className="text-4xl sm:text-6xl lg:text-[5.5rem] font-bold tracking-tight leading-[1.02] max-w-5xl text-white [text-shadow:0_2px_20px_rgba(0,0,0,0.4),0_1px_4px_rgba(0,0,0,0.3)]">
            {displayTitle}
          </h1>

          {/* Subtitle */}
          {displaySubtitle && (
            <p className="mt-4 sm:mt-6 text-lg sm:text-2xl lg:text-[1.7rem] text-white/90 max-w-2xl leading-relaxed [text-shadow:0_1px_8px_rgba(0,0,0,0.35)]">{displaySubtitle}</p>
          )}

          {/* Mini-form (name + phone) */}
          <div className="mt-5 sm:mt-8 animate-fade-in-up max-w-lg">
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
                    if (form) { form.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => { const ni = document.getElementById('form-name') as HTMLInputElement | null; if (ni) { ni.focus(); ni.classList.add('ring-2', 'ring-[#33492F]'); setTimeout(() => ni.classList.remove('ring-2', 'ring-[#33492F]'), 3000); } }, 600); }
                    return;
                  }
                  if (heroPhone.length < 10 && heroPhone.length > 0) return;
                  setFormName(heroName);
                  setFormPhone(heroPhone.length >= 10 ? (document.getElementById('hero-phone') as HTMLInputElement)?.value || '' : '');
                  const form = document.getElementById('landing-form') as HTMLFormElement | null;
                  if (form) { form.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => { const ei = document.getElementById('form-email') as HTMLInputElement | null; if (ei && !formEmail.trim()) { ei.focus(); ei.classList.add('ring-2', 'ring-[#33492F]'); setTimeout(() => ei.classList.remove('ring-2', 'ring-[#33492F]'), 3000); } }, 600); }
                } catch {}
              }}
              className="w-full"
            >
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                  <input id="hero-name" type="text" placeholder={t('hero.namePlaceholder')} autoComplete="name" required
                    className="lp-input-mobile w-full min-h-[44px] pl-10 pr-4 py-3 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[#33492F]/50 focus:ring-1 focus:ring-[#33492F]/20 transition-all" />
                </div>
                <div className="flex-1 relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                  <input id="hero-phone" type="tel" inputMode="numeric" placeholder={t('hero.phonePlaceholder')} autoComplete="tel" required
                    onChange={(ev) => { const d = ev.target.value.replace(/\D/g, '').slice(0, 11); let m = ''; if (d.length > 0) m += `(${d.slice(0, 2)}`; if (d.length > 2) m += `) ${d.slice(2, 7)}`; if (d.length > 7) m += `-${d.slice(7)}`; ev.target.value = m; }}
                    className="lp-input-mobile w-full min-h-[44px] pl-10 pr-4 py-3 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[#33492F]/50 focus:ring-1 focus:ring-[#33492F]/20 transition-all" />
                </div>
                <button type="submit" onClick={() => { try { (window as any).CRMPIXEL?.trackCTA('hero_form', 'Saber mais', 'hero', 'primary'); } catch {} }}
                  className="flex-shrink-0 min-h-[44px] flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#33492F] text-white font-bold text-sm hover:bg-[#33492F]/90 transition-all shadow-lg shadow-[#33492F]/25 hover:shadow-[#33492F]/40 active:scale-[0.98]">
                  <Send className="h-4 w-4" /><span>{t('hero.cta')}</span>
                </button>
              </div>
              <p className="text-[11px] text-white/30 mt-1.5 text-center sm:text-left">{t('hero.noCommitment')}</p>
            </form>
          </div>

          {/* Secondary CTAs */}
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <a href="#cadastro" className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.08] border border-white/[0.15] text-white font-medium text-xs hover:bg-white/[0.15] transition-all backdrop-blur-sm">
              <MessageSquare className="h-3.5 w-3.5" /> {t('hero.seeDetails')}
            </a>
            <button type="button" onClick={() => openWhatsApp('hero', 'hero', 'secondary')} className="min-h-[44px] inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#25D366] text-white font-semibold text-xs hover:bg-[#20bd5a] transition-all shadow-lg shadow-[#25D366]/25">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" dangerouslySetInnerHTML={{ __html: WHATSAPP_ICON }} />
              {t('hero.talkToConsultant')}
            </button>
          </div>
        </div>

        {/* Scroll indicator (desktop) */}
        <div className="absolute bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 animate-bounce hidden sm:flex">
          <span className="text-[10px] text-white/30 uppercase tracking-widest">{t('hero.scroll')}</span>
          <div className="w-px h-8 bg-gradient-to-b from-white/30 to-transparent" />
        </div>
      </section>

      {/* ══════════════════════════════════════════════════
          3. SOCIAL PROOF BAR
          ══════════════════════════════════════════════════ */}
      <section id="social-proof" className="bg-[#33492F]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 sm:py-7">
          <div className="flex items-center justify-center gap-4 sm:gap-8 flex-wrap">
            {showRealCount ? (
              <div id="social-proof-counter" className="flex items-center gap-2.5 text-white/80">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
                </span>
                <span className="text-sm sm:text-base font-semibold"><span className="text-white">{animatedCount || clientCount}</span> {t('socialProof.person', { count: clientCount })} {t('socialProof.interested', { count: clientCount })}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 text-white/70">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
                </span>
                <span className="text-sm">{socialProofPool[socialProofIdx]?.message} — <span className="text-white/50">{socialProofPool[socialProofIdx]?.time}</span></span>
              </div>
            )}
            <div className="hidden sm:block h-4 w-px bg-white/20" />
            <div className="flex items-center gap-1.5 text-xs sm:text-sm text-white/50">
              <Shield className="h-3.5 w-3.5" /> {t('socialProof.dataProtected')}
            </div>
            <div className="flex items-center gap-1.5 text-xs sm:text-sm text-white/50">
              <Clock className="h-3.5 w-3.5" /> {t('socialProof.response24h')}
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════
          4. SUMMARY SECTION
          ══════════════════════════════════════════════════ */}
      {(info.totalUnits || areaRange || info.floors || info.parkingSpots || status || deliveryText) && (
        <ScrollReveal>
          <section id="summary" className="bg-white">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
                {status && (
                  <div className="text-center p-4 sm:p-5 rounded-2xl bg-[#F7F6F3]">
                    <CheckCircle2 className={`h-5 w-5 mx-auto mb-2 ${status === 'Entregue' ? 'text-emerald-600' : status === 'Em Construção' ? 'text-amber-600' : 'text-[#33492F]'}`} />
                    <p className={`text-sm sm:text-base font-bold ${status === 'Entregue' ? 'text-emerald-700' : status === 'Em Construção' ? 'text-amber-700' : 'text-[#33492F]'}`}>{status}</p>
                    <p className="text-[11px] sm:text-xs text-[#1a1a1a]/40 mt-1">{t('summary.status')}</p>
                  </div>
                )}
                {deliveryText && (
                  <div className="text-center p-4 sm:p-5 rounded-2xl bg-[#F7F6F3]">
                    <CalendarDays className="h-5 w-5 text-[#33492F] mx-auto mb-2" />
                    <p className="text-sm sm:text-base font-bold text-[#33492F]">{deliveryText}</p>
                    <p className="text-[11px] sm:text-xs text-[#1a1a1a]/40 mt-1">{t('summary.delivery')}</p>
                  </div>
                )}
                {info.totalUnits != null && info.totalUnits > 0 && (
                  <div className="text-center p-4 sm:p-5 rounded-2xl bg-[#F7F6F3]">
                    <Building2 className="h-5 w-5 text-[#33492F] mx-auto mb-2" />
                    <p className="text-xl sm:text-2xl font-bold text-[#33492F]">{info.totalUnits}</p>
                    <p className="text-[11px] sm:text-xs text-[#1a1a1a]/40 mt-1">{t('summary.units')}</p>
                  </div>
                )}
                {areaRange && (
                  <div className="text-center p-4 sm:p-5 rounded-2xl bg-[#F7F6F3]">
                    <Ruler className="h-5 w-5 text-[#33492F] mx-auto mb-2" />
                    <p className="text-xl sm:text-2xl font-bold text-[#33492F]">{areaRange}</p>
                    <p className="text-[11px] sm:text-xs text-[#1a1a1a]/40 mt-1">{t('summary.area')}</p>
                  </div>
                )}
                {info.floors != null && info.floors > 0 && (
                  <div className="text-center p-4 sm:p-5 rounded-2xl bg-[#F7F6F3]">
                    <Layers className="h-5 w-5 text-[#33492F] mx-auto mb-2" />
                    <p className="text-xl sm:text-2xl font-bold text-[#33492F]">{info.floors}</p>
                    <p className="text-[11px] sm:text-xs text-[#1a1a1a]/40 mt-1">{t('summary.floors')}</p>
                  </div>
                )}
                {info.parkingSpots != null && info.parkingSpots > 0 && (
                  <div className="text-center p-4 sm:p-5 rounded-2xl bg-[#F7F6F3]">
                    <Car className="h-5 w-5 text-[#33492F] mx-auto mb-2" />
                    <p className="text-xl sm:text-2xl font-bold text-[#33492F]">{info.parkingSpots}</p>
                    <p className="text-[11px] sm:text-xs text-[#1a1a1a]/40 mt-1">{t('summary.parking')}</p>
                  </div>
                )}
              </div>
            </div>
          </section>
        </ScrollReveal>
      )}

      {/* ══════════════════════════════════════════════════
          5. WHY VITTA (3 Value Props)
          ══════════════════════════════════════════════════ */}
      <ScrollReveal>
        <section id="why-vitta" className="bg-[#F7F6F3]">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
            <p className="text-[11px] sm:text-xs font-medium text-[#1a1a1a]/30 uppercase tracking-[0.15em] mb-2 text-center">{t('why.eyebrow')}</p>
            <div className="text-center mb-8 sm:mb-12">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1a1a1a]">{t('why.title', { name: e.name })}</h2>
              <p className="text-sm text-[#1a1a1a]/40 mt-2">{t('why.subtitle')}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
              {/* Location Card */}
              <div className="rounded-3xl bg-white border border-[#1a1a1a]/[0.04] p-5 sm:p-6 hover:border-[#33492F]/15 hover:shadow-md transition-all">
                <div className="h-10 w-10 rounded-xl bg-[#33492F]/10 flex items-center justify-center mb-4">
                  <MapPin className="h-5 w-5 text-[#33492F]" />
                </div>
                <h3 className="text-base font-semibold text-[#1a1a1a] mb-2">{t('why.locationTitle')}</h3>
                <p className="text-sm text-[#1a1a1a]/50 leading-relaxed">
                  {info?.location?.neighborhood || info?.location?.city
                    ? t('why.locationDesc', { neighborhood: `${info.location.neighborhood || info.location.city}${info.location.city && info.location.neighborhood ? ', ' + info.location.city : ''}` })
                    : t('why.locationDescFallback')}
                </p>
              </div>
              {/* Differentials Card */}
              <div className="rounded-3xl bg-white border border-[#1a1a1a]/[0.04] p-5 sm:p-6 hover:border-[#33492F]/15 hover:shadow-md transition-all">
                <div className="h-10 w-10 rounded-xl bg-[#C9A96E]/10 flex items-center justify-center mb-4">
                  <Sparkles className="h-5 w-5 text-[#C9A96E]" />
                </div>
                <h3 className="text-base font-semibold text-[#1a1a1a] mb-2">{t('why.differentialsTitle')}</h3>
                <p className="text-sm text-[#1a1a1a]/50 leading-relaxed">
                  {info?.differentials && info.differentials.length > 0
                    ? t('why.differentialsDesc', { differentials: info.differentials.slice(0, 3).join(', ') })
                    : t('why.differentialsDescFallback')}
                </p>
              </div>
              {/* Investment Card */}
              <div className="rounded-3xl bg-white border border-[#1a1a1a]/[0.04] p-5 sm:p-6 hover:border-[#33492F]/15 hover:shadow-md transition-all">
                <div className="h-10 w-10 rounded-xl bg-emerald-50 flex items-center justify-center mb-4">
                  <TrendingUp className="h-5 w-5 text-emerald-600" />
                </div>
                <h3 className="text-base font-semibold text-[#1a1a1a] mb-2">{t('why.investmentTitle')}</h3>
                <p className="text-sm text-[#1a1a1a]/50 leading-relaxed">
                  {t('why.investmentDesc')}
                </p>
              </div>
            </div>
          </div>
        </section>
      </ScrollReveal>

      {/* ══════════════════════════════════════════════════
          5.5 MID-PAGE CTA STRIP — WhatsApp (catches 45% drop-off)
          ══════════════════════════════════════════════════ */}
      <div className="bg-[#33492F]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-center sm:text-left">
            <p className="text-white font-bold text-base sm:text-lg">{t('midCta.title')}</p>
            <p className="text-white/50 text-xs sm:text-sm mt-1">{t('midCta.subtitle')}</p>
          </div>
          <button type="button" onClick={() => openWhatsApp('mid_page', 'why-vitta', 'cta_strip')}
            className="flex-shrink-0 min-h-[48px] inline-flex items-center gap-2.5 px-6 py-3 rounded-xl bg-[#25D366] text-white font-bold text-sm hover:bg-[#20bd5a] transition-all shadow-lg shadow-[#25D366]/20 active:scale-[0.98]">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" dangerouslySetInnerHTML={{ __html: WHATSAPP_ICON }} />
            {t('midCta.button')}
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════
          6. LEISURE & DIFFERENTIALS (Tabbed Cards)
          ══════════════════════════════════════════════════ */}
      {diffCategories.length > 0 && (
        <ScrollReveal>
          <section id="differentials" className="bg-white">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
              <p className="text-[11px] sm:text-xs font-medium text-[#1a1a1a]/30 uppercase tracking-[0.15em] mb-2">{t('differentials.eyebrow')}</p>
              <div className="text-center mb-8 sm:mb-10">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1a1a1a]">{t('differentials.title')}</h2>
                <p className="text-sm text-[#1a1a1a]/40 mt-2">{t('differentials.subtitle')}</p>
              </div>

              {/* Tabs */}
              <div className="flex flex-wrap justify-center gap-2 mb-6 sm:mb-8">
                {diffCategories.map((cat, i) => (
                  <button key={cat.name} onClick={() => setActiveDiffTab(i)}
                    className={`flex-shrink-0 min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-xs sm:text-sm font-medium transition-all ${
                      activeDiffTab === i ? 'bg-[#33492F] text-white shadow-lg shadow-[#33492F]/20' : 'bg-[#F7F6F3] text-[#1a1a1a]/50 hover:text-[#1a1a1a]/70 hover:bg-[#1a1a1a]/[0.06]'
                    }`}>
                    {diffIconMap[cat.icon]} {cat.name}
                  </button>
                ))}
              </div>

              {/* Tab content — visual cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                {(diffCategories[activeDiffTab]?.items || []).map((d, i) => (
                  <div key={i} className="flex items-start gap-3.5 px-5 py-4 rounded-2xl bg-[#F7F6F3] border border-[#1a1a1a]/[0.04] hover:border-[#33492F]/15 hover:shadow-sm transition-all">
                    <div className="flex-shrink-0 h-8 w-8 rounded-xl bg-[#33492F]/10 flex items-center justify-center mt-0.5">
                      <CheckCircle2 className="h-4 w-4 text-[#33492F]" />
                    </div>
                    <span className="text-sm text-[#1a1a1a]/70 leading-relaxed pt-1">{d}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </ScrollReveal>
      )}

      {/* ══════════════════════════════════════════════════
          7. APARTMENT TYPES (Horizontal scroll mobile)
          ══════════════════════════════════════════════════ */}
      {info?.apartmentTypes && info.apartmentTypes.length > 0 && !hasAdminFloorPlans && (
        <ScrollReveal>
          <section id="apartments" className="bg-[#F7F6F3]">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
              <p className="text-[11px] sm:text-xs font-medium text-[#1a1a1a]/30 uppercase tracking-[0.15em] mb-2">{t('apartments.eyebrow')}</p>
              <div className="flex items-end justify-between mb-8 sm:mb-10">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1a1a1a]">{t('apartments.title')}</h2>
                  <p className="text-sm text-[#1a1a1a]/40 mt-2">{t('apartments.subtitle')}</p>
                </div>
              </div>
              {/* Grid layout — no horizontal scroll */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
                {info.apartmentTypes.map((apt, i) => (
                  <div key={i} className="rounded-3xl bg-white border border-[#1a1a1a]/[0.04] p-5 sm:p-6 hover:border-[#33492F]/15 hover:shadow-md transition-all">
                    <h3 className="text-base font-semibold text-[#1a1a1a] mb-3">{apt.name || t('apartments.typeFallback', { n: i + 1 })}</h3>
                    <div className="space-y-2.5">
                      {apt.bedrooms && (
                        <div className="flex items-center gap-2.5 text-sm text-[#1a1a1a]/60">
                          <div className="h-7 w-7 rounded-lg bg-[#33492F]/8 flex items-center justify-center flex-shrink-0"><BedDouble className="h-3.5 w-3.5 text-[#33492F]/60" /></div>
                          {apt.bedrooms}
                        </div>
                      )}
                      {apt.area && (
                        <div className="flex items-center gap-2.5 text-sm text-[#1a1a1a]/60">
                          <div className="h-7 w-7 rounded-lg bg-[#33492F]/8 flex items-center justify-center flex-shrink-0"><Ruler className="h-3.5 w-3.5 text-[#33492F]/60" /></div>
                          {apt.area}
                        </div>
                      )}
                      {apt.price && (
                        <div className="flex items-center gap-2.5 text-sm font-semibold text-[#C9A96E]">
                          <div className="h-7 w-7 rounded-lg bg-[#C9A96E]/10 flex items-center justify-center flex-shrink-0"><DollarSign className="h-3.5 w-3.5 text-[#C9A96E]" /></div>
                          {apt.price}
                        </div>
                      )}
                    </div>
                    {apt.description && <p className="text-xs text-[#1a1a1a]/40 mt-4 leading-relaxed">{apt.description}</p>}
                  </div>
                ))}
              </div>


            </div>
          </section>
        </ScrollReveal>
      )}

      {/* ══════════════════════════════════════════════════
          7.5 FLOOR PLANS (Accordion: card + inline image)
          ══════════════════════════════════════════════════ */}
      {e.floorPlans && e.floorPlans.length > 0 && (
        <ScrollReveal>
          <section id="plantas" className="bg-[#33492F]">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
              <div className="max-w-2xl mb-8 sm:mb-10">
                <p className="text-[11px] sm:text-xs font-medium text-[#C9A96E] uppercase tracking-[0.15em] mb-2">{t('floorPlans.eyebrow')}</p>
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">{t('floorPlans.title')}</h2>
                <p className="text-sm text-white/50 mt-2 max-w-xl">{t('floorPlans.subtitle')}</p>
              </div>
              <div className="flex flex-col gap-2">
                {e.floorPlans.map((plan, i) => {
                  const label = buildPlantLabel(plan);
                  const isSelected = i === selectedPlanIdx;
                  return (
                    <div key={plan.id}>
                      <button
                        type="button"
                        onClick={() => { setSelectedPlanIdx(isSelected ? -1 : i); try { (window as any).CRMPIXEL?.trackGalleryClick(i, e.floorPlans.length); } catch {} }}
                        className={`w-full text-left rounded-2xl p-4 sm:p-5 transition-all duration-300 border min-h-[44px] ${isSelected ? 'bg-white/25 border-[#C9A96E] shadow-lg rounded-b-none' : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/20'}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-[0.1em] mb-1 text-[#C9A96E]">{label}</p>
                            <h3 className={`text-sm sm:text-base font-semibold leading-snug ${isSelected ? 'text-white' : 'text-white/80'}`}>{plan.name || t('floorPlans.plan') + ' ' + (i + 1)}</h3>
                            {plan.description && <p className={`text-xs sm:text-sm mt-1 ${isSelected ? 'text-white/70' : 'text-white/40'}`}>{plan.description}</p>}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className={`text-sm sm:text-lg font-semibold whitespace-nowrap ${isSelected ? 'text-white' : 'text-white/80'}`}>{plan.area || '—'}</p>
                            <span className={`mt-1 inline-block text-xs font-medium transition-colors duration-300 ${isSelected ? 'text-[#C9A96E]' : 'text-white/30'}`}>
                              {isSelected ? t('floorPlans.close') : t('floorPlans.viewPlan')}
                            </span>
                          </div>
                        </div>
                      </button>
                      {/* Inline image — expands below the card */}
                      <div className={`overflow-hidden transition-all duration-500 ease-in-out ${isSelected ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0'}`}>
                        <div className="bg-white/10 border border-t-0 border-white/15 rounded-b-2xl p-4 sm:p-6">
                          {plan.url ? (
                            <div className="relative w-full max-w-2xl mx-auto aspect-square">
                              <img
                                src={plan.url}
                                alt={plan.altText || `${plan.name || t('floorPlans.plan')}`}
                                className="w-full h-full object-contain"
                                loading="lazy"
                                decoding="async"
                              />
                            </div>
                          ) : (
                            <div className="w-full max-w-2xl mx-auto aspect-square flex items-center justify-center bg-white/5 rounded-2xl">
                              <div className="text-center text-white/30">
                                <LayoutGrid className="h-12 w-12 mx-auto mb-3" />
                                <p className="text-sm">{t('floorPlans.noImage')}</p>
                              </div>
                            </div>
                          )}
                          <p className="mt-3 text-white/25 text-[10px] sm:text-xs leading-relaxed text-center">{t('floorPlans.disclaimer')}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {/* CTA card */}
                <button
                  type="button"
                  onClick={() => { scrollToForm(); try { (window as any).CRMPIXEL?.trackCTAClick('floor_plan_book'); } catch {} }}
                  className="w-full text-left rounded-2xl p-4 sm:p-5 bg-[#C9A96E] hover:bg-[#C9A96E]/85 transition-colors min-h-[44px]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] sm:text-xs font-medium uppercase tracking-[0.1em] mb-1 text-[#1a1a1a]/50">{t('floorPlans.bookEyebrow')}</p>
                      <h3 className="text-sm sm:text-base font-semibold text-[#1a1a1a] leading-snug">{t('floorPlans.bookCta')}</h3>
                    </div>
                    <span className="shrink-0 mt-1 text-[#1a1a1a]">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
                    </span>
                  </div>
                </button>
              </div>
            </div>
          </section>
        </ScrollReveal>
      )}

      {/* ══════════════════════════════════════════════════
          8. GALLERY (Horizontal scroll cards with lightbox)
          ══════════════════════════════════════════════════ */}
      {images.length > 0 && (
        <ScrollReveal>
          <section id="galeria" className="bg-white">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
              <p className="text-[11px] sm:text-xs font-medium text-[#1a1a1a]/30 uppercase tracking-[0.15em] mb-2">{t('gallery.eyebrow')}</p>
              <div className="mb-8 sm:mb-10">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1a1a1a]">{t('gallery.title', { name: e.name })}</h2>
                  <p className="text-sm text-[#1a1a1a]/40 mt-2">{t('gallery.photoCount', { count: images.length })}</p>
                </div>
              </div>

              {/* Mosaic grid — 2 cols mobile, 3 cols desktop */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                {images.map((img, idx) => (
                  <button key={img.id} type="button" onClick={() => { startTransition(() => { setActiveImgIdx(idx); setLightboxOpen(true); }); try { (window as any).CRMPIXEL?.trackGalleryClick(idx, images.length); } catch {} }}
                    className="lp-gallery-card group relative w-full overflow-hidden rounded-2xl bg-[#1a1a1a]/[0.06] aspect-[4/3] hover:shadow-lg transition-all duration-300">
                    <img src={img.url} alt={img.altText || `${e.name} - ${t('gallery.photoAlt', { n: idx + 1 })}`} width={680} height={510} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" loading={idx < 4 ? 'eager' : 'lazy'} decoding="async" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <div className="h-12 w-12 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-lg">
                        <ZoomIn className="h-5 w-5 text-[#1a1a1a]" />
                      </div>
                    </div>
                    {/* Image counter on first card */}
                    {idx === 0 && images.length > 1 && (
                      <div className="absolute bottom-3 right-3 bg-black/50 backdrop-blur-sm text-white text-[11px] px-3 py-1.5 rounded-full">
                        {t('gallery.countBadge', { count: images.length })}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </ScrollReveal>
      )}

      {/* ══════════════════════════════════════════════════
          9. LOCATION
          ══════════════════════════════════════════════════ */}
      {(info?.location?.address || info?.location?.neighborhood || info?.location?.city || e.region) && (
        <ScrollReveal>
          <section id="location" className="bg-[#F7F6F3]">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
              <p className="text-[11px] sm:text-xs font-medium text-[#1a1a1a]/30 uppercase tracking-[0.15em] mb-2 text-center">{t('location.eyebrow')}</p>
              <div className="text-center mb-8 sm:mb-10">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1a1a1a]">{t('location.title')}</h2>
              </div>
              <div className="rounded-3xl bg-white border border-[#1a1a1a]/[0.04] shadow-sm overflow-hidden">
                {/* Map */}
                {(mapAddress || (e.mapLatitude != null && e.mapLongitude != null)) && (
                  <LocationMap address={mapAddress} location={info?.location || {}} dbLatitude={e.mapLatitude} dbLongitude={e.mapLongitude} className="h-[260px] sm:h-[380px] lg:h-[420px]" />
                )}
                {/* Address details */}
                <div className="p-5 sm:p-8 space-y-3">
                  {info?.location?.address && (
                    <div className="flex items-start gap-3">
                      <MapPin className="h-4 w-4 text-[#33492F] flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-[#1a1a1a]/60">{info.location.address}</p>
                    </div>
                  )}
                  {(info?.location?.neighborhood || info?.location?.city) && (
                    <div className="flex items-start gap-3">
                      <Navigation className="h-4 w-4 text-[#33492F] flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-[#1a1a1a]/60">{[info?.location?.neighborhood, info?.location?.city, info?.location?.state].filter(Boolean).join(', ')}</p>
                    </div>
                  )}
                  {info?.location?.additionalInfo && (
                    <div className="flex items-start gap-3">
                      <Map className="h-4 w-4 text-[#33492F] flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-[#1a1a1a]/60">{info.location.additionalInfo}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </ScrollReveal>
      )}

      {/* ══════════════════════════════════════════════════
          10. FAQ (Objection Reduction)
          ══════════════════════════════════════════════════ */}
      <ScrollReveal>
        <section id="faq" className="bg-white">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
            <p className="text-[11px] sm:text-xs font-medium text-[#1a1a1a]/30 uppercase tracking-[0.15em] mb-2 text-center">{t('faq.eyebrow')}</p>
            <div className="text-center mb-8 sm:mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1a1a1a]">{t('faq.title')}</h2>
              <p className="text-sm text-[#1a1a1a]/40 mt-2">{t('faq.subtitle')}</p>
            </div>
            <div className="space-y-3">
              {faqItems.map((item, idx) => (
                <div key={idx} className={`rounded-2xl border transition-all duration-300 overflow-hidden ${faqOpenIndex === idx ? 'border-[#33492F]/25 bg-[#F7F6F3] shadow-sm' : 'border-[#1a1a1a]/[0.06] bg-white hover:border-[#1a1a1a]/[0.12]'}`}>
                  <button onClick={() => { if (faqOpenIndex !== idx && typeof window !== 'undefined' && window.CRMPIXEL) window.CRMPIXEL.trackFAQOpen(idx, faqItems[idx]?.question); setFaqOpenIndex(faqOpenIndex === idx ? null : idx); }}
                    className="w-full flex items-center justify-between gap-4 p-4 sm:p-5 text-left min-h-[44px]">
                    <span className={`text-sm sm:text-[15px] font-semibold transition-colors ${faqOpenIndex === idx ? 'text-[#33492F]' : 'text-[#1a1a1a]/80'}`}>{item.question}</span>
                    <ChevronDown className={`h-5 w-5 flex-shrink-0 transition-transform duration-300 ${faqOpenIndex === idx ? 'rotate-180 text-[#33492F]' : 'text-[#1a1a1a]/30'}`} />
                  </button>
                  <div className={`overflow-hidden transition-all duration-300 ease-in-out ${faqOpenIndex === idx ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
                    <div className="px-4 sm:px-5 pb-4 sm:pb-5">
                      <div className="h-px bg-[#33492F]/10 mb-3" />
                      <p className="text-sm text-[#1a1a1a]/60 leading-relaxed">{item.answer}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 sm:mt-8 text-center">
              <p className="text-sm text-[#1a1a1a]/40 mb-3">{t('faq.hasQuestion')}</p>
              <button type="button" onClick={() => openWhatsApp('faq_cta', 'faq', 'bottom')}
                className="min-h-[44px] inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#25D366] text-white font-semibold text-sm hover:bg-[#20bd5a] transition-colors shadow-lg shadow-[#25D366]/15">
                <Phone className="h-4 w-4" /> {t('faq.talkToConsultant')}
              </button>
            </div>
          </div>
        </section>
      </ScrollReveal>

      {/* ══════════════════════════════════════════════════
          11. LEAD CAPTURE FORM
          ══════════════════════════════════════════════════ */}
      <ScrollReveal>
        <section id="cadastro" className="bg-[#F7F6F3]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14 sm:py-24 lg:py-32">
            <div className="grid lg:grid-cols-2 gap-8 lg:gap-14 items-start">
              {/* Left — CTA copy */}
              <div className="order-2 lg:order-1">
                <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-2xl bg-[#33492F]/10 flex items-center justify-center mb-4 sm:mb-5">
                  <Home className="h-5 w-5 sm:h-6 sm:w-6 text-[#33492F]" />
                </div>
                <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-3 text-[#1a1a1a] leading-tight" dangerouslySetInnerHTML={{ __html: t('form.headingHtml', { name: e.name }) }} />
                <p className="text-[#33492F]/80 text-sm sm:text-base font-medium mb-2">
                  {showUrgencyBadge ? t('form.subtextWithInfo', { status }) : priceText ? t('form.subtextWithPrice', { price: priceText.replace('a partir de ', '') }) : t('form.subtextFallback')}
                </p>
                <p className="text-[#1a1a1a]/50 max-w-md text-sm sm:text-base leading-relaxed mb-5 sm:mb-6">
                  {e.landingDescription || `${t('form.descriptionBase')}${info?.location?.neighborhood ? ` ${t('form.descriptionIn', { neighborhood: info.location.neighborhood })}` : ''}. ${t('form.descriptionEnd')}`}
                </p>
                {/* Quick-value bullets */}
                <ul className="space-y-2 mb-5 sm:mb-6">
                  {areaRange && <li className="flex items-center gap-2 text-sm text-[#1a1a1a]/50"><Ruler className="h-3.5 w-3.5 text-[#33492F]/50" /> {t('form.areaRange', { areaRange })}</li>}
                  {info?.totalUnits && info.totalUnits > 0 && <li className="flex items-center gap-2 text-sm text-[#1a1a1a]/50"><Building2 className="h-3.5 w-3.5 text-[#33492F]/50" /> {t('form.unitCount', { count: info.totalUnits })}</li>}
                  {deliveryText && deliveryText !== t('summary.delivered') && <li className="flex items-center gap-2 text-sm text-[#1a1a1a]/50"><CalendarDays className="h-3.5 w-3.5 text-[#33492F]/50" /> {t('form.delivery', { deliveryText })}</li>}
                </ul>
                {/* Trust signals */}
                <div className="flex flex-wrap items-center gap-3 sm:gap-4 mb-5 sm:mb-6 text-xs sm:text-sm text-[#1a1a1a]/50">
                  <span className="flex items-center gap-1.5"><Shield className="h-3.5 w-3.5 text-[#33492F]/50" /> {t('form.dataSafe')}</span>
                  <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-[#33492F]/50" /> {t('form.response24h')}</span>
                  <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-[#33492F]/50" /> {t('form.noCommitment')}</span>
                </div>
                {/* WhatsApp CTA */}
                <button type="button" onClick={() => openWhatsApp('form_section', 'cadastro', 'left')}
                  className="min-h-[44px] inline-flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-[#25D366] text-white font-semibold text-sm hover:bg-[#20bd5a] transition-colors shadow-lg shadow-[#25D366]/15">
                  <Phone className="h-4 w-4" /> {t('form.whatsappCta')}
                </button>
              </div>

              {/* Right — Form */}
              <div ref={formSectionRef} className="relative order-1 lg:order-2">
                <div className="absolute -inset-1 sm:-inset-3 bg-[#33492F]/[0.03] rounded-3xl blur-xl" />
                <form id="landing-form" onSubmit={handleFormSubmit} className="relative z-10 rounded-3xl bg-white border border-[#1a1a1a]/[0.08] shadow-lg p-5 sm:p-8 lg:p-10 space-y-4 sm:space-y-5">
                  <div className="mb-1">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-xl font-bold text-[#1a1a1a]">{t('form.title')}</h3>
                      {formProgress > 0 && formProgress < 100 && <span className="text-xs text-[#33492F]/70 font-medium">{formProgress}%</span>}
                    </div>
                    {formProgress > 0 && (
                      <div className="h-1 w-full bg-[#1a1a1a]/[0.06] rounded-full overflow-hidden mb-1">
                        <div className="h-full rounded-full transition-all duration-500 ease-out" style={{ width: `${formProgress}%`, backgroundColor: formProgress === 100 ? '#25D366' : '#33492F' }} />
                      </div>
                    )}
                    <p className="text-sm text-[#1a1a1a]/40 mt-1">{t('form.subtitle')}</p>
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
                    <label htmlFor="form-name" className="block text-sm font-medium text-[#1a1a1a]/70 mb-2">{t('form.nameLabel')} <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#1a1a1a]/30" />
                      <input id="form-name" type="text" value={formName}
                        onChange={(ev) => { setFormName(ev.target.value); updatePixelFormFields(ev.target.value, formPhone, formEmail, customAnswers); }}
                        onFocus={() => { fieldFocusTime.current.name = Date.now(); try { (window as any).CRMPIXEL?.trackFormFocus('name'); } catch {} }}
                        onBlur={() => { const t = fieldFocusTime.current.name || Date.now(); try { (window as any).CRMPIXEL?.trackFormBlur('name', Date.now() - t); } catch {} }}
                        placeholder={t('form.namePlaceholder')} autoComplete="name" required
                        className={`lp-input-mobile w-full min-h-[44px] pl-11 pr-10 py-3.5 rounded-xl bg-white border text-sm text-[#1a1a1a] placeholder:text-[#1a1a1a]/30 focus:outline-none focus:ring-1 transition-all ${
                          formName.trim().length >= 2 ? 'border-emerald-400 focus:border-emerald-500 focus:ring-emerald-500/20' : 'border-[#1a1a1a]/[0.12] focus:border-[#33492F] focus:ring-[#33492F]/20'
                        }`} />
                      {formName.trim().length >= 2 && <Check className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-500" />}
                    </div>
                  </div>

                  {/* Email */}
                  <div>
                    <label htmlFor="form-email" className="block text-sm font-medium text-[#1a1a1a]/70 mb-2">{t('form.emailLabel')} <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#1a1a1a]/30" />
                      <input id="form-email" type="email" value={formEmail}
                        onChange={(ev) => { setFormEmail(ev.target.value); updatePixelFormFields(formName, formPhone, ev.target.value, customAnswers); }}
                        onFocus={() => { fieldFocusTime.current.email = Date.now(); try { (window as any).CRMPIXEL?.trackFormFocus('email'); } catch {} }}
                        onBlur={() => { const t = fieldFocusTime.current.email || Date.now(); try { (window as any).CRMPIXEL?.trackFormBlur('email', Date.now() - t); } catch {} }}
                        placeholder={t('form.emailPlaceholder')} autoComplete="email" required
                        className={`lp-input-mobile w-full min-h-[44px] pl-11 pr-10 py-3.5 rounded-xl bg-white border text-sm text-[#1a1a1a] placeholder:text-[#1a1a1a]/30 focus:outline-none focus:ring-1 transition-all ${
                          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formEmail.trim().toLowerCase()) ? 'border-emerald-400 focus:border-emerald-500 focus:ring-emerald-500/20' : 'border-[#1a1a1a]/[0.12] focus:border-[#33492F] focus:ring-[#33492F]/20'
                        }`} />
                      {/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formEmail.trim().toLowerCase()) && <Check className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-500" />}
                    </div>
                  </div>

                  {/* Phone */}
                  <div>
                    <label htmlFor="form-phone" className="block text-sm font-medium text-[#1a1a1a]/70 mb-2">{t('form.phoneLabel')} <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#1a1a1a]/30" />
                      <input id="form-phone" type="tel" inputMode="numeric" value={formPhone} onChange={(ev) => { handlePhoneChange(ev.target.value); updatePixelFormFields(formName, ev.target.value, formEmail, customAnswers); }}
                        onFocus={() => { fieldFocusTime.current.phone = Date.now(); try { (window as any).CRMPIXEL?.trackFormFocus('phone'); } catch {} }}
                        onBlur={() => { const t = fieldFocusTime.current.phone || Date.now(); try { (window as any).CRMPIXEL?.trackFormBlur('phone', Date.now() - t); } catch {} }}
                        placeholder={t('form.phonePlaceholder')} autoComplete="tel" required
                        className={`lp-input-mobile w-full min-h-[44px] pl-11 pr-10 py-3.5 rounded-xl bg-white border text-sm text-[#1a1a1a] placeholder:text-[#1a1a1a]/30 focus:outline-none focus:ring-1 transition-all ${
                          formPhone.replace(/\D/g, '').length >= 10 ? 'border-emerald-400 focus:border-emerald-500 focus:ring-emerald-500/20' : 'border-[#1a1a1a]/[0.12] focus:border-[#33492F] focus:ring-[#33492F]/20'
                        }`} />
                      {formPhone.replace(/\D/g, '').length >= 10 && <Check className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-500" />}
                    </div>
                  </div>

                  {/* Custom fields */}
                  {enterprise?.formFields && enterprise.formFields.length > 0 && (
                    <div className="space-y-4">
                      {enterprise.formFields.map((field) => {
                        const val = customAnswers[field.id] || '';
                        return (
                          <div key={field.id}>
                            <label htmlFor={`field-${field.id}`} className="block text-sm font-medium text-[#1a1a1a]/70 mb-2">
                              {field.label} {field.required && <span className="text-red-500">*</span>}
                            </label>
                            {field.fieldType === 'text' && (
                              <input id={`field-${field.id}`} type="text" value={val} placeholder={field.placeholder || ''}
                                onChange={(ev) => { const next = { ...customAnswers, [field.id]: ev.target.value }; setCustomAnswers(next); updatePixelFormFields(formName, formPhone, formEmail, next); }}
                                onFocus={() => { fieldFocusTime.current[field.id] = Date.now(); try { (window as any).CRMPIXEL?.trackFormFocus(field.label); } catch {} }}
                                onBlur={() => { const t = fieldFocusTime.current[field.id] || Date.now(); try { (window as any).CRMPIXEL?.trackFormBlur(field.label, Date.now() - t); } catch {} }}
                                className="lp-input-mobile w-full min-h-[44px] px-4 py-3.5 rounded-xl bg-white border border-[#1a1a1a]/[0.12] text-sm text-[#1a1a1a] placeholder:text-[#1a1a1a]/30 focus:outline-none focus:ring-1 focus:border-[#33492F] focus:ring-[#33492F]/20 transition-all" />
                            )}
                            {field.fieldType === 'select' && field.options && (
                              <select id={`field-${field.id}`} value={val} onChange={(ev) => { const next = { ...customAnswers, [field.id]: ev.target.value }; setCustomAnswers(next); updatePixelFormFields(formName, formPhone, formEmail, next); }}
                                className="lp-input-mobile w-full min-h-[44px] px-4 py-3.5 rounded-xl bg-white border border-[#1a1a1a]/[0.12] text-sm text-[#1a1a1a] focus:outline-none focus:ring-1 focus:border-[#33492F] focus:ring-[#33492F]/20 transition-all appearance-none">
                                <option value="">{field.placeholder || t('form.selectDefault')}</option>
                                {field.options.split(',').map((opt) => <option key={opt.trim()} value={opt.trim()}>{opt.trim()}</option>)}
                              </select>
                            )}
                            {field.fieldType === 'checkbox' && (
                              <label htmlFor={`field-${field.id}`} className="flex items-center gap-3 cursor-pointer group py-1">
                                <input id={`field-${field.id}`} type="checkbox" checked={val === t('form.yes')} onChange={(ev) => { const next = { ...customAnswers, [field.id]: ev.target.checked ? t('form.yes') : t('form.no') }; setCustomAnswers(next); updatePixelFormFields(formName, formPhone, formEmail, next); }}
                                  className="h-4 w-4 rounded border-[#1a1a1a]/20 bg-white text-[#33492F] focus:ring-[#33492F]/20 cursor-pointer accent-[#33492F]" />
                                <span className="text-sm text-[#1a1a1a]/50 group-hover:text-[#1a1a1a]/70 transition-colors">{field.placeholder || field.label}</span>
                              </label>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Submit */}
                  <button type="submit" disabled={formSubmitting}
                    className={`w-full min-h-[44px] flex items-center justify-center gap-2.5 px-8 py-4 rounded-2xl font-bold text-base sm:text-lg transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed mt-2 hover:scale-[1.01] active:scale-[0.99] ${
                      formProgress === 100 ? 'bg-emerald-500 text-white shadow-emerald-500/20 hover:bg-emerald-600' : 'bg-[#33492F] text-white shadow-[#33492F]/20 hover:bg-[#33492F]/90'
                    }`}>
                    {formSubmitting ? <><Loader2 className="h-5 w-5 animate-spin" /> {t('form.submitting')}</> :
                    formProgress === 100 ? <><Send className="h-4 w-4" /> {t('form.submitWithPrice')}</> :
                    <><Send className="h-4 w-4" /> {t('form.submitDefault')}</>}
                  </button>

                  {/* Trust signals */}
                  <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 pt-1">
                    <span className="flex items-center gap-1.5 text-xs text-[#1a1a1a]/30"><Shield className="h-3.5 w-3.5 text-[#33492F]/50" /> {t('form.dataSafe')}</span>
                    <span className="flex items-center gap-1.5 text-xs text-[#1a1a1a]/30"><Mail className="h-3.5 w-3.5 text-[#33492F]/50" /> {t('form.noSpam')}</span>
                    <span className="flex items-center gap-1.5 text-xs text-[#1a1a1a]/30"><Clock className="h-3.5 w-3.5 text-[#33492F]/50" /> {t('form.upto24h')}</span>
                  </div>
                  <p className="text-xs text-[#1a1a1a]/25 text-center">{t('form.disclaimer')}</p>
                </form>
              </div>
            </div>
          </div>
        </section>
      </ScrollReveal>

      {/* ══════════════════════════════════════════════════
          12. FOOTER
          ══════════════════════════════════════════════════ */}
      <footer className="bg-[#33492F]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="py-8 sm:py-10 flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-6">
            <a href="/empreendimentos" className="flex items-center gap-2.5 group">
              <div className="h-8 w-8 rounded-lg bg-white/10 flex items-center justify-center"><Building2 className="h-4 w-4 text-white" /></div>
              <span className="text-sm font-bold text-white">{t('footer.brand')}</span>
            </a>
            <button type="button" onClick={() => openWhatsApp('footer', 'footer', 'bottom')}
              className="min-h-[44px] flex items-center gap-2.5 px-5 py-2.5 rounded-xl bg-[#25D366]/15 text-white/80 hover:text-white text-sm font-medium transition-colors">
              <Phone className="h-3.5 w-3.5 text-[#25D366]" /> {t('footer.whatsapp')}
            </button>
          </div>
          <div className="border-t border-white/10 py-4 flex flex-col sm:flex-row items-center justify-between gap-2">
            <p className="text-xs text-white/30">&copy; {new Date().getFullYear()} {t('footer.copyright')}</p>
            <p className="text-xs text-white/20">{t('footer.disclaimer')}</p>
          </div>
        </div>
      </footer>

      {/* ══════════════════════════════════════════════════
          FLOATING ELEMENTS
          ══════════════════════════════════════════════════ */}

      {/* Fixed Bottom CTA Bar (Mobile) — WhatsApp left + Ver Condições right */}
      {showBottomBar && !isFormSectionVisible && (
        <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden animate-slide-up-bar">
          <div className="flex">
            <button type="button" onClick={() => openWhatsApp('bottom_bar', null, 'left')}
              className="flex-1 min-h-[52px] flex items-center justify-center gap-2 bg-[#25D366] text-white font-semibold text-sm shadow-[0_-4px_20px_rgba(37,211,102,0.3)]">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" dangerouslySetInnerHTML={{ __html: WHATSAPP_ICON }} />
              {t('floatingBar.whatsapp')}
            </button>
            <button type="button" onClick={scrollToForm}
              className="flex-1 min-h-[52px] flex items-center justify-center gap-2 bg-[#33492F] text-white font-bold text-sm shadow-[0_-4px_20px_rgba(51,73,47,0.3)]">
              {t('floatingBar.seeConditions')}
            </button>
          </div>
          <div className="h-[env(safe-area-inset-bottom)]" />
        </div>
      )}

      {/* Floating WhatsApp Button (appears after 1.5s, always visible on desktop) */}
      {showFloatingWhatsApp && (!isFormSectionVisible || typeof window !== 'undefined' && window.innerWidth >= 1024) && (
        <div className="fixed bottom-20 sm:bottom-6 right-4 z-40 animate-fade-in-up">
          <button type="button" onClick={() => openWhatsApp('floating_btn', null, 'floating')}
            className="relative h-14 w-14 rounded-full bg-[#25D366] text-white flex items-center justify-center shadow-xl shadow-[#25D366]/30 hover:bg-[#20bd5a] transition-all active:scale-95">
            <span className="absolute inset-0 rounded-full bg-[#25D366] animate-pulse-ring" />
            <svg className="h-6 w-6 relative z-10" viewBox="0 0 24 24" fill="currentColor" dangerouslySetInnerHTML={{ __html: WHATSAPP_ICON }} />
          </button>
        </div>
      )}

      {/* Social Proof Toast — fades out after 3s visibility per cycle */}
      {toastVisible && socialProofPool.length > 0 && (
        <div className={`fixed bottom-4 left-4 z-30 sm:hidden transition-opacity duration-700 ${toastFading ? 'opacity-0' : 'opacity-100'}`} role="status" aria-live="polite">
          <div className="flex items-center gap-3 bg-[#1A1A1A]/95 backdrop-blur-md border border-white/10 rounded-2xl px-4 py-3 shadow-2xl shadow-black/40 max-w-[260px]">
            <div className="flex-shrink-0 h-8 w-8 rounded-full bg-[#C9A96E]/20 flex items-center justify-center">
              <UserCheck className="h-4 w-4 text-[#C9A96E]" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-white/90 font-medium leading-tight">{socialProofPool[socialProofIdx].message}</p>
              <p className="text-[10px] text-white/35 mt-0.5">{t('socialProof.timeAgo', { time: socialProofPool[socialProofIdx].time })}</p>
            </div>
          </div>
        </div>
      )}

      {/* EXIT INTENT POPUP — loaded lazily */}
      {exitPopupOpen && (
        <Suspense fallback={null}>
          <LandingExitPopup
            enterpriseName={e?.name || ''}
            onClose={() => setExitPopupOpen(false)}
            onWhatsApp={() => { setExitPopupOpen(false); openWhatsApp('exit_popup', null, 'popup'); }}
            showRealCount={showRealCount}
            clientCount={clientCount}
          />
        </Suspense>
      )}

      {/* LIGHTBOX — loaded lazily on first open */}
      {lightboxOpen && (
        <Suspense fallback={null}>
          <LandingLightbox
            images={images}
            activeIdx={activeImgIdx}
            onClose={() => setLightboxOpen(false)}
            onIndexChange={(idx: number) => startTransition(() => setActiveImgIdx(idx))}
          />
        </Suspense>
      )}


    </div>
  );
}
