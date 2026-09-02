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
          queue: {
            select: { id: true, name: true, isActive: true },
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
        queueId: string | null;
        queue: { id: string; name: string; isActive: boolean } | null;
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
          if (!existing.queueId && m.queueId) {
            existing.queueId = m.queueId;
            existing.queue = m.queue;
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
            queueId: m.queueId,
            queue: m.queue,
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
        queue: {
          select: { id: true, name: true, isActive: true },
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
// Vincula um form mapping a um CAPI config e/ou a uma fila de
// atendimento (roteamento multi-anúncio).
// Body: { formId: string, campaignId?: string, capiConfigId?: string | null, queueId?: string | null }
// ============================================================
export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin();

    const body = await request.json();
    const { formId, campaignId, capiConfigId, queueId } = body;

    if (!formId) {
      return NextResponse.json({ error: 'formId é obrigatório' }, { status: 400 });
    }

    // Normaliza: string vazia → null (remove vínculo)
    const nextCapiConfigId = capiConfigId === undefined ? undefined : (capiConfigId || null);
    const nextQueueId = queueId === undefined ? undefined : (queueId || null);

    // Valida que a fila existe (evita FK inválida)
    if (nextQueueId) {
      const queueExists = await db.leadQueue.findUnique({ where: { id: nextQueueId }, select: { id: true } });
      if (!queueExists) {
        return NextResponse.json({ error: 'Fila não encontrada' }, { status: 400 });
      }
    }

    const updateData: { capiConfigId?: string | null; queueId?: string | null } = {};
    if (nextCapiConfigId !== undefined) updateData.capiConfigId = nextCapiConfigId;
    if (nextQueueId !== undefined) updateData.queueId = nextQueueId;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'Nada para atualizar (informe capiConfigId e/ou queueId)' }, { status: 400 });
    }

    // Se campaignId foi fornecido, atualizar apenas aquele mapping específico
    if (campaignId) {
      const result = await db.leadFormMapping.updateMany({
        where: { formId, campaignId },
        data: updateData,
      });
      return NextResponse.json({ updated: result.count });
    }

    // Sem campaignId: atualizar TODOS os mappings com este formId
    const result = await db.leadFormMapping.updateMany({
      where: { formId },
      data: updateData,
    });

    // Sincronizar com o formIds JSON do MetaCapConfig
    if (nextCapiConfigId) {
      // Buscar todos os formIds já mapeados para este config
      const allMappings = await db.leadFormMapping.findMany({
        where: { capiConfigId: nextCapiConfigId },
        select: { formId: true },
        distinct: ['formId'],
      });
      const formIdsArray = allMappings.map(m => m.formId);

      await db.metaCapConfig.update({
        where: { id: nextCapiConfigId },
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

    // Tentar buscar formulários de lead via Graph API
    // Abordagem 1: direto pela edge leadgen_forms (requer ads_read no token)
    // Abordagem 2: via campaigns com leadgen_forms aninhado (fallback)
    let forms: Array<{ id: string; name?: string; status?: string; created_time?: string }> = [];
    let lastErrorMsg = '';
    let lastErrorCode: string | undefined;
    let lastErrorSubcode: string | undefined;

    // --- Tentativa 1: edge direta leadgen_forms ---
    const directUrl = `https://graph.facebook.com/v22.0/${accountId}/leadgen_forms?fields=id,name,status,created_time&limit=100`;
    let response = await fetch(directUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (response.ok) {
      const data = await response.json();
      forms = data.data || [];
    } else {
      // Salvar erro da tentativa 1
      const errText = await response.text();
      let parsed: any = {};
      try { parsed = JSON.parse(errText); } catch {}
      lastErrorMsg = parsed?.error?.message || `HTTP ${response.status}`;
      lastErrorCode = parsed?.error?.code;
      lastErrorSubcode = parsed?.error?.error_subcode;
      console.warn(`[Form Import] Tentativa 1 (direct) falhou: code=${lastErrorCode} msg=${lastErrorMsg}`);

      // --- Tentativa 2: via campaigns com leadgen_forms aninhado ---
      if (String(lastErrorCode) === '100') {
        console.log(`[Form Import] Tentando abordagem alternativa via campaigns...`);
        const campaignsUrl = `https://graph.facebook.com/v22.0/${accountId}/campaigns?fields=leadgen_forms{id,name,status,created_time}&limit=100&effective_status=["ACTIVE","PAUSED"]`;
        const campResponse = await fetch(campaignsUrl, {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (campResponse.ok) {
          const campData = await campResponse.json();
          const seen = new Set<string>();
          for (const camp of (campData.data || [])) {
            for (const f of (camp.leadgen_forms?.data || [])) {
              if (!seen.has(f.id)) {
                seen.add(f.id);
                forms.push(f);
              }
            }
          }
          console.log(`[Form Import] Tentativa 2 (campaigns) encontrou ${forms.length} formulários`);
        } else {
          const err2Text = await campResponse.text();
          let parsed2: any = {};
          try { parsed2 = JSON.parse(err2Text); } catch {}
          lastErrorMsg = parsed2?.error?.message || `HTTP ${campResponse.status}`;
          lastErrorCode = parsed2?.error?.code;
          lastErrorSubcode = parsed2?.error?.error_subcode;
          console.error(`[Form Import] Tentativa 2 (campaigns) também falhou: code=${lastErrorCode} msg=${lastErrorMsg}`);
        }
      }
    }

    // Se nenhuma abordagem funcionou, retornar erro com orientação
    if (forms.length === 0 && lastErrorMsg) {
      let permissionHint = '';
      const code = String(lastErrorCode);
      if (code === '100' || code === '200') {
        permissionHint = '\n\nPara resolver:\n1. Vá em Meta Business Manager > System Users (business.facebook.com/settings/system-users)\n2. Crie ou edite um System User com permissão "ads_read"\n3. Atribua esse usuário à conta de anúncios\n4. Gere um novo token e use-o aqui.';
      }
      console.error(`[Form Import] Falha final: code=${lastErrorCode} subcode=${lastErrorSubcode} msg=${lastErrorMsg} accountId=${accountId}`);
      return NextResponse.json(
        { error: lastErrorMsg + permissionHint, metaErrorCode: lastErrorCode, metaErrorSubcode: lastErrorSubcode },
        { status: 400 }
      );
    }

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

    return NextResponse.json({
      imported,
      total: forms.length,
      forms: forms.map(f => ({
        id: f.id,
        name: f.name,
        status: f.status,
      })),
      message: `${imported} formulário${imported !== 1 ? 's' : ''} importado${imported !== 1 ? 's' : ''} com sucesso`,
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
