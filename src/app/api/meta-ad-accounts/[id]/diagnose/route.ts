import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';
import {
  evaluateAccountConnection,
  parseJsonArray,
  mergePageTokens,
  derivePageTokenForPage,
  type AdAccountRef,
} from '@/lib/meta-ad-accounts';

// ============================================================
// GET /api/meta-ad-accounts/[id]/diagnose
//
// Diagnóstico e teste de conexão DE UMA CONTA DE ANÚNCIOS — parte do
// modelo em que TODAS as configurações de conexão Meta Ads vivem na
// conta (não há webhook/polling global). Executa, na ordem:
//
//   1. Checklist de configuração (token/verify/secret/pages/forms/toggles)
//   2. Validação do access token na Graph API (GET /me)
//   3. Cada page ID da conta: acessível? leadgen assinado no app?
//   4. Cada form ID (até 5): leitura de leads liberada p/ o token?
//   5. Self-test do webhook: GET no próprio endpoint com o verify
//      token DESTA conta (hub.challenge)
//   6. Estatísticas: formulários/campanhas/CAPI aprendidos nesta conta
//
// Retorna checks[{key,status,details,fix?}] + resumo (ok/warn/error).
// ============================================================

export const maxDuration = 30;

const GRAPH_API_BASE = 'https://graph.facebook.com/v22.0';
const GRAPH_TIMEOUT_MS = 8_000;

type CheckStatus = 'ok' | 'warn' | 'error' | 'skip';

interface DiagCheck {
  key: string;
  status: CheckStatus;
  details: string;
  fix?: string;
}

async function graphGet(path: string, token: string): Promise<{ ok: boolean; status?: number; data: any; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GRAPH_TIMEOUT_MS);
  try {
    const url = `${GRAPH_API_BASE}/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: res.status, data, error: data?.error?.message || `HTTP ${res.status}` };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, data: null, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { id } = await params;

  // 0. Carrega a conta (campos completos — rota admin-only)
  const account = await db.metaAdAccount.findUnique({ where: { id } });
  if (!account) {
    return NextResponse.json({ error: 'Conta de anúncios não encontrada' }, { status: 404 });
  }

  const checks: DiagCheck[] = [];
  const ref: AdAccountRef = {
    id: account.id,
    name: account.name,
    adAccountId: account.adAccountId,
    accessToken: account.accessToken,
    verifyToken: account.verifyToken,
    appSecret: account.appSecret,
    pageIds: account.pageIds,
    formIds: account.formIds,
    queueId: account.queueId,
    webhookEnabled: account.webhookEnabled,
    pollingEnabled: account.pollingEnabled,
  };

  // ── 1. Checklist de configuração (puro) ──────────────────────
  const evaluation = evaluateAccountConnection(ref);
  for (const item of evaluation.checks) {
    checks.push({
      key: `config_${item.key}`,
      status: item.ok ? 'ok' : item.required ? 'error' : 'warn',
      details: item.ok
        ? `${item.label}: OK`
        : `${item.label}: pendente — ${item.hint}`,
      fix: item.ok ? undefined : item.hint,
    });
  }

  // ── 2. Access token na Graph API ─────────────────────────────
  if (account.accessToken) {
    const me = await graphGet('me?fields=id,name', account.accessToken);
    if (me.ok) {
      checks.push({
        key: 'graph_token',
        status: 'ok',
        details: `Token válido na Graph API — identidade: ${me.data?.name || me.data?.id || 'N/A'}`,
      });
    } else {
      checks.push({
        key: 'graph_token',
        status: 'error',
        details: `Token INVÁLIDO ou sem permissões — ${me.error}`,
        fix: 'Gere um novo token (System User/Page) com leads_retrieval e pages_show_list/pages_read_engagement, e atualize o card desta conta.',
      });
    }
  }

  // ── 3. Pages da conta: acesso + EXTRAÇÃO AUTOMÁTICA de page token
  //      + assinatura leadgen ──────────────────────────────────────────
  // Comportamento RESTAURADO (era feito pelo diagnóstico global): se o
  // GET direto na página falhar ou não retornar access_token (token de
  // USUÁRIO), o page token é derivado via /me/accounts e SALVO na conta
  // (pageTokens) — não expira com o user token e passa a ser usado pelo
  // webhook ao buscar field_data dos leads da página.
  const pageIds = parseJsonArray(account.pageIds).slice(0, 10);
  for (const pageId of pageIds) {
    const page = await graphGet(`${pageId}?fields=name,access_token`, account.accessToken);
    let pageName: string = page.ok ? page.data?.name || pageId : pageId;
    let pageToken: string | undefined = page.ok ? page.data?.access_token : undefined;
    let pageTokenNote = '';

    if (!pageToken) {
      // Extração automática: token de usuário → /me/accounts → page token
      const derived = await derivePageTokenForPage(account.accessToken, pageId);
      if (derived.ok) {
        pageToken = derived.pageToken;
        if (derived.pageName) pageName = derived.pageName;
        pageTokenNote =
          derived.via === 'me_accounts'
            ? ' — page access token EXTRAÍDO AUTOMATICAMENTE do token de usuário (/me/accounts) e salvo nesta conta'
            : ' — page access token extraído e salvo nesta conta';
        // Persistir POR CONTA (falha não derruba o diagnóstico)
        await db.metaAdAccount
          .update({
            where: { id: account.id },
            data: { pageTokens: mergePageTokens(account.pageTokens, { [pageId]: derived.pageToken }) },
          })
          .catch((err: unknown) => {
            console.warn(`[Diagnóstico] Falha ao salvar page token da página ${pageId} na conta:`, err instanceof Error ? err.message : err);
          });
      } else if (derived.reason === 'me_accounts_error') {
        checks.push({
          key: `page_${pageId}`,
          status: 'error',
          details: `Page ${pageId}: SEM acesso direto com o token desta conta — ${page.error || 'erro desconhecido'}. O fallback /me/accounts também falhou: ${derived.error || 'erro desconhecido'}`,
          fix: 'Confirme que o access token da conta é válido e tem pages_show_list/pages_manage_metadata, depois reexecute o diagnóstico.',
        });
        continue;
      } else if (derived.reason === 'page_not_listed') {
        checks.push({
          key: `page_${pageId}`,
          status: 'error',
          details: `Page ${pageId}: SEM acesso com o token desta conta — ${page.error || 'erro desconhecido'}. A página também NÃO aparece em /me/accounts com este token (a extração automática do page token não foi possível).`,
          fix: 'Conceda acesso da página ao token desta conta (pages_show_list/pages_manage_metadata; em System User, adicione a página como ativo do usuário) ou confira o ID.',
        });
        continue;
      } else {
        // no_token_in_response: página acessível, mas nenhum page token
        checks.push({
          key: `page_${pageId}`,
          status: 'warn',
          details: `Page "${pageName}": acessível, mas o token não retornou o page access token e a extração via /me/accounts não o encontrou — não foi possível verificar a assinatura do webhook.`,
          fix: 'Use um token com permissão pages_manage_metadata/pages_manage_pages.',
        });
        continue;
      }
    } else if (pageToken !== account.accessToken) {
      // GET direto retornou um page token DISTINTO do token da conta —
      // salva também (mesma persistência do fluxo de extração).
      pageTokenNote = ' — page access token obtido e salvo nesta conta';
      await db.metaAdAccount
        .update({
          where: { id: account.id },
          data: { pageTokens: mergePageTokens(account.pageTokens, { [pageId]: pageToken }) },
        })
        .catch(() => {});
    }

    const subs = await graphGet(`${pageId}/subscribed_apps?fields=subscribed_fields`, pageToken);
    if (!subs.ok) {
      checks.push({
        key: `page_${pageId}`,
        status: 'warn',
        details: `Page "${pageName}": não foi possível consultar subscribed_apps — ${subs.error}`,
        fix: 'Verifique a assinatura manualmente: Page Settings → Advanced Messaging → Webhooks (campo leadgen).',
      });
      continue;
    }
    const ownApp = Array.isArray(subs.data?.data)
      ? subs.data.data.find((s: any) => s && Array.isArray(s.subscribed_fields))
      : null;
    const fields: string[] = ownApp?.subscribed_fields || [];
    const hasLeadgen = fields.includes('leadgen');
    checks.push({
      key: `page_${pageId}`,
      status: hasLeadgen ? 'ok' : 'error',
      details: hasLeadgen
        ? `Page "${pageName}": webhook de LEADS assinado neste app (campos: ${fields.join(', ')})${pageTokenNote}`
        : `Page "${pageName}": o app NÃO está inscrito no campo leadgen desta página — leads NÃO chegam via webhook${pageTokenNote}`,
      fix: hasLeadgen
        ? undefined
        : 'Inscreva a página no campo leadgen: POST /{page-id}/subscribed_apps?subscribed_fields=leadgen (ou Page Settings → Webhooks).',
    });
  }

  // ── 4. Form IDs: leitura de leads liberada? ──────────────────
  const formIds = parseJsonArray(account.formIds).slice(0, 5);
  for (const formId of formIds) {
    const leads = await graphGet(`${formId}/leads?limit=1&fields=id`, account.accessToken);
    checks.push({
      key: `form_${formId}`,
      status: leads.ok ? 'ok' : 'error',
      details: leads.ok
        ? `Form ${formId}: leitura de leads OK com o token desta conta`
        : `Form ${formId}: FALHA ao ler leads — ${leads.error}`,
      fix: leads.ok ? undefined : 'Confirme que o formulário pertence a uma página desta conta e que o token tem leads_retrieval.',
    });
  }

  // ── 5. Self-test do webhook com o verify token DESTA conta ───
  if (account.verifyToken && account.webhookEnabled !== false) {
    const challenge = crypto.randomUUID().replace(/-/g, '');
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
    const proto = request.headers.get('x-forwarded-proto') || (host?.startsWith('localhost') ? 'http' : 'https');
    const origin = process.env.NEXT_PUBLIC_APP_URL || (host ? `${proto}://${host}` : '');
    if (origin) {
      const selfUrl = `${origin}/api/webhooks/meta-leads?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(account.verifyToken)}&hub.challenge=${challenge}`;
      try {
        const res = await fetch(selfUrl, { method: 'GET', signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS) });
        const bodyText = await res.text().catch(() => '');
        if (res.status === 200 && bodyText === challenge) {
          checks.push({
            key: 'webhook_selftest',
            status: 'ok',
            details: 'Webhook do CRM aceitou o verify token DESTA conta (hub.challenge ecoado)',
          });
        } else if (res.status === 403) {
          checks.push({
            key: 'webhook_selftest',
            status: 'error',
            details: 'Webhook REJEITOU o verify token desta conta (HTTP 403) — valor salvo diverge do esperado',
            fix: 'Re-salve o verify token no card da conta e use exatamente o mesmo valor no Meta for Developers.',
          });
        } else {
          checks.push({
            key: 'webhook_selftest',
            status: 'error',
            details: `Self-test do webhook retornou HTTP ${res.status} (esperado 200 + challenge)`,
            fix: 'Verifique se o deploy está saudável e se a URL do webhook está correta: /api/webhooks/meta-leads',
          });
        }
      } catch (err) {
        checks.push({
          key: 'webhook_selftest',
          status: 'error',
          details: `Falha ao chamar o próprio webhook — ${err instanceof Error ? err.message : err}`,
        });
      }
    } else {
      checks.push({
        key: 'webhook_selftest',
        status: 'skip',
        details: 'Self-test pulado — origem do servidor não determinável',
      });
    }
  } else if (!account.verifyToken) {
    checks.push({
      key: 'webhook_selftest',
      status: 'skip',
      details: 'Self-test pulado — conta sem verify token próprio',
    });
  }

  // ── 6. Estatísticas da conta (agrupamento por conta) ─────────
  const [formMappingAgg, bindingAgg, capiCount] = await Promise.all([
    db.leadFormMapping
      .aggregate({ where: { adAccountId: account.id }, _count: { _all: true }, _sum: { leadCount: true } })
      .catch(() => null),
    db.metaCampaignBinding
      .aggregate({ where: { adAccountId: account.id }, _count: { _all: true }, _sum: { leadCount: true } })
      .catch(() => null),
    db.metaCapConfig.count({ where: { adAccountId: account.id } }).catch(() => 0),
  ]);

  checks.push({
    key: 'stats',
    status: 'ok',
    details: [
      `Formulários aprendidos: ${formMappingAgg?._count?._all ?? 0} (leads: ${formMappingAgg?._sum?.leadCount ?? 0})`,
      `Campanhas vinculadas: ${bindingAgg?._count?._all ?? 0} (leads: ${bindingAgg?._sum?.leadCount ?? 0})`,
      `Configs CAPI desta conta: ${capiCount}`,
    ].join(' · '),
  });

  const errorCount = checks.filter((c) => c.status === 'error').length;
  const warnCount = checks.filter((c) => c.status === 'warn').length;

  return NextResponse.json({
    account: {
      id: account.id,
      name: account.name,
      adAccountId: account.adAccountId,
      enabled: account.enabled,
      webhookEnabled: account.webhookEnabled,
      pollingEnabled: account.pollingEnabled,
    },
    evaluation: {
      webhookReady: evaluation.webhookReady,
      pollingReady: evaluation.pollingReady,
    },
    webhookUrl: '/api/webhooks/meta-leads',
    checks,
    summary: { ok: checks.length - errorCount - warnCount, warnings: warnCount, errors: errorCount },
  });
}
