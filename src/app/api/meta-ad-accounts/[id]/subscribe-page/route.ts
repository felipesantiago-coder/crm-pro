import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import {
  derivePageTokenForPage,
  mergePageTokens,
  parseJsonArray,
  resolvePageToken,
  subscribePageLeadgenWebhook,
} from '@/lib/meta-ad-accounts';

// ============================================================
// POST /api/meta-ad-accounts/[id]/subscribe-page
//
// Inscreve o app DESTA conta no campo leadgen de UMA página
// (POST /{page-id}/subscribed_apps?subscribed_fields=leadgen) —
// fecha o circuito do webhook: quando o diagnóstico aponta
// "app NÃO inscrito no campo leadgen", este endpoint resolve
// sem sair do CRM.
//
// Token usado: page token SALVO da página (resolvePageToken) e,
// em caso de falha por pages_manage_metadata (token salvo pode ser
// anterior à concessão da permissão), re-deriva um token FRESCO do
// token atual da conta e tenta uma segunda vez — persistindo o novo
// page token na conta.
// ============================================================

export const maxDuration = 30;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const account = await db.metaAdAccount.findUnique({ where: { id } });
  if (!account) {
    return NextResponse.json({ error: 'Conta de anúncios não encontrada' }, { status: 404 });
  }
  if (!account.accessToken) {
    return NextResponse.json(
      { error: 'Conta sem access token — informe o token no card desta conta antes de inscrever páginas' },
      { status: 400 },
    );
  }

  const pageId = typeof body?.pageId === 'string' ? body.pageId.trim() : '';
  if (!pageId) {
    return NextResponse.json({ error: 'pageId obrigatório no corpo da requisição' }, { status: 400 });
  }
  if (!parseJsonArray(account.pageIds).includes(pageId)) {
    return NextResponse.json(
      { error: `Página ${pageId} não está vinculada a esta conta — salve o Page ID na aba Webhook primeiro` },
      { status: 400 },
    );
  }

  const persist = (pageToken: string) =>
    db.metaAdAccount
      .update({
        where: { id: account.id },
        data: { pageTokens: mergePageTokens(account.pageTokens, { [pageId]: pageToken }) },
      })
      .catch(() => {});

  // 1ª tentativa: token resolvido da conta (page token salvo tem prioridade)
  const firstToken = resolvePageToken(account, pageId);
  if (!firstToken) {
    return NextResponse.json({ error: 'Conta sem access token utilizável' }, { status: 400 });
  }
  let result = await subscribePageLeadgenWebhook(firstToken, pageId);

  // 2ª tentativa: o page token salvo pode ter sido derivado ANTES da
  // permissão pages_manage_metadata ser concedida ao user token —
  // deriva um token fresco com o token ATUAL da conta e persiste.
  if (!result.ok && result.missingPermission) {
    const derived = await derivePageTokenForPage(account.accessToken, pageId);
    if (derived.ok && derived.pageToken !== firstToken) {
      await persist(derived.pageToken);
      result = await subscribePageLeadgenWebhook(derived.pageToken, pageId);
    }
  }

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.missingPermission
          ? `O token desta conta NÃO tem a permissão pages_manage_metadata (${result.error}). Regenere o token concedendo pages_manage_metadata — a identidade do token precisa ter CONTROLE TOTAL da página — salve no card e tente de novo; ou inscreva manualmente: Page Settings → Advanced Messaging → Webhooks (campo leadgen).`
          : `Falha ao inscrever o app na página ${pageId} — ${result.error}`,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    pageId,
    subscribedFields: result.subscribedFields,
    confirmed: result.confirmed,
    message: result.confirmed
      ? `App inscrito no campo leadgen da página ${pageId} (campos: ${result.subscribedFields.join(', ')})`
      : `Inscrição leadgen enviada para a página ${pageId} — reexecute o diagnóstico para confirmar`,
  });
}
