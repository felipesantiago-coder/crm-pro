'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, Plus, Trash2, Loader2, GripVertical,
  ImageIcon, Star, ChevronUp, ChevronDown, Upload, AlertCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ============================================================
// Types
// ============================================================
interface GalleryImage {
  id: string;
  url: string;
  altText: string | null;
  sortOrder: number;
  isHero?: boolean;
}

interface GalleryManagerProps {
  enterpriseId: string;
  enterpriseName: string;
  currentHeroUrl?: string | null;
  onClose: () => void;
  onHeroChange?: (url: string) => void;
}

const MAX_IMAGES = 15;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_TYPES = 'image/webp,image/jpeg,image/png,image/avif,image/heic,image/heif';

// ============================================================
// Component
// ============================================================
export function GalleryManager({
  enterpriseId,
  enterpriseName,
  currentHeroUrl,
  onClose,
}: GalleryManagerProps) {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchImages = useCallback(async () => {
    try {
      const res = await fetch(`/api/enterprises/${enterpriseId}/images`);
      if (res.ok) {
        const data = await res.json();
        setImages(
          data.map((img: GalleryImage) => ({
            ...img,
            isHero: img.url === currentHeroUrl,
          })),
        );
      }
    } catch {
      toast.error('Erro ao carregar imagens');
    } finally {
      setLoading(false);
    }
  }, [enterpriseId, currentHeroUrl]);

  useEffect(() => {
    fetchImages();
  }, [fetchImages]);

  /* ── Upload ──────────────────────────────────────────── */
  async function handleUpload(files: FileList | File[]) {
    const fileArray = Array.from(files);

    for (const file of fileArray) {
      if (images.length + fileArray.indexOf(file) >= MAX_IMAGES) {
        toast.error(`Máximo de ${MAX_IMAGES} imagens`);
        break;
      }
      if (!file.type.match(/^image\/(webp|jpeg|png|avif)$/)) {
        toast.error(`"${file.name}" — tipo inválido (use WebP, JPEG, PNG ou AVIF)`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`"${file.name}" — muito grande (máx. 5MB)`);
        continue;
      }
    }

    const validFiles = fileArray.filter(
      (f) =>
        f.type.match(/^image\/(webp|jpeg|png|avif)$/) &&
        f.size <= MAX_FILE_SIZE &&
        images.length + fileArray.indexOf(f) < MAX_IMAGES,
    );

    if (validFiles.length === 0) return;

    setUploading(true);

    for (const file of validFiles) {
      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch(`/api/enterprises/${enterpriseId}/images`, {
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
    fetchImages();
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  /* ── Delete ──────────────────────────────────────────── */
  async function handleDelete(imageId: string) {
    setDeletingId(imageId);
    try {
      const res = await fetch(
        `/api/enterprises/${enterpriseId}/images?imageId=${imageId}`,
        { method: 'DELETE' },
      );
      if (res.ok) {
        toast.success('Imagem removida');
        setConfirmDeleteId(null);
        fetchImages();
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

  /* ── Set as Hero ─────────────────────────────────────── */
  async function handleSetHero(image: GalleryImage) {
    try {
      const res = await fetch(`/api/enterprises/${enterpriseId}/images`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setAsHero: true, imageId: image.id }),
      });
      if (res.ok) {
        toast.success('Imagem principal definida');
        fetchImages();
      }
    } catch {
      toast.error('Erro ao definir imagem principal');
    }
  }

  /* ── Drag & Drop Reorder ─────────────────────────────── */
  function handleDragStart(idx: number) {
    setDragIdx(idx);
  }

  function handleDragOver(ev: React.DragEvent, idx: number) {
    ev.preventDefault();
    setDragOverIdx(idx);
  }

  async function handleDrop(targetIdx: number) {
    if (dragIdx === null || dragIdx === targetIdx) {
      setDragIdx(null);
      setDragOverIdx(null);
      return;
    }

    const newImages = [...images];
    const [moved] = newImages.splice(dragIdx, 1);
    newImages.splice(targetIdx, 0, moved);

    const orders = newImages.map((img, i) => ({
      id: img.id,
      sortOrder: i,
    }));

    try {
      const res = await fetch(`/api/enterprises/${enterpriseId}/images`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders }),
      });
      if (res.ok) {
        setImages(
          newImages.map((img, i) => ({ ...img, sortOrder: i })),
        );
      }
    } catch {
      toast.error('Erro ao reordenar');
    }

    setDragIdx(null);
    setDragOverIdx(null);
  }

  /* ── Arrow reorder (touch-friendly) ──────────────────── */
  async function handleMoveUp(idx: number) {
    if (idx === 0) return;
    const newImages = [...images];
    [newImages[idx - 1], newImages[idx]] = [newImages[idx], newImages[idx - 1]];
    const orders = newImages.map((img, i) => ({ id: img.id, sortOrder: i }));
    try {
      const res = await fetch(`/api/enterprises/${enterpriseId}/images`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders }),
      });
      if (res.ok) setImages(newImages.map((img, i) => ({ ...img, sortOrder: i })));
    } catch { /* silent */ }
  }

  async function handleMoveDown(idx: number) {
    if (idx >= images.length - 1) return;
    const newImages = [...images];
    [newImages[idx], newImages[idx + 1]] = [newImages[idx + 1], newImages[idx]];
    const orders = newImages.map((img, i) => ({ id: img.id, sortOrder: i }));
    try {
      const res = await fetch(`/api/enterprises/${enterpriseId}/images`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders }),
      });
      if (res.ok) setImages(newImages.map((img, i) => ({ ...img, sortOrder: i })));
    } catch { /* silent */ }
  }

  /* ── File input handler ──────────────────────────────── */
  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleUpload(files);
    }
  }

  function onDropZoneDrop(ev: React.DragEvent) {
    ev.preventDefault();
    const files = ev.dataTransfer.files;
    if (files.length > 0) handleUpload(files);
  }

  /* ============================================================
     Render
     ============================================================ */
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative bg-background rounded-2xl shadow-2xl border w-full max-w-3xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-amber-500" />
              Galeria de Fotos
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {enterpriseName}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Badge variant="secondary" className="text-[10px]">
              {images.length} / {MAX_IMAGES}
            </Badge>
            <button
              onClick={onClose}
              className="h-8 w-8 rounded-lg hover:bg-muted flex items-center justify-center"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Loading */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Upload Zone */}
              {images.length < MAX_IMAGES && (
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={onDropZoneDrop}
                  className="relative rounded-xl border-2 border-dashed border-dashed-border hover:border-amber-300 dark:hover:border-amber-700 transition-colors cursor-pointer group"
                >
                  <input
                    id="gallery-upload-input"
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_TYPES}
                    multiple
                    className="hidden"
                    onChange={onFileChange}
                    disabled={uploading}
                  />
                  <label
                    htmlFor="gallery-upload-input"
                    className="flex flex-col items-center justify-center py-8 px-4 cursor-pointer"
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="h-8 w-8 animate-spin text-amber-500 mb-2" />
                        <p className="text-sm text-muted-foreground">Enviando...</p>
                      </>
                    ) : (
                      <>
                        <div className="h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                          <Upload className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                        </div>
                        <p className="text-sm font-medium">
                          Clique ou arraste fotos aqui
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          WebP, JPEG, PNG ou AVIF — máx. 5MB cada
                        </p>
                        <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                          {MAX_IMAGES - images.length} vaga{MAX_IMAGES - images.length !== 1 ? 's' : ''} restante{MAX_IMAGES - images.length !== 1 ? 's' : ''}
                        </p>
                      </>
                    )}
                  </label>
                </div>
              )}

              {/* Max reached warning */}
              {images.length >= MAX_IMAGES && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/30">
                  <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Limite de {MAX_IMAGES} imagens atingido. Remova uma foto para enviar outra.
                  </p>
                </div>
              )}

              {/* Images Grid */}
              {images.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Fotos enviadas
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {images.map((img, idx) => (
                      <div
                        key={img.id}
                        draggable
                        onDragStart={() => handleDragStart(idx)}
                        onDragOver={(e) => handleDragOver(e, idx)}
                        onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                        onDrop={() => handleDrop(idx)}
                        className={cn(
                          'relative group/card rounded-xl overflow-hidden border-2 transition-all',
                          img.isHero
                            ? 'border-amber-400 dark:border-amber-600 ring-2 ring-amber-400/20'
                            : 'border-border hover:border-border/80',
                          dragIdx === idx && 'opacity-40',
                          dragOverIdx === idx && 'border-amber-400 scale-[1.02]',
                        )}
                      >
                        {/* Image */}
                        <div className="aspect-[4/3] bg-muted relative">
                          <img
                            src={img.url}
                            alt={img.altText || `${enterpriseName} ${idx + 1}`}
                            className="w-full h-full object-cover"
                          />
                          {/* Hero badge */}
                          {img.isHero && (
                            <div className="absolute top-1.5 left-1.5 bg-amber-500 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shadow-sm">
                              <Star className="h-2.5 w-2.5" /> Principal
                            </div>
                          )}
                          {/* Index */}
                          <div className="absolute top-1.5 right-1.5 bg-black/50 text-white text-[10px] font-mono w-5 h-5 flex items-center justify-center rounded-full backdrop-blur-sm">
                            {idx + 1}
                          </div>
                          {/* Overlay actions */}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover/card:opacity-100 transition-opacity">
                            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                              {/* Left: reorder arrows */}
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
                                  disabled={idx === images.length - 1}
                                  className="h-6 w-6 rounded bg-white/20 hover:bg-white/30 flex items-center justify-center disabled:opacity-30 transition-colors"
                                >
                                  <ChevronDown className="h-3 w-3 text-white" />
                                </button>
                              </div>
                              {/* Right: hero + delete */}
                              <div className="flex items-center gap-0.5">
                                {!img.isHero && (
                                  <button
                                    onClick={() => handleSetHero(img)}
                                    className="h-6 w-6 rounded bg-white/20 hover:bg-amber-500/60 flex items-center justify-center transition-colors"
                                    title="Definir como principal"
                                  >
                                    <Star className="h-3 w-3 text-white" />
                                  </button>
                                )}
                                {confirmDeleteId === img.id ? (
                                  <button
                                    onClick={() => handleDelete(img.id)}
                                    disabled={deletingId === img.id}
                                    className="h-6 px-1.5 rounded bg-red-600/80 hover:bg-red-600 text-white text-[9px] font-medium flex items-center justify-center gap-0.5 transition-colors"
                                  >
                                    {deletingId === img.id ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      'Confirmar'
                                    )}
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => setConfirmDeleteId(img.id)}
                                    className="h-6 w-6 rounded bg-white/20 hover:bg-red-500/60 flex items-center justify-center transition-colors"
                                    title="Remover"
                                  >
                                    <Trash2 className="h-3 w-3 text-white" />
                                  </button>
                                )}
                              </div>
                            </div>
                            {/* Drag handle */}
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover/card:opacity-50 transition-opacity pointer-events-none">
                              <GripVertical className="h-6 w-6 text-white" />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Add more button (if space) */}
                    {images.length < MAX_IMAGES && (
                      <label className="rounded-xl border-2 border-dashed border-dashed-border hover:border-amber-300 dark:hover:border-amber-700 transition-colors cursor-pointer flex flex-col items-center justify-center aspect-[4/3] group/add">
                        <input
                          type="file"
                          accept={ACCEPTED_TYPES}
                          multiple
                          className="hidden"
                          onChange={onFileChange}
                          disabled={uploading}
                        />
                        <Plus className="h-5 w-5 text-muted-foreground group-hover/add:text-amber-500 transition-colors" />
                        <span className="text-[10px] text-muted-foreground mt-1">Adicionar</span>
                      </label>
                    )}
                  </div>

                  {/* Hint */}
                  <p className="text-[10px] text-muted-foreground/60 flex items-center gap-1.5">
                    <GripVertical className="h-3 w-3" />
                    Arraste para reordenar • Clique em ★ para definir como imagem principal
                  </p>
                </div>
              )}

              {/* Empty state */}
              {images.length === 0 && !uploading && (
                <div className="text-center py-10">
                  <ImageIcon className="h-12 w-12 text-muted-foreground/20 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    Nenhuma foto enviada ainda.
                  </p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    As fotos aparecem na galeria da landing page e no card do empreendimento.
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