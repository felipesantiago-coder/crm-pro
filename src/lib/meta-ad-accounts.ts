import { db } from '@/lib/db';

// ============================================================
// Meta Ad Accounts — Multi-conta Meta Ads (captação multi-token)
// ============================================================
// A conta de anúncios (MetaAdAccount) é a ÚNICA fonte de configuração
// de conexão com o Meta: cada uma tem o próprio access token (System
// User/Page), verify token e app secret do webhook, page_ids e
// form_ids. NÃO existe mais webhook/polling global — todo lead entra
// resolvido por uma conta:
//
//   Webhook  → entry[].id (page id) resolve a conta → token da conta
//              é usado para buscar field_data do lead; o verify token
//              e o app secret aceitos são SEMPRE os das contas.
//              Página sem conta vinculada → lead salvo em LostLeads.
//   Polling  → cada conta é consultada com o PRÓPRIO token (forms da
//              conta via formIds). Não há polling global.
//   Routing  → resolveQueueForMetaLead aceita campaignId + adAccountId
//              (prioridade: campanha > formulário > conta > config > default).
//
// Degradacão graciosa: falhas de schema (migration pendente) retornam
// [] com log — o webhook salva os leads como perdidos em vez de
// quebrar (nenhum lead é perdido silenciosamente).
// ============================================================

/** Shape mínimo usado nas resoluções (independe do Prisma Client). */
export interface AdAccountRef {
  id: string;
  name: string;
  adAccountId: string;
  accessToken: string;
  verifyToken?: string | null;
  appSecret?: string | null;
  pageIds?: string | null;
  formIds?: string | null;
  /** JSON map pageId → page access token (extraído automaticamente do
   *  token da conta pelo diagnóstico — via GET /{page-id} ou /me/accounts).
   *  Page tokens derivados de token de longa duração NÃO expiram; são
   *  usados preferencialmente nas operações page-scoped. */
  pageTokens?: string | null;
  queueId?: string | null;
  /** Toggle de webhook DESTA conta (settings por conta). */
  webhookEnabled?: boolean;
  /** Toggle de polling DESTA conta (settings por conta). */
  pollingEnabled?: boolean;
}

/**
 * Canal de captação usado para filtrar as contas pelos toggles
 * PRÓPRIOS de cada conta (settings agrupadas por conta):
 *   all     → todas as contas habilitadas (enabled)
 *   webhook → somente contas com webhookEnabled !== false
 *   polling → somente contas com pollingEnabled !== false
 */
export type AdAccountChannel = 'all' | 'webhook' | 'polling';

/**
 * Filtra as contas pelo canal de captação usando os toggles próprios
 * de cada conta. undefined/null conta como ligado (compatibilidade
 * com registros criados antes da migration). */
export function filterAccountsByChannel<T extends AdAccountRef>(
  accounts: T[],
  channel: AdAccountChannel,
): T[] {
  if (channel === 'webhook') return accounts.filter((a) => a.webhookEnabled !== false);
  if (channel === 'polling') return accounts.filter((a) => a.pollingEnabled !== false);
  return accounts;
}

/** Parse defensivo de JSON array de IDs (retorna [] em qualquer falha). */
export function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => String(v)).filter((v) => v.length > 0);
  } catch {
    return [];
  }
}

/** Parse defensivo do JSON map pageId → page access token. */
export function parsePageTokens(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const map: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (key && typeof value === 'string' && value.length > 0) map[key] = value;
    }
    return map;
  } catch {
    return {};
  }
}

/**
 * Mescla tokens de página novos no map existente da conta (JSON).
 * Tokens novos sobrescrevem os antigos para a MESMA página; as demais
 * páginas preservam seus tokens.
 */
export function mergePageTokens(
  existing: string | null | undefined,
  additions: Record<string, string>,
): string {
  return JSON.stringify({ ...parsePageTokens(existing), ...additions });
}

/**
 * Normaliza o ID de conta de anúncios: remove espaços e garante o
 * prefixo "act_" (formato aceito pela Graph API).
 *   "123456" → "act_123456"; "act_123456" → "act_123456"
 */
export function normalizeAdAccountId(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  return trimmed.startsWith('act_') ? trimmed : `act_${trimmed}`;
}

/**
 * Resolve a conta de anúncios dona de uma page_id do Facebook.
 * O webhook envia entry[].id = page id — usamos o pageIds JSON de
 * cada conta para descobrir de qual conta/page o lead veio.
 */
export function resolveAccountByPageId<T extends AdAccountRef>(
  accounts: T[],
  pageId: string | null | undefined,
): T | null {
  if (!pageId) return null;
  const wanted = String(pageId);
  for (const account of accounts) {
    const pages = parseJsonArray(account.pageIds);
    if (pages.includes(wanted)) return account;
  }
  return null;
}

/**
 * Candidatos de App Secret para validar a assinatura HMAC do webhook:
 * EXCLUSIVAMENTE os secrets das contas habilitadas com webhook PRÓPRIO
 * ativo (não existe mais secret global). Sem duplicatas.
 */
export function buildWebhookSecretCandidates(
  accounts: Array<{ appSecret?: string | null; enabled?: boolean; webhookEnabled?: boolean }>,
): string[] {
  const candidates: string[] = [];
  const push = (secret?: string | null) => {
    if (secret && !candidates.includes(secret)) candidates.push(secret);
  };
  for (const account of accounts) {
    if (account.enabled === false) continue;
    if (account.webhookEnabled === false) continue; // webhook da conta desligado
    push(account.appSecret);
  }
  return candidates;
}

/**
 * Encontra a conta cujo verify token dedicado corresponde ao token
 * recebido na verificação do webhook (hub.verify_token). Só contas
 * com webhook próprio ativo participam — não existe verify token
 * global.
 */
export function resolveAccountByVerifyToken<T extends AdAccountRef>(
  accounts: T[],
  token: string | null | undefined,
): T | null {
  if (!token) return null;
  return accounts.find((a) => a.verifyToken && a.verifyToken === token) || null;
}

/**
 * Token a usar para buscar dados do lead (field_data) e demais
 * operações page-scoped: EXCLUSIVAMENTE a conta resolvida — não há
 * mais token global de fallback. Dentro da conta, quando o pageId é
 * conhecido (webhook: entry[].id), o PAGE TOKEN salvo para aquela
 * página tem prioridade sobre o token bruto da conta: page tokens
 * extraídos via /me/accounts não expiram junto com o user token.
 */
export function resolvePageToken(
  account: (Pick<AdAccountRef, 'accessToken'> & { pageTokens?: string | null }) | null | undefined,
  pageId?: string | null,
): string | null {
  if (!account) return null;
  if (pageId) {
    const perPage = parsePageTokens(account.pageTokens)[String(pageId)];
    if (perPage) return perPage;
  }
  return account.accessToken || null;
}

// ============================================================
// Extração automática de PAGE ACCESS TOKEN (por conta)
// ============================================================
// Comportamento restaurado do antigo diagnóstico global: tokens de
// USUÁRIO expiram (~60 dias) e podem falhar em GET /{page-id} direto
// ("Unsupported get request") mesmo lendo leads com sucesso; o page
// token derivado do user token (via /me/accounts) não expira quando
// derivado de token de longa duração e habilita operações page-scoped.

export type DerivePageTokenResult =
  | { ok: true; pageId: string; pageName: string | null; pageToken: string; via: 'direct' | 'me_accounts' }
  | { ok: false; pageId: string; reason: 'no_token_in_response' | 'me_accounts_error' | 'page_not_listed'; error?: string };

/**
 * Extrai o PAGE ACCESS TOKEN de uma página a partir do token da conta.
 *
 * Estratégia:
 *   1. GET /{page-id}?fields=name,access_token direto (funciona para
 *      System User/page tokens e user tokens com pages_show_list).
 *   2. Fallback: GET /me/accounts?fields=id,name,access_token com o
 *      token de usuário — se a página aparecer na lista, extrai o page
 *      token dela (mesmo que o GET direto tenha falhado). Percorre até
 *      3 rodadas de paginação.
 */
export async function derivePageTokenForPage(
  accessToken: string,
  pageId: string,
  timeoutMs = 8_000,
): Promise<DerivePageTokenResult> {
  const call = async (url: string): Promise<{ ok: boolean; data: any }> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, data };
    } catch {
      return { ok: false, data: null };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  // 1. Tentativa direta na página
  const direct = await call(
    `${GRAPH_API_BASE}/${pageId}?fields=name,access_token&access_token=${encodeURIComponent(accessToken)}`,
  );
  const directToken = direct.ok ? direct.data?.access_token : undefined;
  if (direct.ok && typeof directToken === 'string' && directToken.length > 0) {
    return {
      ok: true,
      pageId,
      pageName: typeof direct.data?.name === 'string' ? direct.data.name : null,
      pageToken: directToken,
      via: 'direct',
    };
  }

  // 2. Fallback /me/accounts (token de USUÁRIO — varre as páginas dele)
  let url = `${GRAPH_API_BASE}/me/accounts?fields=id,name,access_token&limit=100&access_token=${encodeURIComponent(accessToken)}`;
  let meAccountsFailed = false;
  let meAccountsError: string | undefined;
  for (let round = 0; round < 3 && url; round++) {
    const res = await call(url);
    if (!res.ok) {
      meAccountsFailed = true;
      meAccountsError = res.data?.error?.message || 'HTTP error em /me/accounts';
      break;
    }
    const pages: Array<{ id?: string; name?: string; access_token?: string }> = Array.isArray(res.data?.data)
      ? res.data.data
      : [];
    const found = pages.find(
      (p) => p.id === pageId && typeof p.access_token === 'string' && p.access_token.length > 0,
    );
    if (found) {
      return {
        ok: true,
        pageId,
        pageName: typeof found.name === 'string' ? found.name : null,
        pageToken: found.access_token as string,
        via: 'me_accounts',
      };
    }
    url = typeof res.data?.paging?.next === 'string' ? res.data.paging.next : '';
  }

  if (meAccountsFailed) {
    return { ok: false, pageId, reason: 'me_accounts_error', error: meAccountsError };
  }
  if (!direct.ok) {
    // GET direto falhou E a página não veio no /me/accounts →
    // sem permissão de página no token (ou ID errado).
    return { ok: false, pageId, reason: 'page_not_listed', error: direct.data?.error?.message };
  }
  // GET direto ok sem access_token e página não listada no /me/accounts
  return { ok: false, pageId, reason: 'no_token_in_response' };
}

// ============================================================
// Diagnóstico de conexão POR CONTA (puro — sem rede, sem banco)
// ============================================================

export interface AccountConfigCheck {
  key: string;
  label: string;
  ok: boolean;
  /** Obrigatório para o canal funcionar (vs recomendado). */
  required: boolean;
  hint: string;
}

export interface AccountConnectionEvaluation {
  hasToken: boolean;
  hasVerifyToken: boolean;
  hasAppSecret: boolean;
  pageCount: number;
  formCount: number;
  webhookEnabled: boolean;
  pollingEnabled: boolean;
  /** Webhook pronto: token + verify + secret + pages + canal ativo. */
  webhookReady: boolean;
  /** Polling pronto: token + forms + canal ativo. */
  pollingReady: boolean;
  checks: AccountConfigCheck[];
}

/**
 * Avalia a completude das configurações de conexão de UMA conta
 * (checklist usado no diagnóstico por conta da UI). Como não existe
 * mais webhook/polling global, verify token e pages passam a ser
 * OBRIGATÓRIOS para o webhook da conta, e formIds para o polling.
 */
export function evaluateAccountConnection<T extends AdAccountRef>(
  account: T,
): AccountConnectionEvaluation {
  const hasToken = !!account.accessToken;
  const hasVerifyToken = !!account.verifyToken;
  const hasAppSecret = !!account.appSecret;
  const pageCount = parseJsonArray(account.pageIds).length;
  const formCount = parseJsonArray(account.formIds).length;
  const webhookEnabled = account.webhookEnabled !== false;
  const pollingEnabled = account.pollingEnabled !== false;

  const checks: AccountConfigCheck[] = [
    {
      key: 'token',
      label: 'Access token da conta',
      ok: hasToken,
      required: true,
      hint: 'Token (System User/Page) usado para buscar leads e consultar a Graph API desta conta.',
    },
    {
      key: 'verifyToken',
      label: 'Verify token do webhook',
      ok: hasVerifyToken,
      required: true,
      hint: 'Obrigatório — usado na verificação (hub.challenge) do webhook desta conta no Meta for Developers.',
    },
    {
      key: 'appSecret',
      label: 'App secret do webhook',
      ok: hasAppSecret,
      required: true,
      hint: 'Obrigatório — valida a assinatura HMAC (X-Hub-Signature-256) dos payloads desta conta.',
    },
    {
      key: 'pageIds',
      label: 'Page IDs vinculadas',
      ok: pageCount > 0,
      required: true,
      hint: 'Obrigatório — o webhook usa entry[].id (page id) para resolver a conta de origem do lead.',
    },
    {
      key: 'webhookEnabled',
      label: 'Canal webhook ativo',
      ok: webhookEnabled,
      required: true,
      hint: 'Toggle do webhook desta conta (as demais contas não são afetadas).',
    },
    {
      key: 'formIds',
      label: 'Form IDs para polling',
      ok: formCount > 0,
      required: false,
      hint: 'Necessário apenas para o polling desta conta (Sync Forms preenche automaticamente).',
    },
    {
      key: 'pollingEnabled',
      label: 'Canal polling ativo',
      ok: pollingEnabled,
      required: false,
      hint: 'Toggle do polling desta conta (as demais contas não são afetadas).',
    },
  ];

  return {
    hasToken,
    hasVerifyToken,
    hasAppSecret,
    pageCount,
    formCount,
    webhookEnabled,
    pollingEnabled,
    webhookReady: hasToken && hasVerifyToken && hasAppSecret && pageCount > 0 && webhookEnabled,
    pollingReady: hasToken && formCount > 0 && pollingEnabled,
    checks,
  };
}

// ============================================================
// Helper de rede — busca de field_data por leadgen id (multi-conta)
// ============================================================

const GRAPH_API_BASE = 'https://graph.facebook.com/v22.0';

/**
 * Busca o field_data de um lead via Graph API com um token específico.
 * Retorna null em qualquer falha (HTTP, timeout, resposta sem field_data).
 */
export async function fetchLeadDataForLeadgen(
  leadgenId: string,
  token: string,
  timeoutMs = 8_000,
): Promise<Array<{ name: string; values: string[] }> | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${GRAPH_API_BASE}/${leadgenId}?access_token=${encodeURIComponent(token)}&fields=field_data`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error(`[Meta Ad Accounts] fetchLeadData(${leadgenId}) HTTP ${response.status}: ${errorText.slice(0, 200)}`);
      return null;
    }
    const data = await response.json();
    const fieldData = data?.field_data;
    if (!fieldData || !Array.isArray(fieldData)) return null;
    return fieldData as Array<{ name: string; values: string[] }>;
  } catch (error) {
    console.error(`[Meta Ad Accounts] Falha ao buscar lead ${leadgenId}:`, error);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Busca o field_data de um lead tentando os tokens das CONTAS: usa o
 * token da conta preferida (quando informada) e, em caso de falha ou
 * ausência, percorre as demais contas habilitadas até obter sucesso.
 * Substitui o antigo token global das ferramentas de importação.
 */
export async function fetchLeadDataViaAccounts(
  leadgenId: string,
  accounts: Array<{ id: string; name: string; accessToken: string; enabled?: boolean }>,
  preferredAccountId?: string | null,
): Promise<{ fieldData: Array<{ name: string; values: string[] }> | null; accountId: string | null }> {
  const usable = accounts.filter((a) => a.accessToken && a.enabled !== false);
  const ordered = [
    ...usable.filter((a) => a.id === preferredAccountId),
    ...usable.filter((a) => a.id !== preferredAccountId),
  ];
  for (const account of ordered) {
    const fieldData = await fetchLeadDataForLeadgen(leadgenId, account.accessToken);
    if (fieldData) return { fieldData, accountId: account.id };
  }
  return { fieldData: null, accountId: null };
}

// ============================================================
// Helpers de banco (sempre com degradação graciosa)
// ============================================================

/**
 * Lista as contas de anúncios habilitadas para a captação, filtradas
 * pelo canal (toggles webhookEnabled/pollingEnabled próprios de cada
 * conta — settings agrupadas por conta).
 *
 * Degradação graciosa: se a migration dos toggles ainda não rodou,
 * repete a consulta sem as colunas novas (todas tratadas como ativas);
 * retorna [] se a tabela/entidade nem existir.
 */
export async function fetchEnabledAdAccounts(
  channel: AdAccountChannel = 'all',
): Promise<AdAccountRef[]> {
  const baseSelect = {
    id: true,
    name: true,
    adAccountId: true,
    accessToken: true,
    verifyToken: true,
    appSecret: true,
    pageIds: true,
    formIds: true,
    queueId: true,
  } as const;
  try {
    try {
      const accounts = await db.metaAdAccount.findMany({
        where: { enabled: true },
        select: { ...baseSelect, pageTokens: true, webhookEnabled: true, pollingEnabled: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });
      return filterAccountsByChannel(accounts, channel);
    } catch {
      // Migration pendente: colunas novas (pageTokens/webhookEnabled/
      // pollingEnabled) ausentes — cai para o select legado (toggles
      // tratados como ligados e sem page tokens salvos).
      const accounts = await db.metaAdAccount.findMany({
        where: { enabled: true },
        select: baseSelect,
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });
      return filterAccountsByChannel(accounts, channel);
    }
  } catch (err) {
    console.warn('[Meta Ad Accounts] Falha ao listar contas (migration pendente?):', err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Resolve a conta de anúncios por page_id direto no banco (webhook).
 * Considera somente contas com o webhook PRÓPRIO ativo (canal webhook)
 * — não existe mais resolução por configuração global.
 */
export async function resolveAdAccountForPage(
  pageId: string | null | undefined,
): Promise<AdAccountRef | null> {
  if (!pageId) return null;
  try {
    const accounts = await fetchEnabledAdAccounts('webhook');
    return resolveAccountByPageId(accounts, pageId);
  } catch (err) {
    console.warn('[Meta Ad Accounts] Falha ao resolver conta por page:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Auto-registro (fire-and-forget) do vínculo campanha → conta/fila.
 * Chamado pelo webhook e polling a cada lead com campaign_id.
 *
 * Regras:
 *   - Cria a binding com campaignName + adAccountId (quando conhecido).
 *   - Em updates, NUNCA sobrescreve a conta nem a fila já definidas
 *     (a fila é escolha do admin; a conta aprendida uma vez é estável).
 *   - Incrementa leadCount (observabilidade na UI).
 */
export function upsertCampaignBindingAuto(input: {
  campaignId: string;
  campaignName?: string | null;
  adAccountId?: string | null;
}): void {
  const { campaignId, campaignName, adAccountId } = input;
  if (!campaignId) return;
  // Fire-and-forget: falhas não podem interromper o processamento do lead.
  db.metaCampaignBinding
    .upsert({
      where: { campaignId },
      create: {
        campaignId,
        campaignName: campaignName || null,
        adAccountId: adAccountId || null,
        leadCount: 1,
      },
      update: {
        leadCount: { increment: 1 },
        campaignName: campaignName || undefined,
      },
    })
    .catch((err: unknown) => {
      console.warn(
        `[Meta Ad Accounts] Falha ao upsert campaign binding ${campaignId} (migration pendente?):`,
        err instanceof Error ? err.message : err,
      );
    });
}
