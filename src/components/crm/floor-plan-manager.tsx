'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  X, Trash2, Loader2, GripVertical,
  LayoutGrid, ChevronUp, ChevronDown, AlertCircle,
  Plus, Check, Save,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ============================================================
// Types
// ============================================================
interface FloorPlan {
  id: string;
  url: string | null;
  altText: string | null;
  sortOrder: number;
  name: string | null;
  area: string | null;
  bedrooms: number | null;
  suites: number | null;
  hasBalcony: boolean | null;
  isGarden: boolean | null;
  isPenthouse: boolean | null;
  description: string | null;
}

interface FloorPlanForm {
  name: string;
  area: string;
  bedrooms: string;
  suites: string;
  hasBalcony: boolean;
  isGarden: boolean;
  isPenthouse: boolean;
  description: string;
}

interface FloorPlanManagerProps {
  enterpriseId: string;
  enterpriseName: string;
  onClose: () => void;
}

const MAX_PLANS = 10;

const EMPTY_FORM: FloorPlanForm = {
  name: '',
  area: '',
  bedrooms: '',
  suites: '',
  hasBalcony: false,
  isGarden: false,
  isPenthouse: false,
  description: '',
};

function planToForm(plan: FloorPlan): FloorPlanForm {
  return {
    name: plan.name || '',
    area: plan.area || '',
    bedrooms: plan.bedrooms != null ? String(plan.bedrooms) : '',
    suites: plan.suites != null ? String(plan.suites) : '',
    hasBalcony: plan.hasBalcony ?? false,
    isGarden: plan.isGarden ?? false,
    isPenthouse: plan.isPenthouse ?? false,
    description: plan.description || '',
  };
}

function formToData(form: FloorPlanForm) {
  return {
    name: form.name.trim() || null,
    area: form.area.trim() || null,
    bedrooms: form.bedrooms !== '' ? parseInt(form.bedrooms, 10) : null,
    suites: form.suites !== '' ? parseInt(form.suites, 10) : 0,
    hasBalcony: form.hasBalcony,
    isGarden: form.isGarden,
    isPenthouse: form.isPenthouse,
    description: form.description.trim() || null,
  };
}

// ============================================================
// Component
// ============================================================
export function FloorPlanManager({
  enterpriseId,
  enterpriseName,
  onClose,
}: FloorPlanManagerProps) {
  const [plans, setPlans] = useState<FloorPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FloorPlanForm>(EMPTY_FORM);
  const [showAddForm, setShowAddForm] = useState(false);

  const fetchPlans = useCallback(async () => {
    try {
      const res = await fetch(`/api/enterprises/${enterpriseId}/floor-plans`);
      if (res.ok) {
        const data = await res.json();
        setPlans(data);
      }
    } catch {
      toast.error('Erro ao carregar plantas');
    } finally {
      setLoading(false);
    }
  }, [enterpriseId]);

  useEffect(() => { fetchPlans(); }, [fetchPlans]);

  /* ── Create / Update ────────────────────────────────── */
  async function handleSave(isNew: boolean) {
    if (!form.name.trim() && !form.area.trim()) {
      toast.error('Preencha ao menos o nome e/ou a metragem da planta');
      return;
    }
    setSaving(true);
    try {
      const data = formToData(form);
      const res = await fetch(`/api/enterprises/${enterpriseId}/floor-plans`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isNew ? data : { planId: editingId, ...data }),
      });
      if (res.ok) {
        toast.success(isNew ? 'Planta adicionada' : 'Planta atualizada');
        if (isNew) {
          setShowAddForm(false);
          setForm(EMPTY_FORM);
        } else {
          setEditingId(null);
        }
        fetchPlans();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Erro ao salvar');
      }
    } catch {
      toast.error('Erro de conexão');
    } finally {
      setSaving(false);
    }
  }

  /* ── Delete ──────────────────────────────────────────── */
  async function handleDelete(planId: string) {
    setDeletingId(planId);
    try {
      const res = await fetch(
        `/api/enterprises/${enterpriseId}/floor-plans?planId=${planId}`,
        { method: 'DELETE' },
      );
      if (res.ok) {
        toast.success('Planta removida');
        setConfirmDeleteId(null);
        fetchPlans();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Erro ao remover');
      }
    } catch {
      toast.error('Erro de conexão');
    } finally {
      setDeletingId(null);
    }
  }

  /* ── Reorder ─────────────────────────────────────────── */
  async function handleMoveUp(idx: number) {
    if (idx === 0) return;
    const newPlans = [...plans];
    [newPlans[idx - 1], newPlans[idx]] = [newPlans[idx], newPlans[idx - 1]];
    const orders = newPlans.map((p, i) => ({ id: p.id, sortOrder: i }));
    try {
      const res = await fetch(`/api/enterprises/${enterpriseId}/floor-plans`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders }),
      });
      if (res.ok) setPlans(newPlans.map((p, i) => ({ ...p, sortOrder: i })));
    } catch { /* silent */ }
  }

  async function handleMoveDown(idx: number) {
    if (idx >= plans.length - 1) return;
    const newPlans = [...plans];
    [newPlans[idx], newPlans[idx + 1]] = [newPlans[idx + 1], newPlans[idx]];
    const orders = newPlans.map((p, i) => ({ id: p.id, sortOrder: i }));
    try {
      const res = await fetch(`/api/enterprises/${enterpriseId}/floor-plans`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders }),
      });
      if (res.ok) setPlans(newPlans.map((p, i) => ({ ...p, sortOrder: i })));
    } catch { /* silent */ }
  }

  function startEditing(plan: FloorPlan) {
    setEditingId(plan.id);
    setForm(planToForm(plan));
  }

  function cancelEditing() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function updateForm(field: keyof FloorPlanForm, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function buildPreviewLabel(f: FloorPlanForm): string {
    const parts: string[] = [];
    if (f.isGarden) parts.push('Garden');
    if (f.isPenthouse) parts.push('Cobertura');
    if (f.bedrooms) {
      const bed = `${f.bedrooms} quarto${Number(f.bedrooms) > 1 ? 's' : ''}`;
      if (f.suites && Number(f.suites) > 0) {
        parts.push(`${bed} (${f.suites} suíte${Number(f.suites) > 1 ? 's' : ''})`);
      } else {
        parts.push(bed);
      }
    }
    if (f.hasBalcony && parts.length > 0) parts[parts.length - 1] += ' com Varanda';
    else if (f.hasBalcony) parts.push('Com Varanda');
    return parts.length > 0 ? parts.join(' ') : '—';
  }

  /* ============================================================
     Render
     ============================================================ */
  const isEditing = editingId !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-background rounded-2xl shadow-2xl border w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <LayoutGrid className="h-5 w-5 text-blue-500" />
              Plantas das Unidades
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {enterpriseName}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {plans.length} / {MAX_PLANS}
            </span>
            <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-muted flex items-center justify-center">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* ── Add / Edit Form ─────────────────────── */}
              {(showAddForm || isEditing) && (
                <div className="rounded-xl border-2 border-blue-200 dark:border-blue-800/40 bg-blue-50/50 dark:bg-blue-950/10 p-4 space-y-4">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    {isEditing ? 'Editar Planta' : 'Nova Planta'}
                  </h3>

                  {/* Row 1: Name + Area */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Nome *</label>
                      <input
                        type="text"
                        value={form.name}
                        onChange={(e) => updateForm('name', e.target.value)}
                        placeholder="Ex: Garden 03, Tipo 1 Quarto"
                        className="w-full h-9 px-3 text-sm rounded-lg border bg-background outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Metragem *</label>
                      <input
                        type="text"
                        value={form.area}
                        onChange={(e) => updateForm('area', e.target.value)}
                        placeholder="Ex: 80,57 m²"
                        className="w-full h-9 px-3 text-sm rounded-lg border bg-background outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                      />
                    </div>
                  </div>

                  {/* Row 2: Bedrooms + Suites */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Quartos</label>
                      <select
                        value={form.bedrooms}
                        onChange={(e) => updateForm('bedrooms', e.target.value)}
                        className="w-full h-9 px-3 text-sm rounded-lg border bg-background outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                      >
                        <option value="">Selecione</option>
                        {[1, 2, 3, 4].map((n) => (
                          <option key={n} value={n}>{n} quarto{n > 1 ? 's' : ''}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Suítes</label>
                      <select
                        value={form.suites}
                        onChange={(e) => updateForm('suites', e.target.value)}
                        className="w-full h-9 px-3 text-sm rounded-lg border bg-background outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                      >
                        <option value="">Nenhuma</option>
                        {[1, 2, 3, 4].map((n) => (
                          <option key={n} value={n}>{n} suíte{n > 1 ? 's' : ''}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Row 3: Checkboxes */}
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={form.hasBalcony}
                        onChange={(e) => updateForm('hasBalcony', e.target.checked)}
                        className="h-4 w-4 rounded border-muted-foreground/30 accent-blue-500"
                      />
                      Varanda
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={form.isGarden}
                        onChange={(e) => updateForm('isGarden', e.target.checked)}
                        className="h-4 w-4 rounded border-muted-foreground/30 accent-blue-500"
                      />
                      Garden
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={form.isPenthouse}
                        onChange={(e) => updateForm('isPenthouse', e.target.checked)}
                        className="h-4 w-4 rounded border-muted-foreground/30 accent-blue-500"
                      />
                      Cobertura
                    </label>
                  </div>

                  {/* Row 4: Description */}
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">Descrição</label>
                    <input
                      type="text"
                      value={form.description}
                      onChange={(e) => updateForm('description', e.target.value)}
                      placeholder="Ex: Torre A · unidade térrea com área privativa ampliada"
                      className="w-full h-9 px-3 text-sm rounded-lg border bg-background outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                    />
                  </div>

                  {/* Preview */}
                  <div className="rounded-lg bg-background border p-3">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Pré-visualização do card</p>
                    <div className="rounded-xl p-3 bg-muted/50 border">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">{buildPreviewLabel(form)}</p>
                          <p className="text-sm font-semibold text-foreground">{form.name || 'Nome da planta'}</p>
                          {form.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{form.description}</p>}
                        </div>
                        <p className="text-sm font-semibold text-foreground whitespace-nowrap">{form.area || '—'}</p>
                      </div>
                    </div>
                  </div>

                  {/* Form Actions */}
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => { setShowAddForm(false); cancelEditing(); }}
                      className="h-8 px-3 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => handleSave(!isEditing)}
                      disabled={saving}
                      className="h-8 px-4 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                    >
                      {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      {isEditing ? 'Salvar' : 'Adicionar'}
                    </button>
                  </div>
                </div>
              )}

              {/* ── Add Button ────────────────────────────── */}
              {!showAddForm && !isEditing && plans.length < MAX_PLANS && (
                <button
                  onClick={() => { setShowAddForm(true); setForm(EMPTY_FORM); }}
                  className="w-full flex items-center justify-center gap-2 h-10 rounded-xl border-2 border-dashed border-dashed-border hover:border-blue-300 dark:hover:border-blue-700 text-sm font-medium text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400 transition-all"
                >
                  <Plus className="h-4 w-4" />
                  Adicionar Planta
                </button>
              )}

              {plans.length >= MAX_PLANS && !isEditing && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/30">
                  <AlertCircle className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-blue-700 dark:text-blue-400">
                    Limite de {MAX_PLANS} plantas atingido. Remova uma para adicionar outra.
                  </p>
                </div>
              )}

              {/* ── Plans List ────────────────────────────── */}
              {plans.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Plantas cadastradas
                  </p>
                  <div className="space-y-1.5">
                    {plans.map((plan, idx) => {
                      const label = buildPreviewLabel(planToForm(plan));
                      return (
                        <div
                          key={plan.id}
                          className={cn(
                            'group/plan rounded-xl border p-3 transition-all',
                            editingId === plan.id
                              ? 'border-blue-300 dark:border-blue-700 bg-blue-50/30 dark:bg-blue-950/10'
                              : 'border-border hover:border-border/80 bg-background',
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-[10px] font-mono text-muted-foreground/50">#{idx + 1}</span>
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">{label}</span>
                              </div>
                              <p className="text-sm font-semibold text-foreground">{plan.name || 'Sem nome'}</p>
                              {plan.description && (
                                <p className="text-xs text-muted-foreground mt-0.5 truncate">{plan.description}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <span className="text-sm font-semibold text-foreground whitespace-nowrap">{plan.area || '—'}</span>
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
                            <div className="flex items-center gap-0.5">
                              <button
                                onClick={() => handleMoveUp(idx)}
                                disabled={idx === 0}
                                className="h-6 w-6 rounded hover:bg-muted flex items-center justify-center disabled:opacity-30 transition-colors"
                                title="Mover para cima"
                              >
                                <ChevronUp className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => handleMoveDown(idx)}
                                disabled={idx === plans.length - 1}
                                className="h-6 w-6 rounded hover:bg-muted flex items-center justify-center disabled:opacity-30 transition-colors"
                                title="Mover para baixo"
                              >
                                <ChevronDown className="h-3 w-3" />
                              </button>
                              <GripVertical className="h-3 w-3 text-muted-foreground/30 mx-0.5" />
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => startEditing(plan)}
                                className="h-6 w-6 rounded hover:bg-muted flex items-center justify-center transition-colors text-muted-foreground hover:text-foreground"
                                title="Editar"
                              >
                                <Save className="h-3 w-3" />
                              </button>
                              {confirmDeleteId === plan.id ? (
                                <button
                                  onClick={() => handleDelete(plan.id)}
                                  disabled={deletingId === plan.id}
                                  className="h-6 px-2 rounded bg-red-600/80 hover:bg-red-600 text-white text-[10px] font-medium flex items-center justify-center gap-0.5 transition-colors"
                                >
                                  {deletingId === plan.id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : 'Confirmar'}
                                </button>
                              ) : (
                                <button
                                  onClick={() => setConfirmDeleteId(plan.id)}
                                  className="h-6 w-6 rounded hover:bg-red-50 dark:hover:bg-red-950/20 flex items-center justify-center transition-colors text-muted-foreground hover:text-red-500"
                                  title="Remover"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {plans.length === 0 && !showAddForm && !isEditing && (
                <div className="text-center py-10">
                  <LayoutGrid className="h-12 w-12 text-muted-foreground/20 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    Nenhuma planta cadastrada ainda.
                  </p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    Adicione plantas com metragem, quartos, suítes e outros detalhes.
                    Elas aparecerão como cards informativos na landing page.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
