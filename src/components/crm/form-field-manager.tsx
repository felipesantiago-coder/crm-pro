'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  X, Plus, Trash2, Loader2, GripVertical, Type, AlignLeft,
  List, Hash, ToggleLeft, Pencil, Save, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

/* ================================================================
   Types
   ================================================================ */
interface FormField {
  id: string;
  label: string;
  fieldType: string;
  placeholder: string | null;
  options: string | null;
  required: boolean;
  sortOrder: number;
  isActive: boolean;
}

const FIELD_TYPES: Array<{ value: string; label: string; icon: React.ReactNode; desc: string }> = [
  { value: 'text', label: 'Texto curto', icon: <Type className="h-4 w-4" />, desc: 'Resposta em uma linha' },
  { value: 'textarea', label: 'Texto longo', icon: <AlignLeft className="h-4 w-4" />, desc: 'Resposta em várias linhas' },
  { value: 'select', label: 'Seleção', icon: <List className="h-4 w-4" />, desc: 'Escolher entre opções' },
  { value: 'number', label: 'Número', icon: <Hash className="h-4 w-4" />, desc: 'Valor numérico' },
  { value: 'checkbox', label: 'Sim/Não', icon: <ToggleLeft className="h-4 w-4" />, desc: 'Caixa de verificação' },
];

/* ================================================================
   Form Field Manager (Modal)
   ================================================================ */
interface Props {
  enterpriseId: string;
  enterpriseName: string;
  onClose: () => void;
}

export function FormFieldManager({ enterpriseId, enterpriseName, onClose }: Props) {
  const [fields, setFields] = useState<FormField[]>([]);
  const [loading, setLoading] = useState(true);

  // New field form
  const [showNewForm, setShowNewForm] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newType, setNewType] = useState('text');
  const [newPlaceholder, setNewPlaceholder] = useState('');
  const [newRequired, setNewRequired] = useState(false);
  const [newOptionsText, setNewOptionsText] = useState('');
  const [saving, setSaving] = useState(false);

  // Edit mode
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editPlaceholder, setEditPlaceholder] = useState('');
  const [editRequired, setEditRequired] = useState(false);
  const [editOptionsText, setEditOptionsText] = useState('');

  const fetchFields = useCallback(async () => {
    try {
      const res = await fetch(`/api/enterprises/${enterpriseId}/form-fields`);
      if (res.ok) setFields(await res.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [enterpriseId]);

  useEffect(() => { fetchFields(); }, [fetchFields]);

  /* ── Create ──────────────────────────────────────────── */
  async function createField() {
    if (!newLabel.trim() || newLabel.trim().length < 2) {
      toast.error('Informe o rótulo do campo (mínimo 2 caracteres)');
      return;
    }

    setSaving(true);
    try {
      let options: string | null = null;
      if (newType === 'select' && newOptionsText.trim()) {
        const arr = newOptionsText.split('\n').map((s) => s.trim()).filter(Boolean);
        if (arr.length === 0) {
          toast.error('Adicione pelo menos uma opção (uma por linha)');
          setSaving(false);
          return;
        }
        options = JSON.stringify(arr);
      }

      const res = await fetch(`/api/enterprises/${enterpriseId}/form-fields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: newLabel.trim(),
          fieldType: newType,
          placeholder: newPlaceholder || null,
          options,
          required: newRequired,
        }),
      });

      if (res.ok) {
        toast.success('Campo adicionado');
        setNewLabel('');
        setNewPlaceholder('');
        setNewRequired(false);
        setNewOptionsText('');
        setShowNewForm(false);
        fetchFields();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Erro ao criar campo');
      }
    } catch {
      toast.error('Erro de conexão');
    } finally {
      setSaving(false);
    }
  }

  /* ── Delete ──────────────────────────────────────────── */
  async function deleteField(id: string) {
    if (!confirm('Remover este campo do formulário?')) return;

    try {
      const res = await fetch(`/api/enterprises/form-fields/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Campo removido');
        fetchFields();
      } else {
        toast.error('Erro ao remover');
      }
    } catch {
      toast.error('Erro de conexão');
    }
  }

  /* ── Toggle active ───────────────────────────────────── */
  async function toggleActive(field: FormField) {
    try {
      const res = await fetch(`/api/enterprises/form-fields/${field.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !field.isActive }),
      });
      if (res.ok) fetchFields();
    } catch { /* silent */ }
  }

  /* ── Save edit ───────────────────────────────────────── */
  async function saveEdit(id: string) {
    if (!editLabel.trim() || editLabel.trim().length < 2) {
      toast.error('O rótulo é obrigatório');
      return;
    }

    let options: string | undefined = undefined;
    const field = fields.find((f) => f.id === id);
    if (field?.fieldType === 'select' && editOptionsText !== undefined) {
      const arr = editOptionsText.split('\n').map((s) => s.trim()).filter(Boolean);
      if (arr.length === 0) {
        toast.error('Adicione pelo menos uma opção');
        return;
      }
      options = JSON.stringify(arr);
    }

    try {
      const res = await fetch(`/api/enterprises/form-fields/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: editLabel.trim(),
          placeholder: editPlaceholder || null,
          required: editRequired,
          ...(options !== undefined ? { options } : {}),
        }),
      });
      if (res.ok) {
        toast.success('Campo atualizado');
        setEditingId(null);
        fetchFields();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Erro ao atualizar');
      }
    } catch {
      toast.error('Erro de conexão');
    }
  }

  function startEdit(field: FormField) {
    setEditingId(field.id);
    setEditLabel(field.label);
    setEditPlaceholder(field.placeholder || '');
    setEditRequired(field.required);
    setEditOptionsText(field.options ? parseOptions(field.options).join('\n') : '');
  }

  /* ── Move order ──────────────────────────────────────── */
  async function moveField(field: FormField, direction: 'up' | 'down') {
    const idx = fields.findIndex((f) => f.id === field.id);
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === fields.length - 1) return;

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    const swapField = fields[swapIdx];

    try {
      await Promise.all([
        fetch(`/api/enterprises/form-fields/${field.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sortOrder: swapField.sortOrder }),
        }),
        fetch(`/api/enterprises/form-fields/${swapField.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sortOrder: field.sortOrder }),
        }),
      ]);
      fetchFields();
    } catch { /* silent */ }
  }

  function getTypeInfo(type: string) {
    return FIELD_TYPES.find((t) => t.value === type) || FIELD_TYPES[0];
  }

  function parseOptions(options: string | null): string[] {
    if (!options) return [];
    try { return JSON.parse(options); } catch { return []; }
  }

  /* ================================================================
     Render
     ================================================================ */
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative bg-background rounded-2xl shadow-2xl border w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="text-base font-semibold">Campos do Formulário</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{enterpriseName}</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-muted flex items-center justify-center">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Loading */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Fields list */}
              {fields.length === 0 && !showNewForm && (
                <div className="text-center py-10">
                  <Type className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">Nenhum campo personalizado.</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    Os campos padrão (nome, telefone, e-mail) já estão incluídos.
                  </p>
                </div>
              )}

              {fields.map((field) => {
                const typeInfo = getTypeInfo(field.fieldType);
                const isEditing = editingId === field.id;
                const opts = parseOptions(field.options);

                return (
                  <div
                    key={field.id}
                    className={`rounded-xl border p-4 transition-colors ${
                      field.isActive ? 'border-border' : 'border-border/50 opacity-50'
                    }`}
                  >
                    {isEditing ? (
                      /* Edit mode */
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="col-span-2">
                            <Label className="text-xs">Rótulo</Label>
                            <Input
                              value={editLabel}
                              onChange={(e) => setEditLabel(e.target.value)}
                              className="h-8 text-sm mt-1"
                              autoFocus
                            />
                          </div>
                          <div className="col-span-2">
                            <Label className="text-xs">Placeholder</Label>
                            <Input
                              value={editPlaceholder}
                              onChange={(e) => setEditPlaceholder(e.target.value)}
                              className="h-8 text-sm mt-1"
                              placeholder="Texto de ajuda..."
                            />
                          </div>
                          {field.fieldType === 'select' && (
                            <div className="col-span-2">
                              <Label className="text-xs">Opções (uma por linha)</Label>
                              <textarea
                                value={editOptionsText}
                                onChange={(e) => setEditOptionsText(e.target.value)}
                                className="w-full mt-1 min-h-[80px] rounded-md border bg-transparent px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                                placeholder="Opção 1&#10;Opção 2&#10;Opção 3"
                              />
                            </div>
                          )}
                          <div className="col-span-2 flex items-center gap-2">
                            <Switch
                              checked={editRequired}
                              onCheckedChange={setEditRequired}
                              id={`edit-req-${field.id}`}
                            />
                            <Label htmlFor={`edit-req-${field.id}`} className="text-xs cursor-pointer">
                              Obrigatório
                            </Label>
                          </div>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <Button size="sm" className="h-7 text-xs" onClick={() => saveEdit(field.id)}>
                            <Save className="h-3 w-3 mr-1" /> Salvar
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingId(null)}>
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      /* View mode */
                      <div className="flex items-start gap-3">
                        {/* Drag / Move */}
                        <div className="flex flex-col items-center gap-0.5 pt-1 flex-shrink-0">
                          <button
                            onClick={() => moveField(field, 'up')}
                            disabled={fields.indexOf(field) === 0}
                            className="text-muted-foreground/40 hover:text-foreground disabled:opacity-30 disabled:cursor-default"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <GripVertical className="h-3.5 w-3.5 text-muted-foreground/30" />
                          <button
                            onClick={() => moveField(field, 'down')}
                            disabled={fields.indexOf(field) === fields.length - 1}
                            className="text-muted-foreground/40 hover:text-foreground disabled:opacity-30 disabled:cursor-default"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium truncate">{field.label}</span>
                            {field.required && (
                              <span className="text-[10px] text-red-500 font-medium flex-shrink-0">*</span>
                            )}
                            <Badge variant="secondary" className="text-[10px] gap-1 flex-shrink-0 ml-auto">
                              {typeInfo.icon}
                              {typeInfo.label}
                            </Badge>
                          </div>
                          {field.placeholder && (
                            <p className="text-[11px] text-muted-foreground truncate">{field.placeholder}</p>
                          )}
                          {opts.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {opts.map((o, i) => (
                                <span key={i} className="text-[10px] bg-muted px-2 py-0.5 rounded-full">
                                  {o}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Switch
                            checked={field.isActive}
                            onCheckedChange={() => toggleActive(field)}
                            className="scale-75"
                          />
                          <button
                            onClick={() => startEdit(field)}
                            className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
                            title="Editar"
                          >
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                          <button
                            onClick={() => deleteField(field.id)}
                            className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-red-100 dark:hover:bg-red-900/20 transition-colors"
                            title="Remover"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-500" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Add new field */}
              {!showNewForm ? (
                <Button
                  variant="outline"
                  className="w-full border-dashed h-10 text-sm gap-2"
                  onClick={() => setShowNewForm(true)}
                >
                  <Plus className="h-4 w-4" />
                  Adicionar Campo Personalizado
                </Button>
              ) : (
                <div className="rounded-xl border border-[#C9A96E]/30 bg-[#C9A96E]/5 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Novo Campo</p>
                    <button onClick={() => setShowNewForm(false)} className="text-muted-foreground hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="space-y-3">
                    {/* Type selector */}
                    <div>
                      <Label className="text-xs">Tipo do Campo</Label>
                      <div className="grid grid-cols-5 gap-1.5 mt-1.5">
                        {FIELD_TYPES.map((t) => (
                          <button
                            key={t.value}
                            onClick={() => setNewType(t.value)}
                            className={`flex flex-col items-center gap-1 p-2.5 rounded-lg border text-center transition-all ${
                              newType === t.value
                                ? 'border-[#C9A96E] bg-[#C9A96E]/10 text-[#C9A96E]'
                                : 'border-border hover:border-border/80'
                            }`}
                          >
                            {t.icon}
                            <span className="text-[10px] font-medium">{t.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Label */}
                    <div>
                      <Label className="text-xs">Rótulo da Pergunta</Label>
                      <Input
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        placeholder="Ex: Qual seu orçamento?"
                        className="h-8 text-sm mt-1"
                        autoFocus
                      />
                    </div>

                    {/* Placeholder (not for checkbox) */}
                    {newType !== 'checkbox' && (
                      <div>
                        <Label className="text-xs">Placeholder (texto de ajuda)</Label>
                        <Input
                          value={newPlaceholder}
                          onChange={(e) => setNewPlaceholder(e.target.value)}
                          placeholder="Ex: Até R$ 500.000"
                          className="h-8 text-sm mt-1"
                        />
                      </div>
                    )}

                    {/* Options for select */}
                    {newType === 'select' && (
                      <div>
                        <Label className="text-xs">Opções (uma por linha)</Label>
                        <textarea
                          value={newOptionsText}
                          onChange={(e) => setNewOptionsText(e.target.value)}
                          className="w-full mt-1 min-h-[80px] rounded-md border bg-transparent px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                          placeholder="Até R$ 300.000&#10;R$ 300.000 - R$ 500.000&#10;R$ 500.000 - R$ 800.000&#10;Acima de R$ 800.000"
                        />
                      </div>
                    )}

                    {/* Required */}
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={newRequired}
                        onCheckedChange={setNewRequired}
                        id="new-required"
                      />
                      <Label htmlFor="new-required" className="text-xs cursor-pointer">
                        Campo obrigatório
                      </Label>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        className="h-8 text-xs flex-1"
                        onClick={createField}
                        disabled={saving}
                      >
                        {saving ? (
                          <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Criando...</>
                        ) : (
                          <><Plus className="h-3 w-3 mr-1" /> Adicionar Campo</>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() => setShowNewForm(false)}
                        disabled={saving}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}