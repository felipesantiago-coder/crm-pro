import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import {
  buildAccountPlaceholderCampaignId,
  fetchLeadgenFormsForAccount,
  normalizeAdAccountId,
  parseJsonArray,
} from '@/lib/meta-ad-accounts';
import { classifyGraphAuthFailure, buildSyncFormsPermissionHint } from '@/lib/meta-oauth';
import { clearAccountAuthState, registerAccountAuthFailure } from '@/lib/meta-oauth-server';

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
    const { error } = await requireAdmin();
    if (error) return error;

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

    const { forms, via, lastErrorMsg, lastErrorCode, attempts } = await fetchLeadgenFormsForAccount(account);

    if (forms.length === 0 && lastErrorMsg) {
      // (b) Falha de AUTENTICAÇÃO do token (190/200/10): registra o
      // estado na conta — a UI mostra o banner de reconexão. Sucesso
      // total abaixo limpa o estado.
      const authKind = classifyGraphAuthFailure(lastErrorCode ?? null);
      if (authKind && authKind !== 'transient') {
        await registerAccountAuthFailure(account.id, { code: lastErrorCode, message: lastErrorMsg });
      }

      const pageCount = parseJsonArray(account.pageIds).length;
      const authHint = authKind === 'expired'
        ? '\n\nO TOKEN DESTA CONTA EXPIROU/FOI REVOGADO (Graph code 190). Se a conta veio do Facebook (authSource oauth), clique em "Reconectar com o Facebook" no card; se é um token manual, gere um novo e atualize o card.'
        : authKind === 'permission_denied'
          ? '\n\nPERMISSÃO NEGADA pela Graph (code 200/10) — a permissão pode ter sido revogada ou nunca aprovada no App Review. Reconecte a conta com o Facebook ou ajuste as permissões do token.'
          : '';
      // Dica de permissão: quando a via campanhas respondeu OK mas a
      // edge da conta deu #100 "nonexisting field (leadgen_forms)", a
      // dica clássica "conceda ads_read" é FALSA (ads_read provado) —
      // o bloqueio real é leads_retrieval ausente (helper puro em
      // meta-oauth, testado). Caso contrário, mantém a orientação de
      // ads_read/asset da conta.
      const permissionHint = buildSyncFormsPermissionHint({ attempts, pageCount });
      // Diagnóstico por via: mostra ao admin O QUE falhou em cada
      // tentativa (conta, campanhas, página a página) direto no toast —
      // antes isso só existia no console do servidor (inacessível na
      // prática dentro da Vercel).
      const attemptLines = attempts
        .slice(0, 13)
        .map((a) => `• ${a.label}${a.code ? ` [code ${a.code}]` : ''}: ${a.msg.slice(0, 200)}`)
        .join('\n');
      const diagnosisBlock = attemptLines ? `\n\nDiagnóstico por via:\n${attemptLines}` : '';
      return NextResponse.json({ error: lastErrorMsg + authHint + permissionHint + diagnosisBlock }, { status: 400 });
    }

    if (forms.length === 0) {
      // A Graph respondeu OK em alguma via — token sadio: limpa estado
      // de erro remanescente (mantém tokenExpiresAt, que é real).
      await clearAccountAuthState(account.id);
      return NextResponse.json({
        imported: 0,
        total: 0,
        forms: [],
        message: 'Nenhum formulário de lead encontrado (nem na conta de anúncios, nem nas páginas vinculadas)',
      });
    }

    // Sucesso: token comprovadamente válido — limpa estado de erro (b)
    await clearAccountAuthState(account.id);

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
