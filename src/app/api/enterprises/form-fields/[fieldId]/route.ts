import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';

const VALID_TYPES = ['text', 'textarea', 'select', 'number', 'checkbox'] as const;

/**
 * PUT /api/enterprises/form-fields/[fieldId]
 * Update a form field (auth required).
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ fieldId: string }> },
) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const { fieldId } = await params;
    const body = await request.json();
    const { label, fieldType, placeholder, options, required, sortOrder, isActive } = body;

    // Verify the field exists
    const existing = await db.landingFormField.findUnique({ where: { id: fieldId } });
    if (!existing) {
      return NextResponse.json({ error: 'Campo não encontrado.' }, { status: 404 });
    }

    // Validate type if provided
    if (fieldType && !VALID_TYPES.includes(fieldType)) {
      return NextResponse.json({ error: `Tipo inválido. Use: ${VALID_TYPES.join(', ')}` }, { status: 400 });
    }

    // Validate options for select
    if ((fieldType || existing.fieldType) === 'select' && options !== undefined) {
      try {
        const parsed = typeof options === 'string' ? JSON.parse(options) : options;
        if (!Array.isArray(parsed) || parsed.length === 0) {
          return NextResponse.json({ error: 'Select deve ter pelo menos uma opção.' }, { status: 400 });
        }
      } catch {
        return NextResponse.json({ error: 'Options deve ser um array JSON válido.' }, { status: 400 });
      }
    }

    const updated = await db.landingFormField.update({
      where: { id: fieldId },
      data: {
        ...(label !== undefined ? { label: label.trim() } : {}),
        ...(fieldType !== undefined ? { fieldType } : {}),
        ...(placeholder !== undefined ? { placeholder: placeholder || null } : {}),
        ...(options !== undefined ? { options: typeof options === 'string' ? options : JSON.stringify(options) } : {}),
        ...(required !== undefined ? { required: !!required } : {}),
        ...(sortOrder !== undefined ? { sortOrder } : {}),
        ...(isActive !== undefined ? { isActive: !!isActive } : {}),
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('[Form Field PUT] Erro:', error);
    return NextResponse.json({ error: 'Erro ao atualizar campo.' }, { status: 500 });
  }
}

/**
 * DELETE /api/enterprises/form-fields/[fieldId]
 * Delete a form field (auth required).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ fieldId: string }> },
) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const { fieldId } = await params;

    await db.landingFormField.delete({ where: { id: fieldId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Form Field DELETE] Erro:', error);
    return NextResponse.json({ error: 'Erro ao remover campo.' }, { status: 500 });
  }
}