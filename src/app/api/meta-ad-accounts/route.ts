import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { normalizeAdAccountId } from '@/lib/meta-ad-accounts';
import { validateAppSecretAtSave } from '@/lib/app-secret-validation';
import { daysUntil, resolveAccountAuthStatus } from '@/lib/meta-oauth';

// ============================================================
// GET /api/meta-ad-accounts
// Lista todas as contas de anúncios (multi-conta Meta Ads),
// sem expor tokens completos. Inclui o ESTADO DE AUTENTICAÇÃO do
// token (expiração OAuth, permissão negada) para os banners de
// reconexão da UI.
// ============================================================
export async function GET() {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const accounts = await db.metaAdAccount.findMany({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        adAccountId: true,
        accessToken: true,
        verifyToken: true,
        appSecret: true,
        pageIds: true,
        formIds: true,
        enabled: true,
        isDefault: true,
        webhookEnabled: true,
        pollingEnabled: true,
        queueId: true,
        queue: { select: { id: true, name: true, isActive: true } },
        // Estado de autenticação (OAuth/reconexão)
        authSource: true,
        authStatus: true,
        tokenExpiresAt: true,
        lastAuthError: true,
        lastAuthErrorAt: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { campaignBindings: true, formMappings: true, capiConfigs: true } },
      },
    });

    const masked = accounts.map((a) => ({
      ...a,
      accessTokenMasked: a.accessToken
        ? `${a.accessToken.slice(0, 8)}...${a.accessToken.slice(-8)}`
        : null,
      hasVerifyToken: !!a.verifyToken,
      hasAppSecret: !!a.appSecret,
      // Status COMPUTADO (expiração real vence o armazenado)
      tokenStatus: resolveAccountAuthStatus({ authStatus: a.authStatus, tokenExpiresAt: a.tokenExpiresAt }),
      daysUntilTokenExpiry: daysUntil(a.tokenExpiresAt),
      accessToken: undefined,
      verifyToken: undefined,
      appSecret: undefined,
    }));

    return NextResponse.json(masked);
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: error.status });
    }
    console.error('[Ad Accounts] Erro ao listar:', error);
    return NextResponse.json({ error: 'Erro ao listar contas de anúncios' }, { status: 500 });
  }
}

// ============================================================
// POST /api/meta-ad-accounts
// Cria uma conta de anúncios com token dedicado (multi-conta).
// Body: { name, adAccountId, accessToken, verifyToken?, appSecret?,
//         pageIds?: string[], formIds?: string[], queueId?, enabled?,
//         isDefault?, webhookEnabled?, pollingEnabled? }
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const body = await request.json();
    const { name, adAccountId, accessToken, verifyToken, appSecret, pageIds, formIds, queueId, enabled, isDefault, webhookEnabled, pollingEnabled } = body;

    if (!name || !adAccountId || !accessToken) {
      return NextResponse.json(
        { error: 'Nome, ID da conta e access token são obrigatórios' },
        { status: 400 }
      );
    }

    const rawAccountId = String(adAccountId).trim();
    if (!/^(act_)?\d+$/.test(rawAccountId)) {
      return NextResponse.json(
        { error: 'ID da conta inválido. Use o formato numérico ou act_XXXXXXX' },
        { status: 400 }
      );
    }

    const normalizedAccountId = normalizeAdAccountId(rawAccountId);
    const duplicate = await db.metaAdAccount.findUnique({ where: { adAccountId: normalizedAccountId }, select: { id: true } });
    if (duplicate) {
      return NextResponse.json({ error: 'Já existe uma conta com este ID' }, { status: 409 });
    }

    // Valida fila (roteamento multi-anúncio opcional)
    if (queueId) {
      const queueExists = await db.leadQueue.findUnique({ where: { id: queueId }, select: { id: true } });
      if (!queueExists) {
        return NextResponse.json({ error: 'Fila não encontrada' }, { status: 400 });
      }
    }

    // Se definindo como padrão, desmarca as outras
    if (isDefault) {
      await db.metaAdAccount.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    // ── Validação do App Secret NO ATO DE CRIAR ───────────────
    // Mesma regra do PATCH: secret rejeitado pela Graph API (190) →
    // bloqueia a criação com o elo e a correção exata; indisponibilidade
    // transitória → cria com aviso na resposta.
    let saveWarning: string | null = null;
    let appSecretVerified = false;
    let verifiedAppId: string | null = null;
    const secretToSave = appSecret ? String(appSecret).trim() : '';
    if (secretToSave) {
      const validation = await validateAppSecretAtSave(String(accessToken).trim(), secretToSave);
      if (validation.verdict === 'invalid') {
        return NextResponse.json(
          { error: validation.details, fix: validation.fix },
          { status: 400 },
        );
      }
      if (validation.verdict === 'ok') {
        appSecretVerified = true;
        verifiedAppId = validation.appId;
      } else {
        saveWarning = validation.reason;
      }
    }

    const account = await db.metaAdAccount.create({
      data: {
        name: String(name).trim(),
        adAccountId: normalizedAccountId,
        accessToken: String(accessToken).trim(),
        verifyToken: verifyToken ? String(verifyToken).trim() : null,
        appSecret: appSecret ? String(appSecret).trim() : null,
        pageIds: Array.isArray(pageIds) && pageIds.length > 0 ? JSON.stringify(pageIds.map(String)) : null,
        formIds: Array.isArray(formIds) && formIds.length > 0 ? JSON.stringify(formIds.map(String)) : null,
        queueId: queueId || null,
        enabled: enabled === undefined ? true : !!enabled,
        isDefault: !!isDefault,
        webhookEnabled: webhookEnabled === undefined ? true : !!webhookEnabled,
        pollingEnabled: pollingEnabled === undefined ? true : !!pollingEnabled,
        // Token manual: origem declarada + estado limpo (expiração
        // desconhecida — System User não expira; user token manual a UI
        // mostra como 'unknown' e o runtime marca 190 quando morrer).
        authSource: 'manual',
        authStatus: 'ok',
        // App ID comprovado pela Graph API (quando o secret foi validado)
        appId: verifiedAppId,
      },
    });

    return NextResponse.json(
      {
        id: account.id,
        name: account.name,
        adAccountId: account.adAccountId,
        ...(appSecretVerified ? { appSecretVerified, appId: verifiedAppId } : {}),
        ...(saveWarning ? { warning: saveWarning } : {}),
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: error.status });
    }
    console.error('[Ad Accounts] Erro ao criar:', error);
    return NextResponse.json({ error: 'Erro ao criar conta de anúncios' }, { status: 500 });
  }
}
