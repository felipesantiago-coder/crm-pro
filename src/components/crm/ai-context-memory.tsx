'use client';

import React, { useState } from 'react';
import { Brain, Loader2, Sparkles, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ContextMemoryData {
  summary: string;
  clientName: string;
  stage: string;
  stageLabel: string;
  totalInteractions: number;
  totalSchedules: number;
  completedSchedules: number;
  hasPhone: boolean;
  hasEmail: boolean;
  tags: string;
  enterprise: string | null;
  region: string | null;
  createdAt: string;
  updatedAt: string;
  lastInteractionAt: string | null;
}

export function AIContextMemory({ clientId }: { clientId: string }) {
  const [data, setData] = useState<ContextMemoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function generateContext() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/context-memory`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
        if (!json.summary) {
          setError(
            'Não foi possível gerar o resumo. Verifique se as chaves de API (Gemini ou Groq) estão configuradas.'
          );
        }
      } else {
        setError('Erro ao gerar memória de contexto');
      }
    } catch {
      setError('Erro de conexão ao gerar memória de contexto');
    } finally {
      setLoading(false);
    }
  }

  // Parse markdown to simple HTML rendering
  function renderMarkdown(text: string) {
    // Split into lines and handle headers, lists, bold, etc.
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    let inList = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Headers
      if (line.startsWith('## ')) {
        if (inList) {
          elements.push(<ul key={`ul-close-${i}`} className="list-disc pl-5 mb-2 space-y-0.5" />);
          inList = false;
        }
        const content = line.slice(3).trim();
        // Strip markdown bold from header
        const cleanContent = content.replace(/\*\*/g, '');
        elements.push(
          <h3 key={i} className="text-sm font-semibold mt-3 mb-1 text-foreground">
            {cleanContent}
          </h3>
        );
        continue;
      }

      // List items
      if (line.startsWith('- ') || line.startsWith('* ')) {
        if (!inList) {
          inList = true;
          elements.push(
            <ul key={`ul-${i}`} className="list-disc pl-5 mb-2 space-y-0.5">
              <MarkdownListItem key={i} text={line.slice(2)} />
            </ul>
          );
        } else {
          elements.push(<MarkdownListItem key={i} text={line.slice(2)} />);
        }
        continue;
      }

      // Empty lines
      if (line.trim() === '') {
        if (inList) {
          elements.push(<ul key={`ul-close-${i}`} className="list-disc pl-5 mb-2 space-y-0.5" />);
          inList = false;
        }
        elements.push(<div key={i} className="h-2" />);
        continue;
      }

      // Regular paragraphs
      if (inList) {
        elements.push(<ul key={`ul-close-${i}`} className="list-disc pl-5 mb-2 space-y-0.5" />);
        inList = false;
      }
      elements.push(
        <p key={i} className="text-sm text-muted-foreground leading-relaxed">
          <MarkdownInline text={line} />
        </p>
      );
    }

    if (inList) {
      elements.push(
        <ul key="ul-close-final" className="list-disc pl-5 mb-2 space-y-0.5" />
      );
    }

    return <div>{elements}</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
            <Brain className="h-4 w-4 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Memória de Contexto IA</h3>
            <p className="text-[10px] text-muted-foreground">
              Resumo inteligente para o próximo atendimento
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {data && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'h-7 px-3 text-xs gap-1.5',
              !data && 'bg-gradient-to-r from-violet-500 to-purple-600 text-white border-transparent hover:from-violet-600 hover:to-purple-700'
            )}
            onClick={generateContext}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : data ? (
              <RefreshCw className="h-3 w-3" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {data ? 'Atualizar' : 'Gerar Resumo'}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-amber-200 dark:border-amber-800/50">
          <CardContent className="p-3">
            <p className="text-xs text-amber-600 dark:text-amber-400">{error}</p>
          </CardContent>
        </Card>
      )}

      {loading && !data && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
              <div className="flex-1">
                <p className="text-sm font-medium">Gerando resumo inteligente...</p>
                <p className="text-xs text-muted-foreground">
                  Analisando histórico de interações e agendamentos
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-4 bg-muted rounded animate-pulse" style={{ width: `${90 - i * 15}%` }} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {loading && data && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
              <span className="text-xs text-muted-foreground">Atualizando resumo...</span>
            </div>
            {/* Show old content while loading */}
            {expanded && <div className="text-sm">{renderMarkdown(data.summary)}</div>}
          </CardContent>
        </Card>
      )}

      {data && !loading && expanded && (
        <Card className="border-violet-200/60 dark:border-violet-800/30">
          <CardContent className="p-4">
            {/* Quick stats bar */}
            <div className="flex flex-wrap items-center gap-2 mb-3 pb-3 border-b">
              <Badge variant="secondary" className="text-[10px] h-5">
                {data.stageLabel}
              </Badge>
              {data.region && (
                <Badge variant="outline" className="text-[10px] h-5">
                  {data.region}
                </Badge>
              )}
              {data.enterprise && (
                <Badge variant="outline" className="text-[10px] h-5">
                  {data.enterprise}
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px] h-5">
                {data.totalInteractions} interações
              </Badge>
              <Badge variant="outline" className="text-[10px] h-5">
                {data.completedSchedules}/{data.totalSchedules} visitas
              </Badge>
            </div>

            {/* AI Summary */}
            <div className="text-sm">{renderMarkdown(data.summary)}</div>
          </CardContent>
        </Card>
      )}

      {!data && !loading && !error && (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center">
            <div className="h-12 w-12 rounded-xl bg-violet-50 dark:bg-violet-950/30 flex items-center justify-center mx-auto mb-3">
              <Sparkles className="h-6 w-6 text-violet-400" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">
              Resumo inteligente do cliente
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
              Clique em &quot;Gerar Resumo&quot; para que a IA analise o histórico do cliente e
              crie um resumo estratégico para o próximo atendimento.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MarkdownInline({ text }: { text: string }) {
  // Simple inline markdown: **bold** and *italic*
  const parts = text.split(/(\*\*.*?\*\*|\*.*?\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('*') && part.endsWith('*')) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function MarkdownListItem({ text }: { text: string }) {
  return (
    <li className="text-sm text-muted-foreground leading-relaxed">
      <MarkdownInline text={text} />
    </li>
  );
}