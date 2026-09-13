/**
 * pulse-entity.test.ts — Fase 8.2 (gestor de tráfego nível sênior):
 *
 * Contratos testados:
 *   - attachCampaignPulse: dias ativos + tendência de CPL (1ª vs 2ª
 *     metade da janela) com a MESMA regra de fonte dos totais
 *     (campanha → senão conjuntos); campanha só-legada sem pulso
 *   - métricas de topo de funil agregadas dos SOMAS (impressões/
 *     cliques/alcance) e derivados (CPM/CTR/frequência) — incluindo
 *     campanha sintetizada sem linha própria
 *   - applyClientToOutcome: contadores de funil atingido (agendados/
 *     visitas/propostas) pela ordem canônica das 8 etapas
 *   - entity state: URL de /campaigns+/adsets, parser (learning_stage_
 *     info só em adset, sem id descartado, orçamento string→Int|null)
 *     e sync com snapshot-replace + flag includeEntityState=false
 *   - loadTrafficSnapshot: meta_ad_entity_state ausente (P2021) →
 *     degrada para lista vazia SEM derrubar o snapshot
 *   - relatório v2: seções novas (topo de funil, CRM, estado de
 *     entrega) e omissão limpa quando não há dados
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyClientToOutcome,
  aggregateCampaignPerformance,
  attachCampaignPulse,
  buildEntityStateUrl,
  buildTrafficReportMarkdown,
  fetchAccountEntityStates,
  loadTrafficSnapshot,
  mapEntityStateItems,
  syncTrafficInsights,
  zeroOutcome,
  type FetchLike,
  type InsightRowLite,
  type TrafficReadDb,
  type TrafficSyncDeps,
} from '../../src/lib/traffic-insights.ts';

const NOW = new Date('2026-09-13T12:00:00.000Z');
const SINCE = new Date('2026-09-06T00:00:00.000Z'); // janela 7 dias → midpoint 09-09T12Z? (since + 3.5d)

function day(n: number): Date {
  // n-ésimo dia da janela (0 = since)
  return new Date(SINCE.getTime() + n * 86_400_000);
}

function lite(over: Partial<InsightRowLite>): InsightRowLite {
  return {
    level: 'campaign',
    entityId: 'C?',
    entityName: null,
    campaignId: null,
    campaignName: null,
    date: SINCE,
    spend: 0,
    impressions: 0,
    clicks: 0,
    reach: 0,
    leadsMeta: 0,
    ...over,
  };
}

const WINDOW = { since: SINCE, days: 7 };
const MIDPOINT_MS = SINCE.getTime() + 3.5 * 86_400_000; // attachCampaignPulse

// ── attachCampaignPulse ──────────────────────────────────────────

describe('attachCampaignPulse', () => {
  test('dias ativos = dias UTC distintos com gasto > 0 (linhas de campanha)', () => {
    const rows = [
      lite({ level: 'campaign', entityId: 'C1', campaignId: 'C1', date: day(0), spend: 50 }),
      lite({ level: 'campaign', entityId: 'C1', campaignId: 'C1', date: day(1), spend: 60 }),
      lite({ level: 'campaign', entityId: 'C1', campaignId: 'C1', date: day(1), spend: 0, impressions: 10 }), // sem gasto — não conta
      lite({ level: 'campaign', entityId: 'C1', campaignId: 'C1', date: day(0), spend: 10 }), // mesmo dia 0 — não duplica
    ];
    const aggs = aggregateCampaignPerformance({ rows, outcomesById: new Map(), outcomesByName: new Map(), bindingNameToId: new Map() });
    attachCampaignPulse(aggs, rows, WINDOW);
    assert.equal(aggs[0]!.pulse!.activeDays, 2);
  });

  test('tendência: CPL caindo >= 10% → melhorando; subindo >= 10% → piorando; dentro → estável', () => {
    const build = (firstLeads: number, secondLeads: number) => {
      const rows = [
        lite({ level: 'campaign', entityId: 'C1', campaignId: 'C1', date: day(0), spend: 100, leadsMeta: firstLeads }),
        lite({ level: 'campaign', entityId: 'C1', campaignId: 'C1', date: day(6), spend: 100, leadsMeta: secondLeads }),
      ];
      const aggs = aggregateCampaignPerformance({ rows, outcomesById: new Map(), outcomesByName: new Map(), bindingNameToId: new Map() });
      attachCampaignPulse(aggs, rows, WINDOW);
      return aggs[0]!.pulse!;
    };
    // 1ª metade: 100/10 = 10; 2ª: 100/15 ≈ 6,67 → −33% → melhorando
    assert.equal(build(10, 15).trend, 'melhorando');
    // 1ª: 100/10 = 10; 2ª: 100/5 = 20 → +100% → piorando
    assert.equal(build(10, 5).trend, 'piorando');
    // 1ª: 100/10 = 10; 2ª: 100/10 = 10 → 0% → estável
    assert.equal(build(10, 10).trend, 'estavel');
  });

  test('sem leads em alguma metade → sem_base (não inventa direção)', () => {
    const rows = [
      lite({ level: 'campaign', entityId: 'C1', campaignId: 'C1', date: day(0), spend: 100, leadsMeta: 10 }),
      lite({ level: 'campaign', entityId: 'C1', campaignId: 'C1', date: day(6), spend: 100, leadsMeta: 0 }),
    ];
    const aggs = aggregateCampaignPerformance({ rows, outcomesById: new Map(), outcomesByName: new Map(), bindingNameToId: new Map() });
    attachCampaignPulse(aggs, rows, WINDOW);
    assert.equal(aggs[0]!.pulse!.trend, 'sem_base');
    assert.equal(aggs[0]!.pulse!.cplFirstHalf, 10);
    assert.equal(aggs[0]!.pulse!.cplSecondHalf, null);
  });

  test('campanha sem linha própria: pulso vem das linhas dos CONJUNTOS', () => {
    const rows = [
      lite({ level: 'adset', entityId: 'A1', campaignId: 'C9', campaignName: 'Só Conjuntos', date: day(0), spend: 50, leadsMeta: 5, impressions: 1000, clicks: 40, reach: 700 }),
      lite({ level: 'adset', entityId: 'A2', campaignId: 'C9', campaignName: 'Só Conjuntos', date: day(6), spend: 90, leadsMeta: 3, impressions: 1200, clicks: 30, reach: 800 }),
    ];
    const aggs = aggregateCampaignPerformance({ rows, outcomesById: new Map(), outcomesByName: new Map(), bindingNameToId: new Map() });
    attachCampaignPulse(aggs, rows, WINDOW);
    const pulse = aggs[0]!.pulse!;
    assert.equal(pulse.activeDays, 2);
    assert.equal(pulse.cplFirstHalf, 10);
    assert.equal(pulse.cplSecondHalf, 30);
    assert.equal(pulse.trend, 'piorando');
  });

  test('campanha só-legada (sem campaignId/linhas) não ganha pulso', () => {
    const aggs = aggregateCampaignPerformance({
      rows: [],
      outcomesById: new Map(),
      outcomesByName: new Map([['Antiga', { ...zeroOutcome(), leads: 3 }]]),
      bindingNameToId: new Map(),
    });
    attachCampaignPulse(aggs, [], WINDOW);
    assert.equal(aggs[0]!.pulse, undefined);
  });

  test('metade da janela: datas antes do midpoint vão para a 1ª metade', () => {
    // janela 7d desde 09-06T00Z; midpoint = 09-09T12Z → dia 3 (09-09T00Z) é 1ª metade
    const rows = [
      lite({ level: 'campaign', entityId: 'C1', campaignId: 'C1', date: day(3), spend: 100, leadsMeta: 10 }),
      lite({ level: 'campaign', entityId: 'C1', campaignId: 'C1', date: day(4), spend: 100, leadsMeta: 10 }),
    ];
    const aggs = aggregateCampaignPerformance({ rows, outcomesById: new Map(), outcomesByName: new Map(), bindingNameToId: new Map() });
    attachCampaignPulse(aggs, rows, WINDOW);
    assert.ok(day(3).getTime() < MIDPOINT_MS);
    assert.equal(aggs[0]!.pulse!.cplFirstHalf, 10);
    assert.equal(aggs[0]!.pulse!.cplSecondHalf, 10);
  });
});

// ── Métricas de topo de funil na agregação ──────────────────────

describe('agregação de métricas de topo de funil (8.2a)', () => {
  test('somas de impressões/cliques/alcance e derivados CPM/CTR/frequência', () => {
    const aggs = aggregateCampaignPerformance({
      rows: [
        lite({ level: 'campaign', entityId: 'C1', campaignId: 'C1', date: day(0), spend: 100, impressions: 8000, clicks: 200, reach: 6000, leadsMeta: 4 }),
        lite({ level: 'campaign', entityId: 'C1', campaignId: 'C1', date: day(1), spend: 100, impressions: 4000, clicks: 100, reach: 3000, leadsMeta: 6 }),
      ],
      outcomesById: new Map(),
      outcomesByName: new Map(),
      bindingNameToId: new Map(),
    });
    const c1 = aggs[0]!;
    assert.equal(c1.impressions, 12000);
    assert.equal(c1.clicks, 300);
    assert.equal(c1.reach, 9000);
    assert.equal(c1.cpm, (200 / 12000) * 1000); // ~16,67 dos somas
    assert.equal(c1.ctr, (300 / 12000) * 100); // 2,5%
    assert.equal(c1.frequency, 12000 / 9000); // ~1,33
    assert.equal(c1.cplMeta, 20, 'CPL dos somas (200/10)');
  });

  test('campanha sintetizada (sem linha própria) soma as métricas dos conjuntos; adsets têm derivados próprios', () => {
    const aggs = aggregateCampaignPerformance({
      rows: [
        lite({ level: 'adset', entityId: 'A1', campaignId: 'C9', campaignName: 'C9', date: day(0), spend: 60, impressions: 6000, clicks: 150, reach: 5000, leadsMeta: 3 }),
        lite({ level: 'adset', entityId: 'A2', campaignId: 'C9', campaignName: 'C9', date: day(0), spend: 40, impressions: 4000, clicks: 50, reach: 4000, leadsMeta: 1 }),
      ],
      outcomesById: new Map(),
      outcomesByName: new Map(),
      bindingNameToId: new Map(),
    });
    const c9 = aggs[0]!;
    assert.equal(c9.impressions, 10000);
    assert.equal(c9.clicks, 200);
    assert.equal(c9.reach, 9000);
    assert.equal(c9.cpm, (100 / 10000) * 1000);
    const a1 = c9.adsets.find((a) => a.entityId === 'A1')!;
    assert.equal(a1.ctr, (150 / 6000) * 100);
    assert.equal(a1.cpm, (60 / 6000) * 1000);
    assert.equal(a1.frequency, 6000 / 5000);
    assert.equal(a1.cplMeta, 20);
  });

  test('sem impressões → derivados null (nunca NaN)', () => {
    const aggs = aggregateCampaignPerformance({
      rows: [lite({ level: 'campaign', entityId: 'C1', campaignId: 'C1', date: day(0), spend: 50 })],
      outcomesById: new Map(),
      outcomesByName: new Map(),
      bindingNameToId: new Map(),
    });
    assert.equal(aggs[0]!.cpm, null);
    assert.equal(aggs[0]!.ctr, null);
    assert.equal(aggs[0]!.frequency, null);
  });
});

// ── Funil atingido (estágios) ────────────────────────────────────

describe('applyClientToOutcome — funil atingido (8.2a)', () => {
  test('estágios contam por posição canônica (reached >= limiar)', () => {
    const outcome = zeroOutcome();
    applyClientToOutcome(outcome, 'LEAD', 'FRIO'); // não avança funil
    applyClientToOutcome(outcome, 'PROSPECT', 'MORNO');
    applyClientToOutcome(outcome, 'VISITA_AGENDADA', 'QUENTE'); // agendados++
    applyClientToOutcome(outcome, 'VISITA_REALIZADA', 'QUENTE'); // agendados+visitas++
    applyClientToOutcome(outcome, 'CARTA_PROPOSTA', null); // até propostas++
    applyClientToOutcome(outcome, 'FECHADO_GANHO', 'QUENTE'); // todos++ + won
    assert.equal(outcome.agendados, 4);
    assert.equal(outcome.visitas, 3);
    assert.equal(outcome.propostas, 2);
    assert.equal(outcome.won, 1);
  });

  test('FECHADO_PERDIDO conta como tendo percorrido o funil (aproximação monotônica) e estágio desconhecido não conta', () => {
    const outcome = zeroOutcome();
    applyClientToOutcome(outcome, 'FECHADO_PERDIDO', 'FRIO');
    assert.equal(outcome.lost, 1);
    assert.equal(outcome.agendados, 1);
    applyClientToOutcome(outcome, 'ETAPA_INEXISTENTE', null);
    assert.equal(outcome.leads, 0);
    assert.equal(outcome.agendados, 1, 'estágio fora da ordem canônica é ignorado');
  });
});

// ── Entity state: URL, parser e fetch ───────────────────────────

const ACCOUNT = { id: 'rec1', name: 'Conta', adAccountId: 'act_123', accessToken: 'tok' };

describe('buildEntityStateUrl (8.2b)', () => {
  test('campaign: edge campaigns com campos de entrega/orçamento', () => {
    const url = buildEntityStateUrl(ACCOUNT, 'campaign');
    assert.ok(url.includes('/act_123/campaigns?'));
    assert.ok(url.includes('fields=id%2Cname%2Cstatus%2Ceffective_status%2Cdaily_budget%2Clifetime_budget'));
    assert.ok(url.includes('access_token=tok'));
  });

  test('adset: edge adsets com campaign_id e learning_stage_info', () => {
    const url = buildEntityStateUrl(ACCOUNT, 'adset');
    assert.ok(url.includes('/act_123/adsets?'));
    assert.ok(url.includes('learning_stage_info'));
    assert.ok(url.includes('campaign_id'));
  });
});

describe('mapEntityStateItems (8.2b)', () => {
  test('shape de campanha: id/nome/orçamentos/status; campaignId = próprio id', () => {
    const rows = mapEntityStateItems(
      [{ id: 'C1', name: 'Campanha Um', status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '15000', lifetime_budget: null }],
      'campaign',
      'act_123',
    );
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
      adAccountId: 'act_123',
      level: 'campaign',
      entityId: 'C1',
      entityName: 'Campanha Um',
      campaignId: 'C1',
      dailyBudgetMinor: 15000,
      lifetimeBudgetMinor: null,
      status: 'ACTIVE',
      effectiveStatus: 'ACTIVE',
      learningStage: null,
    });
  });

  test('shape de conjunto: campaign_id do pai + learning_stage_info.status', () => {
    const rows = mapEntityStateItems(
      [{ id: 'A1', name: 'Conjunto A1', campaign_id: 'C1', effective_status: 'ACTIVE', daily_budget: '5000', learning_stage_info: { status: 'LEARNING' } }],
      'adset',
      'act_123',
    );
    assert.equal(rows[0]!.campaignId, 'C1');
    assert.equal(rows[0]!.learningStage, 'LEARNING');
  });

  test('defesas: sem id descarta; valores vazios → null; learning em campaign → null', () => {
    const rows = mapEntityStateItems(
      [
        { name: 'sem id', daily_budget: '' },
        { id: 'C2', daily_budget: 'não-numérico' },
        { id: 'C3', learning_stage_info: { status: 'SUCCESS' } },
      ],
      'campaign',
      'act_123',
    );
    assert.equal(rows.length, 2);
    assert.equal(rows.find((r) => r.entityId === 'C2')!.dailyBudgetMinor, null);
    assert.equal(rows.find((r) => r.entityId === 'C3')!.learningStage, null, 'learning só existe para adsets');
  });
});

describe('fetchAccountEntityStates (8.2b)', () => {
  test('busca campaigns + adsets e concatena parsers por nível', async () => {
    const fetchFn: FetchLike = async (url) => {
      if (url.includes('/campaigns?')) {
        return { ok: true, status: 200, text: JSON.stringify({ data: [{ id: 'C1', name: 'C1', effective_status: 'ACTIVE', daily_budget: '15000' }] }) };
      }
      if (url.includes('/adsets?')) {
        return { ok: true, status: 200, text: JSON.stringify({ data: [{ id: 'A1', name: 'A1', campaign_id: 'C1', effective_status: 'ACTIVE', learning_stage_info: { status: 'SUCCESS' } }] }) };
      }
      throw new Error(`URL inesperada: ${url}`);
    };
    const states = await fetchAccountEntityStates(fetchFn, ACCOUNT);
    assert.equal(states.campaignRows.length, 1);
    assert.equal(states.adsetRows.length, 1);
    assert.equal(states.adsetRows[0]!.learningStage, 'SUCCESS');
  });
});

// ── Sync com entity state ────────────────────────────────────────

function okResponse(data: unknown): { ok: boolean; status: number; text: string } {
  return { ok: true, status: 200, text: JSON.stringify({ data }) };
}

describe('syncTrafficInsights — entity state (8.2b)', () => {
  test('caminho feliz: insights + entity state → entityRows contadas e replace chamado', async () => {
    const replacedStates: Array<{ account: string; rows: number }> = [];
    const calls: string[] = [];
    const deps: TrafficSyncDeps = {
      listAccounts: async () => [ACCOUNT],
      fetchFn: async (url) => {
        calls.push(url);
        if (url.includes('/campaigns?')) return okResponse([{ id: 'C1', name: 'C1', effective_status: 'ACTIVE', daily_budget: '15000' }]);
        if (url.includes('/adsets?')) return okResponse([{ id: 'A1', campaign_id: 'C1', effective_status: 'ACTIVE' }]);
        if (url.includes('level=adset')) return okResponse([{ date_start: '2026-09-12', adset_id: 'A1', adset_name: 'A1', campaign_id: 'C1', campaign_name: 'C1', spend: '40', impressions: '400', clicks: '20', reach: '300', actions: [{ action_type: 'lead', value: '2' }] }]);
        return okResponse([{ date_start: '2026-09-12', campaign_id: 'C1', campaign_name: 'C1', spend: '100', impressions: '1000', clicks: '50', reach: '800', actions: [{ action_type: 'lead', value: '5' }] }]);
      },
      replaceWindowRows: async () => {},
      replaceEntityStates: async (account, rows) => {
        replacedStates.push({ account, rows: rows.length });
      },
      upsertSyncState: async () => {},
      now: () => NOW,
    };
    const summary = await syncTrafficInsights(deps, { days: 1 });
    assert.equal(summary.status, 'ok');
    assert.equal(summary.accounts[0]!.entityRows, 2);
    assert.equal(replacedStates.length, 1);
    assert.equal(replacedStates[0]!.rows, 2);
    assert.equal(calls.filter((u) => u.includes('/campaigns?')).length, 1, '1 fetch de campaigns');
    assert.equal(calls.filter((u) => u.includes('/adsets?')).length, 1, '1 fetch de adsets');
  });

  test('falha no fetch de entity state → conta partial (insights preservados)', async () => {
    const deps: TrafficSyncDeps = {
      listAccounts: async () => [ACCOUNT],
      fetchFn: async (url) => {
        if (url.includes('/campaigns?')) return { ok: false, status: 500, text: JSON.stringify({ error: { message: 'state boom', code: 1 } }) };
        if (url.includes('level=adset')) return okResponse([{ date_start: '2026-09-12', adset_id: 'A1', adset_name: 'A1', campaign_id: 'C1', campaign_name: 'C1', spend: '40', impressions: '400', clicks: '20', reach: '300', actions: [] }]);
        return okResponse([{ date_start: '2026-09-12', campaign_id: 'C1', campaign_name: 'C1', spend: '100', impressions: '1000', clicks: '50', reach: '800', actions: [] }]);
      },
      replaceWindowRows: async () => {},
      replaceEntityStates: async () => {},
      upsertSyncState: async () => {},
      now: () => NOW,
    };
    const summary = await syncTrafficInsights(deps, { days: 1 });
    assert.equal(summary.accounts[0]!.status, 'partial');
    assert.ok(summary.accounts[0]!.error?.includes('state boom'));
    assert.equal(summary.accounts[0]!.entityRows, 0);
  });

  test('includeEntityState=false (flag legacy) → nenhum fetch de estado', async () => {
    let entityFetches = 0;
    const deps: TrafficSyncDeps = {
      listAccounts: async () => [ACCOUNT],
      fetchFn: async (url) => {
        if (url.includes('/campaigns?') || url.includes('/adsets?')) entityFetches++;
        if (url.includes('level=adset')) return okResponse([{ date_start: '2026-09-12', adset_id: 'A1', adset_name: 'A1', campaign_id: 'C1', campaign_name: 'C1', spend: '40', impressions: '400', clicks: '20', reach: '300', actions: [] }]);
        return okResponse([{ date_start: '2026-09-12', campaign_id: 'C1', campaign_name: 'C1', spend: '100', impressions: '1000', clicks: '50', reach: '800', actions: [] }]);
      },
      replaceWindowRows: async () => {},
      replaceEntityStates: async () => {},
      upsertSyncState: async () => {},
      now: () => NOW,
    };
    const summary = await syncTrafficInsights(deps, { days: 1, includeEntityState: false });
    assert.equal(summary.status, 'ok');
    assert.equal(summary.accounts[0]!.entityRows, 0);
    assert.equal(entityFetches, 0, 'flag legacy pula a coleta de estado');
  });

  test('dep replaceEntityStates ausente → pulado sem erro (compat deps legadas)', async () => {
    const deps: TrafficSyncDeps = {
      listAccounts: async () => [ACCOUNT],
      fetchFn: async (url) => {
        if (url.includes('level=adset')) return okResponse([{ date_start: '2026-09-12', adset_id: 'A1', adset_name: 'A1', campaign_id: 'C1', campaign_name: 'C1', spend: '40', impressions: '400', clicks: '20', reach: '300', actions: [] }]);
        return okResponse([{ date_start: '2026-09-12', campaign_id: 'C1', campaign_name: 'C1', spend: '100', impressions: '1000', clicks: '50', reach: '800', actions: [] }]);
      },
      replaceWindowRows: async () => {},
      upsertSyncState: async () => {},
      now: () => NOW,
    };
    const summary = await syncTrafficInsights(deps, { days: 1 });
    assert.equal(summary.status, 'ok');
    assert.equal(summary.accounts[0]!.entityRows, 0);
  });
});

// ── Snapshot com degrade P2021 + relatório v2 ───────────────────

interface FakeDbInput {
  rows?: InsightRowLite[];
  entityStatesError?: unknown;
  entityStates?: Array<{ adAccountId: string; level: string; entityId: string; entityName: string | null; campaignId: string | null; dailyBudgetMinor: number | null; lifetimeBudgetMinor: number | null; status: string | null; effectiveStatus: string | null; learningStage: string | null; fetchedAt: Date }>;
}

function fakeDb(input: FakeDbInput): TrafficReadDb {
  return {
    insightRowsSince: async () => input.rows ?? [],
    inboxLeadsSince: async () => [],
    clientsByLeadgenIds: async () => [],
    metaClientsSince: async () => [],
    campaignBindings: async () => [],
    syncStates: async () => [],
    entityStates: async () => {
      if (input.entityStatesError !== undefined) throw input.entityStatesError;
      return input.entityStates ?? [];
    },
  };
}

describe('loadTrafficSnapshot — entity state com degrade (8.2b)', () => {
  test('tabela presente: snapshot traz entityStates e pulse preenchido', async () => {
    const rows = [
      lite({ level: 'campaign', entityId: 'C1', entityName: 'C1', campaignId: 'C1', date: day(0), spend: 100, impressions: 5000, clicks: 150, reach: 4000, leadsMeta: 5 }),
    ];
    const db = fakeDb({
      rows,
      entityStates: [{
        adAccountId: 'act_123',
        level: 'campaign',
        entityId: 'C1',
        entityName: 'C1',
        campaignId: 'C1',
        dailyBudgetMinor: 15000,
        lifetimeBudgetMinor: null,
        status: 'ACTIVE',
        effectiveStatus: 'ACTIVE',
        learningStage: null,
        fetchedAt: NOW,
      }],
    });
    const snap = await loadTrafficSnapshot(db, 7, NOW);
    assert.equal(snap.entityStates.length, 1);
    assert.equal(snap.aggregates[0]!.pulse!.activeDays, 1);
    assert.equal(snap.totals.impressions, 5000);
  });

  test('P2021 (SQL 8.2 pendente) → snapshot segue ok com entityStates vazio', async () => {
    const rows = [lite({ level: 'campaign', entityId: 'C1', campaignId: 'C1', date: day(0), spend: 100, impressions: 5000, clicks: 150, reach: 4000, leadsMeta: 5 })];
    const db = fakeDb({ rows, entityStatesError: { code: 'P2021' } });
    const snap = await loadTrafficSnapshot(db, 7, NOW);
    assert.equal(snap.entityStates.length, 0);
    assert.equal(snap.aggregates.length, 1, 'insights NÃO são afetados pelo SQL 8.2 pendente');
  });

  test('erro arbitrário no entityStates → também degrada (observabilidade nunca derruba)', async () => {
    const db = fakeDb({ rows: [], entityStatesError: new Error('conexão instável') });
    const snap = await loadTrafficSnapshot(db, 7, NOW);
    assert.equal(snap.entityStates.length, 0);
  });
});

describe('buildTrafficReportMarkdown — relatório v2 (8.2)', () => {
  test('tabelas de topo de funil e CRM com métricas novas e tendência', async () => {
    const rows = [
      lite({ level: 'campaign', entityId: 'C1', entityName: 'Campanha Um', campaignId: 'C1', date: day(0), spend: 100, impressions: 5000, clicks: 150, reach: 4000, leadsMeta: 5 }),
      lite({ level: 'campaign', entityId: 'C1', entityName: 'Campanha Um', campaignId: 'C1', date: day(6), spend: 100, impressions: 5000, clicks: 250, reach: 4000, leadsMeta: 8 }),
    ];
    const snap = await loadTrafficSnapshot(fakeDb({ rows }), 7, NOW);
    const report = buildTrafficReportMarkdown({
      aggregates: snap.aggregates,
      windowDays: snap.windowDays,
      generatedAt: NOW,
      accounts: [],
      totals: snap.totals,
    });
    assert.ok(report.includes('## Desempenho por campanha — custo e topo de funil'));
    assert.ok(report.includes('| campanha | gasto | impressões | cliques | CTR | CPM | CPL | leads (Meta) | dias ativos | tendência CPL |'));
    assert.ok(report.includes('## Resultado no CRM por campanha'));
    assert.ok(report.includes('| campanha | clientes | quente | morno | frio | agend. | visitas | propostas | ganhos | perdidos | CPA | win rate |'));
    assert.ok(report.includes('4,0%'), 'CTR derivado dos somas (400/10000)');
    assert.ok(report.includes('R$ 20,00'), 'CPM derivado dos somas (200/10000×1000)');
    assert.ok(report.includes('melhorando'), 'CPL 12,5 → 20 → piorando? não: leads 5→8 → CPL 20→12,5 = melhorando');
  });

  test('seção de estado de entrega: orçamento em BRL a partir de unidades menores', async () => {
    const rows = [lite({ level: 'campaign', entityId: 'C1', entityName: 'C1', campaignId: 'C1', date: day(0), spend: 100, impressions: 5000, clicks: 150, reach: 4000, leadsMeta: 5 })];
    const snap = await loadTrafficSnapshot(fakeDb({
      rows,
      entityStates: [
        {
          adAccountId: 'act_123', level: 'campaign', entityId: 'C1', entityName: 'C1', campaignId: 'C1',
          dailyBudgetMinor: 15000, lifetimeBudgetMinor: null, status: 'ACTIVE', effectiveStatus: 'ACTIVE', learningStage: null, fetchedAt: NOW,
        },
        {
          adAccountId: 'act_123', level: 'adset', entityId: 'A1', entityName: 'Conjunto A1', campaignId: 'C1',
          dailyBudgetMinor: null, lifetimeBudgetMinor: null, status: 'ACTIVE', effectiveStatus: 'ACTIVE', learningStage: 'LEARNING', fetchedAt: NOW,
        },
      ],
    }), 7, NOW);
    const report = buildTrafficReportMarkdown({
      aggregates: snap.aggregates,
      windowDays: snap.windowDays,
      generatedAt: NOW,
      accounts: [],
      totals: snap.totals,
      entityStates: snap.entityStates.map((s) => ({ ...s, accountName: 'Conta Principal' })),
    });
    assert.ok(report.includes('## Estado de entrega e orçamentos'));
    assert.ok(report.includes('R$ 150,00'), '15000 centavos = R$ 150,00');
    assert.ok(report.includes('LEARNING'));
    assert.ok(report.includes('| Conta Principal | conjunto | Conjunto A1 | — | ACTIVE | ACTIVE | LEARNING |'));
  });

  test('sem entityStates → seção omitida sem quebrar o relatório', async () => {
    const rows = [lite({ level: 'campaign', entityId: 'C1', entityName: 'C1', campaignId: 'C1', date: day(0), spend: 100, impressions: 5000, clicks: 150, reach: 4000, leadsMeta: 5 })];
    const snap = await loadTrafficSnapshot(fakeDb({ rows }), 7, NOW);
    const report = buildTrafficReportMarkdown({
      aggregates: snap.aggregates,
      windowDays: snap.windowDays,
      generatedAt: NOW,
      accounts: [],
      totals: snap.totals,
    });
    assert.ok(!report.includes('## Estado de entrega e orçamentos'));
    assert.ok(report.includes('# Relatório de Otimização — Meta Ads'));
  });
});
