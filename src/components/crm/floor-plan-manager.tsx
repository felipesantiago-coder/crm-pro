'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, Trash2, Loader2, GripVertical,
  LayoutGrid, ChevronUp, ChevronDown, Upload, AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ============================================================
// Types
// ============================================================
interface FloorPlan {
  id: string;
  url: string;
  altText: string | null;
  sortOrder: number;
}

interface FloorPlanManagerProps {
  enterpriseId: string;
  enterpriseName: string;
  onClose: () => void;
}

const MAX_PLANS = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_TYPES = 'image/webp,image/jpeg,image/png,image/avif,image/heic,image/heif';

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
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  /* ── Upload ──────────────────────────────────────────── */
  async function handleUpload(files: FileList | File[]) {
    const fileArray = Array.from(files);
    const validFiles = fileArray.filter((f, i) => {
      if (plans.length + i >= MAX_PLANS) {
        toast.error(`Máximo de ${MAX_PLANS} plantas`);
        return false;
      }
      if (!f.type.match(/^image\/(webp|jpeg|png|avif|heic|heif)$/)) {
        toast.error(`"${f.name}" — tipo inválido`);
        return false;
      }
      if (f.size > MAX_FILE_SIZE) {
        toast.error(`"${f.name}" — muito grande (máx. 10MB)`);
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) return;
    setUploading(true);

    for (const file of validFiles) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`/api/enterprises/${enterpriseId}/floor-plans`, {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) {
          const data = await res.json();
          toast.error(data.error || `Erro ao enviar "${file.name}"`);
        }
      } catch {
        toast.error(`Erro de conexão ao enviar "${file.name}"`);
      }
    }

    setUploading(false);
    fetchPlans();
    if (fileInputRef.current) fileInputRef.current.value = '';
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

  /* ── Drag & Drop Reorder ─────────────────────────────── */
  function handleDragStart(idx: number) { setDragIdx(idx); }
  function handleDragOver(ev: React.DragEvent, idx: number) { ev.preventDefault(); setDragOverIdx(idx); }

  async function handleDrop(targetIdx: number) {
    if (dragIdx === null || dragIdx === targetIdx) {
      setDragIdx(null); setDragOverIdx(null); return;
    }
    const newPlans = [...plans];
    const [moved] = newPlans.splice(dragIdx, 1);
    newPlans.splice(targetIdx, 0, moved);
    const orders = newPlans.map((p, i) => ({ id: p.id, sortOrder: i }));
    try {
      const res = await fetch(`/api/enterprises/${enterpriseId}/floor-plans`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders }),
      });
      if (res.ok) setPlans(newPlans.map((p, i) => ({ ...p, sortOrder: i })));
    } catch { toast.error('Erro ao reordenar'); }
    setDragIdx(null); setDragOverIdx(null);
  }

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

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) handleUpload(e.target.files);
  }
  function onDropZoneDrop(ev: React.DragEvent) {
    ev.preventDefault();
    if (ev.dataTransfer.files.length > 0) handleUpload(ev.dataTransfer.files);
  }

  /* ============================================================
     Render
     ============================================================ */
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-background rounded-2xl shadow-2xl border w-full max-w-3xl max-h-[85vh] flex flex-col">
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
              {/* Upload Zone */}
              {plans.length < MAX_PLANS && (
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={onDropZoneDrop}
                  className="relative rounded-xl border-2 border-dashed border-dashed-border hover:border-blue-300 dark:hover:border-blue-700 transition-colors cursor-pointer group"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_TYPES}
                    multiple
                    className="hidden"
                    onChange={onFileChange}
                    disabled={uploading}
                  />
                  <label
                    htmlFor={undefined}
                    className="flex flex-col items-center justify-center py-8 px-4 cursor-pointer"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="h-8 w-8 animate-spin text-blue-500 mb-2" />
                        <p className="text-sm text-muted-foreground">Enviando...</p>
                      </>
                    ) : (
                      <>
                        <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                          <Upload className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <p className="text-sm font-medium">
                          Clique ou arraste plantas aqui
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          WebP, JPEG, PNG, AVIF ou HEIC — máx. 10MB cada
                        </p>
                        <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                          {MAX_PLANS - plans.length} vaga{MAX_PLANS - plans.length !== 1 ? 's' : ''} restante{MAX_PLANS - plans.length !== 1 ? 's' : ''}
                        </p>
                      </>
                    )}
                  </label>
                </div>
              )}

              {plans.length >= MAX_PLANS && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/30">
                  <AlertCircle className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-blue-700 dark:text-blue-400">
                    Limite de {MAX_PLANS} plantas atingido. Remova uma para enviar outra.
                  </p>
                </div>
              )}

              {/* Plans Grid */}
              {plans.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Plantas enviadas
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {plans.map((plan, idx) => (
                      <div
                        key={plan.id}
                        draggable
                        onDragStart={() => handleDragStart(idx)}
                        onDragOver={(e) => handleDragOver(e, idx)}
                        onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                        onDrop={() => handleDrop(idx)}
                        className={cn(
                          'relative group/card rounded-xl overflow-hidden border-2 transition-all',
                          'border-border hover:border-border/80',
                          dragIdx === idx && 'opacity-40',
                          dragOverIdx === idx && 'border-blue-400 scale-[1.02]',
                        )}
                      >
                        <div className="aspect-[4/3] bg-muted relative">
                          <img
                            src={plan.url}
                            alt={plan.altText || `Planta ${idx + 1}`}
                            className="w-full h-full object-contain p-2"
                          />
                          <div className="absolute top-1.5 right-1.5 bg-black/50 text-white text-[10px] font-mono w-5 h-5 flex items-center justify-center rounded-full backdrop-blur-sm">
                            {idx + 1}
                          </div>
                          {/* Overlay actions */}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover/card:opacity-100 transition-opacity">
                            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                              <div className="flex items-center gap-0.5">
                                <button
                                  onClick={() => handleMoveUp(idx)}
                                  disabled={idx === 0}
                                  className="h-6 w-6 rounded bg-white/20 hover:bg-white/30 flex items-center justify-center disabled:opacity-30 transition-colors"
                                >
                                  <ChevronUp className="h-3 w-3 text-white" />
                                </button>
                                <button
                                  onClick={() => handleMoveDown(idx)}
                                  disabled={idx === plans.length - 1}
                                  className="h-6 w-6 rounded bg-white/20 hover:bg-white/30 flex items-center justify-center disabled:opacity-30 transition-colors"
                                >
                                  <ChevronDown className="h-3 w-3 text-white" />
                                </button>
                              </div>
                              {confirmDeleteId === plan.id ? (
                                <button
                                  onClick={() => handleDelete(plan.id)}
                                  disabled={deletingId === plan.id}
                                  className="h-6 px-1.5 rounded bg-red-600/80 hover:bg-red-600 text-white text-[9px] font-medium flex items-center justify-center gap-0.5 transition-colors"
                                >
                                  {deletingId === plan.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Confirmar'}
                                </button>
                              ) : (
                                <button
                                  onClick={() => setConfirmDeleteId(plan.id)}
                                  className="h-6 w-6 rounded bg-white/20 hover:bg-red-500/60 flex items-center justify-center transition-colors"
                                  title="Remover"
                                >
                                  <Trash2 className="h-3 w-3 text-white" />
                                </button>
                              )}
                            </div>
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover/card:opacity-50 transition-opacity pointer-events-none">
                              <GripVertical className="h-6 w-6 text-white" />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Add more button */}
                    {plans.length < MAX_PLANS && (
                      <label className="rounded-xl border-2 border-dashed border-dashed-border hover:border-blue-300 dark:hover:border-blue-700 transition-colors cursor-pointer flex flex-col items-center justify-center aspect-[4/3] group/add">
                        <input
                          type="file"
                          accept={ACCEPTED_TYPES}
                          multiple
                          className="hidden"
                          onChange={onFileChange}
                          disabled={uploading}
                        />
                        <span className="text-2xl text-muted-foreground group-hover/add:text-blue-500 transition-colors leading-none">+</span>
                        <span className="text-[10px] text-muted-foreground mt-1">Adicionar</span>
                      </label>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground/60 flex items-center gap-1.5">
                    <GripVertical className="h-3 w-3" />
                    Arraste para reordenar
                  </p>
                </div>
              )}

              {/* Empty state */}
              {plans.length === 0 && !uploading && (
                <div className="text-center py-10">
                  <LayoutGrid className="h-12 w-12 text-muted-foreground/20 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    Nenhuma planta enviada ainda.
                  </p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    As plantas aparecem na landing page do empreendimento.
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
