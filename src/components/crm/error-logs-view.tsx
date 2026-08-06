'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  AlertTriangle, XCircle, CheckCircle2, RefreshCw,
  Filter, Search, ExternalLink, ChevronDown, ChevronUp,
  Trash2, Loader2, Bug, MonitorSmartphone, Zap,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface ErrorLog {
  id: string;
  type: string;
  message: string;
  source: string | null;
  lineNumber: number | null;
  colNumber: number | null;
  stackTrace: string | null;
  pageUrl: string | null;
  userAgent: string | null;
  slug: string | null;
  resolved: boolean;
  createdAt: string;
}

interface Stats {
  type: string;
  count: number;
}

const TYPE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  js_error: {
    label: 'JS Error',
    icon: <XCircle className="h-4 w-4" />,
    color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  },
  promise_rejection: {
    label: 'Promise Rejection',
    icon: <Zap className="h-4 w-4" />,
    color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  },
  react_error: {
    label: 'React Error',
    icon: <MonitorSmartphone className="h-4 w-4" />,
    color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  },
};

export function ErrorLogsView() {
  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [stats, setStats] = useState<Stats[]>([]);
  const [unresolvedCount, setUnresolvedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters
  const [filterType, setFilterType] = useState<string>('all');
  const [filterResolved, setFilterResolved] = useState<string>('false');
  const [filterSlug, setFilterSlug] = useState('');

  const fetchErrors = useCallback(async (reset = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterType !== 'all') params.set('type', filterType);
      if (filterResolved !== 'all') params.set('resolved', filterResolved);
      if (filterSlug) params.set('slug', filterSlug);
      params.set('limit', '50');
      if (!reset && cursor) params.set('cursor', cursor);

      const res = await fetch(`/api/errors/list?${params}`);
      const data = await res.json();

      if (reset) {
        setErrors(data.errors);
      } else {
        setErrors((prev) => [...prev, ...data.errors]);
      }
      setHasMore(data.hasMore);
      setCursor(data.nextCursor);
      setStats(data.stats);
      setUnresolvedCount(data.unresolvedCount);
    } catch {
      toast.error('Erro ao carregar logs');
    } finally {
      setLoading(false);
    }
  }, [filterType, filterResolved, filterSlug, cursor]);

  useEffect(() => {
    fetchErrors(true);
  }, [filterType, filterResolved, filterSlug]);

  async function toggleResolved(id: string, currentResolved: boolean) {
    try {
      await fetch(`/api/errors/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved: !currentResolved }),
      });
      setErrors((prev) =>
        prev.map((e) => (e.id === id ? { ...e, resolved: !currentResolved } : e)),
      );
      setUnresolvedCount((c) => (currentResolved ? c + 1 : c - 1));
      toast.success(currentResolved ? 'Marcado como não resolvido' : 'Marcado como resolvido');
    } catch {
      toast.error('Erro ao atualizar');
    }
  }

  async function deleteError(id: string) {
    try {
      await fetch(`/api/errors/${id}`, { method: 'DELETE' });
      setErrors((prev) => prev.filter((e) => e.id !== id));
      toast.success('Erro removido');
    } catch {
      toast.error('Erro ao remover');
    }
  }

  function formatUAgent(ua: string | null): string {
    if (!ua) return '—';
    // Extract browser + OS
    const browserMatch = ua.match(/(Chrome|Firefox|Safari|Edge|Opera)\/?\s*[\d.]+/);
    const osMatch = ua.match(/\(([^)]+)\)/);
    const browser = browserMatch ? browserMatch[0] : 'Desconhecido';
    const os = osMatch ? osMatch[1].split(';')[0].trim() : '';
    return os ? `${browser} — ${os}` : browser;
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Bug className="h-5 w-5 text-rose-500" />
            Erros do Cliente
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Erros JavaScript capturados nas landing pages
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchErrors(true)}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
                <XCircle className="h-5 w-5 text-rose-600 dark:text-rose-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{unresolvedCount}</p>
                <p className="text-xs text-muted-foreground">Não resolvidos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        {stats.map((s) => {
          const cfg = TYPE_CONFIG[s.type];
          return (
            <Card key={s.type}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${cfg?.color || 'bg-gray-100'}`}>
                    {cfg?.icon || <AlertTriangle className="h-5 w-5" />}
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{s.count}</p>
                    <p className="text-xs text-muted-foreground">{cfg?.label || s.type} ativos</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-[160px] h-9">
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os tipos</SelectItem>
                  <SelectItem value="js_error">JS Error</SelectItem>
                  <SelectItem value="promise_rejection">Promise Rejection</SelectItem>
                  <SelectItem value="react_error">React Error</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Select value={filterResolved} onValueChange={setFilterResolved}>
              <SelectTrigger className="w-[170px] h-9">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="false">Não resolvidos</SelectItem>
                <SelectItem value="true">Resolvidos</SelectItem>
                <SelectItem value="all">Todos</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Filtrar por slug..."
                className="h-9 pl-8"
                value={filterSlug}
                onChange={(e) => setFilterSlug(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error list */}
      {errors.length === 0 && !loading ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="h-12 w-12 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="font-medium">Nenhum erro encontrado</p>
            <p className="text-sm text-muted-foreground mt-1">
              Os erros capturados nas landing pages aparecerão aqui.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {errors.map((error) => {
            const cfg = TYPE_CONFIG[error.type] || TYPE_CONFIG.js_error;
            const isExpanded = expandedId === error.id;

            return (
              <Card
                key={error.id}
                className={
                  error.resolved
                    ? 'opacity-60'
                    : 'border-rose-200 dark:border-rose-800/40'
                }
              >
                <CardContent className="p-3">
                  {/* Header row */
                  <div
                    className="flex items-start gap-3 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : error.id)}
                  >
                    <div
                      className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${cfg.color}`}
                    >
                      {cfg.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={`text-[10px] h-5 px-1.5 ${cfg.color}`}>
                          {cfg.label}
                        </Badge>
                        {error.slug && (
                          <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                            {error.slug}
                          </Badge>
                        )}
                        {error.resolved && (
                          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-[10px] h-5 px-1.5">
                            Resolvido
                          </Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground ml-auto flex-shrink-0">
                          {formatDistanceToNow(new Date(error.createdAt), {
                            addSuffix: true,
                            locale: ptBR,
                          })}
                        </span>
                      </div>
                      <p className="text-sm font-medium mt-1 break-all">
                        {error.message}
                      </p>
                      {error.source && !isExpanded && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {error.source}
                          {error.lineNumber ? `:${error.lineNumber}` : ''}
                        </p>
                      )}
                    </div>
                    <div className="flex-shrink-0">
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>

                  {/* Expanded detail */
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t space-y-3">
                      {/* Stack trace */
                      {error.stackTrace && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-1">
                            Stack Trace
                          </p>
                          <pre className="text-xs bg-muted p-3 rounded-lg overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-all font-mono">
                            {error.stackTrace}
                          </pre>
                        </div>
                      )}

                      {/* Metadata grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        {error.pageUrl && (
                          <div>
                            <span className="text-muted-foreground">URL: </span>
                            <a
                              href={error.pageUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                            >
                              {error.pageUrl}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        )}
                        {error.source && (
                          <div>
                            <span className="text-muted-foreground">Fonte: </span>
                            <span className="font-mono">{error.source}{error.lineNumber ? `:${error.lineNumber}:${error.colNumber || 0}` : ''}</span>
                          </div>
                        )}
                        <div>
                          <span className="text-muted-foreground">User Agent: </span>
                          <span>{formatUAgent(error.userAgent)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Data: </span>
                          <span>
                            {new Date(error.createdAt).toLocaleString('pt-BR')}
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 pt-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleResolved(error.id, error.resolved);
                          }}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                          {error.resolved ? 'Reabrir' : 'Marcar como resolvido'}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs text-red-600 hover:text-red-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteError(error.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                          Excluir
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {/* Load more */
          {hasMore && (
            <div className="text-center">
              <Button
                variant="outline"
                onClick={() => fetchErrors(false)}
                disabled={loading}
              >
                {loading ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Carregando...</>
                ) : (
                  'Carregar mais erros'
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
