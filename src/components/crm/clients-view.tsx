'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Search, Plus, Upload, Download, X, Tag, ChevronDown, Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
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
  notes: string | null;
  updatePeriod: number;
  lastInteractionAt: string | null;
  stage?: string;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
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
    filterTagIds,
    setFilterTagIds,
    selectedClientId,
    setSelectedClientId,
  } = useCRMStore();

  const [filterStage, setFilterStage] = useState('');
  const [filterCampaign, setFilterCampaign] = useState('');

  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [regions, setRegions] = useState<string[]>([]);
  const [tags, setTags] = useState<TagOption[]>([]);
  const [campaigns, setCampaigns] = useState<{ name: string; count: number }[]>([]);
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
      filterTagIds.forEach((id) => params.append('tagId', id));
      if (filterStage) params.set('stage', filterStage);
      if (filterCampaign) params.set('utmCampaign', filterCampaign);
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
  }, [debouncedSearch, filterRegion, filterTagIds, filterStage, filterCampaign, page]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  useEffect(() => {
    async function fetchFilters() {
      try {
        const [regionsRes, tagsRes, campaignsRes] = await Promise.all([
          fetch('/api/clients/regions'),
          fetch('/api/tags'),
          fetch('/api/clients/campaigns'),
        ]);
        const regionsData = regionsRes.ok ? await regionsRes.json() : [];
        const tagsData = tagsRes.ok ? await tagsRes.json() : [];
        const campaignsData = campaignsRes.ok ? await campaignsRes.json() : [];
        setRegions(Array.isArray(regionsData) ? regionsData : []);
        setTags(Array.isArray(tagsData) ? tagsData : []);
        setCampaigns(Array.isArray(campaignsData) ? campaignsData : []);
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
      <div className="flex flex-col md:flex-row gap-3">
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
          <SelectTrigger className="w-full md:w-[180px]">
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
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="w-full sm:w-auto justify-start h-9 gap-1.5"
            >
              <Tag className="h-4 w-4 text-muted-foreground" />
              {filterTagIds.length === 0
                ? 'Todas as Tags'
                : `${filterTagIds.length} tag${filterTagIds.length !== 1 ? 's' : ''}`}
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2" align="start">
            <div className="space-y-1">
              <div className="flex items-center justify-between px-1 pb-1.5 border-b">
                <span className="text-xs font-medium text-muted-foreground">
                  Filtrar por tags
                </span>
                {filterTagIds.length > 0 && (
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => { setFilterTagIds([]); setPage(1); }}
                  >
                    Limpar
                  </button>
                )}
              </div>
              {tags.length === 0 ? (
                <p className="text-xs text-muted-foreground px-1 py-3 text-center">
                  Nenhuma tag cadastrada
                </p>
              ) : (
                tags.map((tag) => {
                  const isSelected = filterTagIds.includes(tag.id);
                  return (
                    <label
                      key={tag.id}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer hover:bg-accent transition-colors"
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => {
                          if (isSelected) {
                            setFilterTagIds(filterTagIds.filter((id) => id !== tag.id));
                          } else {
                            setFilterTagIds([...filterTagIds, tag.id]);
                          }
                          setPage(1);
                        }}
                      />
                      <span
                        className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className="text-sm flex-1 truncate">{tag.name}</span>
                    </label>
                  );
                })
              )}
            </div>
            {filterTagIds.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-2 mt-1.5 border-t">
                {filterTagIds.map((tagId) => {
                  const tag = tags.find((t) => t.id === tagId);
                  if (!tag) return null;
                  return (
                    <Badge
                      key={tag.id}
                      variant="secondary"
                      className="text-[10px] gap-1 px-1.5 py-0"
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      {tag.name}
                      <X
                        className="h-2.5 w-2.5 cursor-pointer hover:text-destructive"
                        onClick={() => {
                          setFilterTagIds(filterTagIds.filter((id) => id !== tag.id));
                          setPage(1);
                        }}
                      />
                    </Badge>
                  );
                })}
              </div>
            )}
          </PopoverContent>
        </Popover>
        <Select
          value={filterStage || 'all'}
          onValueChange={(v) => {
            setFilterStage(v === 'all' ? '' : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full md:w-[200px]">
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
        <Select
          value={filterCampaign || 'all'}
          onValueChange={(v) => {
            setFilterCampaign(v === 'all' ? '' : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full md:w-[200px]">
            <div className="flex items-center gap-1.5">
              <Megaphone className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <SelectValue placeholder="Campanha" />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as Campanhas</SelectItem>
            {campaigns.length === 0 ? (
              <div className="px-2 py-3 text-center">
                <p className="text-xs text-muted-foreground">Nenhuma campanha registrada</p>
              </div>
            ) : (
              campaigns.map((c) => (
                <SelectItem key={c.name} value={c.name}>
                  <span className="truncate">{c.name}</span>
                  <span className="ml-2 text-[10px] text-muted-foreground">({c.count})</span>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>
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
            {searchQuery || filterRegion || filterTagIds.length > 0
              ? 'Tente ajustar os filtros de busca.'
              : 'Comece cadastrando seu primeiro cliente.'}
          </p>
          {!searchQuery && !filterRegion && filterTagIds.length === 0 && (
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
