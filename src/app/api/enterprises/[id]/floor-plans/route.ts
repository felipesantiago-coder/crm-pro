import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { db } from '@/lib/db';

const MAX_PLANS = 10;

/**
 * GET — list floor plans
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const { id } = await params;
    const plans = await db.enterpriseFloorPlan.findMany({
      where: { enterpriseId: id },
      orderBy: { sortOrder: 'asc' },
    });
    return NextResponse.json(plans);
  } catch (error) {
    console.error('[FloorPlans GET] Erro:', error);
    return NextResponse.json({ error: 'Erro ao buscar plantas.' }, { status: 500 });
  }
}

/**
 * POST — create a new floor plan (metadata-based)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const { id } = await params;

    const count = await db.enterpriseFloorPlan.count({ where: { enterpriseId: id } });
    if (count >= MAX_PLANS) {
      return NextResponse.json(
        { error: `Máximo de ${MAX_PLANS} plantas por empreendimento.` },
        { status: 400 },
      );
    }

    const enterprise = await db.enterprise.findUnique({ where: { id }, select: { id: true } });
    if (!enterprise) {
      return NextResponse.json({ error: 'Empreendimento não encontrado.' }, { status: 404 });
    }

    const body = await request.json();
    const { name, area, bedrooms, suites, hasBalcony, isGarden, isPenthouse, description } = body;

    if (!name?.trim() && !area?.trim()) {
      return NextResponse.json(
        { error: 'Preencha ao menos o nome ou a metragem.' },
        { status: 400 },
      );
    }

    const maxOrder = await db.enterpriseFloorPlan.aggregate({
      where: { enterpriseId: id },
      _max: { sortOrder: true },
    });
    const nextOrder = (maxOrder._max.sortOrder ?? -1) + 1;

    const plan = await db.enterpriseFloorPlan.create({
      data: {
        enterpriseId: id,
        name: typeof name === 'string' ? name.trim() || null : null,
        area: typeof area === 'string' ? area.trim() || null : null,
        bedrooms: typeof bedrooms === 'number' ? bedrooms : null,
        suites: typeof suites === 'number' ? suites : 0,
        hasBalcony: typeof hasBalcony === 'boolean' ? hasBalcony : false,
        isGarden: typeof isGarden === 'boolean' ? isGarden : false,
        isPenthouse: typeof isPenthouse === 'boolean' ? isPenthouse : false,
        description: typeof description === 'string' ? description.trim() || null : null,
        sortOrder: nextOrder,
      },
    });

    return NextResponse.json(plan, { status: 201 });
  } catch (error) {
    console.error('[FloorPlans POST] Erro:', error);
    return NextResponse.json({ error: 'Erro ao criar planta.' }, { status: 500 });
  }
}

/**
 * PUT — reorder floor plans
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const { id } = await params;
    const body = await request.json();

    if (body.orders && Array.isArray(body.orders)) {
      await Promise.all(
        body.orders.map((item: { id: string; sortOrder: number }) =>
          db.enterpriseFloorPlan.update({
            where: { id: item.id, enterpriseId: id },
            data: { sortOrder: item.sortOrder },
          }),
        ),
      );
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Operação inválida.' }, { status: 400 });
  } catch (error) {
    console.error('[FloorPlans PUT] Erro:', error);
    return NextResponse.json({ error: 'Erro ao atualizar plantas.' }, { status: 500 });
  }
}

/**
 * PATCH — update a single floor plan
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const { id } = await params;
    const body = await request.json();
    const { planId } = body;

    if (!planId) {
      return NextResponse.json({ error: 'planId é obrigatório.' }, { status: 400 });
    }

    const plan = await db.enterpriseFloorPlan.findUnique({
      where: { id: planId, enterpriseId: id },
    });
    if (!plan) {
      return NextResponse.json({ error: 'Planta não encontrada.' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = typeof body.name === 'string' ? body.name.trim() || null : null;
    if (body.area !== undefined) updateData.area = typeof body.area === 'string' ? body.area.trim() || null : null;
    if (body.bedrooms !== undefined) updateData.bedrooms = typeof body.bedrooms === 'number' ? body.bedrooms : null;
    if (body.suites !== undefined) updateData.suites = typeof body.suites === 'number' ? body.suites : 0;
    if (body.hasBalcony !== undefined) updateData.hasBalcony = typeof body.hasBalcony === 'boolean' ? body.hasBalcony : false;
    if (body.isGarden !== undefined) updateData.isGarden = typeof body.isGarden === 'boolean' ? body.isGarden : false;
    if (body.isPenthouse !== undefined) updateData.isPenthouse = typeof body.isPenthouse === 'boolean' ? body.isPenthouse : false;
    if (body.description !== undefined) updateData.description = typeof body.description === 'string' ? body.description.trim() || null : null;
    if (body.altText !== undefined) updateData.altText = typeof body.altText === 'string' ? body.altText.trim() || null : null;

    const updated = await db.enterpriseFloorPlan.update({
      where: { id: planId },
      data: updateData,
    });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('[FloorPlans PATCH] Erro:', error);
    return NextResponse.json({ error: 'Erro ao atualizar planta.' }, { status: 500 });
  }
}

/**
 * DELETE — remove a floor plan
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const { id } = await params;
    const planId = request.nextUrl.searchParams.get('planId');

    if (!planId) {
      return NextResponse.json({ error: 'planId é obrigatório.' }, { status: 400 });
    }

    const plan = await db.enterpriseFloorPlan.findUnique({
      where: { id: planId, enterpriseId: id },
    });

    if (!plan) {
      return NextResponse.json({ error: 'Planta não encontrada.' }, { status: 404 });
    }

    await db.enterpriseFloorPlan.delete({ where: { id: planId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[FloorPlans DELETE] Erro:', error);
    return NextResponse.json({ error: 'Erro ao excluir planta.' }, { status: 500 });
  }
}
