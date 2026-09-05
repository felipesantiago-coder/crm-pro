import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';

// ============================================================
// POST /api/meta-ad-accounts/[id]/sync-forms
// Sincroniza os formulários de lead da conta via Graph API usando
// o access token PRÓPRIO da conta (multi-conta):
//   1. Busca act_<id>/leadgen_forms (fallback via campaigns)
//   2. Upsert em lead_form_mappings com adAccountId da conta
//   3. Atualiza o JSON formIds da conta (fonte do polling multi-token)
// ============================================================
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();

    const { id } = await params;
    const account = await db.metaAdAccount.findUnique({
      where: { id },
      select: { id: true, name: true, adAccountId: true, accessToken: true, enabled: true },
    });

    if (!account) {
      return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 });
    }
    if (!account.accessToken) {
      return NextResponse.json({ error: 'Conta sem access token — edite a conta e informe o token' }, { status: 400 });
    }

    const accountId = account.adAccountId;

    // Tentativa 1: edge direta leadgen_forms (requer ads_read no token)
    // Tentativa 2: via campaigns com leadgen_forms aninhado (fallback)
    let forms: Array<{ id: string; name?: string; status?: string; created_time?: string }> = [];
    let lastErrorMsg = '';

    const directUrl = `https://graph.facebook.com/v22.0/${accountId}/leadgen_forms?fields=id,name,status,created_time&limit=100`;
    let response = await fetch(directUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${account.accessToken}` },
    });

    if (response.ok) {
      const data = await response.json();
      forms = data.data || [];
    } else {
      const errText = await response.text();
      let parsed: any = {};
      try { parsed = JSON.parse(errText); } catch {}
      lastErrorMsg = parsed?.error?.message || `HTTP ${response.status}`;
      const errorCode = String(parsed?.error?.code || '');
      console.warn(`[Sync Forms] Conta ${accountId}: tentativa 1 (direct) falhou — code=${errorCode} msg=${lastErrorMsg}`);

      if (errorCode === '100' || errorCode === '200') {
        const campaignsUrl = `https://graph.facebook.com/v22.0/${accountId}/campaigns?fields=leadgen_forms{id,name,status,created_time}&limit=100&effective_status=["ACTIVE","PAUSED"]`;
        const campResponse = await fetch(campaignsUrl, {
          method: 'GET',
          headers: { Authorization: `Bearer ${account.accessToken}` },
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
          console.log(`[Sync Forms] Conta ${accountId}: tentativa 2 (campaigns) encontrou ${forms.length} formulários`);
        } else {
          const err2Text = await campResponse.text();
          let parsed2: any = {};
          try { parsed2 = JSON.parse(err2Text); } catch {}
          lastErrorMsg = parsed2?.error?.message || `HTTP ${campResponse.status}`;
          console.error(`[Sync Forms] Conta ${accountId}: tentativa 2 (campaigns) também falhou — ${lastErrorMsg}`);
        }
      }
    }

    if (forms.length === 0 && lastErrorMsg) {
      const permissionHint = '\n\nPara resolver:\n1. Vá em Meta Business Manager > System Users (business.facebook.com/settings/system-users)\n2. Crie ou edite um System User com permissão "ads_read" atribuído a esta conta\n3. Gere um novo token e atualize a conta aqui.';
      return NextResponse.json({ error: lastErrorMsg + permissionHint }, { status: 400 });
    }

    if (forms.length === 0) {
      return NextResponse.json({
        imported: 0,
        total: 0,
        forms: [],
        message: 'Nenhum formulário de lead encontrado nesta conta de anúncios',
      });
    }

    // Upsert dos formulários com vínculo à conta + atualização do formIds JSON
    let imported = 0;
    const syncedFormIds: string[] = [];
    for (const form of forms) {
      if (form.status && form.status !== 'ACTIVE') continue;
      syncedFormIds.push(form.id);

      try {
        await db.leadFormMapping.upsert({
          where: {
            formId_campaignId: {
              formId: form.id,
              campaignId: `__account_${accountId}`,
            },
          },
          create: {
            formId: form.id,
            formName: form.name || `Formulário ${form.id}`,
            campaignId: `__account_${accountId}`,
            campaignName: `Conta ${account.name}`,
            adAccountId: account.id,
          },
          update: {
            formName: form.name || undefined,
            adAccountId: account.id,
          },
        });
        imported++;
      } catch (err: any) {
        console.warn(`[Sync Forms] Falha ao upsert form ${form.id}:`, err?.message);
      }
    }

    await db.metaAdAccount.update({
      where: { id: account.id },
      data: { formIds: JSON.stringify(syncedFormIds) },
    });

    return NextResponse.json({
      imported,
      total: syncedFormIds.length,
      forms: forms
        .filter((f) => !f.status || f.status === 'ACTIVE')
        .map((f) => ({ id: f.id, name: f.name, status: f.status })),
      message: `${imported} formulário${imported !== 1 ? 's' : ''} sincronizado${imported !== 1 ? 's' : ''} para a conta "${account.name}"`,
    });
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: error.status });
    }
    console.error('[Sync Forms] Erro:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao sincronizar formulários' },
      { status: 500 }
    );
  }
}
