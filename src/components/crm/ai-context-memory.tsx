'use client';

/**
 * Resumo do cliente com Nexo (prompt v2.0 §21) — substitui a "Memória de
 * Contexto IA". Mesma autorização do endpoint, nova identidade: NexoAvatar,
 * NexoMarkdown sanitizado, tokens e erros do assistente.
 *
 * Ações: Gerar/Atualizar resumo, Copiar resumo (com feedback real) e
 * "Perguntar ao Nexo sobre este cliente" — abre o chat com o clientId
 * fixado como contexto (clique explícito do usuário; nunca autoabre).
 * O resumo não é persistido automaticamente (decisão de produto/privacidade).
 */
import React, { useState } from 'react';
import { Copy, Check, Loader2, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { NexoAvatar } from '@/components/ai-assistant/nexo-avatar';
import { NexoMarkdown } from '@/components/ai-assistant/nexo-markdown';
import { getAssistantMessages, formatMessage } from '@/components/ai-assistant/assistant-messages';
import { useAssistantContextStore } from '@/components/ai-assistant/assistant-context-store';
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
  const t = getAssistantMessages();
  const [data, setData] = useState<ContextMemoryData | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestOpenPanel = useAssistantContextStore((s) => s.requestOpenPanel);
  const pinEntityContext = useAssistantContextStore((s) => s.pinEntityContext);

  async function generateContext() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/context-memory`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setGeneratedAt(new Date());
        if (!json.summary) {
          setError(t.summary.error);
        }
      } else {
        setError(t.summary.error);
      }
    } catch {
      setError(t.summary.error);
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!data?.summary) return;
    try {
      await navigator.clipboard.writeText(data.summary);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function askNexoAboutClient() {
    // Fixa o cliente autorizado como contexto e abre o chat por clique.
    pinEntityContext();
    requestOpenPanel();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <NexoAvatar
            state="idle"
            theme="transparente"
            size={28}
            decorative
            className="flex-shrink-0 rounded-lg"
          />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{t.summary.title}</h3>
            <p className="truncate text-[10px] text-muted-foreground">
              {t.summary.description}
            </p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {data && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              aria-label={expanded ? t.summary.collapse : t.summary.expand}
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
            className="h-7 gap-1.5 px-3 text-xs"
            onClick={generateContext}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : data ? (
              <RefreshCw className="h-3 w-3" aria-hidden />
            ) : null}
            {loading ? t.summary.update : data ? t.summary.update : t.summary.generate}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/30">
          <CardContent className="p-3">
            <p className="text-xs text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {loading && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <NexoAvatar
                state="thinking"
                theme="transparente"
                size={24}
                decorative
                className="flex-shrink-0"
              />
              <p className="text-xs text-muted-foreground">{t.summary.loading}</p>
            </div>
            <div className="mt-4 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-4 w-full max-w-[85%] animate-pulse rounded bg-muted" style={{ maxWidth: `${95 - i * 15}%` }} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {data && !loading && expanded && (
        <Card>
          <CardContent className="p-4">
            {/* Estatísticas rápidas — dados já autorizados da ficha */}
            <div className="mb-3 flex flex-wrap items-center gap-2 border-b pb-3">
              <Badge variant="secondary" className="h-5 text-[10px]">
                {data.stageLabel}
              </Badge>
              {data.region && (
                <Badge variant="outline" className="h-5 text-[10px]">
                  {data.region}
                </Badge>
              )}
              {data.enterprise && (
                <Badge variant="outline" className="h-5 text-[10px]">
                  {data.enterprise}
                </Badge>
              )}
              <Badge variant="outline" className="h-5 text-[10px]">
                {data.totalInteractions} interações
              </Badge>
              <Badge variant="outline" className="h-5 text-[10px]">
                {data.completedSchedules}/{data.totalSchedules} visitas
              </Badge>
            </div>

            {/* Resumo — NexoMarkdown sanitizado (§21) */}
            <div className="text-sm">
              <NexoMarkdown text={data.summary} />
            </div>

            <Separator className="my-3" />

            {/* Rodapé: nota, data de geração e ações */}
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              {t.summary.note}
              {generatedAt && (
                <> · {formatMessage(t.summary.generatedAt, {
                  dateTime: generatedAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }),
                })}</>
              )}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 px-2.5 text-xs"
                onClick={askNexoAboutClient}
              >
                <NexoAvatar state="idle" theme="transparente" size={14} decorative className="rounded-full" />
                {t.summary.askNexo}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 px-2.5 text-xs"
                onClick={handleCopy}
                aria-label={copied ? t.summary.copied : t.summary.copy}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-success" aria-hidden />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                )}
                {copied ? t.summary.copied : t.summary.copy}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!data && !loading && !error && (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
              <NexoAvatar state="idle" theme="claro" size={36} decorative className="rounded-lg" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">
              {t.summary.title}
            </p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
              {t.summary.empty}
            </p>
            <Button
              variant="outline"
              size="sm"
              className={cn('mt-3 h-8 gap-1.5 px-3 text-xs')}
              onClick={generateContext}
            >
              {t.summary.generate}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
