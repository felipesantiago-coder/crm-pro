'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  HeartHandshake,
  RefreshCw,
  Trash2,
  UserPlus,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Mail,
  Phone,
  User,
  Globe,
  ExternalLink,
  Search,
  Filter,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useCRMStore } from '@/store/crm-store';

interface LostLeadItem {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  slug: string | null;
  source: string;
  formData: Record<string, unknown> | null;
  userAgent: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  isRecovered: boolean;
  recoveredToClientId: string | null;
  createdAt: string;
}

export function LostLeadsView() {
  const [items, setItems] = useState<LostLeadItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState<string | null>(null);
  const [showRecovered, setShowRecovered] = useState(false);
  const [filterSlug, setFilterSlug] = useState('');

  const limit = 50;

  const loadLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        ...(showRecovered ? { showRecovered: 'true' } : {}),
        ...(filterSlug ? { slug: filterSlug } : {}),
      });
      const res = await fetch(`/api/leads/lost-leads?${params}`);
      const data = await res.json();
      if (res.ok) {
        setItems(data.items || []);
        setTotal(data.total || 0);
      }
    } catch {
      toast.error('Erro ao carregar leads perdidos');
    } finally {
      setLoading(false);
    }
  }, [page, showRecovered, filterSlug]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  const handleRecover = async (item: LostLeadItem) => {
    if (!item.name || !item.email) {
      toast.error('Este lead não tem dados suficientes (nome e e-mail obrigatórios)');
      return;
    }
    setRecovering(item.id);
    try {
      const res = await fetch('/api/leads/lost-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lostLeadId: item.id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(data.alreadyExisted
          ? `Cliente com este e-mail já existia — ID: ${data.clientId}`
          : `Lead "${data.clientName}" recuperado com sucesso!`
        );
        loadLeads();
      } else {
        toast.error(data.error || 'Erro ao recuperar lead');
      }
    } catch {
      toast.error('Erro de conexão');
    } finally {
      setRecovering(null);
    }
  };

  const handleDiscard = async (item: LostLeadItem) => {
    if (!confirm(`Descartar lead "${item.name || item.email || 'sem dados'}"?`)) return;
    try {
      await fetch(`/api/leads/lost-leads?id=${item.id}`, { method: 'DELETE' });
      toast.success('Lead descartado');
      loadLeads();
    } catch {
      toast.error('Erro ao descartar');
    }
  };

  const handleRecoverAll = async () => {
    const recoverable = items.filter((i) => i.name && i.email && !i.isRecovered);
    if (recoverable.length === 0) {
      toast.info('Nenhum lead recuperável nesta página');
      return;
    }
    if (!confirm(`Recuperar ${recoverable.length} leads desta página? Cada lead será criado como cliente no CRM.`)) return;

    let success = 0;
    let errors = 0;
    for (const item of recoverable) {
      try {
        const res = await fetch('/api/leads/lost-leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lostLeadId: item.id }),
        });
        if (res.ok) success++;
        else errors++;
      } catch {
        errors++;
      }
    }
    toast.success(`${success} leads recuperados${errors > 0 ? `, ${errors} erros` : ''}`);
    loadLeads();
  };

  const sourceBadge = (source: string) => {
    if (source === 'beacon') {
      return <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 text-[10px]">Beacon</Badge>;
    }
    return <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-[10px]">Retry</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center shadow-sm">
            <HeartHandshake className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Leads Perdidos</h1>
            <p className="text-sm text-muted-foreground">
              Leads capturados pela rede de segurança que não completaram o cadastro
            </p>
          </div>
        </div>
        {items.length > 0 && (
          <Button
            onClick={handleRecoverAll}
            disabled={recovering !== null}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <UserPlus className="h-4 w-4 mr-2" />
            Recuperar todos da página
          </Button>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filtrar por slug..."
                value={filterSlug}
                onChange={(e) => { setFilterSlug(e.target.value); setPage(1); }}
                className="h-9 w-48"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Button
                variant={showRecovered ? 'outline' : 'default'}
                size="sm"
                onClick={() => { setShowRecovered(!showRecovered); setPage(1); }}
                className="h-9"
              >
                {showRecovered ? 'Mostrar pendentes' : 'Mostrar recuperados'}
              </Button>
            </div>
            <Button variant="outline" size="sm" onClick={loadLeads} className="h-9 ml-auto">
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
            Total pendentes
          </div>
          <p className="text-2xl font-bold">{total}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Mail className="h-3.5 w-3.5 text-blue-500" />
            Com e-mail
          </div>
          <p className="text-2xl font-bold">{items.filter((i) => i.email).length}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Phone className="h-3.5 w-3.5 text-emerald-500" />
            Com telefone
          </div>
          <p className="text-2xl font-bold">{items.filter((i) => i.phone).length}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            Recuperáveis
          </div>
          <p className="text-2xl font-bold">{items.filter((i) => i.name && i.email && !i.isRecovered).length}</p>
        </Card>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="h-14 w-14 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="h-7 w-7 text-emerald-500" />
          </div>
          <h3 className="font-semibold text-lg">Nenhum lead perdido</h3>
          <p className="text-sm text-muted-foreground mt-2">
            {showRecovered
              ? 'Todos os leads foram tratados.'
              : 'Todos os cadastros foram completados com sucesso. A rede de segurança está ativa e capturará qualquer lead que não consiga se registrar.'}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const canRecover = !!item.name && !!item.email && !item.isRecovered;
            return (
              <Card key={item.id} className="overflow-hidden">
                <div className="p-4">
                  <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                    {/* Main info */}
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">
                          {item.name || 'Sem nome'}
                        </span>
                        {sourceBadge(item.source)}
                        {item.isRecovered && (
                          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-[10px]">
                            <CheckCircle2 className="h-3 w-3 mr-0.5" /> Recuperado
                          </Badge>
                        )}
                        {item.slug && (
                          <Badge variant="secondary" className="text-[10px]">
                            <Globe className="h-3 w-3 mr-0.5" /> {item.slug}
                          </Badge>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        {item.email && (
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <Mail className="h-3.5 w-3.5" /> {item.email}
                          </span>
                        )}
                        {item.phone && (
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <Phone className="h-3.5 w-3.5" /> {item.phone}
                          </span>
                        )}
                      </div>

                      {/* UTM / metadata row */}
                      {(item.utmSource || item.utmCampaign || item.utmMedium) && (
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground/70">
                          {item.utmSource && <span>utm_source: {item.utmSource}</span>}
                          {item.utmMedium && <span>utm_medium: {item.utmMedium}</span>}
                          {item.utmCampaign && <span>utm_campaign: {item.utmCampaign}</span>}
                        </div>
                      )}

                      {/* Timestamp */}
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: ptBR })}
                        {item.userAgent && (
                          <span className="ml-2 truncate max-w-[200px]" title={item.userAgent}>
                            {item.userAgent.split(' ').slice(0, 3).join(' ')}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {canRecover && (
                        <Button
                          size="sm"
                          onClick={() => handleRecover(item)}
                          disabled={recovering !== null}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white h-9"
                        >
                          {recovering === item.id ? (
                            <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Recuperando...</>
                          ) : (
                            <><UserPlus className="h-3.5 w-3.5 mr-1.5" /> Recuperar</>
                          )}
                        </Button>
                      )}
                      {item.recoveredToClientId && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            useCRMStore.getState().setSelectedClientId(item.recoveredToClientId!);
                            useCRMStore.getState().setCurrentView('clientDetail');
                          }}
                          className="h-9"
                        >
                          <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                          Ver cliente
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDiscard(item)}
                        className="text-muted-foreground hover:text-destructive h-9"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline" size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {page} de {Math.ceil(total / limit)}
          </span>
          <Button
            variant="outline" size="sm"
            disabled={page >= Math.ceil(total / limit)}
            onClick={() => setPage(page + 1)}
          >
            Próxima
          </Button>
        </div>
      )}
    </div>
  );
}
