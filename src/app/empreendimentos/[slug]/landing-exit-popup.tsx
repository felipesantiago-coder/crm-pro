'use client';

import React, { useState } from 'react';
import { X, Phone, Send, Shield, User, CheckCircle2, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface ExitPopupProps {
  enterpriseName: string;
  onClose: () => void;
  onWhatsApp: () => void;
  showRealCount: boolean;
  clientCount: number;
}

export default function LandingExitPopup({ enterpriseName, onClose, onWhatsApp, showRealCount, clientCount }: ExitPopupProps) {
  const t = useTranslations();
  const [popupName, setPopupName] = useState('');
  const [popupPhone, setPopupPhone] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const name = popupName.trim();
    const phone = popupPhone.replace(/\D/g, '');
    if (name.length < 2 || (phone.length > 0 && phone.length < 10)) return;

    setSubmitting(true);
    try {
      // Pre-fill the main form and navigate to it
      const nameInput = document.getElementById('form-name') as HTMLInputElement | null;
      const phoneInput = document.getElementById('form-phone') as HTMLInputElement | null;
      if (nameInput) { nameInput.value = name; nameInput.dispatchEvent(new Event('input', { bubbles: true })); }
      if (phoneInput && phone.length >= 10) { phoneInput.value = popupPhone; phoneInput.dispatchEvent(new Event('input', { bubbles: true })); }

      // Track the CTA
      try { (window as any).CRMPIXEL?.trackCTA('exit_popup_form', 'Cadastrar', 'exit_popup', 'form'); } catch {}

      // Show success and close
      setSubmitted(true);
      setTimeout(() => {
        onClose();
        const form = document.getElementById('landing-form') as HTMLFormElement | null;
        if (form) {
          form.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => {
            const ei = document.getElementById('form-email') as HTMLInputElement | null;
            if (ei) { ei.focus(); ei.classList.add('ring-2', 'ring-[#33492F]'); setTimeout(() => ei.classList.remove('ring-2', 'ring-[#33492F]'), 3000); }
          }, 600);
        }
      }, 1200);
    } catch {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
        <div className="relative max-w-md w-full rounded-3xl bg-white border border-[#1a1a1a]/[0.08] p-8 sm:p-10 shadow-2xl text-center" onClick={(ev) => ev.stopPropagation()}>
          <div className="flex items-center justify-center mb-4">
            <div className="h-14 w-14 rounded-full bg-emerald-50 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            </div>
          </div>
          <h3 className="text-xl font-bold text-[#1a1a1a] mb-2">{t('exitPopup.successTitle', { defaultValue: 'Quase lá!' })}</h3>
          <p className="text-sm text-[#1a1a1a]/50 leading-relaxed">{t('exitPopup.successDescription', { defaultValue: 'Estamos te levando para completar seu cadastro...' })}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative max-w-md w-full rounded-3xl bg-white border border-[#1a1a1a]/[0.08] p-6 sm:p-8 shadow-2xl" onClick={(ev) => ev.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-[#1a1a1a]/30 hover:text-[#1a1a1a] transition-colors">
          <X className="h-5 w-5" />
        </button>
        <div className="flex items-center justify-center mb-5">
          <div className="h-14 w-14 rounded-2xl bg-[#33492F]/10 flex items-center justify-center">
            <Phone className="h-7 w-7 text-[#33492F]" />
          </div>
        </div>
        <h3 className="text-xl font-bold text-center mb-2 text-[#1a1a1a]">{t('exitPopup.title', { name: enterpriseName })}</h3>
        <p className="text-sm text-[#1a1a1a]/50 text-center mb-5 leading-relaxed">{t('exitPopup.description')}</p>

        {/* Inline micro-form — capture name + phone directly */}
        <form onSubmit={handleSubmit} className="mb-4">
          <div className="space-y-2.5">
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#1a1a1a]/25" />
              <input
                type="text"
                value={popupName}
                onChange={(ev) => setPopupName(ev.target.value)}
                placeholder={t('hero.namePlaceholder')}
                autoComplete="name"
                required
                className="lp-input-mobile w-full min-h-[44px] pl-10 pr-4 py-3 rounded-xl bg-[#F7F6F3] border border-[#1a1a1a]/[0.08] text-sm text-[#1a1a1a] placeholder:text-[#1a1a1a]/30 focus:outline-none focus:border-[#33492F]/50 focus:ring-2 focus:ring-[#33492F]/20 transition-all"
              />
            </div>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#1a1a1a]/25" />
              <input
                type="tel"
                inputMode="numeric"
                value={popupPhone}
                onChange={(ev) => {
                  const d = ev.target.value.replace(/\D/g, '').slice(0, 11);
                  let m = '';
                  if (d.length > 0) m += `(${d.slice(0, 2)}`;
                  if (d.length > 2) m += `) ${d.slice(2, 7)}`;
                  if (d.length > 7) m += `-${d.slice(7)}`;
                  setPopupPhone(m);
                }}
                placeholder={t('hero.phonePlaceholder')}
                autoComplete="tel"
                required
                className="lp-input-mobile w-full min-h-[44px] pl-10 pr-4 py-3 rounded-xl bg-[#F7F6F3] border border-[#1a1a1a]/[0.08] text-sm text-[#1a1a1a] placeholder:text-[#1a1a1a]/30 focus:outline-none focus:border-[#33492F]/50 focus:ring-2 focus:ring-[#33492F]/20 transition-all"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[44px] flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-[#33492F] text-white font-bold text-sm hover:bg-[#33492F]/90 transition-all shadow-lg shadow-[#33492F]/20 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {submitting ? t('form.submitting', { defaultValue: 'Enviando...' }) : t('exitPopup.formCta')}
            </button>
          </div>
        </form>

        {/* WhatsApp fallback */}
        <button
          type="button"
          onClick={onWhatsApp}
          className="w-full min-h-[44px] flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl bg-[#25D366] text-white font-semibold text-sm hover:bg-[#20bd5a] transition-colors"
        >
          <Phone className="h-4 w-4" /> {t('exitPopup.whatsappCta')}
        </button>

        <p className="text-[11px] text-[#1a1a1a]/25 text-center mt-4">
          <Shield className="h-3 w-3 inline-block mr-1 text-[#33492F]/40" />
          {t('exitPopup.dataSafe')}
          {showRealCount && <span className="ml-2 text-emerald-400/60">{t('exitPopup.registeredCount', { count: clientCount })}</span>}
        </p>
      </div>
    </div>
  );
}
