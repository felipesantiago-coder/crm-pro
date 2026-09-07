'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { MessageCircle, ExternalLink } from 'lucide-react';
import { getLeadTemperatureGuidance } from '@/lib/lead-temperature-guidance';

/**
 * TelegramLeadPreview — prévia visual do cartão de lead (§19).
 * Reproduz a variante compacta com dados EXPLICITAMENTE FICTÍCIOS:
 * a notificação de teste real usa o mesmo compositor da produção,
 * mas a prévia na UI é apenas ilustrativa (não envia nada).
 *
 * Os textos de temperatura e tratativa vêm da MESMA fonte única da
 * produção (lead-temperature-guidance) — a prévia nunca diverge do
 * cartão real.
 */
export function TelegramLeadPreview() {
  const guidance = getLeadTemperatureGuidance('QUENTE');

  return (
    <div className="rounded-xl bg-[#17212b] p-4 space-y-3 text-[13px] leading-relaxed text-[#e8edf2] shadow-inner">
      <p className="text-[11px] text-amber-300/90 font-medium">
        Prévia — dados fictícios. O teste real chega no seu Telegram.
      </p>

      <div className="rounded-xl bg-[#2a3140] p-3 space-y-3">
        <p>
          🔔 <b>Novo interesse para você</b>
        </p>
        <p>
          <b>Villa Bianco</b>
          <br />
          João, Mariana acabou de pedir informações sobre este empreendimento. O
          atendimento está com você.
        </p>

        <p>
          🌡️ <b>Temperatura:</b> 🔥 Quente · 12 pts
        </p>

        {guidance && (
          <div className="space-y-0.5">
            <p>
              🎯 <b>Tratativa sugerida</b>
            </p>
            <p className="italic">{guidance.headline}</p>
            <p>{guidance.description}</p>
            {guidance.steps.map((step, index) => (
              <p key={index}>
                {index + 1}. {step}
              </p>
            ))}
          </div>
        )}

        <div className="space-y-0.5">
          <p>👤 <b>Contato</b></p>
          <p><b>Mariana Alves</b></p>
          <p>Telefone: (61) 99999-0000</p>
          <p>E-mail: mariana.exemplo@email.com</p>
          <p>Região: Águas Claras</p>
        </div>

        <div className="space-y-1.5">
          <p>💬 <b>O que informou</b></p>
          <p>
            <b>Faixa de renda mensal</b>
            <br />
            Entre R$ 8 mil e R$ 12 mil
          </p>
          <p>
            <b>Imóvel de interesse</b>
            <br />
            Apartamento de 2 quartos
          </p>
          <p>
            <b>Quando pretende comprar</b>
            <br />
            Nos próximos 3 meses
          </p>
        </div>

        <p>
          📣 <b>Origem</b>
          <br />
          Meta Ads • Campanha Villa Bianco • Formulário Interesse Park Sul
        </p>

        <p className="text-[#7d8b99]">🕒 Enviado há poucos segundos • 06/09/2026 às 14:32</p>

        <div className="flex gap-2 pt-1">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#3390ec] px-3 py-1.5 text-xs font-medium text-white">
            <MessageCircle className="h-3.5 w-3.5" /> Conversar no WhatsApp
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#2b5279] px-3 py-1.5 text-xs font-medium text-[#e8edf2]">
            <ExternalLink className="h-3.5 w-3.5" /> Abrir no CRM
          </span>
        </div>
      </div>

      <p className="text-[10px] text-[#7d8b99]">
        Cartões longos chegam em partes encadeadas (&quot;Informações (parte 2 de 2)&quot;);
        leads de anúncios sem empreendimento vinculado chegam sem foto.
      </p>
    </div>
  );
}
