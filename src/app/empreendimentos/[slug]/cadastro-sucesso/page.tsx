'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { CheckCircle2, Phone, ArrowLeft, Building2, MessageSquare, Loader2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

/* ─── Types ─────────────────────────────────────────────── */
interface AssignedUser {
  userId: string;
  userName: string;
  userPhone: string | null;
}

/* ─── Inner Content ─────────────────────────────────────── */
function CadastroSucessoContent() {
  const searchParams = useSearchParams();
  const [enterpriseName, setEnterpriseName] = useState('');
  const [clientName, setClientName] = useState('');
  const [assignedUser, setAssignedUser] = useState<AssignedUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const name = searchParams.get('empreendimento') || '';
    const user = searchParams.get('atendente');
    const phone = searchParams.get('telefone');
    const client = searchParams.get('nome');

    setEnterpriseName(decodeURIComponent(name));
    setClientName(decodeURIComponent(client || ''));

    if (user && phone) {
      setAssignedUser({
        userId: '',
        userName: decodeURIComponent(user),
        userPhone: decodeURIComponent(phone),
      });
    }
    setLoading(false);
  }, [searchParams]);

  const whatsappNumber = assignedUser?.userPhone
    ? assignedUser.userPhone.replace(/\D/g, '')
    : null;

  const whatsappUrl = whatsappNumber
    ? `https://wa.me/${whatsappNumber.startsWith('55') ? whatsappNumber : '55' + whatsappNumber}?text=${encodeURIComponent(`Olá! Acabei de me cadastrar no site${enterpriseName ? ` para o empreendimento ${enterpriseName}` : ''} e gostaria de atendimento.`)}`
    : null;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-[#C9A96E] animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col overflow-x-hidden">
      {/* ── Nav ──────────────────────────────────────────── */}
      <nav className="border-b border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 sm:h-20 flex items-center justify-between">
          <a href="/empreendimentos" className="flex items-center gap-3 group">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-[#C9A96E] to-[#8B6914] flex items-center justify-center shadow-lg shadow-[#C9A96E]/20">
              <Building2 className="h-4 w-4 text-white" />
            </div>
            <span className="text-base font-bold tracking-tight hidden sm:block">Empreendimentos</span>
          </a>
        </div>
      </nav>

      {/* ── Content ──────────────────────────────────────── */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-lg text-center">
          {/* Success icon */}
          <div className="relative mx-auto mb-6 sm:mb-8">
            <div className="h-20 w-20 sm:h-24 sm:w-24 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-10 w-10 sm:h-12 sm:w-12 text-emerald-400" />
            </div>
            <div className="absolute -inset-4 rounded-full bg-emerald-500/5 blur-2xl" />
          </div>

          {/* Heading */}
          <h1 className="text-3xl sm:text-4xl font-bold mb-3">
            Cadastro Realizado!
          </h1>
          <p className="text-white/60 text-base sm:text-lg mb-2">
            {clientName ? (
              <>Olá, <span className="text-white/90 font-medium">{clientName}</span>!</>
            ) : (
              <>Obrigado pelo seu interesse!</>
            )}
          </p>
          <p className="text-white/40 text-sm max-w-md mx-auto mb-10">
            {enterpriseName ? (
              <>Seu cadastro para o empreendimento <span className="text-[#C9A96E] font-medium">{enterpriseName}</span> foi recebido com sucesso. Nossa equipe entrará em contato em breve.</>
            ) : (
              <>Seu cadastro foi recebido com sucesso. Nossa equipe entrará em contato em breve.</>
            )}
          </p>

          {/* WhatsApp CTA */}
          {whatsappUrl && assignedUser && (
            <div className="rounded-2xl bg-gradient-to-br from-[#C9A96E]/10 to-transparent border border-[#C9A96E]/20 p-6 sm:p-8 mb-8">
              <div className="flex items-center justify-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-xl bg-[#C9A96E]/20 flex items-center justify-center">
                  <MessageSquare className="h-5 w-5 text-[#C9A96E]" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-white/90">Atendimento Rápido</p>
                  <p className="text-xs text-white/50">Fale agora com {assignedUser.userName}</p>
                </div>
              </div>
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2.5 px-8 py-4 rounded-xl bg-[#25D366] text-white font-semibold text-base hover:bg-[#20bd5a] transition-colors shadow-xl shadow-[#25D366]/20 w-full sm:w-auto justify-center"
              >
                <Phone className="h-5 w-5" />
                Chamar no WhatsApp
              </a>
              <p className="text-xs text-white/30 mt-3">
                Prefere aguardar? Sem problemas — entraremos em contato pelo telefone informado.
              </p>
            </div>
          )}

          {/* Back link */}
          <a
            href="/empreendimentos"
            className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-[#C9A96E] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar aos empreendimentos
          </a>
        </div>
      </main>

      {/* ── Footer ───────────────────────────────────────── */}
      <footer className="border-t border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-white/25">
            Todos os valores e informações são sujeitos a alteração sem aviso prévio.
          </p>
        </div>
      </footer>
    </div>
  );
}

/* ─── Page (with Suspense boundary) ─────────────────────── */
export default function CadastroSucessoPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
          <Loader2 className="h-8 w-8 text-[#C9A96E] animate-spin" />
        </div>
      }
    >
      <CadastroSucessoContent />
    </Suspense>
  );
}