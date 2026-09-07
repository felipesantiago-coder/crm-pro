import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';
import {
  buildAccountPlaceholderCampaignId,
  fetchLeadgenFormsForAccount,
  mergeFormIdsIntoJson,
  normalizeAdAccountId,
} from '@/lib/meta-ad-accounts';

// ============================================================
// GET/POST /api/meta-ads/temperature/forms
// Gerenciamento de formulários da seção Temperatura POR CONTA de
// anúncios Meta (Anúncios Meta > Temperatura > Importar formulários).
//
// GET ?accountId=<metaAdAccount.id>
//   → busca os formulários de lead da conta na Graph API (3 vias:
//     conta → campanhas → páginas) e anota o estado de cada um na
//     seção: na Temperatura / removido / configurado / nº de leads.
// POST { accountId, forms: [{ id, name? }] }
//   → importa os formulários selecionados: cria o registro em
//     lead_form_mappings (campaignId sintático __account_<act_id>),
//     registra no formIds da conta (polling) e desfaz a marca de
//     "removido" (restaura na seção com o histórico de leads intacto).
// ============================================================

export const maxDuration = 60;

/** Limites de defesa contra payload gigante. */
const MAX_FORMS_PER_IMPORT = 100;
const MAX_TEXT_LENGTH = 255;

function sanitizeFormId(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().slice(0, MAX_TEXT_LENGTH) : '';
}

function sanitizeFormName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().slice(0, MAX_TEXT_LENGTH);
  return trimmed || null;
}

// ─────────────────────────────────────────────
// GET — formulários disponíveis na conta (estado na Temperatura)
// ─────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('accountId');
    if (!accountId) {
      return NextResponse.json({ error: 'accountId é obrigatório' }, { status: 400 });
    }

    const account = await db.metaAdAccount.findUnique({
      where: { id: accountId },
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
    if (!normalizeAdAccountId(account.adAccountId)) {
      return NextResponse.json({ error: 'Conta sem ID de conta de anúncios — edite a conta e informe o adAccountId' }, { status: 400 });
    }

    const { forms, via, lastErrorMsg } = await fetchLeadgenFormsForAccount(account);

    if (forms.length === 0 && lastErrorMsg) {
      return NextResponse.json(
        { error: lastErrorMsg || 'Não foi possível listar os formulários desta conta' },
        { status: 400 },
      );
    }
    if (forms.length === 0) {
      return NextResponse.json({
        account: { id: account.id, name: account.name, adAccountId: account.adAccountId },
        via: null,
        forms: [],
        message: 'Nenhum formulário de lead encontrado (nem na conta de anúncios, nem nas páginas vinculadas)',
      });
    }

    const metaFormIds = forms.map((f) => f.id).filter(Boolean);

    // Estado atual de cada formulário: mappings (aprendidos + placeholders),
    // leads gravados, configs de temperatura e marca de "removido".
    const [mappings, leadGroups, scorings, hiddenRows] = await Promise.all([
      db.leadFormMapping.findMany({
        where: { formId: { in: metaFormIds } },
        select: { formId: true, campaignId: true, adAccountId: true },
      }),
      db.client.groupBy({
        by: ['metaFormId'],
        where: { metaFormId: { in: metaFormIds } },
        _count: true,
      }),
      db.leadFormScoring.findMany({
        where: { formId: { in: metaFormIds } },
        select: { formId: true, enabled: true },
      }),
      db.leadFormHidden.findMany({
        where: { formId: { in: metaFormIds } },
        select: { formId: true },
      }).catch(() => [] as Array<{ formId: string }>),
    ]);

    const placeholderForThisAccount = buildAccountPlaceholderCampaignId(account.adAccountId);
    const placeholderFormIds = new Set(
      mappings
        .filter((m) => m.campaignId === placeholderForThisAccount)
        .map((m) => m.formId),
    );
    const knownFormIds = new Set(mappings.map((m) => m.formId));
    const leadCountByForm = new Map<string, number>();
    for (const group of leadGroups) {
      if (group.metaFormId) leadCountByForm.set(group.metaFormId, group._count);
    }
    const scoringByForm = new Map(scorings.map((s) => [s.formId, s.enabled]));
    const hiddenFormIds = new Set(hiddenRows.map((row) => row.formId));

    return NextResponse.json({
      account: { id: account.id, name: account.name, adAccountId: account.adAccountId },
      via,
      forms: forms.map((form) => {
        const hidden = hiddenFormIds.has(form.id);
        const inTemperature =
          !hidden && (knownFormIds.has(form.id) || (leadCountByForm.get(form.id) || 0) > 0);
        return {
          id: form.id,
          name: form.name || null,
          status: form.status || null,
          createdTime: form.created_time || null,
          inTemperature,
          hidden,
          configured: scoringByForm.has(form.id),
          scoringActive: scoringByForm.get(form.id) === true,
          leadCount: leadCountByForm.get(form.id) || 0,
          importedToThisAccount: placeholderFormIds.has(form.id),
        };
      }),
    });
  } catch (err) {
    console.error('[Meta Ads Temperature Forms][GET] Erro:', err);
    return NextResponse.json(
      { error: 'Erro ao listar formulários da conta' },
      { status: 500 },
    );
  }
}

// ─────────────────────────────────────────────
// POST — importar formulários selecionados
// ─────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await request.json().catch(() => null);
    const accountId = sanitizeFormId((body as any)?.accountId);
    const rawForms = Array.isArray((body as any)?.forms) ? (body as any).forms : [];

    if (!accountId) {
      return NextResponse.json({ error: 'accountId é obrigatório' }, { status: 400 });
    }
    if (rawForms.length === 0) {
      return NextResponse.json({ error: 'Selecione pelo menos um formulário' }, { status: 400 });
    }
    if (rawForms.length > MAX_FORMS_PER_IMPORT) {
      return NextResponse.json(
        { error: `Importe no máximo ${MAX_FORMS_PER_IMPORT} formulários por vez` },
        { status: 400 },
      );
    }

    // Dedup + sanitização: [{ id, name? }]
    const seen = new Set<string>();
    const wanted: Array<{ id: string; name: string | null }> = [];
    for (const item of rawForms) {
      const id = sanitizeFormId(item?.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      wanted.push({ id, name: sanitizeFormName(item?.name) });
    }
    if (wanted.length === 0) {
      return NextResponse.json({ error: 'Nenhum formulário válido na seleção' }, { status: 400 });
    }

    const account = await db.metaAdAccount.findUnique({
      where: { id: accountId },
      select: { id: true, name: true, adAccountId: true, formIds: true },
    });
    if (!account) {
      return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 });
    }

    const placeholderCampaignId = buildAccountPlaceholderCampaignId(account.adAccountId);
    let imported = 0;
    const importedFormIds: string[] = [];

    for (const form of wanted) {
      try {
        await db.leadFormMapping.upsert({
          where: {
            formId_campaignId: { formId: form.id, campaignId: placeholderCampaignId },
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
        importedFormIds.push(form.id);
      } catch (err: any) {
        console.warn(`[Meta Ads Temperature Forms] Falha ao importar form ${form.id}:`, err?.message);
      }
    }

    if (importedFormIds.length === 0) {
      return NextResponse.json({ error: 'Falha ao importar os formulários selecionados' }, { status: 500 });
    }

    // Registra no polling da conta (formIds) sem duplicar os existentes
    const mergedFormIds = mergeFormIdsIntoJson(account.formIds, importedFormIds);
    if (mergedFormIds !== (account.formIds || null)) {
      await db.metaAdAccount.update({
        where: { id: account.id },
        data: { formIds: mergedFormIds },
      });
    }

    // Importar restaura formulários removidos da seção (histórico intacto)
    await db.leadFormHidden.deleteMany({ where: { formId: { in: importedFormIds } } });

    return NextResponse.json({
      ok: true,
      imported,
      total: importedFormIds.length,
      message:
        `${imported} formulário${imported !== 1 ? 's' : ''} importado${imported !== 1 ? 's' : ''} ` +
        `para a conta "${account.name}" — configure a temperatura em cada um`,
    });
  } catch (err) {
    console.error('[Meta Ads Temperature Forms][POST] Erro:', err);
    return NextResponse.json(
      { error: 'Erro ao importar formulários' },
      { status: 500 },
    );
  }
}
