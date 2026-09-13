// ============================================================
// TRAFFIC INSIGHTS — gestor de tráfego, estágio A (Fase 8)
// ============================================================
// Espelho diário de CUSTO e PERFORMANCE da Marketing API da Meta,
// cruzado com o resultado real dos leads no CRM, para:
//   1. painel administrativo (CPL/CPA por campanha e conjunto);
//   2. relatório markdown SEM PII para análise por IA externa.
//
// Decisões de desenho (docs/traffic-manager.md):
//   - PURAMENTE ADITIVO: nenhuma rota/tabela existente é alterada.
//     Sem as tabelas (SQL pendente), as rotas degradam com WARN
//     (isPrismaMissingTableError → status 'unavailable').
//   - Fonte de custo: GET /{act_id}/insights (level campaign e adset,
//     time_increment=1). Token por conta de MetaAdAccount — o MESMO
//     padrão do polling de leads (ads_read necessário no token).
//   - Snapshot-REPLACE por janela: a Meta retrocorrige atribuição,
//     então re-sincronizar SOBRESCREVE os dias da janela (deleteMany
//     + createMany em transação). A UNIQUE composta é rede de segurança.
//   - leadsMeta = MAX entre os action_types de lead reportados pela
//     Meta ('lead' e 'onsite_conversion.lead_grouped') — NUNCA soma,
//     para não duplicar métricas sobrepostas.
//   - Atribuição de resultado: estruturada por campaignId (meta_lead_
//     inbox) com dedupe; legada por regex do notes ([Meta Ads] →
//     Campanha:) apenas para leads SEM leadgen estruturado.
//   - Relatório: 100% agregado (nomes de campanha/conjunto + números).
//     Nenhum nome/telefone/e-mail de cliente entra no snapshot — o
//     select da leitura não os carrega e o builder não os recebe.
//   - DI estrutural: rotas montam deps reais (traffic-defaults.ts);
//     testes injetam fakes direto (padrão meta-ingest).
// ============================================================

// ── Tipos base ──────────────────────────────────────────────────

export type InsightLevel = 'campaign' | 'adset';

/** Linha de insight normalizada (1 por conta+nível+entidade+dia). */
export interface TrafficInsightRow {
  adAccountId: string;
  level: InsightLevel;
  entityId: string;
  entityName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  /** 00:00 UTC do YYYY-MM-DD reportado pela conta. */
  date: Date;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  leadsMeta: number;
  cpm: number;
  cpc: number;
  ctr: number;
}

/** Janela de sincronização/relatório em dias UTC. */
export interface InsightWindow {
  days: number;
  /** Início da janela — 00:00 UTC do primeiro dia. */
  since: Date;
  until: Date;
  sinceStr: string;
  untilStr: string;
}

/** Conta mínima necessária para sincronizar insights. */
export interface AccountRefForSync {
  /** ID do registro MetaAdAccount (para marcar saúde de auth). */
  id: string;
  name: string;
  /** act_… normalizado. */
  adAccountId: string;
  accessToken: string;
}

// ── Utilitários puros ───────────────────────────────────────────

/** Trunca mensagem de erro para armazenamento/relatório. */
export function truncateError(msg: string, max = 300): string {
  const clean = (msg || '').replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/** Formata valor monetário em BRL sem depender de Intl (testável). */
export function fmtBRL(value: number): string {
  const fixed = Math.abs(value).toFixed(2);
  const [int, dec] = fixed.split('.');
  const withSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${value < 0 ? '-' : ''}R$ ${withSep},${dec}`;
}

/** Percentual inteiro (0–100) ou null quando não calculável. */
export function fmtPct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** YYYY-MM-DD em UTC. */
export function utcDateStr(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** Date em 00:00 UTC a partir de 'YYYY-MM-DD' (inválido → null). */
export function dateAtUtc(dateStr: string | null | undefined): Date | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Janela de N dias terminando HOJE (UTC): since = hoje-(N-1). */
export function computeInsightWindow(days: number, now: Date): InsightWindow {
  const safeDays = Math.max(1, Math.floor(days));
  const until = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const sinceMs = until - (safeDays - 1) * 86_400_000;
  const since = new Date(sinceMs);
  const untilDate = new Date(until);
  return {
    days: safeDays,
    since,
    until: untilDate,
    sinceStr: utcDateStr(since),
    untilStr: utcDateStr(untilDate),
  };
}

/**
 * Erro de autenticação/quotas da Graph API — carrega o `code` da Meta
 * para marcar a saúde do token da conta (190=expirado, 200/10=permissão).
 */
export class GraphApiError extends Error {
  readonly status: number;
  readonly code: number | null;
  constructor(message: string, status: number, code: number | null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Função de fetch injetável (testes usam fake; produção usa global). */
export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; text: string }>;

export const defaultFetchLike: FetchLike = async (url) => {
  const res = await fetch(url);
  return { ok: res.ok, status: res.status, text: await res.text() };
};

function graphErrorFromResponse(res: { status: number; text: string }): GraphApiError {
  try {
    const parsed = JSON.parse(res.text) as { error?: { message?: string; code?: number } };
    const message = parsed?.error?.message || `Graph API HTTP ${res.status}`;
    return new GraphApiError(message, res.status, typeof parsed?.error?.code === 'number' ? parsed.error.code : null);
  } catch {
    return new GraphApiError(truncateError(res.text) || `Graph API HTTP ${res.status}`, res.status, null);
  }
}

// ── Parser da resposta de insights ─────────────────────────────

const LEAD_ACTION_TYPES = ['lead', 'onsite_conversion.lead_grouped'] as const;

function toNum(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toInt(value: unknown): number {
  return Math.round(toNum(value));
}

/** leadsMeta = MAX dos action_types de lead (nunca soma — evita duplicar). */
function leadsFromActions(actions: unknown): number {
  if (!Array.isArray(actions)) return 0;
  let max = 0;
  for (const action of actions) {
    if (!action || typeof action !== 'object') continue;
    const rec = action as { action_type?: unknown; value?: unknown };
    if (typeof rec.action_type !== 'string') continue;
    if (!(LEAD_ACTION_TYPES as readonly string[]).includes(rec.action_type)) continue;
    max = Math.max(max, toInt(rec.value));
  }
  return max;
}

/**
 * Mapeia os items `data` de uma resposta /insights (já paginada) para
 * linhas normalizadas. Linhas sem entityId ou com data inválida são
 * ignoradas (a Meta nunca deveria enviá-las; defesa defensiva).
 */
export function mapInsightItems(
  items: unknown[],
  level: InsightLevel,
  adAccountId: string,
): TrafficInsightRow[] {
  const rows: TrafficInsightRow[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const entityId = level === 'campaign'
      ? (typeof rec.campaign_id === 'string' ? rec.campaign_id : '')
      : (typeof rec.adset_id === 'string' ? rec.adset_id : '');
    if (!entityId) continue;
    const date = dateAtUtc(typeof rec.date_start === 'string' ? rec.date_start : null);
    if (!date) continue;
    const entityName = level === 'campaign'
      ? (typeof rec.campaign_name === 'string' && rec.campaign_name ? rec.campaign_name : null)
      : (typeof rec.adset_name === 'string' && rec.adset_name ? rec.adset_name : null);
    rows.push({
      adAccountId,
      level,
      entityId,
      entityName,
      campaignId: level === 'campaign'
        ? entityId
        : (typeof rec.campaign_id === 'string' && rec.campaign_id ? rec.campaign_id : null),
      campaignName: level === 'adset' && typeof rec.campaign_name === 'string' && rec.campaign_name
        ? rec.campaign_name
        : entityName,
      date,
      spend: toNum(rec.spend),
      impressions: toInt(rec.impressions),
      clicks: toInt(rec.clicks),
      reach: toInt(rec.reach),
      leadsMeta: leadsFromActions(rec.actions),
      cpm: toNum(rec.cpm),
      cpc: toNum(rec.cpc),
      ctr: toNum(rec.ctr),
    });
  }
  return rows;
}

// ── Fetch da Marketing API ─────────────────────────────────────

const GRAPH_VERSION = 'v26.0';
const PAGE_LIMIT = 500;
const MAX_PAGES = 10;

export function buildInsightsUrl(
  account: { adAccountId: string; accessToken: string },
  level: InsightLevel,
  window: InsightWindow,
): string {
  const fields = level === 'campaign'
    ? 'spend,impressions,clicks,reach,actions,cpm,cpc,ctr,campaign_name'
    : 'spend,impressions,clicks,reach,actions,cpm,cpc,ctr,adset_id,adset_name,campaign_id,campaign_name';
  const params = new URLSearchParams({
    level,
    fields,
    time_increment: '1',
    time_range: JSON.stringify({ since: window.sinceStr, until: window.untilStr }),
    limit: String(PAGE_LIMIT),
    access_token: account.accessToken,
  });
  return `https://graph.facebook.com/${GRAPH_VERSION}/${account.adAccountId}/insights?${params.toString()}`;
}

/** Segue paging.next até esgotar (teto MAX_PAGES — defesa contra loop). */
export async function fetchAllInsightPages(fetchFn: FetchLike, url: string): Promise<unknown[]> {
  const items: unknown[] = [];
  let next: string | null = url;
  for (let page = 0; page < MAX_PAGES && next; page++) {
    const res = await fetchFn(next);
    if (!res.ok) throw graphErrorFromResponse(res);
    let json: { data?: unknown; paging?: { next?: unknown } };
    try {
      json = JSON.parse(res.text) as { data?: unknown; paging?: { next?: unknown } };
    } catch {
      throw new GraphApiError('Resposta não-JSON da Graph API', res.status, null);
    }
    if (Array.isArray(json.data)) items.push(...json.data);
    next = typeof json.paging?.next === 'string' ? json.paging.next : null;
  }
  return items;
}

export interface AccountInsights {
  campaignRows: TrafficInsightRow[];
  adsetRows: TrafficInsightRow[];
}

/** Busca os DOIS níveis de insights de uma conta (2 requisições + paging). */
export async function fetchAccountInsights(
  fetchFn: FetchLike,
  account: AccountRefForSync,
  window: InsightWindow,
): Promise<AccountInsights> {
  const campaignItems = await fetchAllInsightPages(fetchFn, buildInsightsUrl(account, 'campaign', window));
  const adsetItems = await fetchAllInsightPages(fetchFn, buildInsightsUrl(account, 'adset', window));
  return {
    campaignRows: mapInsightItems(campaignItems, 'campaign', account.adAccountId),
    adsetRows: mapInsightItems(adsetItems, 'adset', account.adAccountId),
  };
}

// ── Sincronização (snapshot-replace por conta) ──────────────────

export interface TrafficSyncDeps {
  listAccounts(): Promise<AccountRefForSync[]>;
  fetchFn: FetchLike;
  /** Snapshot-replace: em transação, apaga linhas da janela (date >=
   *  since) da (conta, level) e insere as novas. */
  replaceWindowRows(
    adAccountId: string,
    level: InsightLevel,
    since: Date,
    rows: TrafficInsightRow[],
  ): Promise<void>;
  upsertSyncState(
    adAccountId: string,
    patch: {
      lastStatus: 'ok' | 'partial' | 'error';
      lastWindowDays: number;
      lastError: string | null;
      lastSyncedAt: Date;
    },
  ): Promise<void>;
  /** Marca saúde de auth da conta em erro 190/200/10 — best-effort. */
  markAccountAuthError?(accountRecordId: string, lastError: string, code: number | null): Promise<void>;
  now(): Date;
}

export interface TrafficAccountSyncResult {
  adAccountId: string;
  name: string;
  status: 'ok' | 'partial' | 'error';
  campaignRows: number;
  adsetRows: number;
  error?: string;
}

export interface TrafficSyncSummary {
  status: 'ok' | 'partial' | 'error' | 'no_accounts';
  days: number;
  accounts: TrafficAccountSyncResult[];
}

function isAuthErrorCode(code: number | null): boolean {
  return code === 190 || code === 200 || code === 10;
}

/**
 * Sincroniza insights de TODAS as contas habilitadas, uma a uma.
 * Falha de UMA conta não interrompe as demais; o resultado por conta
 * vai no summary e no estado de sync (painel). Nenhuma exceção sobe
 * para o chamador depois do listAccounts — o retorno é sempre um
 * resumo completo.
 */
export async function syncTrafficInsights(
  deps: TrafficSyncDeps,
  opts: { days: number },
): Promise<TrafficSyncSummary> {
  const window = computeInsightWindow(opts.days, deps.now());
  const accounts = await deps.listAccounts();
  if (accounts.length === 0) {
    return { status: 'no_accounts', days: window.days, accounts: [] };
  }

  const results: TrafficAccountSyncResult[] = [];
  for (const account of accounts) {
    const errors: string[] = [];
    let campaignRows = 0;
    let adsetRows = 0;

    // Nível campanha
    try {
      const items = await fetchAllInsightPages(deps.fetchFn, buildInsightsUrl(account, 'campaign', window));
      const rows = mapInsightItems(items, 'campaign', account.adAccountId);
      await deps.replaceWindowRows(account.adAccountId, 'campaign', window.since, rows);
      campaignRows = rows.length;
    } catch (error) {
      await collectSyncErrorAsync(deps, account, error, errors);
    }

    // Nível conjunto
    try {
      const items = await fetchAllInsightPages(deps.fetchFn, buildInsightsUrl(account, 'adset', window));
      const rows = mapInsightItems(items, 'adset', account.adAccountId);
      await deps.replaceWindowRows(account.adAccountId, 'adset', window.since, rows);
      adsetRows = rows.length;
    } catch (error) {
      await collectSyncErrorAsync(deps, account, error, errors);
    }

    const status: 'ok' | 'partial' | 'error' =
      errors.length === 0 ? 'ok' : campaignRows + adsetRows > 0 ? 'partial' : 'error';

    try {
      await deps.upsertSyncState(account.adAccountId, {
        lastStatus: status,
        lastWindowDays: window.days,
        lastError: errors.length > 0 ? truncateError(errors.join(' | ')) : null,
        lastSyncedAt: deps.now(),
      });
    } catch {
      // estado de sync é observabilidade — nunca derruba o resumo
    }

    results.push({
      adAccountId: account.adAccountId,
      name: account.name,
      status,
      campaignRows,
      adsetRows,
      error: errors.length > 0 ? truncateError(errors.join(' | ')) : undefined,
    });
  }

  // Resumo: ok = tudo OK; partial = QUALQUER dado sincronizado (conta
  // ok OU parcial); error = nenhuma linha nova em nenhuma conta.
  const okCount = results.filter((r) => r.status === 'ok').length;
  const anyRows = results.some((r) => r.campaignRows + r.adsetRows > 0);
  const status: TrafficSyncSummary['status'] =
    okCount === results.length ? 'ok' : okCount > 0 || anyRows ? 'partial' : 'error';
  return { status, days: window.days, accounts: results };
}

/** Erro de conta: registra mensagem e marca auth (AWAITED — best-effort
 *  com try/catch, para não haver corrida com o resumo da sync). */
async function collectSyncErrorAsync(
  deps: TrafficSyncDeps,
  account: AccountRefForSync,
  error: unknown,
  errors: string[],
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  errors.push(message);
  if (error instanceof GraphApiError && isAuthErrorCode(error.code) && deps.markAccountAuthError) {
    try {
      await deps.markAccountAuthError(account.id, message, error.code);
    } catch {
      // saúde de auth é best-effort — nunca propaga
    }
  }
}

// ── Detecção de migration pendente (fallback P2021/P2022) ───────

/** True quando o erro é de tabela/coluna ausente (SQL ainda não aplicado). */
export function isPrismaMissingTableError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'P2021' || code === 'P2022';
}

// ── Resultado no CRM (funil × temperatura) ──────────────────────

export interface CampaignOutcome {
  /** Clientes atribuídos à campanha na janela (dedupe estruturado). */
  leads: number;
  won: number; // FECHADO_GANHO
  lost: number; // FECHADO_PERDIDO
  quente: number;
  morno: number;
  frio: number;
}

export function zeroOutcome(): CampaignOutcome {
  return { leads: 0, won: 0, lost: 0, quente: 0, morno: 0, frio: 0 };
}

/** Acrescenta estágio/temperatura de um cliente ao outcome da campanha. */
export function applyClientToOutcome(
  outcome: CampaignOutcome,
  stage: string | null | undefined,
  temperature: string | null | undefined,
): void {
  if (stage === 'FECHADO_GANHO') outcome.won++;
  if (stage === 'FECHADO_PERDIDO') outcome.lost++;
  if (temperature === 'QUENTE') outcome.quente++;
  if (temperature === 'MORNO') outcome.morno++;
  if (temperature === 'FRIO') outcome.frio++;
}

/**
 * Nome de campanha a partir do notes legado ([Meta Ads] → Campanha:).
 * Mesma regex da rota /api/meta-ads (fonte legada — leads anteriores
 * à inbox durável não têm campaignId estruturado).
 */
export function extractCampaignNameFromNotes(notes: string | null | undefined): string | null {
  if (!notes || !notes.includes('[Meta Ads]')) return null;
  const match = notes.match(/Campanha:\s*(.+)/i);
  const name = match?.[1]?.trim();
  return name ? name : null;
}

// ── Agregação custo × resultado ─────────────────────────────────

export interface InsightRowLite {
  level: InsightLevel;
  entityId: string;
  entityName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  spend: number;
  leadsMeta: number;
}

export interface AdsetAggregate {
  entityId: string;
  name: string;
  spend: number;
  leadsMeta: number;
  cplMeta: number | null;
}

export interface CampaignAggregate {
  /** campaignId quando conhecido; 'name:<nome>' para campanhas só-legadas. */
  key: string;
  campaignId: string | null;
  name: string;
  spend: number;
  leadsMeta: number;
  cplMeta: number | null;
  outcome: CampaignOutcome;
  /** Gasto / fechados ganhos. */
  cpa: number | null;
  winRate: number | null;
  hasSpend: boolean;
  hasOutcome: boolean;
  adsets: AdsetAggregate[];
}

// ── Agregação custo × resultado ─────────────────────────────────

export interface InsightRowLite {
  level: InsightLevel;
  entityId: string;
  entityName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  spend: number;
  leadsMeta: number;
}

export interface AdsetAggregate {
  entityId: string;
  name: string;
  spend: number;
  leadsMeta: number;
  cplMeta: number | null;
}

export interface CampaignAggregate {
  /** campaignId quando conhecido; 'name:<nome>' para campanhas só-legadas. */
  key: string;
  campaignId: string | null;
  name: string;
  spend: number;
  leadsMeta: number;
  cplMeta: number | null;
  outcome: CampaignOutcome;
  /** Gasto / fechados ganhos. */
  cpa: number | null;
  winRate: number | null;
  hasSpend: boolean;
  hasOutcome: boolean;
  adsets: AdsetAggregate[];
}

function finalizeAggregate(agg: CampaignAggregate): CampaignAggregate {
  agg.cplMeta = agg.leadsMeta > 0 ? agg.spend / agg.leadsMeta : null;
  agg.cpa = agg.outcome.won > 0 ? agg.spend / agg.outcome.won : null;
  agg.winRate = agg.outcome.won + agg.outcome.lost > 0
    ? agg.outcome.won / (agg.outcome.won + agg.outcome.lost)
    : null;
  for (const adset of agg.adsets) {
    adset.cplMeta = adset.leadsMeta > 0 ? adset.spend / adset.leadsMeta : null;
  }
  agg.hasSpend = agg.spend > 0;
  agg.hasOutcome = agg.outcome.leads > 0;
  return agg;
}

/**
 * Junta insights (custo) com outcomes (CRM) por campanha.
 *
 * Custos:
 *   - Linhas level='campaign' definem o TOTAL da campanha.
 *   - Linhas level='adset' formam o BREAKDOWN por conjunto; quando a
 *     campanha NÃO tem linha própria, o total é SINTETIZADO da soma dos
 *     conjuntos (usa campaignName reportado pela Meta).
 *
 * Outcomes:
 *   - por campaignId (estruturado, inbox) + por nome (legado, notes),
 *     SOMADOS — cobrem conjuntos de leads DISJUNTOS (o loader já
 *     deduplica por leadgenId antes de montar os mapas);
 *   - legado por nome resolve id via MetaCampaignBinding e mescla na
 *     campanha correspondente (por id OU por nome — nunca duplica);
 *   - campanha com outcome e sem custo entra com spend 0 (orgânico).
 */
export function aggregateCampaignPerformance(input: {
  rows: InsightRowLite[];
  outcomesById: Map<string, { outcome: CampaignOutcome; name: string | null }>;
  outcomesByName: Map<string, CampaignOutcome>;
  bindingNameToId: Map<string, string>;
}): CampaignAggregate[] {
  const campaigns = new Map<string, CampaignAggregate>();

  const ensure = (key: string, campaignId: string | null, name: string): CampaignAggregate => {
    let agg = campaigns.get(key);
    if (!agg) {
      agg = {
        key,
        campaignId,
        name,
        spend: 0,
        leadsMeta: 0,
        cplMeta: null,
        outcome: zeroOutcome(),
        cpa: null,
        winRate: null,
        hasSpend: false,
        hasOutcome: false,
        adsets: [],
      };
      campaigns.set(key, agg);
    }
    return agg;
  };

  // 1. Totais por linhas de campanha
  const campaignRowIds = new Set<string>();
  for (const row of input.rows) {
    if (row.level !== 'campaign') continue;
    campaignRowIds.add(row.entityId);
    const agg = ensure(row.entityId, row.entityId, row.entityName || row.entityId);
    agg.spend += row.spend;
    agg.leadsMeta += row.leadsMeta;
  }

  // 2. Breakdown por conjuntos (sempre acumulado no adset)
  for (const row of input.rows) {
    if (row.level !== 'adset') continue;
    const parentId = row.campaignId;
    if (!parentId) continue; // conjunto órfão sem campanha — fora da agregação
    const agg = ensure(parentId, parentId, row.campaignName || parentId);
    let adset = agg.adsets.find((a) => a.entityId === row.entityId);
    if (!adset) {
      adset = { entityId: row.entityId, name: row.entityName || row.entityId, spend: 0, leadsMeta: 0, cplMeta: null };
      agg.adsets.push(adset);
    }
    adset.spend += row.spend;
    adset.leadsMeta += row.leadsMeta;
  }

  // 3. Campanha sem linha própria: total = soma dos conjuntos
  for (const agg of campaigns.values()) {
    if (agg.campaignId && campaignRowIds.has(agg.campaignId)) continue;
    for (const adset of agg.adsets) {
      agg.spend += adset.spend;
      agg.leadsMeta += adset.leadsMeta;
    }
  }

  // 4. Outcome estruturado (por campaignId)
  for (const [campaignId, meta] of input.outcomesById) {
    const agg = ensure(campaignId, campaignId, meta.name || campaignId);
    agg.outcome.leads += meta.outcome.leads;
    agg.outcome.won += meta.outcome.won;
    agg.outcome.lost += meta.outcome.lost;
    agg.outcome.quente += meta.outcome.quente;
    agg.outcome.morno += meta.outcome.morno;
    agg.outcome.frio += meta.outcome.frio;
  }

  // 5. Outcome legado (por nome): mescla na campanha do mesmo id (via
  //    binding) OU do mesmo nome; sem correspondente → linha própria
  for (const [name, legacy] of input.outcomesByName) {
    const resolvedId = input.bindingNameToId.get(name) ?? null;
    let target: CampaignAggregate | undefined;
    if (resolvedId) target = campaigns.get(resolvedId);
    if (!target) target = [...campaigns.values()].find((a) => a.name === name);
    if (target) {
      target.outcome.leads += legacy.leads;
      target.outcome.won += legacy.won;
      target.outcome.lost += legacy.lost;
      target.outcome.quente += legacy.quente;
      target.outcome.morno += legacy.morno;
      target.outcome.frio += legacy.frio;
    } else {
      const agg = ensure(`name:${name}`, resolvedId, name);
      agg.outcome = { ...legacy };
    }
  }

  // 6. Derivados e ordenação (gasto desc → leads desc → nome)
  const result = [...campaigns.values()].map(finalizeAggregate);
  result.sort((a, b) =>
    b.spend - a.spend || b.leadsMeta - a.leadsMeta || a.name.localeCompare(b.name),
  );
  return result;
}
// ── Snapshot de leitura (rotas overview/report) ─────────────────

export interface InsightDailyRecord {
  level: string;
  entityId: string;
  entityName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  spend: number;
  leadsMeta: number;
}

export interface SyncStateRecord {
  adAccountId: string;
  lastStatus: string;
  lastSyncedAt: Date | null;
  lastError: string | null;
}

/**
 * Fatia de leitura com funções nomeadas (fakes triviais nos testes;
 * traffic-defaults.ts amarra no Prisma). NENHUM seletor retorna PII:
 * sem name/phone/email de cliente em NENHUM método.
 */
export interface TrafficReadDb {
  insightRowsSince(since: Date): Promise<InsightDailyRecord[]>;
  /** Leads da inbox com campaignId, desde a data (join estruturado). */
  inboxLeadsSince(since: Date): Promise<Array<{ campaignId: string | null; leadgenId: string }>>;
  /** Estágio/temperatura dos clientes por leadgen (join inbox→client). */
  clientsByLeadgenIds(
    ids: string[],
  ): Promise<Array<{ metaLeadgenId: string | null; stage: string | null; metaTemperature: string | null }>>;
  /** Clientes legados '[Meta Ads]' criados na janela (regex por nome). */
  metaClientsSince(
    since: Date,
  ): Promise<Array<{ metaLeadgenId: string | null; stage: string | null; metaTemperature: string | null; notes: string | null }>>;
  campaignBindings(): Promise<Array<{ campaignId: string; campaignName: string | null }>>;
  syncStates(): Promise<SyncStateRecord[]>;
}

export interface TrafficSnapshotTotals {
  spend: number;
  leadsMeta: number;
  cplMedio: number | null;
  clientes: number;
  won: number;
  lost: number;
  cpaGlobal: number | null;
  campaigns: number;
  withSpend: number;
}

export interface TrafficSnapshot {
  windowDays: number;
  since: Date;
  until: Date;
  aggregates: CampaignAggregate[];
  accounts: SyncStateRecord[];
  totals: TrafficSnapshotTotals;
  counts: { structuredLeads: number; legacyLeads: number };
}

const CLIENT_CHUNK = 300;

/**
 * Carrega e agrega tudo que o painel e o relatório precisam, com
 * DEDUPE estruturado×legado por leadgenId (o legado conta apenas
 * clientes sem leadgen presente na inbox da janela).
 */
export async function loadTrafficSnapshot(
  db: TrafficReadDb,
  days: number,
  now: Date,
): Promise<TrafficSnapshot> {
  const window = computeInsightWindow(days, now);
  const [rows, inbox, bindings, states] = await Promise.all([
    db.insightRowsSince(window.since),
    db.inboxLeadsSince(window.since),
    db.campaignBindings(),
    db.syncStates(),
  ]);

  // Estruturado: inbox (campaignId) → clientes (stage/temperature)
  const leadgenToCampaign = new Map<string, string>();
  const outcomesById = new Map<string, { outcome: CampaignOutcome; name: string | null }>();
  let structuredLeads = 0;
  for (const row of inbox) {
    if (!row.campaignId) continue;
    structuredLeads++;
    leadgenToCampaign.set(row.leadgenId, row.campaignId);
    const meta = outcomesById.get(row.campaignId) ?? { outcome: zeroOutcome(), name: null };
    meta.outcome.leads++;
    outcomesById.set(row.campaignId, meta);
  }
  const leadgenIds = [...leadgenToCampaign.keys()];
  for (let i = 0; i < leadgenIds.length; i += CLIENT_CHUNK) {
    const chunk = leadgenIds.slice(i, i + CLIENT_CHUNK);
    const clients = await db.clientsByLeadgenIds(chunk);
    for (const client of clients) {
      const campaignId = client.metaLeadgenId ? leadgenToCampaign.get(client.metaLeadgenId) : undefined;
      if (!campaignId) continue;
      const meta = outcomesById.get(campaignId);
      if (!meta) continue;
      applyClientToOutcome(meta.outcome, client.stage, client.metaTemperature);
    }
  }

  // Bindings: nome↔id (resolução legada + nomes de campanhas sem insights)
  const bindingNameToId = new Map<string, string>();
  const bindingIdToName = new Map<string, string>();
  for (const binding of bindings) {
    if (binding.campaignName) {
      if (!bindingNameToId.has(binding.campaignName)) {
        bindingNameToId.set(binding.campaignName, binding.campaignId);
      }
      if (!bindingIdToName.has(binding.campaignId)) {
        bindingIdToName.set(binding.campaignId, binding.campaignName);
      }
    }
  }
  for (const [campaignId, meta] of outcomesById) {
    if (!meta.name) meta.name = bindingIdToName.get(campaignId) ?? null;
  }

  // Legado: clientes '[Meta Ads]' sem leadgen estruturado na janela
  const outcomesByName = new Map<string, CampaignOutcome>();
  let legacyLeads = 0;
  const legacyClients = await db.metaClientsSince(window.since);
  for (const client of legacyClients) {
    if (client.metaLeadgenId && leadgenToCampaign.has(client.metaLeadgenId)) continue;
    legacyLeads++;
    const name = extractCampaignNameFromNotes(client.notes) ?? 'Sem campanha';
    const outcome = outcomesByName.get(name) ?? zeroOutcome();
    outcome.leads++;
    applyClientToOutcome(outcome, client.stage, client.metaTemperature);
    outcomesByName.set(name, outcome);
  }

  const aggregates = aggregateCampaignPerformance({
    rows: rows.map((row) => ({
      level: row.level as InsightLevel,
      entityId: row.entityId,
      entityName: row.entityName,
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      spend: row.spend,
      leadsMeta: row.leadsMeta,
    })),
    outcomesById,
    outcomesByName,
    bindingNameToId,
  });

  const totals: TrafficSnapshotTotals = {
    spend: aggregates.reduce((sum, a) => sum + a.spend, 0),
    leadsMeta: aggregates.reduce((sum, a) => sum + a.leadsMeta, 0),
    cplMedio: null,
    clientes: aggregates.reduce((sum, a) => sum + a.outcome.leads, 0),
    won: aggregates.reduce((sum, a) => sum + a.outcome.won, 0),
    lost: aggregates.reduce((sum, a) => sum + a.outcome.lost, 0),
    cpaGlobal: null,
    campaigns: aggregates.length,
    withSpend: aggregates.filter((a) => a.spend > 0).length,
  };
  const totalLeadsMeta = totals.leadsMeta;
  totals.cplMedio = totalLeadsMeta > 0 ? totals.spend / totalLeadsMeta : null;
  totals.cpaGlobal = totals.won > 0 ? totals.spend / totals.won : null;

  return {
    windowDays: window.days,
    since: window.since,
    until: window.until,
    aggregates,
    accounts: states,
    totals,
    counts: { structuredLeads, legacyLeads },
  };
}

// ── Relatório markdown para IA externa (SEM PII) ────────────────

export interface TrafficReportAccountsMeta {
  name: string;
  lastStatus: string;
  lastSyncedAt: Date | string | null;
  lastError: string | null;
}

/**
 * Relatório agregado (nomes de campanha/conjunto + números). Guardrails
 * de decisão embutidos para a IA externa respeitar significância,
 * learning phase e limites de edição. NENHUM dado de cliente.
 */
export function buildTrafficReportMarkdown(input: {
  aggregates: CampaignAggregate[];
  windowDays: number;
  generatedAt: Date;
  accounts: TrafficReportAccountsMeta[];
  totals: TrafficSnapshotTotals;
}): string {
  const { aggregates, windowDays, generatedAt, accounts, totals } = input;
  const lines: string[] = [];

  lines.push('# Relatório de Otimização — Meta Ads');
  lines.push('');
  lines.push(
    `Janela: últimos ${windowDays} dia(s) · Gerado em ${generatedAt.toISOString()} · ` +
    'Fonte: Marketing API (custo) × CRM (resultado real do funil). Dados 100% agregados, sem PII.',
  );
  lines.push('');
  lines.push('## Regras para a IA analista (guardrails obrigatórios)');
  lines.push('');
  lines.push('1. Só recomende mudanças em campanhas/conjuntos com >= 15 leads no período OU gasto >= R$ 100 (significância mínima).');
  lines.push('2. Mudanças de orçamento: máximo ±30% por ciclo; no máximo 1 edição por conjunto a cada 3 dias (learning phase da Meta).');
  lines.push('3. Priorize CPA (gasto por FECHADO_GANHO) e qualidade (leads QUENTE) sobre CPL bruto.');
  lines.push('4. Formato de cada recomendação: entidade → dado observado → ação proposta → novo valor → risco.');
  lines.push('5. Não invente métricas. Se os dados forem insuficientes, diga exatamente o que falta medir.');
  lines.push('6. Considere o contexto: imobiliário de luxo, ciclo de venda longo, leads chegam por formulário Meta e são trabalhados no CRM.');
  lines.push('');

  lines.push('## Resumo do período');
  lines.push('');
  lines.push('| métrica | valor |');
  lines.push('|---|---|');
  lines.push(`| Gasto total | ${fmtBRL(totals.spend)} |`);
  lines.push(`| Leads (Meta) | ${totals.leadsMeta} |`);
  lines.push(`| CPL médio (Meta) | ${totals.cplMedio === null ? '—' : fmtBRL(totals.cplMedio)} |`);
  lines.push(`| Clientes no CRM (janela) | ${totals.clientes} |`);
  lines.push(`| Fechados (ganho / perdido) | ${totals.won} / ${totals.lost} |`);
  lines.push(`| CPA global (gasto/ganho) | ${totals.cpaGlobal === null ? '—' : fmtBRL(totals.cpaGlobal)} |`);
  lines.push(`| Campanhas (com gasto) | ${totals.campaigns} (${totals.withSpend}) |`);
  lines.push('');

  if (accounts.length > 0) {
    lines.push('## Status da sincronização');
    lines.push('');
    lines.push('| conta | status | última sync | erro |');
    lines.push('|---|---|---|---|');
    for (const account of accounts) {
      const synced = account.lastSyncedAt
        ? (typeof account.lastSyncedAt === 'string' ? account.lastSyncedAt : account.lastSyncedAt.toISOString())
        : 'nunca';
      lines.push(`| ${account.name || '—'} | ${account.lastStatus} | ${synced} | ${account.lastError ? truncateError(account.lastError, 120) : '—'} |`);
    }
    lines.push('');
  }

  lines.push('## Desempenho por campanha');
  lines.push('');
  if (aggregates.length === 0) {
    lines.push('_Nenhum dado no período — sincronize os insights e/ou aguarde tráfego._');
    lines.push('');
  } else {
    lines.push('| campanha | gasto | leads (Meta) | CPL | clientes | ganhos | perdidos | CPA | win rate |');
    lines.push('|---|---|---|---|---|---|---|---|---|');
    for (const agg of aggregates) {
      lines.push(
        `| ${agg.name} | ${fmtBRL(agg.spend)} | ${agg.leadsMeta} | ${agg.cplMeta === null ? '—' : fmtBRL(agg.cplMeta)} | ` +
        `${agg.outcome.leads} | ${agg.outcome.won} | ${agg.outcome.lost} | ` +
        `${agg.cpa === null ? '—' : fmtBRL(agg.cpa)} | ${fmtPct(agg.winRate)} |`,
      );
    }
    lines.push('');
  }

  const adsetRows = aggregates.flatMap((agg) =>
    agg.adsets.map((adset) => ({ campaign: agg.name, ...adset })),
  ).sort((a, b) => b.spend - a.spend).slice(0, 15);
  if (adsetRows.length > 0) {
    lines.push('## Conjuntos (top 15 por gasto)');
    lines.push('');
    lines.push('| conjunto | campanha | gasto | leads (Meta) | CPL |');
    lines.push('|---|---|---|---|---|');
    for (const adset of adsetRows) {
      lines.push(`| ${adset.name} | ${adset.campaign} | ${fmtBRL(adset.spend)} | ${adset.leadsMeta} | ${adset.cplMeta === null ? '—' : fmtBRL(adset.cplMeta)} |`);
    }
    lines.push('');
  }

  const spendNoLead = aggregates.filter((a) => a.spend >= 100 && a.leadsMeta === 0 && a.outcome.leads === 0);
  const leadNoSpend = aggregates.filter((a) => a.spend === 0 && a.outcome.leads > 0);
  if (spendNoLead.length > 0 || leadNoSpend.length > 0) {
    lines.push('## Alertas');
    lines.push('');
    for (const agg of spendNoLead) {
      lines.push(`- Gasto sem nenhum lead: ${agg.name} (${fmtBRL(agg.spend)}) — revisar público/criativo/formulário.`);
    }
    for (const agg of leadNoSpend) {
      lines.push(`- Leads sem custo vinculado: ${agg.name} (${agg.outcome.leads} clientes) — campanha fora da(s) conta(s) sincronizada(s) ou orgânico/importado.`);
    }
    lines.push('');
  }

  lines.push('## Como usar');
  lines.push('');
  lines.push('Cole este relatório completo na sua IA externa com o pedido: "Analise os dados e gere recomendações priorizadas de otimização seguindo as regras acima."');
  lines.push('');

  return lines.join('\n');
}
