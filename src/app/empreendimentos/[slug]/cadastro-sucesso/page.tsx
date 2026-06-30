'use client';

import React, { Suspense, useEffect, useState, useMemo } from 'react';
import {
  CheckCircle2, Phone, ArrowLeft, Building2, MessageSquare,
  Loader2, User, Sparkles, ShieldCheck, Clock,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';

/* ─── Types ─────────────────────────────────────────────── */
interface AssignedUser {
  userId: string;
  userName: string;
  userPhone: string | null;
}

/* ─── Confetti Animation Component ──────────────────────── */
function ConfettiAnimation() {
  const particles = useMemo(() => {
    const colors = ['#C9A96E', '#E8D5A3', '#8B6914', '#25D366', '#ffffff'];
    return Array.from({ length: 30 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 3,
      duration: 2.5 + Math.random() * 3,
      size: 4 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      opacity: 0.3 + Math.random() * 0.5,
    }));
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      <style>{`
        @keyframes confetti-fall {
          0%   { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
          80%  { opacity: 1; }
          100% { transform: translateY(105vh) rotate(720deg); opacity: 0; }
        }
        @keyframes pulse-ring {
          0%   { box-shadow: 0 0 0 0 rgba(37, 211, 102, 0.4); }
          70%  { box-shadow: 0 0 0 15px rgba(37, 211, 102, 0); }
          100% { box-shadow: 0 0 0 0 rgba(37, 211, 102, 0); }
        }
        @keyframes float-in {
          0%   { opacity: 0; transform: translateY(20px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes check-pop {
          0%   { transform: scale(0); opacity: 0; }
          50%  { transform: scale(1.15); }
          100% { transform: scale(1); opacity: 1; }
        }
        .whatsapp-pulse {
          animation: pulse-ring 2s ease-out infinite;
        }
        .float-in-delay-1 { animation: float-in 0.6s ease-out 0.2s both; }
        .float-in-delay-2 { animation: float-in 0.6s ease-out 0.4s both; }
        .float-in-delay-3 { animation: float-in 0.6s ease-out 0.6s both; }
        .float-in-delay-4 { animation: float-in 0.6s ease-out 0.8s both; }
        .float-in-delay-5 { animation: float-in 0.6s ease-out 1.0s both; }
        .check-pop { animation: check-pop 0.6s ease-out 0.1s both; }
      `}</style>

      {/* Falling confetti particles */}
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute rounded-full"
          style={{
            left: `${p.left}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            backgroundColor: p.color,
            opacity: p.opacity,
            animation: `confetti-fall ${p.duration}s linear ${p.delay}s both`,
          }}
        />
      ))}
    </div>
  );
}

/* ─── Inner Content ─────────────────────────────────────── */
function CadastroSucessoContent() {
  const searchParams = useSearchParams();
  const [enterpriseName, setEnterpriseName] = useState('');
  const [enterpriseSlug, setEnterpriseSlug] = useState('');
  const [clientName, setClientName] = useState('');
  const [assignedUser, setAssignedUser] = useState<AssignedUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const name = searchParams.get('empreendimento') || '';
    const slug = searchParams.get('slug') || '';
    const user = searchParams.get('atendente');
    const phone = searchParams.get('telefone');
    const client = searchParams.get('nome');

    setEnterpriseName(decodeURIComponent(name));
    setEnterpriseSlug(decodeURIComponent(slug));
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

  const backUrl = enterpriseSlug
    ? `/empreendimentos/${enterpriseSlug}`
    : '/empreendimentos';

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-[#C9A96E] animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col overflow-x-hidden">
      {/* Confetti celebration */}
      <ConfettiAnimation />

      {/* ── Nav ──────────────────────────────────────────── */}
      <nav className="border-b border-white/[0.06] relative z-10">
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
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 relative z-10">
        <div className="w-full max-w-lg text-center py-8 sm:py-12">
          {/* Success icon with glow */}
          <div className="relative mx-auto mb-6 sm:mb-8 check-pop">
            <div className="absolute -inset-6 rounded-full bg-emerald-500/5 blur-3xl" />
            <div className="absolute -inset-3 rounded-full bg-emerald-500/10 blur-2xl" />
            <div className="relative h-20 w-20 sm:h-24 sm:w-24 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center mx-auto ring-4 ring-emerald-500/5">
              <CheckCircle2 className="h-10 w-10 sm:h-12 sm:w-12 text-emerald-400" />
            </div>
          </div>

          {/* ── Heading ────────────────────────────────── */}
          <div className="float-in-delay-1">
            <h1 className="text-2xl sm:text-4xl font-bold mb-3 tracking-tight">
              Cadastro realizado com{' '}
              <span className="bg-gradient-to-r from-emerald-400 to-emerald-300 bg-clip-text text-transparent">
                sucesso!
              </span>
            </h1>
            <p className="text-white/60 text-base sm:text-lg mb-1">
              {clientName ? (
                <>Olá, <span className="text-white/90 font-medium">{clientName}</span>!</>
              ) : (
                <>Obrigado pelo seu interesse!</>
              )}
            </p>
          </div>

          {/* Enhanced messaging */}
          <div className="float-in-delay-2">
            <p className="text-white/40 text-sm max-w-md mx-auto mb-2 leading-relaxed">
              {enterpriseName ? (
                <>Seu cadastro para o empreendimento <span className="text-[#C9A96E] font-medium">{enterpriseName}</span> foi recebido com sucesso.</>
              ) : (
                <>Seu cadastro foi recebido com sucesso.</>
              )}
            </p>
            <p className="text-white/35 text-sm max-w-md mx-auto mb-10 leading-relaxed">
              Em breve um de nossos consultores especializados entrará em contato para apresentar todas as condições exclusivas deste empreendimento.
            </p>
          </div>

          {/* ── Trust Icons ────────────────────────────── */}
          <div className="float-in-delay-3 grid grid-cols-3 gap-3 sm:gap-4 max-w-sm mx-auto mb-10">
            <div className="flex flex-col items-center gap-2.5 p-4 rounded-xl bg-white/[0.03] border border-white/[0.05]">
              <div className="h-9 w-9 rounded-lg bg-[#C9A96E]/10 flex items-center justify-center">
                <User className="h-4 w-4 text-[#C9A96E]" />
              </div>
              <span className="text-[11px] sm:text-xs font-medium text-white/50 leading-tight">
                Atendimento personalizado
              </span>
            </div>
            <div className="flex flex-col items-center gap-2.5 p-4 rounded-xl bg-white/[0.03] border border-white/[0.05]">
              <div className="h-9 w-9 rounded-lg bg-[#C9A96E]/10 flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-[#C9A96E]" />
              </div>
              <span className="text-[11px] sm:text-xs font-medium text-white/50 leading-tight">
                Condições exclusivas
              </span>
            </div>
            <div className="flex flex-col items-center gap-2.5 p-4 rounded-xl bg-white/[0.03] border border-white/[0.05]">
              <div className="h-9 w-9 rounded-lg bg-[#C9A96E]/10 flex items-center justify-center">
                <ShieldCheck className="h-4 w-4 text-[#C9A96E]" />
              </div>
              <span className="text-[11px] sm:text-xs font-medium text-white/50 leading-tight">
                Sem compromisso
              </span>
            </div>
          </div>

          {/* ── What Happens Next ───────────────────────── */}
          <div className="float-in-delay-4 mb-10">
            <h3 className="text-xs font-semibold text-[#C9A96E] uppercase tracking-wider mb-5">
              Próximos passos
            </h3>
            <div className="space-y-3 text-left max-w-sm mx-auto">
              <div className="flex items-start gap-3.5 p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                <div className="flex-shrink-0 h-7 w-7 rounded-full bg-[#C9A96E]/15 border border-[#C9A96E]/20 flex items-center justify-center mt-0.5">
                  <span className="text-[11px] font-bold text-[#C9A96E]">1</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <Clock className="h-4 w-4 text-white/25 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-white/50 leading-relaxed">
                    Você receberá um contato em até <span className="text-white/70 font-medium">24h</span>
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3.5 p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                <div className="flex-shrink-0 h-7 w-7 rounded-full bg-[#C9A96E]/15 border border-[#C9A96E]/20 flex items-center justify-center mt-0.5">
                  <span className="text-[11px] font-bold text-[#C9A96E]">2</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <Building2 className="h-4 w-4 text-white/25 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-white/50 leading-relaxed">
                    Agendaremos uma visita <span className="text-white/70 font-medium">exclusiva</span>
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3.5 p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                <div className="flex-shrink-0 h-7 w-7 rounded-full bg-[#C9A96E]/15 border border-[#C9A96E]/20 flex items-center justify-center mt-0.5">
                  <span className="text-[11px] font-bold text-[#C9A96E]">3</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <Sparkles className="h-4 w-4 text-white/25 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-white/50 leading-relaxed">
                    Apresentaremos condições <span className="text-white/70 font-medium">especiais</span>
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ── WhatsApp CTA ──────────────────────────── */}
          <div className="float-in-delay-5">
            {whatsappUrl && assignedUser && (
              <div className="rounded-2xl bg-gradient-to-br from-[#C9A96E]/10 to-transparent border border-[#C9A96E]/20 p-6 sm:p-8 mb-8">
                <div className="flex items-center justify-center gap-3 mb-5">
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
                  className="whatsapp-pulse inline-flex items-center gap-2.5 px-8 py-4 rounded-xl bg-[#25D366] text-white font-semibold text-base hover:bg-[#20bd5a] transition-colors shadow-xl shadow-[#25D366]/20 w-full sm:w-auto justify-center"
                >
                  <Phone className="h-5 w-5" />
                  Chamar no WhatsApp
                </a>
                <p className="text-xs text-white/30 mt-3">
                  Prefere aguardar? Sem problemas — entraremos em contato pelo telefone informado.
                </p>
              </div>
            )}
          </div>

          {/* ── Back links ─────────────────────────────── */}
          <div className="flex flex-col items-center gap-3">
            <a
              href={backUrl}
              className="inline-flex items-center gap-2 text-sm text-[#C9A96E]/70 hover:text-[#C9A96E] transition-colors duration-200 font-medium"
            >
              <ArrowLeft className="h-4 w-4" />
              Voltar para o empreendimento
            </a>
            <a
              href="/empreendimentos"
              className="inline-flex items-center gap-1.5 text-sm text-white/30 hover:text-white/50 transition-colors duration-200"
            >
              <Building2 className="h-3.5 w-3.5" />
              Ver todos os empreendimentos
            </a>
          </div>
        </div>
      </main>

      {/* ── Footer ───────────────────────────────────────── */}
      <footer className="border-t border-white/[0.06] relative z-10">
        <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-white/25">
            Todos os valores e informações são sujeitos a alteração sem aviso prévio.
          </p>
          <p className="text-xs text-white/15">&copy; {new Date().getFullYear()} Todos os direitos reservados.</p>
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
