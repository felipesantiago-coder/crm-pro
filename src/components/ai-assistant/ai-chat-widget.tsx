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
  category?: string;
}

const SUGGESTION_CATEGORIES: { title: string; icon: React.ReactNode; items: Suggestion[] }[] = [
  {
    title: 'Buscar dados',
    icon: <Search className="h-3.5 w-3.5" />,
    items: [
      {
        icon: <Users className="h-3.5 w-3.5" />,
        text: 'Quais clientes são LEADs?',
      },
      {
        icon: <CalendarDays className="h-3.5 w-3.5" />,
        text: 'Tenho agendamentos para hoje?',
      },
      {
        icon: <Bell className="h-3.5 w-3.5" />,
        text: 'Quais lembretes estão pendentes?',
      },
    ],
  },
  {
    title: 'Aprender a usar',
    icon: <HelpCircle className="h-3.5 w-3.5" />,
    items: [
      {
        icon: <MessageSquare className="h-3.5 w-3.5" />,
        text: 'Como funciona o funil de clientes?',
      },
      {
        icon: <CalendarDays className="h-3.5 w-3.5" />,
        text: 'Como criar um agendamento de visita?',
      },
      {
        icon: <Users className="h-3.5 w-3.5" />,
        text: 'Quais funcionalidades o CRM tem?',
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;

    const userMsg: ChatMessage = { role: 'user', content: text.trim() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setLoading(true);

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
        { role: 'assistant', content: `⚠️ ${errorMessage}. Tente novamente em instantes.` },
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
      <div className="flex flex-col h-full px-3 py-2 gap-3 overflow-y-auto">
        {/* Hero */}
        <div className="flex flex-col items-center text-center gap-2 pt-2 pb-1">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-600/20 flex items-center justify-center">
            <Sparkles className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <p className="font-semibold text-sm">Assistente IA do CRM Pro</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed max-w-[260px]">
              Pergunte sobre seus clientes, agendamentos, lembretes ou tire dúvidas sobre como usar o sistema.
            </p>
          </div>
        </div>

        {/* Capability badges */}
        <div className="flex flex-wrap justify-center gap-1.5">
          {[
            { icon: <Search className="h-3 w-3" />, label: 'Buscar clientes' },
            { icon: <CalendarDays className="h-3 w-3" />, label: 'Agendamentos' },
            { icon: <Bell className="h-3 w-3" />, label: 'Lembretes' },
            { icon: <HelpCircle className="h-3 w-3" />, label: 'Ajuda do CRM' },
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
        <div className="flex flex-col gap-3 flex-1">
          {SUGGESTION_CATEGORIES.map((cat) => (
            <div key={cat.title}>
              <div className="flex items-center gap-1.5 mb-1.5 px-1">
                <span className="text-emerald-600 dark:text-emerald-400">{cat.icon}</span>
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  {cat.title}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {cat.items.map((item) => (
                  <button
                    key={item.text}
                    onClick={() => sendMessage(item.text)}
                    className="flex items-center gap-2.5 text-left text-xs px-3 py-2 rounded-lg border bg-muted/40 hover:bg-muted transition-colors text-foreground group"
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
        <p className="text-[10px] text-muted-foreground/60 text-center pb-1">
          Digite qualquer pergunta ou clique em uma sugestão acima
        </p>
      </div>
    );
  }

  // -- Render: Chat messages --
  function renderMessages() {
    return (
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
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
                  'max-w-[85%] rounded-2xl px-3.5 py-2.5',
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

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'fixed bottom-5 right-5 z-50 h-14 w-14 rounded-full shadow-lg transition-all duration-300 flex items-center justify-center',
          'bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white',
          'hover:scale-110 active:scale-95',
          open && 'scale-0 opacity-0 pointer-events-none'
        )}
        title="Assistente IA"
      >
        <Sparkles className="h-6 w-6" />
      </button>

      {/* Chat Panel */}
      <div
        className={cn(
          'fixed z-50 bg-card border shadow-2xl rounded-2xl flex flex-col transition-all duration-300 ease-out overflow-hidden',
          'right-2 bottom-2 sm:right-5 sm:bottom-5',
          expanded
            ? 'sm:w-[min(560px,calc(100vw-2.5rem))] sm:h-[min(700px,calc(100vh-2.5rem))] w-[calc(100vw-1rem)] h-[calc(100vh-1rem)]'
            : 'sm:w-[min(380px,calc(100vw-2.5rem))] sm:h-[min(540px,calc(100vh-6rem))] w-[calc(100vw-1rem)] h-[calc(100vh-1rem)]',
          open
            ? 'opacity-100 scale-100 pointer-events-auto'
            : 'opacity-0 scale-95 pointer-events-none translate-y-4'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-gradient-to-r from-emerald-500 to-teal-600 text-white flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-white/20 flex items-center justify-center">
              <Sparkles className="h-4.5 w-4.5" />
            </div>
            <div>
              <h3 className="font-semibold text-sm leading-tight">Assistente IA</h3>
              <p className="text-[10px] text-emerald-100/80 leading-tight">
                {hasMessages ? `${messages.length} mensagens` : 'Clientes, agendamentos, lembretes e ajuda'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
              title={expanded ? 'Reduzir' : 'Expandir'}
            >
              {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
            {hasMessages && (
              <button
                onClick={clearChat}
                className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
                title="Nova conversa"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Body: Welcome or Messages */}
        {hasMessages ? renderMessages() : renderWelcome()}

        {/* Quick suggestions bar (shown when chat has messages) */}
        {hasMessages && !loading && (
          <div className="flex gap-1.5 px-3 py-2 overflow-x-auto flex-shrink-0 border-t bg-muted/20">
            {[
              'Meus clientes',
              'Agendamentos hoje',
              'Lembretes pendentes',
              'Como usar o CRM',
            ].map((s) => (
              <button
                key={s}
                onClick={() => sendMessage(s)}
                className="text-[10px] px-2.5 py-1 rounded-full border bg-card hover:bg-muted transition-colors text-muted-foreground hover:text-foreground whitespace-nowrap flex-shrink-0"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="border-t p-3 flex-shrink-0">
          <div className="flex items-end gap-2">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Pergunte sobre clientes, agendamentos, como usar o CRM..."
              className="min-h-[40px] max-h-[120px] resize-none text-sm rounded-xl"
              rows={1}
              disabled={loading}
            />
            <Button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              size="icon"
              className="h-10 w-10 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 flex-shrink-0"
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