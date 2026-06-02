'use client';

import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod/v4';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Loader2, Building2, X } from 'lucide-react';

interface TagOption {
  id: string;
  name: string;
  color: string;
}

interface ClientFormData {
  name: string;
  phone?: string;
  email?: string;
  region?: string;
  enterprise?: string;
  notes?: string;
  tagIds?: string[];
  updatePeriod?: number;
}

const clientSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  phone: z.string().optional(),
  email: z.string().email('Email inválido').optional().or(z.literal('')),
  region: z.string().optional(),
  enterprise: z.string().optional(),
  notes: z.string().optional(),
  updatePeriod: z.number().optional(),
});

type ClientFormValues = z.infer<typeof clientSchema>;

interface ClientFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client?: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    region: string | null;
    enterprise: string | null;
    notes: string | null;
    updatePeriod: number;
    tags: Array<{ tagId: string; tag: { id: string; name: string; color: string } }>;
  } | null;
  onSuccess: () => void;
}

export function ClientForm({ open, onOpenChange, client, onSuccess }: ClientFormProps) {
  const [tags, setTags] = useState<TagOption[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<number>(30);
  const [enterprises, setEnterprises] = useState<Array<{ id: string; name: string; region: string | null; imageUrl: string | null }>>([]);
  const [selectedEnterpriseId, setSelectedEnterpriseId] = useState<string | null>(null);
  const [customEnterprise, setCustomEnterprise] = useState('');
  const isEditing = !!client;

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      name: client?.name || '',
      phone: client?.phone || '',
      email: client?.email || '',
      region: client?.region || '',
      enterprise: client?.enterprise || '',
      notes: client?.notes || '',
      updatePeriod: client?.updatePeriod || 30,
    },
  });

  useEffect(() => {
    if (open) {
      fetchTags();
      fetchEnterprises();
      if (client) {
        reset({
          name: client.name,
          phone: client.phone || '',
          email: client.email || '',
          region: client.region || '',
          enterprise: client.enterprise || '',
          notes: client.notes || '',
          updatePeriod: client.updatePeriod || 30,
        });
        setSelectedTags(client.tags.map((ct) => ct.tag.id));
        setSelectedPeriod(client.updatePeriod || 30);
        // Check for linked enterprise
        const linkedEnt = (client as Record<string, unknown>).linkedEnterprise as { id: string; name: string } | undefined;
        if (linkedEnt) {
          setSelectedEnterpriseId(linkedEnt.id);
        } else {
          setSelectedEnterpriseId(null);
        }
      } else {
        reset({
          name: '',
          phone: '',
          email: '',
          region: '',
          enterprise: '',
          notes: '',
          updatePeriod: 30,
        });
        setSelectedTags([]);
        setSelectedPeriod(30);
        setSelectedEnterpriseId(null);
        setCustomEnterprise('');
      }
    }
  }, [open, client, reset]);

  async function fetchTags() {
    try {
      const res = await fetch('/api/tags');
      const data = await res.json();
      setTags(data);
    } catch {
      console.error('Error fetching tags');
    }
  }

  async function fetchEnterprises() {
    try {
      const res = await fetch('/api/enterprises/list-public');
      if (res.ok) {
        const data = await res.json();
        setEnterprises(data);
      }
    } catch {
      console.error('Error fetching enterprises');
    }
  }

  function toggleTag(tagId: string) {
    setSelectedTags((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    );
  }

  async function onSubmit(data: ClientFormValues) {
    setLoading(true);
    try {
      const url = isEditing ? `/api/clients/${client!.id}` : '/api/clients';
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          updatePeriod: selectedPeriod,
          tagIds: selectedTags,
          enterpriseId: selectedEnterpriseId,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Erro ao salvar cliente');
      }

      toast.success(
        isEditing ? 'Cliente atualizado com sucesso!' : 'Cliente criado com sucesso!'
      );
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar cliente');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Editar Cliente' : 'Novo Cliente'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">
              Nome <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              placeholder="Nome completo"
              {...register('name')}
              aria-invalid={!!errors.name}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Telefone</Label>
              <Input id="phone" placeholder="(00) 00000-0000" {...register('phone')} />
              {errors.phone && (
                <p className="text-xs text-destructive">{errors.phone.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="email@exemplo.com"
                {...register('email')}
              />
              {errors.email && (
                <p className="text-xs text-destructive">{errors.email.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="region">Região</Label>
              <Input id="region" placeholder="Região" {...register('region')} />
            </div>
            <div className="space-y-2">
              <Label>Empreendimento</Label>
              {enterprises.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs text-muted-foreground mb-2">Selecione um empreendimento cadastrado:</p>
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                    {enterprises.map((ent) => (
                      <button
                        key={ent.id}
                        type="button"
                        onClick={() => {
                          setSelectedEnterpriseId(ent.id);
                          setCustomEnterprise('');
                          setValue('enterprise', ent.name);
                        }}
                        className={`flex items-center gap-2 p-2 rounded-lg border text-left transition-all duration-200 ${
                          selectedEnterpriseId === ent.id
                            ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'border-border hover:bg-muted'
                        }`}
                      >
                        {ent.imageUrl ? (
                          <div className="h-8 w-8 rounded-md overflow-hidden flex-shrink-0">
                            <img src={ent.imageUrl} alt={ent.name} className="h-full w-full object-cover" />
                          </div>
                        ) : (
                          <div className="h-8 w-8 rounded-md bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                            <Building2 className="h-4 w-4 text-emerald-500" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{ent.name}</p>
                          {ent.region && (
                            <p className="text-[10px] text-muted-foreground truncate">{ent.region}</p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                  {selectedEnterpriseId && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedEnterpriseId(null);
                        setValue('enterprise', customEnterprise);
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mt-1"
                    >
                      <X className="h-3 w-3" />
                      Desmarcar empreendimento selecionado
                    </button>
                  )}
                </div>
              )}
              <div className="relative">
                <Input
                  placeholder="Ou digite um empreendimento personalizado..."
                  value={selectedEnterpriseId ? '' : (watch('enterprise') || '')}
                  onChange={(e) => {
                    setCustomEnterprise(e.target.value);
                    setSelectedEnterpriseId(null);
                    setValue('enterprise', e.target.value);
                  }}
                  disabled={loading || !!selectedEnterpriseId}
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Período de Atualização</Label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 15, label: '15 dias' },
                { value: 20, label: '20 dias' },
                { value: 30, label: '30 dias' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSelectedPeriod(option.value)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all duration-200 ${
                    selectedPeriod === option.value
                      ? 'bg-emerald-500/10 border-emerald-500 text-emerald-600 dark:text-emerald-400'
                      : 'border-border hover:bg-muted text-muted-foreground'
                  }`
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Define a frequência com que este cliente precisa ser atualizado. O sistema alertará quando o período expirar.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Observações</Label>
            <Textarea
              id="notes"
              placeholder="Anotações sobre o cliente..."
              rows={3}
              {...register('notes')}
            />
          </div>

          {tags.length > 0 && (
            <div className="space-y-2">
              <Label>Tags</Label>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <label
                    key={tag.id}
                    className="flex items-center gap-1.5 cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedTags.includes(tag.id)}
                      onCheckedChange={() => toggleTag(tag.id)}
                    />
                    <span
                      className="text-xs font-medium px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: tag.color + '20',
                        color: tag.color,
                      }}
                    >
                      {tag.name}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={loading} className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white">
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEditing ? 'Atualizar' : 'Salvar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
