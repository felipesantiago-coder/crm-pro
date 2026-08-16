import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';

// ============================================================
// GET /api/meta-capi-configs
// Lista todas as configurações CAPI (sem expor tokens completos).
// ============================================================
export async function GET() {
  try {
    await requireAdmin();

    const configs = await db.metaCapConfig.findMany({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        datasetId: true,
        enabled: true,
        isDefault: true,
        formIds: true,
        createdAt: true,
        updatedAt: true,
        // Only show first/last 8 chars of token
        accessToken: true,
        _count: { select: { clients: true } },
      },
    });

    // Mask tokens for response
    const masked = configs.map((c) => ({
      ...c,
      accessTokenMasked: c.accessToken
        ? `${c.accessToken.slice(0, 8)}...${c.accessToken.slice(-8)}`
        : null,
      accessToken: undefined, // Don't send full token
    }));

    return NextResponse.json(masked);
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: error.status });
    }
    console.error('[CAPI Configs] Erro ao listar:', error);
    return NextResponse.json({ error: 'Erro ao listar configurações' }, { status: 500 });
  }
}

// ============================================================
// POST /api/meta-capi-configs
// Cria uma nova configuração CAPI.
// ============================================================
export async function POST(request: NextRequest) {
  try {
    await requireAdmin();

    const body = await request.json();
    const { name, accessToken, datasetId, isDefault, formIds } = body;

    if (!name || !accessToken || !datasetId) {
      return NextResponse.json(
        { error: 'Nome, access token e dataset ID são obrigatórios' },
        { status: 400 }
      );
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      await db.metaCapConfig.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const config = await db.metaCapConfig.create({
      data: {
        name: name.trim(),
        accessToken: accessToken.trim(),
        datasetId: datasetId.trim(),
        isDefault: !!isDefault,
        formIds: formIds ? JSON.stringify(formIds) : null,
      },
    });

    return NextResponse.json(config, { status: 201 });
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: error.status });
    }
    console.error('[CAPI Configs] Erro ao criar:', error);
    return NextResponse.json({ error: 'Erro ao criar configuração' }, { status: 500 });
  }
}
