/**
 * sync.test.ts — Fase 8 (gestor de tráfego): orquestrador de
 * sincronização de insights com fakes de fetch + persistência.
 *
 * Contratos testados:
 *   - sucesso nos 2 níveis → status 'ok' + snapshot-replace chamado
 *   - falha em 1 nível → 'partial' (linhas do nível OK persistidas)
 *   - falha nos 2 níveis → 'error' + sync state com erro
 *   - Graph 190/200/10 marca saúde de auth da conta (AWAITED, sem corrida)
 *   - paging via paging.next com teto MAX_PAGES
 *   - sem contas → 'no_accounts' (nunca toca no banco)
 *   - nenhuma exceção escapa do syncTrafficInsights
 *
 * Os fakes respeitam a SEMÂNTICA real da API: o parser descarta linhas
 * sem o id do nível pedido (adset sem adset_id não existe), então cada
 * nível devolve o shape correto (level=campaign vs level=adset).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  syncTrafficInsights,
  GraphApiError,
  fetchAllInsightPages,
  type FetchLike,
  type TrafficInsightRow,
  type TrafficSyncDeps,
} from '../../src/lib/traffic-insights.ts';

const NOW = new Date('2026-09-13T12:00:00.000Z');
const ACCOUNT = { id: 'rec1', name: 'Conta Principal', adAccountId: 'act_123', accessToken: 'tok' };

function campaignData(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    date_start: '2026-09-12',
    campaign_id: 'C1',
    campaign_name: 'Campanha Um',
    spend: '100',
    impressions: '1000',
    clicks: '50',
    reach: '800',
    actions: [{ action_type: 'lead', value: '5' }],
    ...over,
  };
}

function adsetData(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    date_start: '2026-09-12',
    adset_id: 'A1',
    adset_name: 'Conjunto A1',
    campaign_id: 'C1',
    campaign_name: 'Campanha Um',
    spend: '40',
    impressions: '400',
    clicks: '20',
    reach: '300',
    actions: [{ action_type: 'lead', value: '2' }],
    ...over,
  };
}

interface Harness {
  deps: TrafficSyncDeps;
  replaced: Array<{ account: string; level: string; rows: TrafficInsightRow[] }>;
  states: Array<{ account: string; patch: { lastStatus: string; lastError: string | null } }>;
  authErrors: Array<{ id: string; code: number | null }>;
  calls: number;
}

function makeDeps(
  fetchFn: FetchLike,
  accounts: Array<typeof ACCOUNT> = [ACCOUNT],
): Harness {
  const harness: Harness = {
    deps: undefined as unknown as TrafficSyncDeps,
    replaced: [],
    states: [],
    authErrors: [],
    calls: 0,
  };
  harness.deps = {
    listAccounts: async () => accounts,
    fetchFn: async (url) => {
      harness.calls++;
      return fetchFn(url);
    },
    replaceWindowRows: async (account, level, _since, rows) => {
      harness.replaced.push({ account, level, rows });
    },
    upsertSyncState: async (account, patch) => {
      harness.states.push({ account, patch });
    },
    markAccountAuthError: async (id, _error, code) => {
      harness.authErrors.push({ id, code });
    },
    now: () => NOW,
  };
  return harness;
}

function okResponse(data: unknown, next?: string): { ok: boolean; status: number; text: string } {
  return {
    ok: true,
    status: 200,
    text: JSON.stringify({ data, paging: next ? { next } : undefined }),
  };
}

/** Fake por nível: shape correto para campaign e adset. */
function byLevel(okCampaign = true, okAdset = true): FetchLike {
  return async (url) => {
    const isAdset = url.includes('level=adset');
    if (isAdset && !okAdset) return { ok: false, status: 500, text: JSON.stringify({ error: { message: 'adset boom', code: 1 } }) };
    if (!isAdset && !okCampaign) return { ok: false, status: 500, text: JSON.stringify({ error: { message: 'campaign boom', code: 1 } }) };
    return okResponse([isAdset ? adsetData() : campaignData()]);
  };
}

describe('syncTrafficInsights — caminho feliz', () => {
  test('2 níveis OK → status ok, replace chamado por nível, sync state ok', async () => {
    const harness = makeDeps(byLevel());
    const summary = await syncTrafficInsights(harness.deps, { days: 2 });

    assert.equal(summary.status, 'ok');
    assert.equal(summary.days, 2);
    assert.equal(summary.accounts.length, 1);
    assert.equal(summary.accounts[0]!.status, 'ok');
    assert.equal(summary.accounts[0]!.campaignRows, 1);
    assert.equal(summary.accounts[0]!.adsetRows, 1);
    assert.equal(harness.replaced.length, 2);
    assert.deepEqual(
      harness.replaced.map((r) => r.level).sort(),
      ['adset', 'campaign'],
    );
    assert.equal(harness.states[0]!.patch.lastStatus, 'ok');
    assert.equal(harness.states[0]!.patch.lastError, null);
  });

  test('paging: paging.next é seguido e acumula dados por nível', async () => {
    // A URL next REAL da Meta preserva os params originais (inclusive
    // level) — o fake simula isso com um marcador de cursor.
    const harness = makeDeps(async (url) => {
      const isAdset = url.includes('level=adset');
      const isSecond = url.includes('cursor=2');
      const base = isAdset ? adsetData() : campaignData();
      const idKey = isAdset ? 'adset_id' : 'campaign_id';
      const item = isSecond ? { ...base, [idKey]: 'X2' } : base;
      const next = isSecond ? undefined : `https://graph.facebook.com/next?level=${isAdset ? 'adset' : 'campaign'}&cursor=2`;
      return okResponse([item], next);
    });
    const summary = await syncTrafficInsights(harness.deps, { days: 1 });
    // campanha: 2 páginas (2 linhas) + conjuntos: 2 páginas (2 linhas)
    assert.equal(summary.accounts[0]!.campaignRows, 2);
    assert.equal(summary.accounts[0]!.adsetRows, 2);
  });

  test('fetchAllInsightPages respeita o teto de páginas (defesa contra loop)', async () => {
    let calls = 0;
    const endless: FetchLike = async () => {
      calls++;
      return okResponse([campaignData()], 'https://graph.facebook.com/next-page');
    };
    const items = await fetchAllInsightPages(endless, 'https://graph.facebook.com/first');
    assert.equal(calls, 10, 'MAX_PAGES = 10');
    assert.equal(items.length, 10);
  });
});

describe('syncTrafficInsights — falhas por conta', () => {
  test('campanha falha (Graph 500) e conjuntos OK → partial com linhas persistidas', async () => {
    const harness = makeDeps(byLevel(false, true));
    const summary = await syncTrafficInsights(harness.deps, { days: 1 });

    assert.equal(summary.status, 'partial');
    assert.equal(summary.accounts[0]!.status, 'partial');
    assert.equal(summary.accounts[0]!.campaignRows, 0);
    assert.equal(summary.accounts[0]!.adsetRows, 1);
    assert.ok(summary.accounts[0]!.error?.includes('campaign boom'));
    assert.equal(harness.states[0]!.patch.lastStatus, 'partial');
    assert.ok(harness.states[0]!.patch.lastError?.includes('campaign boom'));
    assert.equal(harness.authErrors.length, 0, 'code 1 não é erro de auth');
  });

  test('Graph 190 marca authStatus da conta (expired) e resumo vira error', async () => {
    const harness = makeDeps(async () => ({
      ok: false,
      status: 401,
      text: JSON.stringify({ error: { message: 'token expired', code: 190 } }),
    }));
    const summary = await syncTrafficInsights(harness.deps, { days: 1 });

    assert.equal(summary.status, 'error');
    assert.equal(harness.authErrors.length, 2, 'marca nos 2 níveis (awaited)');
    assert.equal(harness.authErrors[0]!.code, 190);
    assert.equal(harness.states[0]!.patch.lastStatus, 'error');
  });

  test('Graph 200 (permissão) também marca auth', async () => {
    const harness = makeDeps(async () => ({
      ok: false,
      status: 400,
      text: JSON.stringify({ error: { message: 'permission denied', code: 200 } }),
    }));
    await syncTrafficInsights(harness.deps, { days: 1 });
    assert.equal(harness.authErrors[0]!.code, 200);
  });

  test('corpo não-JSON → GraphApiError com code null', async () => {
    const harness = makeDeps(async () => ({ ok: false, status: 502, text: '<html>bad gateway</html>' }));
    const summary = await syncTrafficInsights(harness.deps, { days: 1 });
    assert.equal(summary.status, 'error');
    assert.equal(harness.authErrors.length, 0);
  });

  test('falha de persistência não derruba o resumo (vira error da conta)', async () => {
    const harness = makeDeps(byLevel());
    harness.deps.replaceWindowRows = async () => {
      throw new Error('db down');
    };
    const summary = await syncTrafficInsights(harness.deps, { days: 1 });
    assert.equal(summary.status, 'error');
    assert.ok(summary.accounts[0]!.error?.includes('db down'));
  });

  test('exceção de rede (fetch throw) vira error de conta, não quebra', async () => {
    const harness = makeDeps(async () => {
      throw new Error('ECONNRESET');
    });
    const summary = await syncTrafficInsights(harness.deps, { days: 1 });
    assert.equal(summary.status, 'error');
    assert.ok(summary.accounts[0]!.error?.includes('ECONNRESET'));
  });
});

describe('syncTrafficInsights — múltiplas contas e vazio', () => {
  test('uma conta ok + uma com erro → partial', async () => {
    const accounts = [
      ACCOUNT,
      { id: 'rec2', name: 'Secundária', adAccountId: 'act_999', accessToken: 'tok2' },
    ];
    const harness = makeDeps(async (url) => {
      if (url.includes('act_999')) {
        return { ok: false, status: 500, text: JSON.stringify({ error: { message: 'x', code: 1 } }) };
      }
      return byLevel()(url);
    }, accounts);
    const summary = await syncTrafficInsights(harness.deps, { days: 1 });
    assert.equal(summary.status, 'partial');
    assert.equal(harness.states.length, 2);
    assert.equal(harness.states[0]!.patch.lastStatus, 'ok');
    assert.equal(harness.states[1]!.patch.lastStatus, 'error');
  });

  test('sem contas → no_accounts e nenhum acesso a banco', async () => {
    const harness = makeDeps(byLevel(), []);
    const summary = await syncTrafficInsights(harness.deps, { days: 1 });
    assert.equal(summary.status, 'no_accounts');
    assert.equal(harness.calls, 0);
    assert.equal(harness.replaced.length, 0);
    assert.equal(harness.states.length, 0);
  });
});

describe('GraphApiError', () => {
  test('carrega status e code sem parameter properties', () => {
    const err = new GraphApiError('x', 500, 190);
    assert.equal(err.status, 500);
    assert.equal(err.code, 190);
    assert.equal(err.message, 'x');
    assert.ok(err instanceof Error);
  });
});
