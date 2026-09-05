import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { normalizeAdAccountId, parseJsonArray, resolvePageToken } from '@/lib/meta-ad-accounts';

// ============================================================
// POST /api/meta-ad-accounts/[id]/sync-forms
// Sincroniza os formulários de lead da conta via Graph API usando
// o access token PRÓPRIO da conta (multi-conta). 3 vias, da mais
// específica para a mais permissiva:
//   1. act_<id>/leadgen_forms             → exige ads_read no token
//   2. act_<id>/campaigns → leadgen_forms → exige ads_read no token
//   3. {page-id}/leadgen_forms (por página vinculada, com o page
//      token salvo) → exige só permissões de PÁGINA
//      (pages_read_engagement/leads_retrieval) — cobre tokens de
//      papel de página SEM ads_read, que recebem "(#100) Tried
//      accessing nonexisting field (leadgen_forms)" na via da conta
//      (a Graph oculta a edge quando o token não pode vê-la).
// Depois:
//   - Upsert em lead_form_mappings com adAccountId da conta
//   - Atualiza o JSON formIds da conta (fonte do polling multi-token)
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
      select: {
        id: true,
        name: true,
        adAccountId: true,
        accessToken: true,
        enabled: true,
        pageIds: true,
        pageTokens: true,
      },
    });

    if (!account) {
      return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 });
    }
    if (!account.accessToken) {
      return NextResponse.json({ error: 'Conta sem access token — edite a conta e informe o token' }, { status: 400 });
    }

    const accountId = normalizeAdAccountId(account.adAccountId);
    if (!accountId) {
      return NextResponse.json({ error: 'Conta sem ID de conta de anúncios — edite a conta e informe o adAccountId' }, { status: 400 });
    }

    // Tentativa 1: edge direta leadgen_forms (requer ads_read no token)
    // Tentativa 2: via campaigns com leadgen_forms aninhado (fallback ads_read)
    // Tentativa 3: edge leadgen_forms de cada PÁGINA vinculada (sem ads_read)
    let forms: Array<{ id: string; name?: string; status?: string; created_time?: string }> = [];
    let lastErrorMsg = '';
    let via: 'account' | 'campaigns' | 'page' | null = null;

    const directUrl = `https://graph.facebook.com/v22.0/${accountId}/leadgen_forms?fields=id,name,status,created_time&limit=100`;
    let response = await fetch(directUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${account.accessToken}` },
    });

    if (response.ok) {
      const data = await response.json();
      forms = data.data || [];
      if (forms.length > 0) via = 'account';
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
          if (forms.length > 0) via = 'campaigns';
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

    // Tentativa 3 (fallback SEM ads_read): edge leadgen_forms de cada
    // página vinculada — o token da conta tem permissões de página
    // (foi com elas que o polling e a leitura de leads funcionaram).
    // Usa o page token salvo da página quando existir (resolvePageToken).
    if (forms.length === 0) {
      const pageIds = parseJsonArray(account.pageIds).slice(0, 10);
      for (const pageId of pageIds) {
        const pageToken = resolvePageToken(account, pageId);
        if (!pageToken) continue;
        const pageUrl = `https://graph.facebook.com/v22.0/${pageId}/leadgen_forms?fields=id,name,status,created_time&limit=100`;
        const pageRes = await fetch(pageUrl, {
          method: 'GET',
          headers: { Authorization: `Bearer ${pageToken}` },
        });
        if (pageRes.ok) {
          const pageData = await pageRes.json().catch(() => ({}));
          const pageForms = Array.isArray(pageData?.data) ? pageData.data : [];
          if (pageForms.length > 0) {
            forms = pageForms;
            via = 'page';
            console.log(`[Sync Forms] Conta ${accountId}: tentativa 3 (página ${pageId}) encontrou ${pageForms.length} formulários`);
            break;
          }
        } else {
          const err3Text = await pageRes.text().catch(() => '');
          let parsed3: any = {};
          try { parsed3 = JSON.parse(err3Text); } catch {}
          console.warn(`[Sync Forms] Conta ${accountId}: tentativa 3 (página ${pageId}) falhou — ${parsed3?.error?.message || `HTTP ${pageRes.status}`}`);
        }
      }
    }

    if (forms.length === 0 && lastErrorMsg) {
      const pageCount = parseJsonArray(account.pageIds).length;
      const permissionHint = pageCount > 0
        ? '\n\nPara resolver:\n1. Conceda ads_read ao token desta conta: System User com a conta de anúncios como ativo (business.facebook.com/settings/system-users) OU papel de ANUNCIANTE para a identidade do token — depois gere um novo token e atualize o card.\n2. As páginas vinculadas também foram consultadas sem sucesso — confira os detalhes por página no console do servidor.'
        : '\n\nPara resolver:\n1. Conceda ads_read ao token desta conta (System User com a conta de anúncios como ativo) e gere um novo token.\n2. Nenhum Page ID está salvo nesta conta — salve-os na aba Webhook para habilitar a sincronização via páginas (não exige ads_read).';
      return NextResponse.json({ error: lastErrorMsg + permissionHint }, { status: 400 });
    }

    if (forms.length === 0) {
      return NextResponse.json({
        imported: 0,
        total: 0,
        forms: [],
        message: 'Nenhum formulário de lead encontrado (nem na conta de anúncios, nem nas páginas vinculadas)',
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

    const viaLabel = via === 'page'
      ? 'páginas vinculadas (permissões de página)'
      : via === 'campaigns'
        ? 'campanhas da conta'
        : 'conta de anúncios';

    return NextResponse.json({
      imported,
      total: syncedFormIds.length,
      via,
      forms: forms
        .filter((f) => !f.status || f.status === 'ACTIVE')
        .map((f) => ({ id: f.id, name: f.name, status: f.status })),
      message: `${imported} formulário${imported !== 1 ? 's' : ''} sincronizado${imported !== 1 ? 's' : ''} para a conta "${account.name}" (via ${viaLabel})`,
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
