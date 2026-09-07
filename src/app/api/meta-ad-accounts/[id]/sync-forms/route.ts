import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import {
  buildAccountPlaceholderCampaignId,
  fetchLeadgenFormsForAccount,
  normalizeAdAccountId,
  parseJsonArray,
} from '@/lib/meta-ad-accounts';

// ============================================================
// POST /api/meta-ad-accounts/[id]/sync-forms
// Sincroniza os formulários de lead da conta via Graph API usando
// o access token PRÓPRIO da conta (multi-conta). A busca em 3 vias
// (conta → campanhas → páginas vinculadas) vive em
// fetchLeadgenFormsForAccount (lib meta-ad-accounts) e é compartilhada
// com a importação de formulários da aba Temperatura.
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

    const { forms, via, lastErrorMsg } = await fetchLeadgenFormsForAccount(account);

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
    const placeholderCampaignId = buildAccountPlaceholderCampaignId(accountId);
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
              campaignId: placeholderCampaignId,
            },
          },
          create: {
            formId: form.id,
            formName: form.name || `Formulário ${form.id}`,
            campaignId: placeholderCampaignId,
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
