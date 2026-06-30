import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';

const VALID_TYPES = ['text', 'textarea', 'select', 'number', 'checkbox'] as const;

/**
 * GET /api/enterprises/[id]/form-fields
 * List all form fields for an enterprise (auth required).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const { id } = await params;

    const fields = await db.landingFormField.findMany({
      where: { enterpriseId: id },
      orderBy: { sortOrder: 'asc' },
    });

    return NextResponse.json(fields);
  } catch (error) {
    console.error('[Form Fields GET] Erro:', error);
    return NextResponse.json({ error: 'Erro ao buscar campos.' }, { status: 500 });
  }
}

/**
 * POST /api/enterprises/[id]/form-fields
 * Create a new form field for an enterprise (auth required).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const { id } = await params;
    const body = await request.json();
    const { label, fieldType, placeholder, options, required, sortOrder } = body;

    if (!label || typeof label !== 'string' || label.trim().length < 2) {
      return NextResponse.json({ error: 'Label é obrigatório (mínimo 2 caracteres).' }, { status: 400 });
    }

    const type = fieldType || 'text';
    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: `Tipo inválido. Use: ${VALID_TYPES.join(', ')}` }, { status: 400 });
    }

    if (type === 'select' && options) {
      try {
        const parsed = typeof options === 'string' ? JSON.parse(options) : options;
        if (!Array.isArray(parsed) || parsed.length === 0) {
          return NextResponse.json({ error: 'Select deve ter pelo menos uma opção.' }, { status: 400 });
        }
      } catch {
        return NextResponse.json({ error: 'Options deve ser um array JSON válido.' }, { status: 400 });
      }
    }

    // Get current max sortOrder
    const maxOrder = await db.landingFormField.aggregate({
      where: { enterpriseId: id },
      _max: { sortOrder: true },
    });

    const field = await db.landingFormField.create({
      data: {
        enterpriseId: id,
        label: label.trim(),
        fieldType: type,
        placeholder: placeholder || null,
        options: options ? (typeof options === 'string' ? options : JSON.stringify(options)) : null,
        required: !!required,
        sortOrder: sortOrder ?? (maxOrder._max.sortOrder ?? -1) + 1,
      },
    });

    return NextResponse.json(field, { status: 201 });
  } catch (error) {
    console.error('[Form Fields POST] Erro:', error);
    return NextResponse.json({ error: 'Erro ao criar campo.' }, { status: 500 });
  }
}