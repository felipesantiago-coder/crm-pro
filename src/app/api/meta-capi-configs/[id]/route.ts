import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';

// ============================================================
// GET /api/meta-capi-configs/[id]
// Retorna uma config específica (sem token mascarado).
// ============================================================
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;

    const config = await db.metaCapConfig.findUnique({ where: { id } });
    if (!config) {
      return NextResponse.json({ error: 'Configuração não encontrada' }, { status: 404 });
    }

    return NextResponse.json(config);
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: error.status });
    }
    return NextResponse.json({ error: 'Erro ao buscar configuração' }, { status: 500 });
  }
}

// ============================================================
// PATCH /api/meta-capi-configs/[id]
// Atualiza uma config existente.
// ============================================================
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await request.json();
    const { name, accessToken, datasetId, enabled, isDefault, formIds, queueId, adAccountId } = body;

    const existing = await db.metaCapConfig.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Configuração não encontrada' }, { status: 404 });
    }

    // Valida fila (roteamento multi-anúncio opcional)
    if (queueId) {
      const queueExists = await db.leadQueue.findUnique({ where: { id: queueId }, select: { id: true } });
      if (!queueExists) {
        return NextResponse.json({ error: 'Fila não encontrada' }, { status: 400 });
      }
    }

    // Valida conta de anúncios (multi-conta, opcional)
    if (adAccountId) {
      const accountExists = await db.metaAdAccount.findUnique({ where: { id: adAccountId }, select: { id: true } });
      if (!accountExists) {
        return NextResponse.json({ error: 'Conta de anúncios não encontrada' }, { status: 400 });
      }
    }

    // If setting as default, unset other defaults
    if (isDefault && !existing.isDefault) {
      await db.metaCapConfig.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    const config = await db.metaCapConfig.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(accessToken !== undefined ? { accessToken: accessToken.trim() } : {}),
        ...(datasetId !== undefined ? { datasetId: datasetId.trim() } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
        ...(isDefault !== undefined ? { isDefault } : {}),
        ...(formIds !== undefined
          ? { formIds: formIds ? JSON.stringify(formIds) : null }
          : {}),
        ...(queueId !== undefined ? { queueId: queueId || null } : {}),
        ...(adAccountId !== undefined ? { adAccountId: adAccountId || null } : {}),
      },
    });

    return NextResponse.json(config);
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: error.status });
    }
    console.error('[CAPI Configs] Erro ao atualizar:', error);
    return NextResponse.json({ error: 'Erro ao atualizar configuração' }, { status: 500 });
  }
}

// ============================================================
// DELETE /api/meta-capi-configs/[id]
// Remove uma config (clientes ficam com metaCapConfigId = null).
// ============================================================
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;

    const existing = await db.metaCapConfig.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Configuração não encontrada' }, { status: 404 });
    }

    // Clients with this config will have metaCapConfigId set to NULL (onDelete: SetNull)
    await db.metaCapConfig.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: error.status });
    }
    console.error('[CAPI Configs] Erro ao deletar:', error);
    return NextResponse.json({ error: 'Erro ao deletar configuração' }, { status: 500 });
  }
}
