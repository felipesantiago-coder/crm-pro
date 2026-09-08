'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  UsersRound, Plus, Trash2, Loader2, Save, X, Pencil, UserPlus,
  ShieldAlert, RefreshCw, Users,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/* ================================================================
   Types — espelham GET /api/teams
   ================================================================ */
interface TeamUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
}

interface TeamWithMembers {
  id: string;
  name: string;
  members: TeamUser[];
}

interface TeamsPayload {
  teams: TeamWithMembers[];
  teamless: TeamUser[];
  admins: TeamUser[];
}

/* ================================================================
   Component — aba "Equipes" do Painel de Administração
   ================================================================ */
export function TeamsTab() {
  const [payload, setPayload] = useState<TeamsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  // Create team
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  // Rename team
  const [renaming, setRenaming] = useState<TeamWithMembers | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [savingRename, setSavingRename] = useState(false);

  // Add member (por equipe)
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);

  const fetchTeams = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/teams');
      if (res.ok) setPayload(await res.json());
      else toast.error('Erro ao carregar equipes');
    } catch {
      toast.error('Erro ao carregar equipes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTeams(); }, [fetchTeams]);

  async function createTeam() {
    if (!newName.trim()) { toast.error('Nome é obrigatório'); return; }
    setCreating(true);
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro');
      toast.success(`Equipe "${newName.trim()}" criada!`);
      setNewName(''); setShowCreate(false);
      fetchTeams();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao criar equipe');
    } finally { setCreating(false); }
  }

  async function renameTeam() {
    if (!renaming || !renameValue.trim()) return;
    setSavingRename(true);
    try {
      const res = await fetch(`/api/teams/${renaming.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameValue }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro');
      toast.success('Equipe renomeada!');
      setRenaming(null);
      fetchTeams();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao renomear');
    } finally { setSavingRename(false); }
  }

  async function deleteTeam(team: TeamWithMembers) {
    if (!confirm(`Excluir a equipe "${team.name}"? Os membros ficam sem equipe (nenhum usuário é excluído).`)) return;
    try {
      const res = await fetch(`/api/teams/${team.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Erro');
      toast.success('Equipe excluída');
      if (addingTo === team.id) setAddingTo(null);
      fetchTeams();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao excluir');
    }
  }

  async function assignUser(teamId: string, userId: string) {
    setAssigning(userId);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro');
      toast.success('Usuário adicionado à equipe');
      fetchTeams();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao adicionar usuário');
    } finally { setAssigning(null); }
  }

  async function removeFromTeam(u: TeamUser) {
    if (!confirm(`Remover "${u.name}" da equipe? Ele fica sem equipe (pode ser adicionado novamente).`)) return;
    try {
      const res = await fetch(`/api/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro');
      toast.success('Usuário removido da equipe');
      fetchTeams();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao remover');
    }
  }

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

  const teams = payload?.teams ?? [];
  const teamless = payload?.teamless ?? [];

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="secondary" className="text-xs gap-1.5">
          <UsersRound className="h-3 w-3" />
          {teams.length} equipe{teams.length !== 1 ? 's' : ''}
        </Badge>
        {teamless.length > 0 && (
          <Badge variant="outline" className="text-xs gap-1.5">
            <Users className="h-3 w-3" />
            {teamless.length} sem equipe
          </Badge>
        )}
        <Button variant="outline" size="sm" onClick={fetchTeams} className="ml-auto">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Create Team */}
      {!showCreate ? (
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Criar Equipe
        </Button>
      ) : (
        <Card className="border-dashed">
          <CardContent className="p-4 space-y-3">
            <h3 className="text-sm font-semibold">Nova Equipe</h3>
            <div className="space-y-1.5 max-w-sm">
              <Label htmlFor="t-name" className="text-xs">Nome *</Label>
              <Input
                id="t-name"
                placeholder="Ex: Equipe Comercial Zona Sul"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createTeam()}
                maxLength={80}
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={createTeam} disabled={creating || !newName.trim()}>
                {creating ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Criando...</> : <><Save className="h-3.5 w-3.5 mr-1.5" /> Criar</>}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setShowCreate(false); setNewName(''); }}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Team List */}
      {teams.length === 0 && !showCreate && (
        <Card>
          <CardContent className="py-12 text-center">
            <UsersRound className="h-12 w-12 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Nenhuma equipe criada.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Crie equipes para organizar a visualização de leads e a composição das filas de atendimento.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {teams.map((team) => (
          <Card key={team.id} className="overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-sm">{team.name}</h3>
                    <Badge variant="secondary" className="text-[10px] gap-1">
                      <Users className="h-2.5 w-2.5" />
                      {team.members.length} membro{team.members.length !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    title="Renomear"
                    onClick={() => { setRenaming(team); setRenameValue(team.name); }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    title="Excluir equipe"
                    onClick={() => deleteTeam(team)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Members */}
              {team.members.length === 0 ? (
                <p className="text-xs text-muted-foreground py-3">
                  Nenhum membro ainda. Adicione usuários sem equipe abaixo.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2 mt-3">
                  {team.members.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full border bg-muted/40"
                    >
                      <div className="h-6 w-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                        {m.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate max-w-[160px] leading-tight">{m.name}</p>
                      </div>
                      <button
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        title={`Remover ${m.name} da equipe`}
                        onClick={() => removeFromTeam(m)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add member (teamless users) */}
              {addingTo === team.id ? (
                <div className="mt-3 p-3 rounded-lg bg-muted/50 space-y-2">
                  <p className="text-xs font-medium">Adicionar usuário sem equipe:</p>
                  {teamless.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Nenhum usuário sem equipe. Todos os usuários regulares já pertencem a uma equipe.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                      {teamless.map((u) => (
                        <button
                          key={u.id}
                          disabled={assigning === u.id}
                          onClick={() => assignUser(team.id, u.id)}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors text-left disabled:opacity-50"
                        >
                          <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                            {u.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate max-w-[140px]">{u.name}</p>
                            <p className="text-[10px] text-muted-foreground truncate max-w-[140px]">{u.email}</p>
                          </div>
                          {assigning === u.id && <Loader2 className="h-3 w-3 animate-spin" />}
                        </button>
                      ))}
                    </div>
                  )}
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => setAddingTo(null)}>
                    Fechar
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs gap-1.5 w-full mt-3"
                  onClick={() => setAddingTo(team.id)}
                  disabled={teamless.length === 0}
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  {teamless.length === 0 ? 'Nenhum usuário sem equipe disponível' : 'Adicionar usuário à equipe'}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Teamless users (fora de qualquer equipe) */}
      {teamless.length > 0 && teams.length > 0 && (
        <Card className="border-dashed">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Usuários sem equipe</h3>
              <Badge variant="outline" className="text-[10px]">{teamless.length}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              Use o botão "Adicionar usuário à equipe" de uma equipe acima para vinculá-los.
            </p>
            <div className="flex flex-wrap gap-2">
              {teamless.map((u) => (
                <div key={u.id} className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full border">
                  <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                    {u.name.charAt(0).toUpperCase()}
                  </div>
                  <p className="text-xs font-medium truncate max-w-[140px]">{u.name}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info */}
      <Card className={cn('bg-blue-50/50 dark:bg-blue-950/10 border-blue-200/50 dark:border-blue-800/30')}>
        <CardContent className="p-4 flex items-start gap-3">
          <ShieldAlert className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-muted-foreground space-y-1.5">
            <p className="font-medium text-foreground/80">Como funcionam as Equipes</p>
            <ul className="list-disc list-inside space-y-1">
              <li><strong>Filtro de leads:</strong> no painel de leads e no pipeline, o admin pode selecionar uma equipe por vez para ver apenas os leads dos usuários dela (manuais e automáticos)</li>
              <li><strong>Filas de atendimento:</strong> ao montar uma fila, o admin seleciona primeiro a equipe e depois os membros daquela equipe</li>
              <li><strong>Administradores não pertencem a equipes</strong> — eles aparecem como opção própria ("Administradores") ao montar filas e podem participar de quantas filas quiserem</li>
              <li><strong>Excluir equipe</strong> não exclui usuários — eles apenas ficam sem equipe</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Rename dialog */}
      <Dialog open={!!renaming} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Renomear Equipe</DialogTitle>
            <DialogDescription>Os membros permanecem os mesmos.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="rename-team" className="text-xs">Nome</Label>
            <Input
              id="rename-team"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              maxLength={80}
              onKeyDown={(e) => e.key === 'Enter' && renameTeam()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)} disabled={savingRename}>
              Cancelar
            </Button>
            <Button onClick={renameTeam} disabled={savingRename || !renameValue.trim()}>
              {savingRename ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Salvando...</> : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
