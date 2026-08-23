'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Instagram,
  Upload,
  Image as ImageIcon,
  Calendar,
  Clock,
  Send,
  Save,
  Trash2,
  MoreHorizontal,
  Pencil,
  ExternalLink,
  RotateCcw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Unplug,
  Link2,
  X,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

// ============================================================
// Types
// ============================================================
interface Post {
  id: string;
  caption: string;
  imageUrl: string;
  status: 'DRAFT' | 'SCHEDULED' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED';
  scheduledAt: string | null;
  publishedAt: string | null;
  igPermalink: string | null;
  igMediaId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Helpers
// ============================================================
const STATUS_CONFIG: Record<
  Post['status'],
  { label: string; className: string }
> = {
  DRAFT: {
    label: 'Rascunho',
    className: 'bg-muted text-muted-foreground',
  },
  SCHEDULED: {
    label: 'Agendado',
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  },
  PUBLISHING: {
    label: 'Publicando...',
    className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  },
  PUBLISHED: {
    label: 'Publicado',
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  },
  FAILED: {
    label: 'Falha',
    className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  },
};

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'DRAFT', label: 'Rascunho' },
  { value: 'SCHEDULED', label: 'Agendado' },
  { value: 'PUBLISHED', label: 'Publicado' },
  { value: 'FAILED', label: 'Falha' },
];

const PAGE_SIZE = 20;

// ============================================================
// Component
// ============================================================
export function InstagramPanel() {
  const searchParams = useSearchParams();

  // ---- State ----
  const [activeTab, setActiveTab] = useState<'account' | 'new' | 'posts'>(
    'account'
  );
  const [loading, setLoading] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [totalPosts, setTotalPosts] = useState(0);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');

  // New post form
  const [caption, setCaption] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [imageKey, setImageKey] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [scheduledDate, setScheduledDate] = useState<string>('');
  const [scheduledTime, setScheduledTime] = useState('12:00');
  const [isScheduling, setIsScheduling] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);

  // Dialogs
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [editCaption, setEditCaption] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('12:00');
  const [editSaving, setEditSaving] = useState(false);

  // Drag & drop
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- URL params detection (post Instagram OAuth redirect) ----
  useEffect(() => {
    const igStatus = searchParams.get('instagram');
    if (igStatus === 'connected') {
      toast.success('Conta Instagram conectada com sucesso!');
    } else if (igStatus === 'error') {
      toast.error('Erro ao conectar conta Instagram.');
    }
  }, [searchParams]);

  // ---- Fetch posts ----
  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (statusFilter) params.set('status', statusFilter);

      const res = await fetch(`/api/instagram/posts?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao carregar publicações.' }));
        throw new Error(err.error || 'Erro ao carregar publicações.');
      }
      const data = await res.json();
      setPosts(data.posts ?? data ?? []);
      setTotalPosts(data.total ?? data.posts?.length ?? 0);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao carregar publicações.');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    if (activeTab === 'posts') {
      fetchPosts();
    }
  }, [activeTab, fetchPosts]);

  // ---- Reset form ----
  const resetForm = () => {
    setCaption('');
    setImagePreview('');
    setImageKey('');
    setImageUrl('');
    setScheduledDate('');
    setScheduledTime('12:00');
    setIsScheduling(false);
  };

  // ---- Image upload ----
  const handleImageUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Por favor, selecione um arquivo de imagem válido.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('A imagem deve ter no máximo 10MB.');
      return;
    }

    // Show preview immediately
    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Upload to server
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);

      const res = await fetch('/api/instagram/upload-image', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao fazer upload da imagem.' }));
        throw new Error(err.error || 'Erro ao fazer upload da imagem.');
      }
      const data = await res.json();
      setImageUrl(data.url);
      setImageKey(data.key);
      toast.success('Imagem carregada com sucesso!');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao fazer upload da imagem.');
      setImagePreview('');
    } finally {
      setUploading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files[0];
    if (file) handleImageUpload(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleImageUpload(file);
    // Reset so the same file can be re-selected
    e.target.value = '';
  };

  // ---- Schedule validation ----
  const getScheduledDatetime = useCallback((): Date | null => {
    if (!scheduledDate || !scheduledTime) return null;
    return new Date(`${scheduledDate}T${scheduledTime}:00`);
  }, [scheduledDate, scheduledTime]);

  const isScheduleValid = useCallback((): boolean => {
    const dt = getScheduledDatetime();
    if (!dt) return false;
    return dt.getTime() > Date.now() + 5 * 60 * 1000; // 5 min in future
  }, [getScheduledDatetime]);

  // ---- Save / Publish ----
  const handleSaveDraft = async () => {
    if (!caption.trim() && !imageUrl) {
      toast.error('Adicione uma imagem e/ou legenda para salvar o rascunho.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/instagram/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caption: caption.trim(),
          imageUrl,
          imageKey,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao salvar rascunho.' }));
        throw new Error(err.error || 'Erro ao salvar rascunho.');
      }
      toast.success('Rascunho salvo com sucesso!');
      resetForm();
      setActiveTab('posts');
      fetchPosts();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar rascunho.');
    } finally {
      setSaving(false);
    }
  };

  const handleSchedule = async () => {
    if (!caption.trim() && !imageUrl) {
      toast.error('Adicione uma imagem e/ou legenda para agendar.');
      return;
    }
    const dt = getScheduledDatetime();
    if (!dt || !isScheduleValid()) {
      toast.error('A data/horário de agendamento deve ser pelo menos 5 minutos no futuro.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/instagram/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caption: caption.trim(),
          imageUrl,
          imageKey,
          scheduledAt: dt.toISOString(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao agendar publicação.' }));
        throw new Error(err.error || 'Erro ao agendar publicação.');
      }
      toast.success('Publicação agendada com sucesso!');
      resetForm();
      setActiveTab('posts');
      fetchPosts();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao agendar publicação.');
    } finally {
      setSaving(false);
    }
  };

  const handlePublishNow = async () => {
    if (!imageUrl) {
      toast.error('É necessário carregar uma imagem para publicar.');
      return;
    }
    if (!caption.trim()) {
      toast.error('Adicione uma legenda para publicar.');
      return;
    }
    setSaving(true);
    try {
      // Create the post first
      const createRes = await fetch('/api/instagram/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caption: caption.trim(),
          imageUrl,
          imageKey,
        }),
      });
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({ error: 'Erro ao criar publicação.' }));
        throw new Error(err.error || 'Erro ao criar publicação.');
      }
      const created = await createRes.json();
      const postId = created.id;

      // Immediately publish
      setPublishingId(postId);
      const pubRes = await fetch(`/api/instagram/posts/${postId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish-now' }),
      });
      if (!pubRes.ok) {
        const err = await pubRes.json().catch(() => ({ error: 'Erro ao publicar.' }));
        throw new Error(err.error || 'Erro ao publicar.');
      }
      toast.success('Publicação enviada ao Instagram!');
      resetForm();
      setActiveTab('posts');
      fetchPosts();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao publicar.');
    } finally {
      setSaving(false);
      setPublishingId(null);
    }
  };

  // ---- Disconnect ----
  const handleDisconnect = async () => {
    try {
      const res = await fetch('/api/instagram/disconnect', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao desconectar.' }));
        throw new Error(err.error || 'Erro ao desconectar.');
      }
      toast.success('Conta Instagram desconectada.');
      setDisconnectDialogOpen(false);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao desconectar.');
    }
  };

  // ---- Post actions ----
  const handlePublishPost = async (postId: string) => {
    setPublishingId(postId);
    try {
      const res = await fetch(`/api/instagram/posts/${postId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish-now' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao publicar.' }));
        throw new Error(err.error || 'Erro ao publicar.');
      }
      toast.success('Publicação enviada ao Instagram!');
      fetchPosts();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao publicar.');
    } finally {
      setPublishingId(null);
    }
  };

  const handleRetryPost = async (postId: string) => {
    try {
      const res = await fetch(`/api/instagram/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'SCHEDULED' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao tentar novamente.' }));
        throw new Error(err.error || 'Erro ao tentar novamente.');
      }
      toast.success('Status redefinido para agendado. A publicação será tentada novamente.');
      fetchPosts();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao tentar novamente.');
    }
  };

  const handleDeletePost = async () => {
    if (!editingPost) return;
    try {
      const res = await fetch(`/api/instagram/posts/${editingPost.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao excluir publicação.' }));
        throw new Error(err.error || 'Erro ao excluir publicação.');
      }
      toast.success('Publicação excluída com sucesso.');
      setDeleteDialogOpen(false);
      setEditingPost(null);
      fetchPosts();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao excluir publicação.');
    }
  };

  // ---- Edit post ----
  const openEditDialog = (post: Post) => {
    setEditingPost(post);
    setEditCaption(post.caption);
    if (post.scheduledAt) {
      const d = new Date(post.scheduledAt);
      setEditDate(format(d, 'yyyy-MM-dd'));
      setEditTime(format(d, 'HH:mm'));
    } else {
      setEditDate('');
      setEditTime('12:00');
    }
    setEditDialogOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingPost) return;
    setEditSaving(true);
    try {
      const body: Record<string, string> = { caption: editCaption.trim() };
      if (editDate && editTime) {
        const dt = new Date(`${editDate}T${editTime}:00`);
        if (dt.getTime() > Date.now() + 5 * 60 * 1000) {
          body.scheduledAt = dt.toISOString();
        }
      }

      const res = await fetch(`/api/instagram/posts/${editingPost.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao editar publicação.' }));
        throw new Error(err.error || 'Erro ao editar publicação.');
      }
      toast.success('Publicação atualizada com sucesso!');
      setEditDialogOpen(false);
      setEditingPost(null);
      fetchPosts();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao editar publicação.');
    } finally {
      setEditSaving(false);
    }
  };

  // ---- Computed ----
  const totalPages = Math.ceil(totalPosts / PAGE_SIZE);
  const showingFrom = totalPosts === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min((page + 1) * PAGE_SIZE, totalPosts);
  const isFormDisabled = uploading || saving;

  // ============================================================
  // RENDER — Account Tab
  // ============================================================
  const renderAccountTab = () => (
    <Card className="rounded-xl border bg-card">
      <CardHeader className="p-6 pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Instagram className="h-5 w-5 text-pink-500" />
          Conta Instagram
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 pt-0 space-y-4">
        {/* Connection status card */}
        <div className="rounded-lg border p-4 space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600">
              <Instagram className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 space-y-1">
              <h4 className="text-sm font-medium">Conexão com Instagram</h4>
              <p className="text-sm text-muted-foreground">
                Conecte sua conta profissional do Instagram para publicar conteúdo diretamente pelo painel.
              </p>
            </div>
          </div>

          <Separator />

          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              onClick={() => (window.location.href = '/api/instagram/connect')}
              className="bg-gradient-to-r from-pink-500 via-red-500 to-yellow-500 text-white hover:opacity-90"
            >
              <Link2 className="mr-2 h-4 w-4" />
              Conectar Conta
            </Button>
            <Button
              variant="outline"
              onClick={() => setDisconnectDialogOpen(true)}
            >
              <Unplug className="mr-2 h-4 w-4" />
              Desconectar
            </Button>
          </div>
        </div>

        {/* Info / requirements */}
        <div className="rounded-lg border border-dashed p-4 space-y-3">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
            Requisitos
          </h4>
          <ul className="text-sm text-muted-foreground space-y-2 list-none pl-0">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-500 shrink-0" />
              <span>Conta Instagram profissional (Creator ou Business)</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-500 shrink-0" />
              <span>Página do Facebook vinculada à conta do Instagram</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-500 shrink-0" />
              <span>A conexão é válida apenas para o administrador do sistema</span>
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );

  // ============================================================
  // RENDER — New Post Tab
  // ============================================================
  const renderNewPostTab = () => (
    <Card className="rounded-xl border bg-card">
      <CardHeader className="p-6 pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Send className="h-5 w-5 text-pink-500" />
          Criar Publicação
        </CardTitle>
        <CardDescription>
          Crie e publique conteúdo diretamente no Instagram.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-6 pt-0 space-y-4">
        {/* Image Upload Area */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Imagem</Label>
          {!imagePreview ? (
            <div
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8',
                'cursor-pointer transition-colors hover:border-pink-400 hover:bg-pink-50/50 dark:hover:bg-pink-950/10',
                uploading && 'pointer-events-none opacity-60'
              )}
            >
              {uploading ? (
                <>
                  <Loader2 className="h-8 w-8 animate-spin text-pink-500" />
                  <p className="text-sm text-muted-foreground">Enviando imagem...</p>
                </>
              ) : (
                <>
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <Upload className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium">
                      Arraste uma imagem ou clique para selecionar
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      PNG, JPG ou JPEG (máx. 10MB)
                    </p>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="relative rounded-lg overflow-hidden border bg-muted">
              <div className="relative w-full max-w-sm mx-auto aspect-square">
                <Image
                  src={imagePreview}
                  alt="Pré-visualização"
                  fill
                  className="object-cover"
                />
              </div>
              <Button
                variant="destructive"
                size="icon"
                className="absolute top-2 right-2 h-8 w-8 rounded-full bg-black/50 hover:bg-black/70 text-white"
                onClick={(e) => {
                  e.stopPropagation();
                  setImagePreview('');
                  setImageKey('');
                  setImageUrl('');
                }}
                disabled={uploading}
              >
                <X className="h-4 w-4" />
              </Button>
              {uploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <Loader2 className="h-8 w-8 animate-spin text-white" />
                </div>
              )}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg"
            className="hidden"
            onChange={handleFileInputChange}
          />
        </div>

        {/* Caption */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Legenda</Label>
            <span
              className={cn(
                'text-xs',
                caption.length > 2200
                  ? 'text-red-500'
                  : caption.length > 2000
                    ? 'text-yellow-600'
                    : 'text-muted-foreground'
              )}
            >
              {caption.length}/2200
            </span>
          </div>
          <Textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value.slice(0, 2200))}
            placeholder="Escreva a legenda da publicação..."
            rows={4}
            className="resize-none"
            disabled={isFormDisabled}
          />
        </div>

        <Separator />

        {/* Scheduling */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Agendar publicação
            </Label>
            <Switch
              checked={isScheduling}
              onCheckedChange={setIsScheduling}
              disabled={isFormDisabled}
            />
          </div>
          {isScheduling && (
            <div className="flex flex-col sm:flex-row gap-3 pl-0 sm:pl-6">
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs text-muted-foreground">Data</Label>
                <Input
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  min={format(new Date(), 'yyyy-MM-dd')}
                  disabled={isFormDisabled}
                />
              </div>
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs text-muted-foreground">Horário</Label>
                <Input
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                  disabled={isFormDisabled}
                />
              </div>
            </div>
          )}
          {isScheduling && scheduledDate && scheduledTime && !isScheduleValid() && (
            <p className="text-xs text-red-500 pl-0 sm:pl-6">
              A data e horário devem ser pelo menos 5 minutos no futuro.
            </p>
          )}
        </div>

        <Separator />

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            variant="outline"
            onClick={handleSaveDraft}
            disabled={isFormDisabled}
            className="flex-1 sm:flex-none"
          >
            {saving && !publishingId ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Salvar Rascunho
          </Button>

          {isScheduling && (
            <Button
              onClick={handleSchedule}
              disabled={isFormDisabled || !isScheduleValid()}
              className="flex-1 sm:flex-none"
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Calendar className="mr-2 h-4 w-4" />
              )}
              Agendar
            </Button>
          )}

          <Button
            onClick={handlePublishNow}
            disabled={isFormDisabled || !imageUrl || !caption.trim()}
            className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Publicar Agora
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  // ============================================================
  // RENDER — Posts Tab
  // ============================================================
  const renderPostsTab = () => {
    const isActionDisabled = (postId: string) =>
      publishingId === postId || saving;

    return (
      <div className="space-y-4">
        {/* Filter bar */}
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((filter) => (
            <Button
              key={filter.value}
              variant={statusFilter === filter.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setStatusFilter(filter.value);
                setPage(0);
              }}
              className={cn(
                'text-xs',
                statusFilter === filter.value
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : ''
              )}
            >
              {filter.label}
            </Button>
          ))}
        </div>

        {/* Posts list */}
        <Card className="rounded-xl border bg-card">
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center p-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : posts.length === 0 ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                  <ImageIcon className="h-7 w-7 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">Nenhuma publicação criada ainda</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Crie sua primeira publicação na aba &quot;Novo Post&quot;
                  </p>
                </div>
              </div>
            ) : (
              <ScrollArea className="max-h-[600px]">
                <div className="divide-y">
                  {posts.map((post) => {
                    const statusCfg = STATUS_CONFIG[post.status];
                    return (
                      <div
                        key={post.id}
                        className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-4 hover:bg-muted/50 transition-colors"
                      >
                        {/* Thumbnail */}
                        {post.imageUrl ? (
                          <div className="relative h-12 w-12 shrink-0 rounded-lg overflow-hidden bg-muted">
                            <Image
                              src={post.imageUrl}
                              alt=""
                              fill
                              className="object-cover"
                            />
                          </div>
                        ) : (
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
                            <ImageIcon className="h-5 w-5 text-muted-foreground" />
                          </div>
                        )}

                        {/* Caption + meta */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate max-w-xs sm:max-w-md">
                            {post.caption || 'Sem legenda'}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            <Badge
                              variant="secondary"
                              className={cn('text-[10px] px-1.5 py-0', statusCfg.className)}
                            >
                              {statusCfg.label}
                            </Badge>
                            {post.scheduledAt && post.status === 'SCHEDULED' && (
                              <span className="text-[11px] text-muted-foreground">
                                {format(
                                  new Date(post.scheduledAt),
                                  "dd/MM/yyyy 'às' HH:mm",
                                  { locale: ptBR }
                                )}
                              </span>
                            )}
                            {post.publishedAt && post.status === 'PUBLISHED' && (
                              <span className="text-[11px] text-muted-foreground">
                                {format(
                                  new Date(post.publishedAt),
                                  "dd/MM/yyyy 'às' HH:mm",
                                  { locale: ptBR }
                                )}
                              </span>
                            )}
                            {post.status === 'PUBLISHING' && (
                              <span className="flex items-center gap-1 text-[11px] text-yellow-600 dark:text-yellow-400">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Publicando...
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="shrink-0 self-start sm:self-center">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                disabled={isActionDisabled(post.id)}
                              >
                                {isActionDisabled(post.id) ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <MoreHorizontal className="h-4 w-4" />
                                )}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              {/* Edit: DRAFT or SCHEDULED */}
                              {(post.status === 'DRAFT' ||
                                post.status === 'SCHEDULED') && (
                                <DropdownMenuItem
                                  onClick={() => openEditDialog(post)}
                                >
                                  <Pencil className="mr-2 h-4 w-4" />
                                  Editar
                                </DropdownMenuItem>
                              )}

                              {/* Publish now: DRAFT or SCHEDULED */}
                              {(post.status === 'DRAFT' ||
                                post.status === 'SCHEDULED') && (
                                <DropdownMenuItem
                                  onClick={() => handlePublishPost(post.id)}
                                >
                                  <Send className="mr-2 h-4 w-4" />
                                  Publicar Agora
                                </DropdownMenuItem>
                              )}

                              {/* View on Instagram: PUBLISHED */}
                              {post.status === 'PUBLISHED' &&
                                post.igPermalink && (
                                  <DropdownMenuItem asChild>
                                    <a
                                      href={post.igPermalink}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <ExternalLink className="mr-2 h-4 w-4" />
                                      Ver no Instagram
                                    </a>
                                  </DropdownMenuItem>
                                )}

                              {/* Retry: FAILED */}
                              {post.status === 'FAILED' && (
                                <DropdownMenuItem
                                  onClick={() => handleRetryPost(post.id)}
                                >
                                  <RotateCcw className="mr-2 h-4 w-4" />
                                  Tentar Novamente
                                </DropdownMenuItem>
                              )}

                              {/* Delete: DRAFT or SCHEDULED */}
                              {(post.status === 'DRAFT' ||
                                post.status === 'SCHEDULED') && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400"
                                    onClick={() => {
                                      setEditingPost(post);
                                      setDeleteDialogOpen(true);
                                    }}
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Excluir
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {posts.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>
              Mostrando {showingFrom}–{showingTo} de {totalPosts}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Próximo
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ============================================================
  // RENDER — Main
  // ============================================================
  return (
    <div className="space-y-4">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as typeof activeTab)}
      >
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="account" className="gap-2">
            <Instagram className="h-4 w-4" />
            <span className="hidden sm:inline">Conta</span>
          </TabsTrigger>
          <TabsTrigger value="new" className="gap-2">
            <Send className="h-4 w-4" />
            <span className="hidden sm:inline">Novo Post</span>
          </TabsTrigger>
          <TabsTrigger value="posts" className="gap-2">
            <ImageIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Publicações</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="account" className="mt-4">
          {renderAccountTab()}
        </TabsContent>

        <TabsContent value="new" className="mt-4">
          {renderNewPostTab()}
        </TabsContent>

        <TabsContent value="posts" className="mt-4">
          {renderPostsTab()}
        </TabsContent>
      </Tabs>

      {/* ---- Disconnect confirmation dialog ---- */}
      <AlertDialog open={disconnectDialogOpen} onOpenChange={setDisconnectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar conta Instagram</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja desconectar sua conta do Instagram? As
              publicações agendadas podem não ser mais enviadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---- Delete confirmation dialog ---- */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir publicação</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir esta publicação? Esta ação não pode
              ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeletePost}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---- Edit dialog ---- */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar publicação</DialogTitle>
            <DialogDescription>
              Altere a legenda ou o agendamento da publicação.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Current image preview */}
            {editingPost?.imageUrl && (
              <div className="relative w-full max-w-xs mx-auto aspect-square rounded-lg overflow-hidden bg-muted">
                <Image
                  src={editingPost.imageUrl}
                  alt=""
                  fill
                  className="object-cover"
                />
              </div>
            )}

            {/* Caption */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Legenda</Label>
                <span
                  className={cn(
                    'text-xs',
                    editCaption.length > 2200
                      ? 'text-red-500'
                      : editCaption.length > 2000
                        ? 'text-yellow-600'
                        : 'text-muted-foreground'
                  )}
                >
                  {editCaption.length}/2200
                </span>
              </div>
              <Textarea
                value={editCaption}
                onChange={(e) =>
                  setEditCaption(e.target.value.slice(0, 2200))
                }
                rows={4}
                className="resize-none"
                disabled={editSaving}
              />
            </div>

            {/* Scheduling */}
            <div className="space-y-3">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                Agendamento
              </Label>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Data</Label>
                  <Input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    min={format(new Date(), 'yyyy-MM-dd')}
                    disabled={editSaving}
                  />
                </div>
                <div className="flex-1 space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Horário</Label>
                  <Input
                    type="time"
                    value={editTime}
                    onChange={(e) => setEditTime(e.target.value)}
                    disabled={editSaving}
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditDialogOpen(false)}
              disabled={editSaving}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={editSaving}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {editSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
