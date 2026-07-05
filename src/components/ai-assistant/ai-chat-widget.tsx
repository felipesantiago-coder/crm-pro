'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  X,
  Send,
  Loader2,
  Sparkles,
  Maximize2,
  Minimize2,
  RotateCcw,
  Users,
  CalendarDays,
  Bell,
  HelpCircle,
  Search,
  MessageSquare,
  Trash2,
  Zap,
  BarChart3,
  Target,
  Settings,
  GraduationCap,
  TrendingUp,
  LayoutDashboard,
  FileText,
  Megaphone,
} from 'lucide-react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ============================================================
// AI ASSISTANT — MÓDULO ISOLADO
//
// Para remover completamente este assistente de IA:
//   1. Delete a pasta: src/components/ai-assistant/
//   2. Delete a pasta: src/app/api/ai-assistant/
//   3. Em src/app/page.tsx, remova a importação e o <AIChatWidget />
// ============================================================

interface Suggestion {
  icon: React.ReactNode;
  text: string;
}

const SUGGESTION_CATEGORIES: { title: string; icon: React.ReactNode; items: Suggestion[] }[] = [
  {
    title: 'Acesso rápido',
    icon: <Zap className="h-3.5 w-3.5" />,
    items: [
      {
        icon: <LayoutDashboard className="h-3.5 w-3.5" />,
        text: 'Resumo do meu dia',
      },
      {
        icon: <Users className="h-3.5 w-3.5" />,
        text: 'Quais clientes são LEADs?',
      },
      {
        icon: <CalendarDays className="h-3.5 w-3.5" />,
        text: 'Tenho visitas para hoje?',
      },
      {
        icon: <Bell className="h-3.5 w-3.5" />,
        text: 'Lembretes pendentes',
      },
    ],
  },
  {
    title: 'Configurar notificações',
    icon: <Settings className="h-3.5 w-3.5" />,
    items: [
      {
        icon: <MessageSquare className="h-3.5 w-3.5" />,
        text: 'Como configurar notificações no Telegram?',
      },
      {
        icon: <Bell className="h-3.5 w-3.5" />,
        text: 'Quero usar o Ntfy para notificações',
      },
      {
        icon: <HelpCircle className="h-3.5 w-3.5" />,
        text: 'Quais formas de notificação existem?',
      },
    ],
  },
  {
    title: 'Aprenda a usar',
    icon: <GraduationCap className="h-3.5 w-3.5" />,
    items: [
      {
        icon: <Target className="h-3.5 w-3.5" />,
        text: 'Como funciona o funil de vendas?',
      },
      {
        icon: <CalendarDays className="h-3.5 w-3.5" />,
        text: 'Como agendar uma visita?',
      },
      {
        icon: <BarChart3 className="h-3.5 w-3.5" />,
        text: 'Como conectar o Google Calendar?',
      },
    ],
  },
  {
    title: 'Explore mais',
    icon: <TrendingUp className="h-3.5 w-3.5" />,
    items: [
      {
        icon: <Users className="h-3.5 w-3.5" />,
        text: 'O que você pode fazer por mim?',
      },
      {
        icon: <Megaphone className="h-3.5 w-3.5" />,
        text: 'Como funciona o painel de Meta Ads?',
      },
      {
        icon: <FileText className="h-3.5 w-3.5" />,
        text: 'O que são landing pages no CRM?',
      },
    ],
  },
];

function SimpleMarkdown({ text }: { text: string }) {
  const html = text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">$1</code>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal">$2</li>')
    .replace(/\n/g, '<br/>');

  return (
    <span
      className="text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function AIChatWidget() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [greetingDone, setGreetingDone] = useState(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  // Dismiss the "new" badge after first open
  useEffect(() => {
    if (open && !greetingDone) {
      setGreetingDone(true);
    }
  }, [open, greetingDone]);

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;

    const userMsg: ChatMessage = { role: 'user', content: text.trim() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setLoading(true);
    setDismissed(true);

    try {
      const res = await fetch('/api/ai-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erro na resposta');
      }

      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro inesperado';
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: `Desculpe, ${errorMessage.toLowerCase()}. Tente novamente em instantes.` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function clearChat() {
    setMessages([]);
  }

  // -- Render: Welcome Screen (no messages yet) --
  function renderWelcome() {
    return (
      <div className="flex flex-col h-full px-3 py-1 gap-2 overflow-y-auto">
        {/* Hero */}
        <div className="flex flex-col items-center text-center gap-1.5 pt-2 pb-0.5">
          <div className="relative">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-emerald-400/30 to-teal-500/30 animate-pulse" />
            <div className="relative h-12 w-12 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-600/20 flex items-center justify-center border border-emerald-500/20">
              <Sparkles className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            </div>
          </div>
          <div>
            <p className="font-bold text-sm">Olá! Sou seu assistente IA</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed max-w-[280px]">
              Posso buscar dados, agendamentos, te ajudar a configurar notificações e explicar qualquer funcionalidade do CRM.
            </p>
          </div>
        </div>

        {/* Capability badges */}
        <div className="flex flex-wrap justify-center gap-1.5">
          {[
            { icon: <Search className="h-3 w-3" />, label: 'Buscar clientes' },
            { icon: <CalendarDays className="h-3 w-3" />, label: 'Agendamentos' },
            { icon: <Bell className="h-3 w-3" />, label: 'Notificações' },
            { icon: <HelpCircle className="h-3 w-3" />, label: 'Tutoriais' },
            { icon: <BarChart3 className="h-3 w-3" />, label: 'Meta Ads' },
            { icon: <Target className="h-3 w-3" />, label: 'Funil' },
          ].map(({ icon, label }) => (
            <span
              key={label}
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/60 px-2 py-1 rounded-full"
            >
              {icon}
              {label}
            </span>
          ))}
        </div>

        {/* Suggestion categories */}
        <div className="flex flex-col gap-2 flex-1 overflow-y-auto min-h-0">
          {SUGGESTION_CATEGORIES.map((cat) => (
            <div key={cat.title}>
              <div className="flex items-center gap-1.5 mb-1 px-1">
                <span className="text-emerald-600 dark:text-emerald-400">{cat.icon}</span>
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  {cat.title}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {cat.items.map((item) => (
                  <button
                    key={item.text}
                    onClick={() => sendMessage(item.text)}
                    className="flex items-center gap-2.5 text-left text-xs px-3 py-2.5 rounded-lg border bg-muted/40 hover:bg-muted active:bg-muted/80 transition-colors text-foreground group"
                  >
                    <span className="flex-shrink-0 text-muted-foreground group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                      {item.icon}
                    </span>
                    <span>{item.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Hint */}
        <p className="text-[10px] text-muted-foreground/60 text-center">
          Clique em uma sugestão ou digite sua pergunta
        </p>
      </div>
    );
  }

  // -- Render: Chat messages --
  function renderMessages() {
    return (
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-3">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                'flex',
                msg.role === 'user' ? 'justify-end' : 'justify-start'
              )}
            >
              <div
                className={cn(
                  'rounded-2xl px-3 py-2.5 sm:max-w-[85%] max-w-[90%]',
                  msg.role === 'user'
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-br-md'
                    : 'bg-muted rounded-bl-md'
                )}
              >
                {msg.role === 'assistant' ? (
                  <SimpleMarkdown text={msg.content} />
                ) : (
                  <p className="text-sm">{msg.content}</p>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-emerald-600 dark:text-emerald-400" />
                  <span className="text-xs text-muted-foreground">Pensando...</span>
                </div>
              </div>
            </div>
          )}
      </div>
    );
  }

  const hasMessages = messages.length > 0;
  const showBadge = !dismissed && !open && !greetingDone;

  return (
    <>
      {/* Floating Button — respects iOS safe area */}
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'fixed z-50 h-14 w-14 rounded-full shadow-lg transition-all duration-300 flex items-center justify-center',
          'bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white',
          'hover:scale-110 active:scale-95',
          'right-4 bottom-4 sm:right-5 sm:bottom-5',
          'pb-[env(safe-area-inset-bottom)]',
          open && 'scale-0 opacity-0 pointer-events-none'
        )}
        title="Assistente IA"
        aria-label="Abrir assistente IA"
      >
        {showBadge && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 z-10">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40" />
            <span className="relative inline-flex rounded-full h-5 w-5 bg-emerald-500 items-center justify-center">
              <Sparkles className="h-3 w-3 text-white" />
            </span>
          </span>
        )}
        <Sparkles className="h-6 w-6" />
      </button>

      {/* Tooltip — responsive positioning to avoid overflow on small screens */}
      {showBadge && (
        <div
          className="fixed z-50 bg-card border shadow-lg rounded-xl px-3 py-2.5 animate-in fade-in-0 slide-in-from-bottom-2 duration-300 pointer-events-none right-2 bottom-[4.5rem] sm:right-5 sm:max-w-[220px] max-w-[calc(100vw-2.5rem)]"
        >
          <p className="text-xs font-medium text-foreground leading-snug">
            Precisa de ajuda? Pergunte sobre notificações, clientes ou qualquer funcionalidade!
          </p>
          <div className="absolute -bottom-1.5 right-6 w-3 h-3 bg-card border-r border-b rotate-45" />
        </div>
      )}

      {/* Chat Panel — respects iOS safe area */}
      <div
        className={cn(
          'fixed z-50 bg-card border shadow-2xl rounded-2xl flex flex-col transition-all duration-300 ease-out overflow-hidden',
          'right-0 bottom-0 sm:right-5 sm:bottom-5 sm:rounded-2xl',
          expanded
            ? 'sm:w-[min(560px,calc(100vw-2.5rem))] sm:h-[min(700px,calc(100vh-2.5rem))] w-full h-full sm:h-[min(700px,calc(100vh-2.5rem))]'
            : 'sm:w-[min(380px,calc(100vw-2.5rem))] sm:h-[min(540px,calc(100vh-6rem))] w-full h-[min(85vh,600px)]',
          open
            ? 'opacity-100 scale-100 pointer-events-auto'
            : 'opacity-0 scale-95 pointer-events-none translate-y-4'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 sm:py-3 border-b bg-gradient-to-r from-emerald-500 to-teal-600 text-white flex-shrink-0">
          <div className="flex items-center gap-2 sm:gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
              <Sparkles className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-sm leading-tight">Assistente IA</h3>
              <p className="text-[10px] text-emerald-100/80 leading-tight truncate">
                {hasMessages ? `${messages.length} mensagens` : 'Pergunte qualquer coisa sobre o CRM'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-2.5 rounded-lg hover:bg-white/20 active:bg-white/30 transition-colors"
              title={expanded ? 'Reduzir' : 'Expandir'}
              aria-label={expanded ? 'Reduzir painel' : 'Expandir painel'}
            >
              {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            {hasMessages && (
              <button
                onClick={clearChat}
                className="p-2.5 rounded-lg hover:bg-white/20 active:bg-white/30 transition-colors"
                title="Nova conversa"
                aria-label="Nova conversa"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              className="p-2.5 rounded-lg hover:bg-white/20 active:bg-white/30 transition-colors"
              aria-label="Fechar assistente"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body: Welcome or Messages */}
        {hasMessages ? renderMessages() : renderWelcome()}

        {/* Quick suggestions bar (shown when chat has messages) */}
        {hasMessages && !loading && (
          <div className="flex gap-1.5 px-3 py-2 overflow-x-auto flex-shrink-0 border-t bg-muted/20 scrollbar-none">
            {[
              'Resumo do meu dia',
              'Configurar notificações',
              'Como funciona o funil?',
              'O que você pode fazer?',
            ].map((s) => (
              <button
                key={s}
                onClick={() => sendMessage(s)}
                className="text-[11px] px-3 py-1.5 rounded-full border bg-card hover:bg-muted active:bg-muted/80 transition-colors text-muted-foreground hover:text-foreground whitespace-nowrap flex-shrink-0"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Input — respects iOS safe area */}
        <div className="border-t p-2.5 sm:p-3 flex-shrink-0 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
          <div className="flex items-end gap-2">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Pergunte sobre clientes, notificações, como usar o CRM..."
              className="min-h-[40px] max-h-[120px] resize-none text-sm rounded-xl"
              rows={1}
              disabled={loading}
            />
            <Button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              size="icon"
              className="h-10 w-10 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 flex-shrink-0"
              aria-label="Enviar mensagem"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}