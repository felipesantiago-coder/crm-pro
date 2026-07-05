'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Search, Trophy, Ban, Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ClientCard } from './client-card';
import { ClientDetail } from './client-detail';
import { ClientForm } from './client-form';
import { useCRMStore } from '@/store/crm-store';

interface Client {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  region: string | null;
  enterprise: string | null;
  notes: string | null;
  updatePeriod: number;
  lastInteractionAt: string | null;
  stage: string;
  createdAt: string;
  tags: Array<{ tagId: string; tag: { id: string; name: string; color: string } }>;
}

export function ClosedDealsView() {
  const {
    searchQuery,
    setSearchQuery,
    selectedClientId,
    setSelectedClientId,
  } = useCRMStore();

  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [wonCount, setWonCount] = useState(0);
  const [lostCount, setLostCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState('all');
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);

  const limit = 18;

  // Debounce search input
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      params.set('page', page.toString());
      params.set('limit', limit.toString());

      // Set stage filter
      const stages = stageFilter === 'FECHADO_GANHO'
        ? 'FECHADO_GANHO'
        : stageFilter === 'FECHADO_PERDIDO'
          ? 'FECHADO_PERDIDO'
          : 'FECHADO_GANHO,FECHADO_PERDIDO';

      params.set('stage', stages);

      const res = await fetch(`/api/clients?${params}`);
      const data = await res.json();
      setClients(data.clients || []);
      setTotal(data.total || 0);

      // Fetch counts for won/lost badges (separate lightweight queries)
      const [wonCountRes, lostCountRes] = await Promise.all([
        fetch('/api/clients?stage=FECHADO_GANHO&page=1&limit=1'),
        fetch('/api/clients?stage=FECHADO_PERDIDO&page=1&limit=1'),
      ]);
      const wonCountData = await wonCountRes.json();
      const lostCountData = await lostCountRes.json();
      setWonCount(wonCountData.total || 0);
      setLostCount(lostCountData.total || 0);
    } catch (err) {
      console.error('Error fetching closed deals:', err);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page, stageFilter]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const totalPages = Math.ceil(total / limit);

  function handleCardClick(id: string) {
    setSelectedClientId(id);
    setDetailOpen(true);
  }

  function handleEdit(id: string) {
    const client = clients.find((c) => c.id === id);
    if (client) {
      setEditingClient(client);
      setFormOpen(true);
    }
  }

  function handleFormSuccess() {
    setFormOpen(false);
    setEditingClient(null);
    fetchClients();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Negócios Finalizados</h1>
          <p className="text-muted-foreground mt-1">
            {total} negócio{total !== 1 ? 's' : ''} finalizado{total !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-100 dark:bg-green-900/30">
            <Trophy className="h-4 w-4 text-green-600 dark:text-green-400" />
            <span className="text-sm font-semibold text-green-700 dark:text-green-300">{wonCount} Ganho{wonCount !== 1 ? 's' : ''}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-100 dark:bg-rose-900/30">
            <Ban className="h-4 w-4 text-rose-600 dark:text-rose-400" />
            <span className="text-sm font-semibold text-rose-700 dark:text-rose-300">{lostCount} Perdido{lostCount !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Pesquisar negócios finalizados..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
            }}
            className="pl-9"
          />
        </div>
        <Select
          value={stageFilter || 'all'}
          onValueChange={(v) => {
            setStageFilter(v === 'all' ? '' : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Filtrar resultado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os Resultados</SelectItem>
            <SelectItem value="FECHADO_GANHO">Fechado e Ganho</SelectItem>
            <SelectItem value="FECHADO_PERDIDO">Fechado e Perdido</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Client Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="h-40 rounded-xl border bg-muted animate-pulse"
            />
          ))}
        </div>
      ) : clients.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
            <Trophy className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">Nenhum negócio finalizado</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            {searchQuery || stageFilter
              ? 'Tente ajustar os filtros de busca.'
              : 'Os negócios marcados como "Fechado e Ganho" ou "Fechado e Perdido" aparecerão aqui automaticamente.'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {clients.map((client) => (
              <ClientCard
                key={client.id}
                client={client}
                onClick={handleCardClick}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Anterior
              </Button>
              <span className="text-sm text-muted-foreground px-3">
                {page} de {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                Próximo
              </Button>
            </div>
          )}
        </>
      )}

      {/* Client Detail */}
      <ClientDetail
        clientId={selectedClientId}
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) setSelectedClientId(null);
        }}
        onEdit={handleEdit}
        onRefresh={fetchClients}
      />

      {/* Client Form */}
      <ClientForm
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) {
            setEditingClient(null);
          }
        }}
        client={editingClient}
        onSuccess={handleFormSuccess}
      />
    </div>
  );
}
