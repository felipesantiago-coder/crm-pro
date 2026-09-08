import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { normalizeAdAccountId } from '@/lib/meta-ad-accounts';
import { validateAppSecretAtSave } from '@/lib/app-secret-validation';

// ============================================================
// PATCH /api/meta-ad-accounts/[id]
// Atualiza uma conta de anúncios (token, pageIds, formIds, fila…).
// Campos vazios de token/secret NÃO apagam o valor salvo — envie
// null explicitamente para remover.
// ============================================================
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();

    const { id } = await params;
    const body = await request.json();
    const { name, adAccountId, accessToken, verifyToken, appSecret, pageIds, formIds, queueId, enabled, isDefault, webhookEnabled, pollingEnabled } = body;

    const existing = await db.metaAdAccount.findUnique({ where: { id }, select: { id: true, accessToken: true } });
    if (!existing) {
      return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 });
    }

    const data: Record<string, unknown> = {};

    if (name !== undefined) data.name = String(name).trim();

    if (adAccountId !== undefined) {
      const raw = String(adAccountId).trim();
      if (!/^(act_)?\d+$/.test(raw)) {
        return NextResponse.json({ error: 'ID da conta inválido. Use o formato numérico ou act_XXXXXXX' }, { status: 400 });
      }
      const normalized = normalizeAdAccountId(raw);
      if (normalized !== (await db.metaAdAccount.findUnique({ where: { id }, select: { adAccountId: true } }))?.adAccountId) {
        const duplicate = await db.metaAdAccount.findUnique({ where: { adAccountId: normalized }, select: { id: true } });
        if (duplicate) {
          return NextResponse.json({ error: 'Já existe uma conta com este ID' }, { status: 409 });
        }
      }
      data.adAccountId = normalized;
    }

    // Tokens: string vazia = manter atual; null = remover; valor = trocar
    if (accessToken !== undefined) {
      if (accessToken === null) data.accessToken = '';
      else if (String(accessToken).trim() !== '') data.accessToken = String(accessToken).trim();
    }
    if (verifyToken !== undefined) {
      data.verifyToken = verifyToken === null || verifyToken === '' ? null : String(verifyToken).trim();
    }
    if (appSecret !== undefined) {
      data.appSecret = appSecret === null || appSecret === '' ? null : String(appSecret).trim();
    }

    if (pageIds !== undefined) {
      data.pageIds = Array.isArray(pageIds) && pageIds.length > 0 ? JSON.stringify(pageIds.map(String)) : null;
    }
    if (formIds !== undefined) {
      data.formIds = Array.isArray(formIds) && formIds.length > 0 ? JSON.stringify(formIds.map(String)) : null;
    }

    if (queueId !== undefined) {
      if (queueId) {
        const queueExists = await db.leadQueue.findUnique({ where: { id: queueId }, select: { id: true } });
        if (!queueExists) {
          return NextResponse.json({ error: 'Fila não encontrada' }, { status: 400 });
        }
      }
      data.queueId = queueId || null;
    }

    if (enabled !== undefined) data.enabled = !!enabled;

    // Toggles de canal por conta (settings agrupadas): webhook e
    // polling desta conta podem ser ligados/desligados de forma
    // independente das demais contas.
    if (webhookEnabled !== undefined) data.webhookEnabled = !!webhookEnabled;
    if (pollingEnabled !== undefined) data.pollingEnabled = !!pollingEnabled;

    if (isDefault !== undefined) {
      if (isDefault) {
        await db.metaAdAccount.updateMany({
          where: { isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      data.isDefault = !!isDefault;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nada para atualizar' }, { status: 400 });
    }

    // ── Validação do App Secret NO ATO DE SALVAR ──────────────
    // Um secret errado passa no self-test HMAC local (auto-consistente)
    // e só mata as entregas REAIS do Meta — o sintoma "polling funciona,
    // webhook mudo com tudo verde". Ao salvar um secret NOVO, monta o
    // app access token (app_id|secret) e o prova contra a Graph API:
    // rejeitado (190) → BLOQUEIA o save com o elo e a correção exata.
    // Indisponibilidade transitória → salva com aviso (nunca bloqueia).
    let saveWarning: string | null = null;
    let appSecretVerified: boolean | undefined;
    let verifiedAppId: string | undefined;
    if (typeof data.appSecret === 'string' && data.appSecret) {
      const effectiveToken =
        data.accessToken !== undefined ? String(data.accessToken) : existing.accessToken || '';
      const validation = await validateAppSecretAtSave(effectiveToken, data.appSecret);
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

    const updated = await db.metaAdAccount.update({
      where: { id },
      data,
      select: { id: true, name: true, adAccountId: true, enabled: true, isDefault: true, webhookEnabled: true, pollingEnabled: true },
    });

    return NextResponse.json({
      ...updated,
      ...(appSecretVerified ? { appSecretVerified, appId: verifiedAppId } : {}),
      ...(saveWarning ? { warning: saveWarning } : {}),
    });
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: error.status });
    }
    console.error('[Ad Accounts] Erro ao atualizar:', error);
    return NextResponse.json({ error: 'Erro ao atualizar conta de anúncios' }, { status: 500 });
  }
}

// ============================================================
// DELETE /api/meta-ad-accounts/[id]
// Remove a conta. Não destrutivo: vínculos (campanhas, mappings,
// configs CAPI) ficam com adAccountId = null (ON DELETE SET NULL).
// ============================================================
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();

    const { id } = await params;
    const existing = await db.metaAdAccount.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 });
    }

    await db.metaAdAccount.delete({ where: { id } });

    return NextResponse.json({ deleted: true });
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: error.status });
    }
    console.error('[Ad Accounts] Erro ao remover:', error);
    return NextResponse.json({ error: 'Erro ao remover conta de anúncios' }, { status: 500 });
  }
}
