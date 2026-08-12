'use client';

import React from 'react';
import { X, Phone, Send, Shield } from 'lucide-react';

interface ExitPopupProps {
  enterpriseName: string;
  onClose: () => void;
  onWhatsApp: () => void;
  showRealCount: boolean;
  clientCount: number;
}

export default function LandingExitPopup({ enterpriseName, onClose, onWhatsApp, showRealCount, clientCount }: ExitPopupProps) {
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
        <h3 className="text-xl font-bold text-center mb-2 text-[#1a1a1a]">Tem interesse no {enterpriseName}?</h3>
        <p className="text-sm text-[#1a1a1a]/50 text-center mb-6 leading-relaxed">Receba valores e condições comerciais diretamente no seu WhatsApp. Sem compromisso.</p>
        <div className="space-y-3">
          <button
            type="button"
            onClick={onWhatsApp}
            className="w-full min-h-[44px] flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-[#25D366] text-white font-semibold text-sm hover:bg-[#20bd5a] transition-colors"
          >
            <Phone className="h-4 w-4" /> Falar pelo WhatsApp
          </button>
          <a
            href="#cadastro"
            onClick={onClose}
            className="w-full min-h-[44px] flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-[#33492F] text-white font-bold text-sm hover:bg-[#33492F]/90 transition-all shadow-lg shadow-[#33492F]/20"
          >
            <Send className="h-4 w-4" /> Quero saber mais
          </a>
        </div>
        <p className="text-[11px] text-[#1a1a1a]/25 text-center mt-4">
          <Shield className="h-3 w-3 inline-block mr-1 text-[#33492F]/40" />
          Seus dados estão seguros e não enviamos spam.
          {showRealCount && <span className="ml-2 text-emerald-400/60">{clientCount} pessoa{clientCount !== 1 ? 's' : ''} já se cadastraram.</span>}
        </p>
      </div>
    </div>
  );
}
