import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';

// ============================================================
// GET /api/meta-capi-configs/form-mappings
// Lista todos os mapeamentos de Form IDs com info de campanha.
// Agrupa por formId (mostrando a campanha mais recente).
// ============================================================
export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const grouped = searchParams.get('grouped') === 'true';

    if (grouped) {
      // Modo agrupado: um registro por formId (agrega leads e mostra campanhas)
      const mappings = await db.leadFormMapping.findMany({
        orderBy: { lastSeenAt: 'desc' },
        include: {
          capiConfig: {
            select: { id: true, name: true, enabled: true },
          },
        },
      });

      // Agrupar por formId
      const groupedMap = new Map<string, {
        formId: string;
        formName: string | null;
        totalLeads: number;
        firstSeenAt: Date;
        lastSeenAt: Date;
        capiConfigId: string | null;
        capiConfig: { id: string; name: string; enabled: boolean } | null;
        campaigns: Array<{ campaignId: string | null; campaignName: string | null; adName: string | null; leadCount: number }>;
      }>();

      for (const m of mappings) {
        const existing = groupedMap.get(m.formId);
        if (existing) {
          existing.totalLeads += m.leadCount;
          if (m.firstSeenAt < existing.firstSeenAt) existing.firstSeenAt = m.firstSeenAt;
          if (m.lastSeenAt > existing.lastSeenAt) existing.lastSeenAt = m.lastSeenAt;
          if (!existing.capiConfigId && m.capiConfigId) {
            existing.capiConfigId = m.capiConfigId;
            existing.capiConfig = m.capiConfig;
          }
          existing.campaigns.push({
            campaignId: m.campaignId,
            campaignName: m.campaignName,
            adName: m.adName,
            leadCount: m.leadCount,
          });
        } else {
          groupedMap.set(m.formId, {
            formId: m.formId,
            formName: m.formName,
            totalLeads: m.leadCount,
            firstSeenAt: m.firstSeenAt,
            lastSeenAt: m.lastSeenAt,
            capiConfigId: m.capiConfigId,
            capiConfig: m.capiConfig,
            campaigns: [{
              campaignId: m.campaignId,
              campaignName: m.campaignName,
              adName: m.adName,
              leadCount: m.leadCount,
            }],
          });
        }
      }

      return NextResponse.json(Array.from(groupedMap.values()));
    }

    // Modo detalhado (padrão)
    const mappings = await db.leadFormMapping.findMany({
      orderBy: { lastSeenAt: 'desc' },
      include: {
        capiConfig: {
          select: { id: true, name: true, enabled: true },
        },
      },
    });

    return NextResponse.json(mappings);
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: error.status });
    }
    console.error('[Form Mappings] Erro ao listar:', error);
    return NextResponse.json({ error: 'Erro ao listar mapeamentos' }, { status: 500 });
  }
}

// ============================================================
// PATCH /api/meta-capi-configs/form-mappings
// Vincula um form mapping a um CAPI config.
// Body: { formId: string, campaignId?: string, capiConfigId: string | null }
// ============================================================
export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin();

    const body = await request.json();
    const { formId, campaignId, capiConfigId } = body;

    if (!formId) {
      return NextResponse.json({ error: 'formId é obrigatório' }, { status: 400 });
    }

    // Se campaignId foi fornecido, atualizar apenas aquele mapping específico
    if (campaignId) {
      const result = await db.leadFormMapping.updateMany({
        where: { formId, campaignId },
        data: { capiConfigId: capiConfigId || null },
      });
      return NextResponse.json({ updated: result.count });
    }

    // Sem campaignId: atualizar TODOS os mappings com este formId
    const result = await db.leadFormMapping.updateMany({
      where: { formId },
      data: { capiConfigId: capiConfigId || null },
    });

    // Sincronizar com o formIds JSON do MetaCapConfig
    if (capiConfigId) {
      // Buscar todos os formIds já mapeados para este config
      const allMappings = await db.leadFormMapping.findMany({
        where: { capiConfigId },
        select: { formId: true },
        distinct: ['formId'],
      });
      const formIdsArray = allMappings.map(m => m.formId);

      await db.metaCapConfig.update({
        where: { id: capiConfigId },
        data: { formIds: JSON.stringify(formIdsArray) },
      });
    }

    return NextResponse.json({ updated: result.count });
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: error.status });
    }
    console.error('[Form Mappings] Erro ao atualizar:', error);
    return NextResponse.json({ error: 'Erro ao atualizar mapeamento' }, { status: 500 });
  }
}

// ============================================================
// POST /api/meta-capi-configs/form-mappings/import
// Importa Form IDs de uma conta de anúncios via Graph API.
// Body: { accessToken: string, adAccountId: string, capiConfigId?: string }
// ============================================================
export async function POST(request: NextRequest) {
  try {
    await requireAdmin();

    const body = await request.json();
    const { accessToken, adAccountId, capiConfigId } = body;

    if (!accessToken || !adAccountId) {
      return NextResponse.json(
        { error: 'Access Token e ID da conta de anúncios são obrigatórios' },
        { status: 400 }
      );
    }

    // Normalizar adAccountId (aceita com ou sem 'act_' prefixo)
    const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

    // Buscar formulários de lead via Graph API
    const url = `https://graph.facebook.com/v25.0/${accountId}/leadgen_forms?fields=id,name,status,created_time&limit=100`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = `Erro da API Meta: HTTP ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMsg = errorJson.error?.message || errorMsg;
      } catch {}
      return NextResponse.json({ error: errorMsg }, { status: 400 });
    }

    const data = await response.json();
    const forms: Array<{ id: string; name?: string; status?: string; created_time?: string }> = data.data || [];

    if (forms.length === 0) {
      return NextResponse.json({
        imported: 0,
        forms: [],
        message: 'Nenhum formulário de lead encontrado nesta conta de anúncios',
      });
    }

    // Upsert cada formulário na tabela lead_form_mappings
    let imported = 0;
    for (const form of forms) {
      if (form.status && form.status !== 'ACTIVE') continue;

      try {
        await db.leadFormMapping.upsert({
          where: {
            formId_campaignId: {
              formId: form.id,
              campaignId: `__imported_${accountId}`,
            },
          },
          create: {
            formId: form.id,
            formName: form.name || `Formulário ${form.id}`,
            campaignId: `__imported_${accountId}`,
            campaignName: `Importado de ${accountId}`,
            capiConfigId: capiConfigId || null,
          },
          update: {
            formName: form.name || undefined,
            capiConfigId: capiConfigId || undefined,
          },
        });
        imported++;
      } catch (err: any) {
        // Unique constraint might fail for duplicate formId with different campaignId
        console.warn(`[Form Import] Falha ao importar form ${form.id}:`, err?.message);
      }
    }

    // Se capiConfigId foi fornecido, sincronizar formIds no config
    if (capiConfigId) {
      const allMappings = await db.leadFormMapping.findMany({
        where: { capiConfigId },
        select: { formId: true },
        distinct: ['formId'],
      });
      await db.metaCapConfig.update({
        where: { id: capiConfigId },
        data: { formIds: JSON.stringify(allMappings.map(m => m.formId)) },
      });
    }

    // Verificar se há mais páginas (paginação)
    let hasNextPage = false;
    if (data.paging?.next) {
      hasNextPage = true;
    }

    return NextResponse.json({
      imported,
      total: forms.length,
      forms: forms.map(f => ({
        id: f.id,
        name: f.name,
        status: f.status,
      })),
      hasNextPage,
      message: `${imported} formulário${imported !== 1 ? 's' : ''} importado${imported !== 1 ? 's' : ''} com sucesso${hasNextPage ? ' (mais formulários disponíveis — increase limit)' : ''}`,
    });
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: error.status });
    }
    console.error('[Form Import] Erro:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao importar formulários' },
      { status: 500 }
    );
  }
}
