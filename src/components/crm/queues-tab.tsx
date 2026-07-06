'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Users, Plus, Trash2, Loader2, Save, GripVertical, Phone,
  CheckCircle2, XCircle, Star, Eye, EyeOff, RefreshCw,
  ChevronDown, ChevronUp, UserPlus, AlertTriangle, ArrowUp, ArrowDown,
  Circle, Crown,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/* ================================================================
   Types
   ================================================================ */
interface QueueUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
}

interface QueueMember {
  id: string;
  queueId: string;
  userId: string;
  order: number;
  isActive: boolean;
  user: QueueUser;
}

interface QueueAssignment {
  id: string;
  userId: string;
  leadId: string | null;
  source: string;
  createdAt: string;
  user: { id: string; name: string; phone: string | null };
}

interface LeadQueue {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  isDefault: boolean;
  currentIdx: number;
  createdAt: string;
  members: QueueMember[];
  _count: { assignments: number };
}

interface SystemUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
}

/* ================================================================
   Component
   ================================================================ */
export function QueuesTab() {
  const [queues, setQueues] = useState<LeadQueue[]>([]);
  const [systemUsers, setSystemUsers] = useState<SystemUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Create queue form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newDefault, setNewDefault] = useState(false);
  const [creating, setCreating] = useState(false);

  // Add member dialog
  const [addingToQueue, setAddingToQueue] = useState<string | null>(null);

  const fetchQueues = useCallback(async () => {
    setLoading(true);
    try {
      const [qRes, uRes] = await Promise.all([
        fetch('/api/lead-queues'),
        fetch('/api/users/search?q=&includeSelf=true'),
      ]);
      if (qRes.ok) setQueues(await qRes.json());
      if (uRes.ok) setSystemUsers(await uRes.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchQueues(); }, [fetchQueues]);

  // ── Queue CRUD ────────────────────────────────────────
  async function createQueue() {
    if (!newName.trim()) { toast.error('Nome é obrigatório'); return; }
    setCreating(true);
    try {
      const res = await fetch('/api/lead-queues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, description: newDesc, isDefault: newDefault }),
      });
      if (res.ok) {
        toast.success('Fila criada!');
        setNewName(''); setNewDesc(''); setNewDefault(false); setShowCreate(false);
        fetchQueues();
      } else {
        const d = await res.json();
        throw new Error(d.error || 'Erro');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao criar fila');
    } finally { setCreating(false); }
  }

  async function toggleQueueActive(q: LeadQueue) {
    try {
      const res = await fetch(`/api/lead-queues/${q.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !q.isActive }),
      });
      if (res.ok) {
        toast.success(q.isActive ? 'Fila pausada' : 'Fila ativada');
        fetchQueues();
      }
    } catch { toast.error('Erro ao alterar fila'); }
  }

  async function toggleDefault(q: LeadQueue) {
    try {
      const res = await fetch(`/api/lead-queues/${q.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDefault: !q.isDefault }),
      });
      if (res.ok) {
        toast.success(q.isDefault ? 'Fila removida como padrão' : 'Fila definida como padrão');
        fetchQueues();
      }
    } catch { toast.error('Erro ao alterar fila'); }
  }

  async function deleteQueue(id: string) {
    if (!confirm('Excluir esta fila e todos os dados de atribuição?')) return;
    try {
      const res = await fetch(`/api/lead-queues/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Fila excluída');
        if (expandedId === id) setExpandedId(null);
        fetchQueues();
      }
    } catch { toast.error('Erro ao excluir'); }
  }

  // ── Member Management ────────────────────────────────
  async function addMember(queueId: string, userId: string) {
    try {
      const res = await fetch(`/api/lead-queues/${queueId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (res.ok) {
        toast.success('Membro adicionado');
        setAddingToQueue(null);
        fetchQueues();
      } else {
        const d = await res.json();
        throw new Error(d.error || 'Erro');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao adicionar membro');
    }
  }

  async function toggleMemberActive(queueId: string, memberId: string, isActive: boolean) {
    try {
      const res = await fetch(`/api/lead-queues/${queueId}/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, isActive: !isActive }),
      });
      if (res.ok) fetchQueues();
    } catch { toast.error('Erro ao alterar membro'); }
  }

  async function removeMember(queueId: string, memberId: string) {
    try {
      const res = await fetch(`/api/lead-queues/${queueId}/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId }),
      });
      if (res.ok) {
        toast.success('Membro removido');
        fetchQueues();
      }
    } catch { toast.error('Erro ao remover membro'); }
  }

  async function moveMember(queueId: string, memberId: string, direction: 'up' | 'down', currentOrder: number) {
    try {
      await fetch(`/api/lead-queues/${queueId}/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, order: direction === 'up' ? currentOrder - 1 : currentOrder + 1 }),
      });
      fetchQueues();
    } catch { /* silent reorder */ }
  }

  const getAvailableUsers = (queue: LeadQueue) => {
    const memberIds = new Set(queue.members.map((m) => m.userId));
    return systemUsers.filter((u) => !memberIds.has(u.id));
  };

  const activeMembers = (q: LeadQueue) => q.members.filter((m) => m.isActive);
  const totalAssignments = queues.reduce((sum, q) => sum + q._count.assignments, 0);

  /* ─── Loading ─────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <div key={i} className="h-32 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="secondary" className="text-xs gap-1.5">
          <Users className="h-3 w-3" />
          {queues.length} fila{queues.length !== 1 ? 's' : ''}
        </Badge>
        <Badge className="text-xs gap-1.5 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
          <Circle className="h-2 w-2 fill-current" />
          {totalAssignments} atribuições
        </Badge>
        {queues.some((q) => q.isDefault) && (
          <Badge className="text-xs gap-1.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            <Star className="h-3 w-3" /> Fila padrão ativa
          </Badge>
        )}
        <Button variant="outline" size="sm" onClick={fetchQueues} className="ml-auto">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Create Queue */}
      {!showCreate ? (
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Criar Fila
        </Button>
      ) : (
        <Card className="border-dashed">
          <CardContent className="p-4 space-y-3">
            <h3 className="text-sm font-semibold">Nova Fila de Atendimento</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="q-name" className="text-xs">Nome *</Label>
                <Input
                  id="q-name"
                  placeholder="Ex: Atendimento Comercial"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createQueue()}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="q-desc" className="text-xs">Descrição</Label>
                <Input
                  id="q-desc"
                  placeholder="Opcional"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="q-default" checked={newDefault} onCheckedChange={setNewDefault} />
              <Label htmlFor="q-default" className="text-xs cursor-pointer">Fila padrão (usada nas landing pages)</Label>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={createQueue} disabled={creating || !newName.trim()}>
                {creating ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Criando...</> : <><Save className="h-3.5 w-3.5 mr-1.5" /> Criar</>}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setShowCreate(false); setNewName(''); setNewDesc(''); setNewDefault(false); }}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Queue List */}
      {queues.length === 0 && !showCreate && (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Nenhuma fila criada.</p>
            <p className="text-xs text-muted-foreground mt-1">Crie uma fila para distribuir leads automaticamente entre os atendentes.</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {queues.map((q) => {
          const isExpanded = expandedId === q.id;
          const active = activeMembers(q);
          const available = getAvailableUsers(q);

          return (
            <Card
              key={q.id}
              className={cn(
                'overflow-hidden transition-all',
                !q.isActive && 'opacity-60',
                q.isDefault && 'border-amber-200 dark:border-amber-800/50'
              )}
            >
              {/* Queue Header */}
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-sm">{q.name}</h3>
                      {q.isDefault && (
                        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-[10px] gap-1">
                          <Star className="h-2.5 w-2.5" /> Padrão
                        </Badge>
                      )}
                      {!q.isActive && (
                        <Badge variant="secondary" className="text-[10px] gap-1">
                          <EyeOff className="h-2.5 w-2.5" /> Pausada
                        </Badge>
                      )}
                    </div>
                    {q.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{q.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1"><Users className="h-3 w-3" />{active.length} ativo{active.length !== 1 ? 's' : ''}/{q.members.length}</span>
                      <span className="flex items-center gap-1"><Circle className="h-2 w-2" />{q._count.assignments} atribuições</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => toggleQueueActive(q)}
                      title={q.isActive ? 'Pausar' : 'Ativar'}
                    >
                      {q.isActive ? <Eye className="h-3.5 w-3.5 text-emerald-500" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => toggleDefault(q)}
                      title={q.isDefault ? 'Remover padrão' : 'Definir padrão'}
                    >
                      <Star className={cn('h-3.5 w-3.5', q.isDefault ? 'text-amber-500 fill-amber-500' : 'text-muted-foreground')} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => setExpandedId(isExpanded ? null : q.id)}
                    >
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      onClick={() => deleteQueue(q.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Expanded: Members */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t space-y-3">
                    {/* Member list */}
                    {q.members.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">
                        Nenhum membro. Adicione usuários abaixo.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {q.members.map((m, idx) => (
                          <div
                            key={m.id}
                            className={cn(
                              'flex items-center gap-3 p-2.5 rounded-lg border transition-colors',
                              !m.isActive && 'opacity-50 bg-muted/30',
                              m.isActive && 'hover:bg-muted/30'
                            )}
                          >
                            <div className="flex flex-col gap-0.5">
                              <button
                                onClick={() => moveMember(q.id, m.id, 'up', m.order)}
                                disabled={idx === 0}
                                className="text-muted-foreground hover:text-foreground disabled:opacity-20"
                              >
                                <ArrowUp className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => moveMember(q.id, m.id, 'down', m.order)}
                                disabled={idx === q.members.length - 1}
                                className="text-muted-foreground hover:text-foreground disabled:opacity-20"
                              >
                                <ArrowDown className="h-3 w-3" />
                              </button>
                            </div>

                            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                              {m.user.name.charAt(0).toUpperCase()}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium truncate">{m.user.name}</span>
                                {q.isDefault && m.isActive && idx === (q.currentIdx % Math.max(active.length, 1)) && (
                                  <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-[9px] px-1.5 py-0 gap-0.5">
                                    <Crown className="h-2.5 w-2.5" /> Vez
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                {m.user.phone && (
                                  <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{m.user.phone}</span>
                                )}
                                <span className="truncate">{m.user.email}</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1 flex-shrink-0">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => toggleMemberActive(q.id, m.id, m.isActive)}
                                title={m.isActive ? 'Pausar' : 'Ativar'}
                              >
                                {m.isActive
                                  ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                                  : <XCircle className="h-3.5 w-3.5 text-muted-foreground" />}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                onClick={() => removeMember(q.id, m.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add member */}
                    {addingToQueue === q.id ? (
                      <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                        <p className="text-xs font-medium">Adicionar membro:</p>
                        {available.length === 0 ? (
                          <p className="text-xs text-muted-foreground">Todos os usuários já estão na fila.</p>
                        ) : (
                          <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                            {available.map((u) => (
                              <button
                                key={u.id}
                                onClick={() => addMember(q.id, u.id)}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors text-left"
                              >
                                <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                                  {u.name.charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-xs font-medium truncate max-w-[140px]">{u.name}</p>
                                  {u.phone && <p className="text-[10px] text-muted-foreground">{u.phone}</p>}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                        <Button variant="ghost" size="sm" className="text-xs" onClick={() => setAddingToQueue(null)}>
                          Fechar
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs gap-1.5 w-full"
                        onClick={() => setAddingToQueue(q.id)}
                        disabled={available.length === 0}
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        {available.length === 0 ? 'Todos os usuários já estão na fila' : 'Adicionar membro'}
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Info */}
      <Card className="bg-blue-50/50 dark:bg-blue-950/10 border-blue-200/50 dark:border-blue-800/30">
        <CardContent className="p-4 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-muted-foreground space-y-1.5">
            <p className="font-medium text-foreground/80">Como funcionam as Filas de Atendimento</p>
            <ul className="list-disc list-inside space-y-1">
              <li><strong>Rodízio automático:</strong> cada visitante da landing page é atribuído ao próximo membro da fila (round-robin)</li>
              <li><strong>WhatsApp dinâmico:</strong> o botão da landing page usa o telefone do atendente da vez</li>
              <li><strong>Fila padrão:</strong> apenas uma fila pode ser marcada como padrão — é ela que as landing pages usam</li>
              <li><strong>Pausar membro:</strong> temporariamente remove o atendente da rotação sem excluí-lo</li>
              <li><strong>Ordem:</strong> use as setas para definir a prioridade dos atendentes</li>
              <li>Os usuários precisam ter o <strong>telefone cadastrado</strong> nas Configurações para aparecer no WhatsApp</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}