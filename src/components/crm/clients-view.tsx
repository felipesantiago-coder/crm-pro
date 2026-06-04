'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Search, Plus, Upload, Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ClientCard } from './client-card';
import { ClientForm } from './client-form';
import { ClientDetail } from './client-detail';
import { ImportExport } from './import-export';
import { useCRMStore } from '@/store/crm-store';

interface Client {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  region: string | null;
  enterprise: string | null;
  updatePeriod: number;
  lastInteractionAt: string | null;
  stage?: string;
  createdAt: string;
  tags: Array<{ tagId: string; tag: { id: string; name: string; color: string } }>;
}

interface TagOption {
  id: string;
  name: string;
  color: string;
}

export function ClientsView() {
  const {
    searchQuery,
    setSearchQuery,
    filterRegion,
    setFilterRegion,
    filterTagId,
    setFilterTagId,
    selectedClientId,
    setSelectedClientId,
  } = useCRMStore();

  const [filterStage, setFilterStage] = useState('');

  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [regions, setRegions] = useState<string[]>([]);
  const [tags, setTags] = useState<TagOption[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
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
      if (filterRegion) params.set('region', filterRegion);
      if (filterTagId) params.set('tagId', filterTagId);
      if (filterStage) params.set('stage', filterStage);
      // Excluir negócios finalizados da lista principal (têm view dedicada)
      params.set('excludeClosed', 'true');
      params.set('page', page.toString());
      params.set('limit', limit.toString());

      const res = await fetch(`/api/clients?${params}`);
      const data = await res.json();
      setClients(data.clients || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Error fetching clients:', err);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, filterRegion, filterTagId, filterStage, page]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  useEffect(() => {
    async function fetchFilters() {
      try {
        const [regionsRes, tagsRes] = await Promise.all([
          fetch('/api/clients/regions'),
          fetch('/api/tags'),
        ]);
        const regionsData = await regionsRes.json();
        const tagsData = await tagsRes.json();
        setRegions(regionsData || []);
        setTags(tagsData);
      } catch {
        console.error('Error fetching filters');
      }
    }
    fetchFilters();
  }, []);

  const totalPages = Math.ceil(total / limit);

  function handleCardClick(id: string) {
    setSelectedClientId(id);
    setDetailOpen(true);
  }

  function handleEdit(id: string) {
    const client = clients.find((c) => c.id === id);
    if (client) {
      setEditingClient(client);
      setEditingClientId(id);
      setFormOpen(true);
    }
  }

  function handleFormSuccess() {
    setFormOpen(false);
    setEditingClient(null);
    setEditingClientId(null);
    fetchClients();
  }

  function handleNewClient() {
    setEditingClient(null);
    setEditingClientId(null);
    setFormOpen(true);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
          <p className="text-muted-foreground mt-1">
            {total} cliente{total !== 1 ? 's' : ''} cadastrado{total !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setShowImportExport(!showImportExport)}>
            {showImportExport ? (
              <X className="h-4 w-4 mr-2" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            {showImportExport ? 'Fechar' : 'Importar/Exportar'}
          </Button>
          <Button size="sm" onClick={handleNewClient} className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white">
            <Plus className="h-4 w-4 mr-2" />
            Novo Cliente
          </Button>
        </div>
      </div>

      {/* Import/Export Section */}
      {showImportExport && (
        <ImportExport onImportComplete={fetchClients} />
      )}

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Pesquisar clientes..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
            }}
            className="pl-9"
          />
        </div>
        <Select
          value={filterRegion || 'all'}
          onValueChange={(v) => {
            setFilterRegion(v === 'all' ? '' : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Região" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as Regiões</SelectItem>
            {regions.map((region) => (
              <SelectItem key={region} value={region}>
                {region}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filterTagId || 'all'}
          onValueChange={(v) => {
            setFilterTagId(v === 'all' ? '' : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Tag" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as Tags</SelectItem>
            {tags.map((tag) => (
              <SelectItem key={tag.id} value={tag.id}>
                {tag.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filterStage || 'all'}
          onValueChange={(v) => {
            setFilterStage(v === 'all' ? '' : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Etapa" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as Etapas</SelectItem>
            <SelectItem value="LEAD">Lead</SelectItem>
            <SelectItem value="PROSPECT">Prospect</SelectItem>
            <SelectItem value="VISITA_AGENDADA">Visita Agendada</SelectItem>
            <SelectItem value="VISITA_REALIZADA">Visita Realizada</SelectItem>
            <SelectItem value="CARTA_PROPOSTA">Carta Proposta</SelectItem>
            <SelectItem value="CONTRATO_GERADO">Contrato Gerado</SelectItem>
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
            <Download className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">Nenhum cliente encontrado</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            {searchQuery || filterRegion || filterTagId
              ? 'Tente ajustar os filtros de busca.'
              : 'Comece cadastrando seu primeiro cliente.'}
          </p>
          {!searchQuery && !filterRegion && !filterTagId && (
            <Button className="mt-4 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white" onClick={handleNewClient}>
              <Plus className="h-4 w-4 mr-2" />
              Novo Cliente
            </Button>
          )}
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
            setEditingClientId(null);
          }
        }}
        client={editingClient}
        onSuccess={handleFormSuccess}
      />
    </div>
  );
}
