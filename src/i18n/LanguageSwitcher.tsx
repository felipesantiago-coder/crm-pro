'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLocaleContext } from './LocaleProvider';
import { locales, localeNames, type Locale } from './config';

export default function LanguageSwitcher() {
  const { locale, setLocale } = useLocaleContext();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, []);

  function handleSelect(l: Locale) {
    setLocale(l);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label="Select language"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white/50 hover:text-white/80 hover:bg-white/[0.06] border border-white/[0.08] transition-all duration-200 min-h-[36px]"
      >
        <span>{localeNames[locale]}</span>
        <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full mt-1.5 py-1 min-w-[140px] rounded-xl bg-[#1a1a1a] border border-white/[0.10] shadow-xl shadow-black/30 z-50 overflow-hidden"
        >
          {locales.map((l) => (
            <button
              key={l}
              role="option"
              aria-selected={l === locale}
              onClick={() => handleSelect(l)}
              className={`w-full text-left px-4 py-2.5 text-sm transition-colors duration-150 ${
                l === locale
                  ? 'text-[#C9A96E] bg-[#C9A96E]/10 font-medium'
                  : 'text-white/60 hover:text-white/90 hover:bg-white/[0.05]'
              }`}
            >
              {localeNames[l]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
