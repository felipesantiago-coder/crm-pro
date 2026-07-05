'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Kanban,
  Search,
  RefreshCw,
  Loader2,
  Phone,
  Mail,
  MapPin,
  Building2,
  CalendarClock,
  MessageCircle,
  GripVertical,
  ChevronLeft,
  ChevronRight,
  Clock,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCRMStore } from '@/store/crm-store';
import { toast } from 'sonner';
import { format, isPast, isToday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

const STAGE_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; border: string; dot: string }
> = {
  LEAD: {
    label: 'Lead',
    color: 'text-slate-600 dark:text-slate-300',
    bg: 'bg-slate-50 dark:bg-slate-900/50',
    border: 'border-slate-200 dark:border-slate-800',
    dot: 'bg-slate-400',
  },
  PROSPECT: {
    label: 'Prospect',
    color: 'text-cyan-600 dark:text-cyan-400',
    bg: 'bg-cyan-50 dark:bg-cyan-950/30',
    border: 'border-cyan-200 dark:border-cyan-800/50',
    dot: 'bg-cyan-500',
  },
  VISITA_AGENDADA: {
    label: 'Visita Agendada',
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    border: 'border-blue-200 dark:border-blue-800/50',
    dot: 'bg-blue-500',
  },
  VISITA_REALIZADA: {
    label: 'Visita Realizada',
    color: 'text-violet-600 dark:text-violet-400',
    bg: 'bg-violet-50 dark:bg-violet-950/30',
    border: 'border-violet-200 dark:border-violet-800/50',
    dot: 'bg-violet-500',
  },
  CARTA_PROPOSTA: {
    label: 'Carta Proposta',
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-800/50',
    dot: 'bg-amber-500',
  },
  CONTRATO_GERADO: {
    label: 'Contrato Gerado',
    color: 'text-orange-600 dark:text-orange-400',
    bg: 'bg-orange-50 dark:bg-orange-950/30',
    border: 'border-orange-200 dark:border-orange-800/50',
    dot: 'bg-orange-500',
  },
  FECHADO_GANHO: {
    label: 'Fechado',
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    border: 'border-emerald-200 dark:border-emerald-800/50',
    dot: 'bg-emerald-500',
  },
  FECHADO_PERDIDO: {
    label: 'Perdido',
    color: 'text-rose-600 dark:text-rose-400',
    bg: 'bg-rose-50 dark:bg-rose-950/30',
    border: 'border-rose-200 dark:border-rose-800/50',
    dot: 'bg-rose-500',
  },
};

interface PipelineClient {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  region: string | null;
  enterprise: string | null;
  stage: string;
  updatedAt: string;
  _count: { schedules: number; interactions: number };
  schedules: Array<{ scheduledDate: string; scheduledTime: string }>;
  tags: Array<{ tag: { name: string; color: string } }>;
}

interface PipelineData {
  stages: string[];
  pipeline: Record<string, PipelineClient[]>;
}

export function KanbanBoard() {
  const [data, setData] = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [draggedClient, setDraggedClient] = useState<PipelineClient | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [updatingStage, setUpdatingStage] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { setSelectedClientId, setCurrentView } = useCRMStore();

  const loadPipeline = useCallback(async () => {
    setLoading(true);
    try {
      const params = search ? `?search=${encodeURIComponent(search)}` : '';
      const res = await fetch(`/api/pipeline${params}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      toast.error('Erro ao carregar pipeline');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(loadPipeline, search ? 400 : 0);
    return () => clearTimeout(timer);
  }, [loadPipeline, search]);

  async function handleStageChange(clientId: string, newStage: string) {
    setUpdatingStage(clientId);
    try {
      const res = await fetch(`/api/clients/${clientId}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: newStage }),
      });
      if (res.ok) {
        // Optimistic update
        setData((prev) => {
          if (!prev) return prev;
          const newPipeline = { ...prev.pipeline };
          // Remove from all stages
          for (const stage of prev.stages) {
            newPipeline[stage] = (newPipeline[stage] || []).filter(
              (c) => c.id !== clientId
            );
          }
          // Find and add to new stage
          for (const stage of prev.stages) {
            const client = prev.pipeline[stage]?.find((c) => c.id === clientId);
            if (client) {
              newPipeline[newStage] = [
                { ...client, stage: newStage },
                ...(newPipeline[newStage] || []),
              ];
              break;
            }
          }
          return { ...prev, pipeline: newPipeline };
        });

        const stageLabel = STAGE_CONFIG[newStage]?.label || newStage;
        toast.success(`Estágio atualizado para "${stageLabel}"`);
      } else {
        toast.error('Erro ao atualizar estágio');
        loadPipeline();
      }
    } catch {
      toast.error('Erro ao atualizar estágio');
      loadPipeline();
    } finally {
      setUpdatingStage(null);
    }
  }

  function handleDragStart(e: React.DragEvent, client: PipelineClient) {
    setDraggedClient(client);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', client.id);
  }

  function handleDragOver(e: React.DragEvent, stage: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverStage(stage);
  }

  function handleDragLeave() {
    setDragOverStage(null);
  }

  function handleDrop(e: React.DragEvent, stage: string) {
    e.preventDefault();
    setDragOverStage(null);
    if (draggedClient && draggedClient.stage !== stage) {
      handleStageChange(draggedClient.id, stage);
    }
    setDraggedClient(null);
  }

  function handleDragEnd() {
    setDraggedClient(null);
    setDragOverStage(null);
  }

  function handleScroll(dir: 'left' | 'right') {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: dir === 'left' ? -300 : 300, behavior: 'smooth' });
    }
  }

  function getInitials(name: string) {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  function getAvatarColor(name: string) {
    const colors = [
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
      'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
      'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
      'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
      'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
      'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  function renderClientCard(client: PipelineClient, stage: string) {
    const config = STAGE_CONFIG[stage] || STAGE_CONFIG.LEAD;
    const isDragging = draggedClient?.id === client.id;
    const isUpdating = updatingStage === client.id;
    const nextSchedule = client.schedules[0];
    const isOverdue =
      nextSchedule &&
      isPast(new Date(nextSchedule.scheduledDate)) &&
      !isToday(new Date(nextSchedule.scheduledDate));

    return (
      <div
        key={client.id}
        draggable
        onDragStart={(e) => handleDragStart(e, client)}
        onDragEnd={handleDragEnd}
        className={cn(
          'group p-3 rounded-lg border bg-card hover:shadow-md transition-all cursor-grab active:cursor-grabbing',
          isDragging && 'opacity-40 scale-95',
          isUpdating && 'ring-2 ring-primary'
        )}
        onClick={() => {
          setSelectedClientId(client.id);
          setCurrentView('clientDetail');
        }}
      >
        <div className="flex items-start gap-2.5">
          <div className="flex-shrink-0 mt-0.5">
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground/70 transition-colors" />
          </div>
          <div className="flex-1 min-w-0">
            {/* Name and avatar */}
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0',
                  getAvatarColor(client.name)
                )}
              >
                {getInitials(client.name)}
              </div>
              <p className="text-sm font-semibold truncate">{client.name}</p>
            </div>

            {/* Meta info */}
            <div className="mt-2 space-y-1">
              {client.enterprise && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Building2 className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{client.enterprise}</span>
                </div>
              )}
              {client.region && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{client.region}</span>
                </div>
              )}
            </div>

            {/* Tags */}
            {client.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {client.tags.slice(0, 2).map((t) => (
                  <Badge
                    key={t.tag.name}
                    className="text-[9px] h-4 px-1.5 font-medium"
                    style={{
                      backgroundColor: `${t.tag.color}20`,
                      color: t.tag.color,
                      borderColor: `${t.tag.color}40`,
                    }}
                  >
                    {t.tag.name}
                  </Badge>
                ))}
                {client.tags.length > 2 && (
                  <span className="text-[9px] text-muted-foreground px-1">
                    +{client.tags.length - 2}
                  </span>
                )}
              </div>
            )}

            {/* Next schedule info */}
            {nextSchedule && (
              <div
                className={cn(
                  'mt-2 flex items-center gap-1.5 text-xs px-2 py-1 rounded-md',
                  isOverdue
                    ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                <CalendarClock className="h-3 w-3 flex-shrink-0" />
                <span>
                  {format(new Date(nextSchedule.scheduledDate), "dd/MM", { locale: ptBR })}
                  {nextSchedule.scheduledTime && ` às ${nextSchedule.scheduledTime}`}
                </span>
                {isOverdue && <span className="font-medium ml-auto text-[10px]">Atrasado</span>}
              </div>
            )}

            {/* Footer: interactions count + pending schedules */}
            <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
              {client._count.interactions > 0 && (
                <span className="flex items-center gap-1">
                  <MessageCircle className="h-3 w-3" />
                  {client._count.interactions}
                </span>
              )}
              {client._count.schedules > 0 && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {client._count.schedules} pend.
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 animate-pulse bg-muted rounded-lg" />
          <div className="h-10 w-64 animate-pulse bg-muted rounded-lg" />
        </div>
        <div className="flex gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex-1 min-w-[260px] h-96 animate-pulse bg-muted rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const stages = data?.stages || [];

  return (
    <div className="space-y-4">
      {/* Header with search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar cliente, empresa ou região..."
            className="pl-9 h-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-10"
          onClick={loadPipeline}
          disabled={loading}
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </Button>
      </div>

      {/* Kanban columns */}
      <div className="relative px-5">
        {/* Scroll buttons */}
        <Button
          variant="outline"
          size="icon"
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 h-9 w-9 rounded-full shadow-md bg-background border"
          onClick={() => handleScroll('left')}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 h-9 w-9 rounded-full shadow-md bg-background border"
          onClick={() => handleScroll('right')}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto pb-4 px-2 scrollbar-thin"
          style={{ scrollbarWidth: 'thin' }}
        >
          {stages.map((stage) => {
            const config = STAGE_CONFIG[stage] || STAGE_CONFIG.LEAD;
            const clients = data?.pipeline[stage] || [];
            const isDragOver = dragOverStage === stage;

            return (
              <div
                key={stage}
                className="flex-shrink-0 w-[280px]"
                onDragOver={(e) => handleDragOver(e, stage)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, stage)}
              >
                <div
                  className={cn(
                    'rounded-xl border-2 transition-colors',
                    isDragOver
                      ? 'border-primary/50 bg-primary/5'
                      : config.border,
                    config.bg
                  )}
                >
                  {/* Column header */}
                  <div className="p-3 pb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={cn('h-2.5 w-2.5 rounded-full', config.dot)} />
                      <h3 className={cn('text-sm font-semibold', config.color)}>
                        {config.label}
                      </h3>
                    </div>
                    <Badge
                      variant="secondary"
                      className="h-5 min-w-[20px] px-1.5 text-[10px] font-bold"
                    >
                      {clients.length}
                    </Badge>
                  </div>

                  {/* Column body */}
                  <div className="px-3 pb-3">
                    <div className="space-y-2 max-h-[calc(100vh-14rem)] sm:max-h-[calc(100vh-16.25rem)] overflow-y-auto pr-1">
                      {clients.length === 0 ? (
                        <div className="py-6 text-center">
                          <p className="text-xs text-muted-foreground/60">
                            {isDragOver
                              ? 'Solte aqui para mover'
                              : 'Nenhum cliente'}
                          </p>
                        </div>
                      ) : (
                        clients.map((client) => renderClientCard(client, stage))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}