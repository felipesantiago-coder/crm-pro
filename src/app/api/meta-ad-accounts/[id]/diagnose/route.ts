import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';
import crypto from 'crypto';
import {
  evaluateAccountConnection,
  parseJsonArray,
  mergePageTokens,
  derivePageTokenForPage,
  needsPagesManageMetadata,
  type AdAccountRef,
} from '@/lib/meta-ad-accounts';
import {
  buildAppAccessToken,
  evaluateAppSubscription,
  type AppSubscriptionFetchOutcome,
} from '@/lib/meta-app-subscription';
import { evaluateTokenPermissions } from '@/lib/meta-oauth';

// ============================================================
// GET /api/meta-ad-accounts/[id]/diagnose
//
// Diagnóstico e teste de conexão DE UMA CONTA DE ANÚNCIOS — parte do
// modelo em que TODAS as configurações de conexão Meta Ads vivem na
// conta (não há webhook/polling global). Executa, na ordem:
//
//   1. Checklist de configuração (token/verify/secret/pages/forms/toggles)
//   2. Validação do access token na Graph API (GET /me)
//   3. Cada page ID da conta: acessível? leadgen assinado NO APP DESTA
//      conta (comparação por app id via debug_token — não basta "algum
//      app" estar inscrito)?
//   4. Cada form ID (até 5): leitura de leads liberada p/ o token?
//   5. Self-test do webhook: GET (verify token/hub.challenge) + POST
//      ASSINADO com o App Secret da conta — a porta EXCLUSIVA das
//      entregas reais do Meta — usando payload sem leadgen_id (zero
//      efeitos: nada é criado, fila não gira, cartão não dispara)
//   5c. Assinatura do webhook NO NÍVEL DO APP: GET /{app-id}/subscriptions
//      com app access token (app_id|app_secret) — confirma o App Secret
//      REAL contra a Graph API (o self-test 5b é auto-consistente e não
//      prova isso) e verifica se o app tem o webhook Page/leadgen ATIVO
//      com Callback URL apontando para ESTE CRM — sem esse registro, o
//      Meta não tem para onde entregar (zero entregas, tudo verde)
//   6. Leads perdidos PELO webhook (30d) por fonte: assinatura inválida,
//      página não vinculada, conta sem token, sem contas — cada fonte
//      aponta o elo exato da cadeia que está falhando
//   7. Estatísticas: formulários/campanhas/CAPI aprendidos nesta conta
//
// Retorna checks[{key,status,details,fix?}] + resumo (ok/warn/error).
// ============================================================

export const maxDuration = 30;

const GRAPH_API_BASE = 'https://graph.facebook.com/v26.0';
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
  //      + assinatura leadgen + DESCOBERTA DA CAUSA RAIZ ────────────
  // Comportamento RESTAURADO (era feito pelo diagnóstico global): se o
  // GET direto na página falhar ou não retornar access_token (token de
  // USUÁRIO), o page token é derivado via /me/accounts e SALVO na conta
  // (pageTokens) — não expira com o user token e passa a ser usado pelo
  // webhook ao buscar field_data dos leads da página.
  //
  // Quando a página é inacessível, o diagnóstico NÃO se limita a dizer
  // "sem acesso": cruza 4 sondas para apontar a causa exata —
  //   (a) página REAL dona dos formulários (/{form-id}?fields=page — o
  //       token lê leads, então revela se o Page ID do card está errado);
  //   (b) leads perdidos (meta_webhook_unmapped_page) com o page id REAL
  //       que o Meta já entregou no webhook;
  //   (c) permissões concedidas ao token (/me/permissions — token de
  //       usuário; falha com page token é tratada como inconclusiva);
  //   (d) páginas que o token ENXERGA em /me/accounts.
  const pageIds = parseJsonArray(account.pageIds).slice(0, 10);
  const probeFormIds = parseJsonArray(account.formIds).slice(0, 5);

  // Probes preguiçosos — cada um executa no máximo 1× por diagnóstico e
  // só quando alguma página falha (custo zero quando tudo está OK).
  let permissionsProbe: { granted: Record<string, boolean> } | null | undefined;
  const probePermissions = async () => {
    if (permissionsProbe !== undefined) return permissionsProbe;
    const perms = await graphGet('me/permissions', account.accessToken);
    if (!perms.ok || !Array.isArray(perms.data?.data)) {
      permissionsProbe = null; // page token ou falha — inconclusivo
      return null;
    }
    const granted: Record<string, boolean> = {};
    for (const p of perms.data.data as Array<{ permission?: string; status?: string }>) {
      if (p?.permission) granted[p.permission] = p.status === 'granted';
    }
    permissionsProbe = { granted };
    return permissionsProbe;
  };

  let meAccountsProbe: Array<{ id: string; name?: string }> | null | undefined;
  const probeMeAccounts = async () => {
    if (meAccountsProbe !== undefined) return meAccountsProbe;
    const res = await graphGet('me/accounts?fields=id,name&limit=100', account.accessToken);
    meAccountsProbe = res.ok && Array.isArray(res.data?.data) ? res.data.data : null;
    return meAccountsProbe;
  };

  const formPagesProbe = new Map<string, { pageId: string; pageName?: string; formName?: string }>();
  const probeFormPage = async (formId: string) => {
    const cached = formPagesProbe.get(formId);
    if (cached) return cached;
    const res = await graphGet(`${formId}?fields=id,name,page{id,name}`, account.accessToken);
    const found =
      res.ok && res.data?.page?.id
        ? { pageId: String(res.data.page.id), pageName: res.data.page.name, formName: res.data.name }
        : null;
    if (found) formPagesProbe.set(formId, found);
    return found;
  };

  let lostPagesProbe: Record<string, number> | null | undefined;
  const probeLostLeadPages = async () => {
    if (lostPagesProbe !== undefined) return lostPagesProbe;
    try {
      const rows = await db.lostLead.findMany({
        where: { source: 'meta_webhook_unmapped_page', createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { formData: true },
      });
      const counts: Record<string, number> = {};
      for (const row of rows) {
        const pid = (row.formData as { pageId?: unknown } | null)?.pageId;
        if (typeof pid === 'string' && pid) counts[pid] = (counts[pid] || 0) + 1;
      }
      lostPagesProbe = counts;
    } catch {
      lostPagesProbe = null;
    }
    return lostPagesProbe;
  };

  // App id da conta para os checks de WEBHOOK. Ordem de resolução:
  //   1. account.appId — COMPROVADO pela Graph no ato de salvar o App
  //      Secret (par appId+secret validado): é o app cujas assinaturas
  //      o CRM valida e o que deve receber as entregas do webhook.
  //      Funciona inclusive com System User token, onde debug_token
  //      costuma falhar ("debug_token indisponível").
  //   2. debug_token (app que EMITE o token salvo) — proxy quando o
  //      appId não foi comprovado; também expõe divergência token×app.
  // tokenAppId fica disponível para sinalizar token emitido por app
  // diferente do app do webhook (o polling funciona, mas a dupla
  // token×secret fica inconsistente entre apps).
  let appIdsProbe: { webhookAppId: string | null; tokenAppId: string | null } | undefined;
  const probeAppIds = async (): Promise<{ webhookAppId: string | null; tokenAppId: string | null }> => {
    if (appIdsProbe !== undefined) return appIdsProbe;
    const res = await graphGet(
      `debug_token?input_token=${encodeURIComponent(account.accessToken)}`,
      account.accessToken,
    );
    const appId = res.ok ? res.data?.data?.app_id : null;
    const tokenAppId = typeof appId === 'string' && appId ? appId : null;
    appIdsProbe = { webhookAppId: account.appId || tokenAppId, tokenAppId };
    return appIdsProbe;
  };

  // ── 2b. Permissões do token (SEMPRE) — causa raiz dos erros de
  // leitura de formulários/leads. O token pode ser VÁLIDO (/me OK) e
  // ainda assim a Graph OCULTAR as edges de leads quando o token não
  // tem leads_retrieval: "#100 nonexisting field (leadgen_forms)" no
  // Sync Forms e "Unsupported get request … missing permissions" na
  // leitura de leads são os sintomas clássicos — MESMO com ads_read OK
  // e webhook saudável. /me/permissions só responde para tokens de
  // USUÁRIO (page/System User → skip, inconclusivo).
  if (account.accessToken) {
    const perms = await probePermissions();
    const permSummary = evaluateTokenPermissions(perms ? perms.granted : null);
    if (permSummary.inconclusive) {
      checks.push({
        key: 'token_permissions',
        status: 'skip',
        details: 'Permissões do token não puderam ser listadas (/me/permissions só responde para tokens de usuário) — os checks de formulários abaixo mostram o efeito real das falhas de leitura',
      });
    } else {
      const permList = permSummary.permissions
        .map((p) => `${p.permission}: ${p.status === 'granted' ? 'granted' : p.status === 'declined' ? 'DECLINED' : 'ausente'}`)
        .join(' · ');
      if (permSummary.leadsRetrievalMissing) {
        checks.push({
          key: 'token_permissions',
          status: 'error',
          details: `Permissões do token — ${permList}. SEM leads_retrieval a Graph oculta a leitura de formulários e leads: causa típica de "#100 nonexisting field (leadgen_forms)" no Sync Forms e de "Unsupported get request … missing permissions" ao ler leads — MESMO com ads_read OK e webhook saudável.`,
          fix: 'Gere um novo token concedendo leads_retrieval: se a conta veio do Facebook, use "Reconectar com o Facebook" no card; se é token manual, marque leads_retrieval na geração — no Graph API Explorer selecione o MESMO app do webhook desta conta. Apps públicos exigem Advanced Access (App Review); em modo DESENVOLVIMENTO funciona para usuários com papel no app.',
        });
      } else if (permSummary.adsReadMissing) {
        checks.push({
          key: 'token_permissions',
          status: 'warn',
          details: `Permissões do token — ${permList}. Sem ads_read a LISTAGEM de formulários via conta de anúncios (Sync Forms) não funciona — a leitura de leads por form ID (polling) continua OK porque leads_retrieval está concedida.`,
          fix: 'Gere um novo token concedendo ads_read: System User com a conta de anúncios como ativo, OU papel de ANUNCIANTE para a identidade do token.',
        });
      } else {
        checks.push({
          key: 'token_permissions',
          status: 'ok',
          details: `Permissões do token — ${permList}`,
        });
      }
    }
  }

  // ── 2c. Divergência token × app do webhook — o token pode ter sido
  // emitido por OUTRO app (ex.: System User token gerado selecionando
  // um app diferente do App Secret salvo): o polling e as leituras
  // funcionam (o token tem as permissões e os ativos), mas token,
  // webhook e assinaturas HMAC ficam atrelados a apps distintos —
  // sinaliza para regenerar no app certo.
  if (account.accessToken) {
    const { webhookAppId, tokenAppId } = await probeAppIds();
    if (tokenAppId && webhookAppId && tokenAppId !== webhookAppId) {
      checks.push({
        key: 'token_app_mismatch',
        status: 'warn',
        details: `O token desta conta foi emitido pelo app ${tokenAppId}, mas o app do webhook (App ID comprovado com o App Secret salvo) é o ${webhookAppId}. O polling e as leituras na Graph funcionam, mas token, webhook e assinaturas HMAC ficam em apps diferentes.`,
        fix: `Gere um novo token para esta conta no app ${webhookAppId} (System User → Generate Token selecionando esse app, ou "Reconectar com o Facebook" no card) e atualize o card.`,
      });
    }
  }

  /** Cruza as sondas e monta a causa raiz + correção para uma página inacessível. */
  const buildPageFailureDiagnosis = async (pageId: string) => {
    const parts: string[] = [];
    const fixes: string[] = [];
    let realPageId: string | null = null;

    // (a) Página REAL revelada pelos formulários (o token lê leads deles!)
    const formHints: string[] = [];
    for (const formId of probeFormIds) {
      const fp = await probeFormPage(formId);
      if (!fp) continue;
      if (fp.pageId === pageId) {
        formHints.push(`form ${formId} confirma que a página configurada É a dona dele (ID correto)`);
        realPageId = pageId;
      } else {
        formHints.push(`form ${formId} pertence à página ${fp.pageId}${fp.pageName ? ` "${fp.pageName}"` : ''} — DIFERENTE do configurado`);
        if (!realPageId) realPageId = fp.pageId;
      }
    }
    if (formHints.length > 0) parts.push(`Descoberta pelos formulários: ${formHints.join('; ')}.`);

    // (b) Leads perdidos: página REAL que o Meta já entregou no webhook
    const lost = await probeLostLeadPages();
    if (lost && Object.keys(lost).length > 0) {
      const lostSummary = Object.entries(lost)
        .slice(0, 3)
        .map(([pid, n]) => `${pid} (${n} lead${n > 1 ? 's' : ''})`)
        .join(', ');
      parts.push(`O webhook JÁ entregou leads de página(s) NÃO vinculada(s) nos últimos 30 dias: ${lostSummary} — estão em Leads Perdidos (recupere via Importação Manual).`);
      if (!realPageId) realPageId = Object.keys(lost)[0];
    }

    // (c) Permissões concedidas ao token (token de USUÁRIO)
    const perms = await probePermissions();
    if (perms) {
      const g = perms.granted;
      const permSummary = ['pages_show_list', 'pages_manage_metadata', 'pages_read_engagement', 'leads_retrieval']
        .map((p) => `${p}: ${g[p] === true ? 'granted' : g[p] === false ? 'DECLINED' : 'ausente'}`)
        .join(', ');
      parts.push(`Permissões do token: ${permSummary}.`);
      if (g['pages_show_list'] !== true) {
        fixes.push('Gere um novo token concedendo pages_show_list (além de leads_retrieval) e atualize o card.');
      }
    }

    // (d) Páginas que o token ENXERGA
    const pages = await probeMeAccounts();
    if (pages && pages.length > 0) {
      const list = pages
        .slice(0, 5)
        .map((p) => `${p.name || '?'} (${p.id})`)
        .join(', ');
      parts.push(`/me/accounts com este token lista ${pages.length} página(s): ${list}${pages.length > 5 ? ' …' : ''}.`);
    } else if (pages) {
      parts.push('/me/accounts com este token retorna LISTA VAZIA — a identidade do token não administra nenhuma página.');
    }

    // Correção principal, ordenada pela causa mais provável
    if (realPageId && realPageId !== pageId) {
      fixes.unshift(`O Page ID do card está ERRADO — corrija para ${realPageId} (aba Webhook → Page IDs da conta) e reexecute o diagnóstico.`);
    } else if (realPageId === pageId) {
      fixes.unshift('O ID está CORRETO — o problema é ACESSO: conceda papel na página à identidade do token (Page Settings → Page access, ou Business Manager → Páginas → Adicionar pessoas) ou troque o token por um de System User com a página como ativo.');
    } else if (fixes.length === 0) {
      fixes.unshift('Conceda acesso da página à identidade do token (ou use System User com a página como ativo) e confira o ID — a página real aparece nos leads perdidos e nos detalhes acima.');
    }

    return { parts, fix: fixes.join(' ') };
  };

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
        const diag = await buildPageFailureDiagnosis(pageId);
        checks.push({
          key: `page_${pageId}`,
          status: 'error',
          details: `Page ${pageId}: SEM acesso direto com o token desta conta — ${page.error || 'erro desconhecido'}. O fallback /me/accounts também falhou: ${derived.error || 'erro desconhecido'}.${diag.parts.length ? ` ${diag.parts.join(' ')}` : ''}`,
          fix: diag.fix,
        });
        continue;
      } else if (derived.reason === 'page_not_listed') {
        const diag = await buildPageFailureDiagnosis(pageId);
        checks.push({
          key: `page_${pageId}`,
          status: 'error',
          details: `Page ${pageId}: SEM acesso com o token desta conta — ${page.error || 'erro desconhecido'}. A página NÃO aparece em /me/accounts com este token (extração automática do page token impossível).${diag.parts.length ? ` ${diag.parts.join(' ')}` : ''}`,
          fix: diag.fix,
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

    const subs = await graphGet(`${pageId}/subscribed_apps?fields=id,subscribed_fields`, pageToken);
    if (!subs.ok) {
      if (needsPagesManageMetadata(subs.error)) {
        // Page token em mãos, mas SEM pages_manage_metadata: o CRM não
        // consegue VERIFICAR nem criar a inscrição leadgen. A assinatura
        // pode já existir — nesse caso o webhook funciona mesmo assim.
        checks.push({
          key: `page_${pageId}`,
          status: 'warn',
          details: `Page "${pageName}": página ACESSÍVEL e page token em mãos, mas o token NÃO tem a permissão pages_manage_metadata — por isso o CRM não consegue VERIFICAR nem criar a inscrição leadgen do webhook (ler e escrever subscribed_apps exigem essa permissão). Se a assinatura já existir na página, o webhook funciona mesmo assim.${pageTokenNote}`,
          fix: 'Opção A (recomendada): regenere o token desta conta concedendo pages_manage_metadata — a identidade do token precisa ter CONTROLE TOTAL da página — salve no card, reexecute o diagnóstico e, se faltar, use o botão do Page ID (aba Webhook) para inscrever. Opção B (manual): Page Settings → Advanced Messaging → Webhooks → inscreva o app no campo leadgen.',
        });
      } else {
        checks.push({
          key: `page_${pageId}`,
          status: 'warn',
          details: `Page "${pageName}": não foi possível consultar subscribed_apps — ${subs.error}`,
          fix: 'Verifique a assinatura manualmente: Page Settings → Advanced Messaging → Webhooks (campo leadgen).',
        });
      }
      continue;
    }
    // Compara por APP ID: leadgen precisa estar assinado NO app desta
    // conta (o mesmo cujo App Secret valida as assinaturas). "Algum app
    // assinado" não basta — outro app recebe as entregas em outro sistema.
    const subEntries: Array<{ id?: string | number; subscribed_fields?: string[] }> = Array.isArray(subs.data?.data)
      ? subs.data.data
      : [];
    const leadgenApps = subEntries.filter(
      (s) => s && Array.isArray(s.subscribed_fields) && s.subscribed_fields.includes('leadgen'),
    );
    const { webhookAppId: ourAppId } = await probeAppIds();
    const ourAppHasLeadgen = ourAppId
      ? leadgenApps.some((s) => String(s.id) === ourAppId)
      : null; // null = não foi possível determinar o app desta conta
    const fieldsOf = (s: { subscribed_fields?: string[] }) => (s.subscribed_fields || []).join(', ');

    if (ourAppHasLeadgen === true) {
      checks.push({
        key: `page_${pageId}`,
        status: 'ok',
        details: `Page "${pageName}": webhook de LEADS assinado NO APP DESTA CONTA (app id ${ourAppId}, campos: ${fieldsOf(leadgenApps.find((s) => String(s.id) === ourAppId) || {})})${pageTokenNote}`,
      });
    } else if (ourAppHasLeadgen === false && leadgenApps.length > 0) {
      checks.push({
        key: `page_${pageId}`,
        status: 'error',
        details: `Page "${pageName}": a página está inscrita para leads em OUTRO app (id ${leadgenApps.map((s) => s.id || '?').join(', ')}) — o Meta entrega os leads para OUTRO sistema e o webhook do CRM NUNCA recebe nada${pageTokenNote}`,
        fix: `Inscreva a página no app DESTA conta (app id ${ourAppId}): aba Webhook do card → botão do Page ID, ou POST /${pageId}/subscribed_apps?subscribed_fields=leadgen com page token deste app. Remova a inscrição do app antigo se não for mais usada.`,
      });
    } else if (ourAppHasLeadgen === false) {
      checks.push({
        key: `page_${pageId}`,
        status: 'error',
        details: `Page "${pageName}": o app desta conta (id ${ourAppId}) NÃO está inscrito no campo leadgen desta página — leads NÃO chegam via webhook${pageTokenNote}`,
        fix: 'Inscreva a página no campo leadgen: aba Webhook do card (botão do Page ID) ou Page Settings → Webhooks.',
      });
    } else {
      // Sem app id confirmado — mantém a verificação anterior, com ressalva
      const hasLeadgenAny = leadgenApps.length > 0;
      checks.push({
        key: `page_${pageId}`,
        status: hasLeadgenAny ? 'warn' : 'error',
        details: hasLeadgenAny
          ? `Page "${pageName}": webhook de LEADS assinado em algum app (campos: ${fieldsOf(leadgenApps[0])}) — NÃO foi possível confirmar que é o app DESTA conta (sem App ID comprovado salvo e debug_token indisponível para o token salvo); confirme no Meta for Developers → Webhooks que o app inscrito é o mesmo do App Secret salvo${pageTokenNote}`
          : `Page "${pageName}": o app NÃO está inscrito no campo leadgen desta página — leads NÃO chegam via webhook${pageTokenNote}`,
        fix: hasLeadgenAny
          ? undefined
          : 'Inscreva a página no campo leadgen: POST /{page-id}/subscribed_apps?subscribed_fields=leadgen (ou Page Settings → Webhooks).',
      });
    }
  }

  // ── 4. Form IDs: leitura de leads liberada? ──────────────────
  // Falha NÃO fica genérica: cruza com (i) a leitura do PRÓPRIO form
  // (/{form-id}?fields=page — revela a página REAL dona dele, mesmo
  // quando o Page ID do card está errado) e (ii) leads_retrieval do
  // token (probe do 2b) — sem essa permissão, "Unsupported get
  // request … missing permissions" é o sintoma, não um form inexistente.
  const formIds = parseJsonArray(account.formIds).slice(0, 5);
  for (const formId of formIds) {
    const leads = await graphGet(`${formId}/leads?limit=1&fields=id`, account.accessToken);
    if (leads.ok) {
      checks.push({
        key: `form_${formId}`,
        status: 'ok',
        details: `Form ${formId}: leitura de leads OK com o token desta conta`,
      });
      continue;
    }

    const fp = await probeFormPage(formId);
    const perms = await probePermissions();
    const lrMissing = perms ? perms.granted['leads_retrieval'] !== true : null;
    const fpOwned = fp ? parseJsonArray(account.pageIds).includes(fp.pageId) : false;

    const causeParts: string[] = [];
    if (lrMissing === true) {
      causeParts.push('o token NÃO tem leads_retrieval concedida (check "Permissões do token") — sem ela a leitura de leads/formulários fica bloqueada, mesmo com webhook saudável');
    }
    if (fp) {
      causeParts.push(fpOwned
        ? `o formulário em si é legível e pertence à página ${fp.pageId}${fp.pageName ? ` "${fp.pageName}"` : ''} (vinculada nesta conta)`
        : `o formulário pertence à página ${fp.pageId}${fp.pageName ? ` "${fp.pageName}"` : ''}, que NÃO está nos Page IDs desta conta`);
    } else if (lrMissing !== true) {
      causeParts.push('a leitura do PRÓPRIO formulário também falhou — objeto excluído, ID errado ou página inacessível para a identidade do token');
    }
    const details = `Form ${formId}: FALHA ao ler leads — ${leads.error}${causeParts.length ? ` — ${causeParts.join('; ')}` : ''}`;

    let fix: string;
    if (lrMissing === true) {
      fix = 'Gere um novo token concedendo leads_retrieval ("Reconectar com o Facebook" no card, ou marque a permissão na geração do token manual — no Graph API Explorer selecione o app do webhook desta conta) e reexecute o diagnóstico.';
    } else if (fp && !fpOwned) {
      fix = `Vincule a página real do formulário (${fp.pageId}) nos Page IDs desta conta (aba Webhook) ou mova o form ID para a conta correta.`;
    } else if (lrMissing === null) {
      fix = 'Confirme que o formulário existe e pertence a uma página acessível pela identidade do token; /me/permissions é inconclusivo para tokens de página/sistema — valide leads_retrieval no app (Advanced Access/App Review).';
    } else {
      fix = 'Confirme que o formulário pertence a uma página desta conta e que o token tem leads_retrieval.';
    }
    checks.push({ key: `form_${formId}`, status: 'error', details, fix });
  }

  // ── 5. Self-test do webhook (GET + POST assinado) ───────────
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || (host?.startsWith('localhost') ? 'http' : 'https');
  const selfOrigin = process.env.NEXT_PUBLIC_APP_URL || (host ? `${proto}://${host}` : '');

  // 5a. GET — hub.challenge com o verify token DESTA conta
  if (account.verifyToken && account.webhookEnabled !== false && selfOrigin) {
    const challenge = crypto.randomUUID().replace(/-/g, '');
    const selfUrl = `${selfOrigin}/api/webhooks/meta-leads?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(account.verifyToken)}&hub.challenge=${challenge}`;
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
  } else if (!account.verifyToken) {
    checks.push({
      key: 'webhook_selftest',
      status: 'skip',
      details: 'Self-test pulado — conta sem verify token próprio',
    });
  } else if (!selfOrigin) {
    checks.push({
      key: 'webhook_selftest',
      status: 'skip',
      details: 'Self-test pulado — origem do servidor não determinável',
    });
  }

  // 5b. POST ASSINADO — a porta EXCLUSIVA das entregas reais do Meta.
  // O GET acima NÃO passa pela validação HMAC; entregas reais morrem nela
  // quando o App Secret salvo está errado (401 + Leads Perdidos) — erro
  // invisível ao self-test de GET. Envia um payload VÁLIDO assinado com o
  // App Secret DESTA conta, porém SEM leadgen_id: valida a assinatura e o
  // roteamento sem criar lead, sem girar fila e sem disparar cartão.
  if (account.appSecret && account.webhookEnabled !== false && account.enabled !== false && selfOrigin) {
    const probePayload = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: pageIds[0] || 'diagnostic_probe',
          time: Math.floor(Date.now() / 1000),
          changes: [{ field: 'leadgen', value: {} }],
        },
      ],
    });
    const signature =
      'sha256=' + crypto.createHmac('sha256', account.appSecret).update(probePayload, 'utf8').digest('hex');
    try {
      const res = await fetch(`${selfOrigin}/api/webhooks/meta-leads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': signature,
          'User-Agent': 'Meta-Diagnostic-Probe/1.0',
        },
        body: probePayload,
        signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
      });
      const respBody = await res.json().catch(() => null);
      if (res.status === 200) {
        checks.push({
          key: 'webhook_post_selftest',
          status: 'ok',
          details: 'Assinatura HMAC ACEITA com o App Secret DESTA conta (payload de sonda sem leadgen_id — nada processado, sem efeitos no CRM)',
        });
      } else if (res.status === 401) {
        checks.push({
          key: 'webhook_post_selftest',
          status: 'error',
          details: 'CAUSA RAIZ TÍPICA de "polling funciona, webhook não": o webhook REJEITOU a assinatura (HTTP 401) — o App Secret salvo NÃO é o do app que entrega os leads. TODA entrega real do Meta está sendo descartada (veja Leads Perdidos: "Assinatura inválida"). O self-test GET acima continua verde porque não passa pela assinatura.',
          fix: 'Copie o App Secret EXATO do app que tem o webhook configurado (Meta for Developers → Configurações Básicas → App Secret) e salve na aba Webhook desta conta; depois reexecute o diagnóstico.',
        });
      } else {
        checks.push({
          key: 'webhook_post_selftest',
          status: 'warn',
          details: `POST assinado retornou HTTP ${res.status}${respBody?.error ? ` — ${respBody.error}` : ''} (esperado 200)`,
          fix: 'Verifique os logs do servidor ([Meta Webhook]) e se a conta está ativa com webhook próprio habilitado.',
        });
      }
    } catch (err) {
      checks.push({
        key: 'webhook_post_selftest',
        status: 'warn',
        details: `Falha no POST assinado de sonda — ${err instanceof Error ? err.message : err}`,
      });
    }
  } else if (!account.appSecret) {
    checks.push({
      key: 'webhook_post_selftest',
      status: 'skip',
      details: 'POST assinado pulado — conta sem App Secret (SEM ele nenhuma entrega real do Meta é aceita)',
    });
  } else if (account.enabled === false || account.webhookEnabled === false) {
    checks.push({
      key: 'webhook_post_selftest',
      status: 'skip',
      details: 'POST assinado pulado — conta desativada ou com webhook próprio desligado (o webhook ignora esta conta)',
    });
  } else if (!selfOrigin) {
    checks.push({
      key: 'webhook_post_selftest',
      status: 'skip',
      details: 'POST assinado pulado — origem do servidor não determinável',
    });
  }

  // ── 5c. Assinatura do webhook NO NÍVEL DO APP — o último elo ─────
  // A página pode estar inscrita (etapa 3), o CRM pode aceitar verify
  // token (5a) e HMAC (5b) — e ainda assim NADA chega: se o APP não
  // tiver o webhook do objeto Page com campo leadgen (Callback URL +
  // verify token) configurado na Meta, o Meta não tem PARA ONDE
  // entregar: zero entregas, zero leads perdidos, tudo verde — o
  // sintoma exato de "só polling funciona".
  //
  // Consulta GET /{app-id}/subscriptions com app access token montado
  // de app_id (appId comprovado → debug_token) + App Secret salvo — que
  // também CONFIRMA o App Secret REAL contra a Graph API: o self-test
  // 5b assina e verifica com o MESMO secret salvo, portanto é
  // auto-consistente e não prova que o secret é o do app que entrega
  // os leads.
  if (account.appSecret && account.webhookEnabled !== false) {
    const { webhookAppId: ourAppIdForSubs } = await probeAppIds();
    let fetchOutcome: AppSubscriptionFetchOutcome;
    if (!ourAppIdForSubs) {
      fetchOutcome = { kind: 'no_app_id' };
    } else {
      const appToken = buildAppAccessToken(ourAppIdForSubs, account.appSecret);
      const subs = await graphGet(`${ourAppIdForSubs}/subscriptions`, appToken);
      if (subs.ok) {
        fetchOutcome = {
          kind: 'ok',
          subscriptions: Array.isArray(subs.data?.data) ? subs.data.data : [],
        };
      } else if (subs.status === undefined) {
        // graphGet não retorna status quando o fetch falha (rede/timeout)
        fetchOutcome = { kind: 'network_error', error: subs.error || 'erro desconhecido' };
      } else {
        fetchOutcome = {
          kind: 'graph_error',
          status: subs.status,
          code: typeof subs.data?.error?.code === 'number' ? subs.data.error.code : null,
          message: subs.error || `HTTP ${subs.status}`,
        };
      }
    }
    const appCheck = evaluateAppSubscription({
      appId: ourAppIdForSubs,
      appSecret: account.appSecret,
      expectedWebhookUrl: selfOrigin ? `${selfOrigin}/api/webhooks/meta-leads` : '',
      fetchOutcome,
    });
    checks.push({ key: 'app_webhook_subscription', ...appCheck });
  } else if (!account.appSecret) {
    checks.push({
      key: 'app_webhook_subscription',
      status: 'skip',
      details: 'Assinatura do app não verificada — conta sem App Secret (sem ele o CRM não consulta as assinaturas do app nem valida entregas)',
    });
  } else {
    checks.push({
      key: 'app_webhook_subscription',
      status: 'skip',
      details: 'Assinatura do app não verificada — conta com webhook próprio desligado (o CRM ignora as entregas desta conta)',
    });
  }

  // ── 6. Leads perdidos PELO webhook nos últimos 30 dias (causa raiz) ──
  // Cada fonte aponta o elo exato da cadeia que está falhando. Sem isso,
  // falhas reais (ex.: assinatura rejeitada) ficavam invisíveis ao
  // diagnóstico e o webhook parecia "saudável e mudo".
  try {
    let lostRows: Array<{ source: string; _count: { _all: number } }> = [];
    try {
      const grouped = await db.lostLead.groupBy({
        by: ['source'],
        where: { source: { startsWith: 'meta_webhook_' }, createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
        _count: { _all: true },
      });
      lostRows = grouped as Array<{ source: string; _count: { _all: number } }>;
    } catch {
      lostRows = [];
    }
    const bySource = new Map(lostRows.map((r) => [r.source, r._count?._all ?? 0]));
    if (bySource.size === 0) {
      checks.push({
        key: 'webhook_lost_leads',
        status: 'ok',
        details: 'Nenhum lead perdido pelo webhook nos últimos 30 dias (assinatura, página não vinculada, conta sem token)',
      });
    } else {
      const total = [...bySource.values()].reduce((a, b) => a + b, 0);
      const explanations: Record<string, { status: 'error'; details: string; fix: string }> = {
        meta_webhook_invalid_signature: {
          status: 'error',
          details: `O webhook RECEBEU ${bySource.get('meta_webhook_invalid_signature')} entrega(s) do Meta e REJEITOU a assinatura — o App Secret salvo não é o do app que entrega os leads. Os leads estão em Leads Perdidos (recupere via Importação Manual).`,
          fix: 'Corrija o App Secret na aba Webhook desta conta com o valor EXATO do app que tem o webhook configurado (Meta for Developers → Configurações Básicas).',
        },
        meta_webhook_unmapped_page: {
          status: 'error',
          details: `O webhook recebeu ${bySource.get('meta_webhook_unmapped_page')} lead(s) de página(s) NÃO vinculada(s) a esta conta — os Page IDs salvos não incluem a página que entrega os leads. Recupere via Leads Perdidos → Importação Manual.`,
          fix: 'Adicione o page id correto nos Page IDs da conta (aba Webhook) — o id real aparece no registro de cada lead perdido.',
        },
        meta_webhook_no_account_token: {
          status: 'error',
          details: `O webhook recebeu ${bySource.get('meta_webhook_no_account_token')} entrega(s) sem field_data e a conta estava SEM access token para buscar os dados na Graph API.`,
          fix: 'Salve um access token válido na conta (de preferência page token — o diagnóstico o extrai automaticamente).',
        },
        meta_webhook_no_accounts: {
          status: 'error',
          details: `${bySource.get('meta_webhook_no_accounts')} entrega(s) chegaram quando NENHUMA conta estava com webhook ativo — foram salvas para recuperação manual.`,
          fix: 'Ative a conta e o webhook próprio dela; recupere os leads via Importação Manual.',
        },
      };
      const known = [...bySource.entries()].filter(([source]) => explanations[source]);
      const unknownSources = [...bySource.keys()].filter((source) => !explanations[source]);
      const summary = [
        ...known.map(([source, n]) => `${explanations[source].details.split('.')[0]} (${n})`),
        ...unknownSources.map((source) => `${source}: ${bySource.get(source)} registro(s)`),
      ].join(' · ');
      checks.push({
        key: 'webhook_lost_leads',
        status: 'error',
        details: `Webhook recebeu e DESCARTOU ${total} lead(s) nos últimos 30 dias — ${summary}. Todos estão em Anúncios Meta > Leads Perdidos.`,
        fix: known.length > 0 ? known.map(([source]) => explanations[source].fix).join(' ') : 'Analise os registros em Leads Perdidos para identificar a fonte exata.',
      });
    }
  } catch {
    // Falha ao agregar leads perdidos não deve derrubar o diagnóstico
  }

  // ── 7. Estatísticas da conta (agrupamento por conta) ─────────
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
