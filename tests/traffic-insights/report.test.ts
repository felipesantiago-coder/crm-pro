/**
 * report.test.ts — Fase 8 (gestor de tráfego): agregação custo × resultado,
 * snapshot com dedupe estruturado×legado e relatório markdown SEM PII.
 *
 * Contratos testados:
 *   - total da campanha = linha de campanha (breakdown de conjuntos NÃO
 *     duplica o total; campanha sem linha própria é sintetizada)
 *   - outcomes estruturado (campaignId) + legado (nome) SOMADOS com
 *     dedupe por leadgenId (legado conta só o que a inbox não cobre)
 *   - nome de campanha resolvido via MetaCampaignBinding
 *   - relatório: guardrails presentes, tabela ordenada por gasto,
 *     alertas (gasto sem lead / leads sem custo) e ZERO PII
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadTrafficSnapshot,
  aggregateCampaignPerformance,
  buildTrafficReportMarkdown,
  zeroOutcome,
  type CampaignOutcome,
  type InsightRowLite,
  type TrafficReadDb,
} from '../../src/lib/traffic-insights.ts';

const NOW = new Date('2026-09-13T12:00:00.000Z');
const SINCE = new Date('2026-09-06T00:00:00.000Z');

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

interface FakeDbInput {
  rows?: InsightRowLite[];
  inbox?: Array<{ campaignId: string | null; leadgenId: string }>;
  clientsByLeadgen?: Array<{ metaLeadgenId: string | null; stage: string | null; metaTemperature: string | null }>;
  legacyClients?: Array<{ metaLeadgenId: string | null; stage: string | null; metaTemperature: string | null; notes: string | null }>;
  bindings?: Array<{ campaignId: string; campaignName: string | null }>;
  states?: Array<{ adAccountId: string; lastStatus: string; lastSyncedAt: Date | null; lastError: string | null }>;
  entityStates?: Array<{ adAccountId: string; level: string; entityId: string; entityName: string | null; campaignId: string | null; dailyBudgetMinor: number | null; lifetimeBudgetMinor: number | null; status: string | null; effectiveStatus: string | null; learningStage: string | null; fetchedAt: Date }>;
  entityStatesError?: unknown;
}

function fakeDb(input: FakeDbInput): TrafficReadDb {
  return {
    insightRowsSince: async () => input.rows ?? [],
    inboxLeadsSince: async () => input.inbox ?? [],
    clientsByLeadgenIds: async () => input.clientsByLeadgen ?? [],
    metaClientsSince: async () => input.legacyClients ?? [],
    campaignBindings: async () => input.bindings ?? [],
    syncStates: async () => input.states ?? [],
    entityStates: async () => {
      if (input.entityStatesError !== undefined) throw input.entityStatesError;
      return input.entityStates ?? [];
    },
  };
}

describe('aggregateCampaignPerformance', () => {
  test('total da campanha vem da linha dela; conjuntos são só breakdown', () => {
    const aggs = aggregateCampaignPerformance({
      rows: [
        lite({ level: 'campaign', entityId: 'C1', entityName: 'Campanha Um', campaignId: 'C1', campaignName: 'Campanha Um', spend: 100, leadsMeta: 5 }),
        lite({ level: 'adset', entityId: 'A1', entityName: 'Conj A1', campaignId: 'C1', campaignName: 'Campanha Um', spend: 60, leadsMeta: 3 }),
        lite({ level: 'adset', entityId: 'A2', entityName: 'Conj A2', campaignId: 'C1', campaignName: 'Campanha Um', spend: 40, leadsMeta: 2 }),
      ],
      outcomesById: new Map(),
      outcomesByName: new Map(),
      bindingNameToId: new Map(),
    });

    assert.equal(aggs.length, 1);
    const c1 = aggs[0]!;
    assert.equal(c1.spend, 100, 'NÃO soma campanha+conjuntos (200)');
    assert.equal(c1.leadsMeta, 5);
    assert.equal(c1.adsets.length, 2);
    assert.deepEqual(c1.adsets.map((a) => a.spend).sort(), [40, 60]);
    assert.equal(c1.cplMeta, 20);
  });

  test('campanha sem linha própria é sintetizada da soma dos conjuntos', () => {
    const aggs = aggregateCampaignPerformance({
      rows: [
        lite({ level: 'adset', entityId: 'A1', entityName: 'Conj A1', campaignId: 'C9', campaignName: 'Só Conjuntos', spend: 70, leadsMeta: 4 }),
        lite({ level: 'adset', entityId: 'A2', entityName: 'Conj A2', campaignId: 'C9', campaignName: 'Só Conjuntos', spend: 30, leadsMeta: 1 }),
      ],
      outcomesById: new Map(),
      outcomesByName: new Map(),
      bindingNameToId: new Map(),
    });

    assert.equal(aggs.length, 1);
    const c9 = aggs[0]!;
    assert.equal(c9.name, 'Só Conjuntos');
    assert.equal(c9.spend, 100);
    assert.equal(c9.leadsMeta, 5);
    assert.equal(c9.adsets.length, 2);
  });

  test('outcome estruturado + legado do MESMO nome somam (leads disjuntos)', () => {
    const structured: CampaignOutcome = { leads: 3, won: 1, lost: 0, quente: 2, morno: 1, frio: 0, agendados: 1, visitas: 1, propostas: 0 };
    const legacy: CampaignOutcome = { leads: 5, won: 0, lost: 2, quente: 0, morno: 3, frio: 2, agendados: 0, visitas: 0, propostas: 0 };
    const aggs = aggregateCampaignPerformance({
      rows: [lite({ level: 'campaign', entityId: 'C1', entityName: 'Campanha Um', campaignId: 'C1', campaignName: 'Campanha Um', spend: 90, leadsMeta: 8 })],
      outcomesById: new Map([['C1', { outcome: structured, name: 'Campanha Um' }]]),
      outcomesByName: new Map([['Campanha Um', legacy]]),
      bindingNameToId: new Map([['Campanha Um', 'C1']]),
    });

    assert.equal(aggs.length, 1, 'mesma campanha — NÃO duplica linha');
    assert.equal(aggs[0]!.outcome.leads, 8);
    assert.equal(aggs[0]!.outcome.won, 1);
    assert.equal(aggs[0]!.outcome.lost, 2);
    assert.equal(aggs[0]!.outcome.quente, 2);
    assert.equal(aggs[0]!.outcome.morno, 4);
    assert.equal(aggs[0]!.outcome.frio, 2);
  });

  test('legado sem correspondente cria linha própria name:<nome> com id resolvido', () => {
    const legacy: CampaignOutcome = { leads: 4, won: 0, lost: 1, quente: 1, morno: 0, frio: 3, agendados: 0, visitas: 0, propostas: 0 };
    const aggs = aggregateCampaignPerformance({
      rows: [],
      outcomesById: new Map(),
      outcomesByName: new Map([['Campanha Antiga', legacy]]),
      bindingNameToId: new Map([['Campanha Antiga', 'C7']]),
    });

    assert.equal(aggs.length, 1);
    assert.equal(aggs[0]!.key, 'name:Campanha Antiga');
    assert.equal(aggs[0]!.campaignId, 'C7');
    assert.equal(aggs[0]!.spend, 0);
    assert.equal(aggs[0]!.outcome.leads, 4);
    assert.equal(aggs[0]!.hasOutcome, true);
  });

  test('CPA e win rate derivados; sem fechados → null', () => {
    const aggs = aggregateCampaignPerformance({
      rows: [lite({ level: 'campaign', entityId: 'C1', entityName: 'C', campaignId: 'C1', campaignName: 'C', spend: 200, leadsMeta: 10 })],
      outcomesById: new Map([['C1', { outcome: { leads: 6, won: 2, lost: 2, quente: 0, morno: 0, frio: 0, agendados: 2, visitas: 1, propostas: 1 }, name: null }]]),
      outcomesByName: new Map(),
      bindingNameToId: new Map(),
    });
    assert.equal(aggs[0]!.cpa, 100);
    assert.equal(aggs[0]!.winRate, 0.5);
  });

  test('ordenação: gasto desc, depois leads desc, depois nome', () => {
    const aggs = aggregateCampaignPerformance({
      rows: [
        lite({ level: 'campaign', entityId: 'A', entityName: 'Aaa', campaignId: 'A', campaignName: 'Aaa', spend: 50, leadsMeta: 0 }),
        lite({ level: 'campaign', entityId: 'B', entityName: 'Bbb', campaignId: 'B', campaignName: 'Bbb', spend: 100, leadsMeta: 0 }),
        lite({ level: 'campaign', entityId: 'D', entityName: 'Ddd', campaignId: 'D', campaignName: 'Ddd', spend: 0, leadsMeta: 9 }),
        lite({ level: 'campaign', entityId: 'E', entityName: 'Eee', campaignId: 'E', campaignName: 'Eee', spend: 0, leadsMeta: 1 }),
      ],
      outcomesById: new Map(),
      outcomesByName: new Map(),
      bindingNameToId: new Map(),
    });
    assert.deepEqual(aggs.map((a) => a.name), ['Bbb', 'Aaa', 'Ddd', 'Eee']);
  });
});

describe('loadTrafficSnapshot — dedupe estruturado × legado', () => {
  const db = fakeDb({
    rows: [
      lite({ level: 'campaign', entityId: 'C1', entityName: 'Campanha Um', campaignId: 'C1', campaignName: 'Campanha Um', spend: 100, leadsMeta: 5 }),
      lite({ level: 'campaign', entityId: 'C2', entityName: 'Campanha Dois', campaignId: 'C2', campaignName: 'Campanha Dois', spend: 150, leadsMeta: 0 }),
    ],
    inbox: [
      { campaignId: 'C1', leadgenId: 'L1' },
      { campaignId: 'C1', leadgenId: 'L2' },
      { campaignId: null, leadgenId: 'LX' },
    ],
    clientsByLeadgen: [
      { metaLeadgenId: 'L1', stage: 'FECHADO_GANHO', metaTemperature: 'QUENTE' },
      { metaLeadgenId: 'L2', stage: 'LEAD', metaTemperature: 'MORNO' },
      { metaLeadgenId: 'LZ', stage: 'PROSPECT', metaTemperature: null }, // fora da janela/inbox — ignorado
    ],
    legacyClients: [
      // L2 está na inbox → DEDUPE: não conta no legado
      { metaLeadgenId: 'L2', stage: 'LEAD', metaTemperature: 'MORNO', notes: '[Meta Ads]\nCampanha: Campanha Um' },
      // leadgen ausente na inbox → conta no legado pelo nome
      { metaLeadgenId: 'L9', stage: 'FECHADO_PERDIDO', metaTemperature: 'FRIO', notes: '[Meta Ads]\nCampanha: Campanha Um' },
      // sem leadgen (manual/antigo) → conta no legado
      { metaLeadgenId: null, stage: 'VISITA_AGENDADA', metaTemperature: 'QUENTE', notes: '[Meta Ads]\nCampanha: Campanha Dois' },
      // NOTA: clientes SEM '[Meta Ads]' nunca chegam aqui — o filtro é
      // responsabilidade do WHERE de metaClientsSince (camada de dados)
    ],
    bindings: [{ campaignId: 'C1', campaignName: 'Campanha Um' }, { campaignId: 'C2', campaignName: 'Campanha Dois' }],
    states: [
      { adAccountId: 'act_123', lastStatus: 'ok', lastSyncedAt: NOW, lastError: null },
    ],
  });

  test('monta agregados com merge correto e contagens de origem', async () => {
    const snap = await loadTrafficSnapshot(db, 7, NOW);

    assert.equal(snap.windowDays, 7);
    assert.equal(snap.counts.structuredLeads, 2, '2 inbox com campaignId (LX sem campaign não conta)');
    assert.equal(snap.counts.legacyLeads, 2, 'L9 + sem leadgen (L2 dedupado, não-meta filtrado antes)');

    assert.equal(snap.aggregates.length, 2);
    const c1 = snap.aggregates.find((a) => a.campaignId === 'C1')!;
    const c2 = snap.aggregates.find((a) => a.campaignId === 'C2')!;
    assert.equal(c1.name, 'Campanha Um');
    assert.equal(c1.outcome.leads, 3, '2 estruturados + 1 legado (L9)');
    assert.equal(c1.outcome.won, 1);
    assert.equal(c1.outcome.lost, 1);
    assert.equal(c1.outcome.frio, 1);
    assert.equal(c2.outcome.leads, 1, 'só o legado sem leadgen');
    assert.equal(c2.outcome.quente, 1);

    // Totais
    assert.equal(snap.totals.spend, 250);
    assert.equal(snap.totals.leadsMeta, 5);
    assert.equal(snap.totals.clientes, 4);
    assert.equal(snap.totals.won, 1);
    assert.equal(snap.totals.lost, 1);
    assert.equal(snap.totals.cplMedio, 50);
    assert.equal(snap.totals.withSpend, 2);
  });

  test('relatório gerado a partir do snapshot tem guardrails e alertas', async () => {
    const snap = await loadTrafficSnapshot(db, 7, NOW);
    const report = buildTrafficReportMarkdown({
      aggregates: snap.aggregates,
      windowDays: snap.windowDays,
      generatedAt: NOW,
      accounts: snap.accounts.map((a) => ({ name: 'Conta Principal', lastStatus: a.lastStatus, lastSyncedAt: a.lastSyncedAt, lastError: a.lastError })),
      totals: snap.totals,
    });

    assert.ok(report.includes('# Relatório de Otimização — Meta Ads'));
    assert.ok(report.includes('guardrails'));
    assert.ok(report.includes('±30%'));
    assert.ok(report.includes('Campanha Um'));
    assert.ok(report.includes('Campanha Dois'));
    assert.ok(report.includes('R$ 250,00'));
    // SEM alerta de gasto-sem-lead para C2: ele tem 1 cliente legado
    // (sem leadgen) atribuído pelo nome — o alerta exige outcome 0
    assert.ok(!report.includes('Gasto sem nenhum lead'));
  });
});

describe('buildTrafficReportMarkdown — higiene e estados', () => {
  test('vazio: mensagem de nenhum dado e sem tabela de conjuntos', () => {
    const report = buildTrafficReportMarkdown({
      aggregates: [],
      windowDays: 30,
      generatedAt: NOW,
      accounts: [],
      totals: {
        spend: 0, impressions: 0, clicks: 0, reach: 0, leadsMeta: 0, cplMedio: null, clientes: 0, won: 0, lost: 0,
        cpaGlobal: null, campaigns: 0, withSpend: 0,
      },
    });
    assert.ok(report.includes('Nenhum dado no período'));
    assert.ok(!report.includes('## Conjuntos'));
    assert.ok(!report.includes('## Status da sincronização'), 'sem contas → seção omitida');
  });

  test('NENHUM dado de cliente (PII) aparece no relatório', () => {
    // Outcomes carregam APENAS contagens — não há campo de nome/telefone
    // no tipo; a prova é estrutural + o relatório não tem coluna de PII.
    const aggs = aggregateCampaignPerformance({
      rows: [lite({ level: 'campaign', entityId: 'C1', entityName: 'Campanha Um', campaignId: 'C1', campaignName: 'Campanha Um', spend: 300, leadsMeta: 20 })],
      outcomesById: new Map([['C1', { outcome: { leads: 20, won: 3, lost: 4, quente: 10, morno: 5, frio: 5, agendados: 6, visitas: 4, propostas: 3 }, name: 'Campanha Um' }]]),
      outcomesByName: new Map(),
      bindingNameToId: new Map(),
    });
    const report = buildTrafficReportMarkdown({
      aggregates: aggs,
      windowDays: 7,
      generatedAt: NOW,
      accounts: [{ name: 'Conta', lastStatus: 'ok', lastSyncedAt: NOW, lastError: null }],
      totals: { spend: 300, impressions: 12000, clicks: 400, reach: 9000, leadsMeta: 20, cplMedio: 15, clientes: 20, won: 3, lost: 4, cpaGlobal: 100, campaigns: 1, withSpend: 1 },
    });

    // Padrões de PII que NUNCA podem aparecer
    assert.ok(!report.includes('Fulano'));
    assert.ok(!report.includes('@'));
    assert.ok(!report.includes('telefone'));
    assert.ok(!/\d{10,11}/.test(report), 'sem telefone cru');
    assert.ok(!report.includes('notes'));
  });

  test('leads sem custo vinculado entram como alerta', () => {
    const report = buildTrafficReportMarkdown({
      aggregates: [{
        key: 'name:Orgânico',
        campaignId: null,
        name: 'Orgânico',
        spend: 0,
        impressions: 0,
        clicks: 0,
        reach: 0,
        leadsMeta: 0,
        cplMeta: null,
        cpm: null,
        ctr: null,
        frequency: null,
        outcome: { leads: 7, won: 0, lost: 0, quente: 0, morno: 0, frio: 0, agendados: 0, visitas: 0, propostas: 0 },
        cpa: null,
        winRate: null,
        hasSpend: false,
        hasOutcome: true,
        adsets: [],
      }],
      windowDays: 7,
      generatedAt: NOW,
      accounts: [],
      totals: { spend: 0, impressions: 0, clicks: 0, reach: 0, leadsMeta: 0, cplMedio: null, clientes: 7, won: 0, lost: 0, cpaGlobal: null, campaigns: 1, withSpend: 0 },
    });
    assert.ok(report.includes('Leads sem custo vinculado: Orgânico'));
  });

  test('gasto sem NENHUM lead (Meta e CRM) dispara alerta de queima', () => {
    const report = buildTrafficReportMarkdown({
      aggregates: [{
        key: 'C3',
        campaignId: 'C3',
        name: 'Campanha Queimada',
        spend: 200,
        impressions: 0,
        clicks: 0,
        reach: 0,
        leadsMeta: 0,
        cplMeta: null,
        cpm: null,
        ctr: null,
        frequency: null,
        outcome: zeroOutcome(),
        cpa: null,
        winRate: null,
        hasSpend: true,
        hasOutcome: false,
        adsets: [],
      }],
      windowDays: 7,
      generatedAt: NOW,
      accounts: [],
      totals: { spend: 200, impressions: 0, clicks: 0, reach: 0, leadsMeta: 0, cplMedio: null, clientes: 0, won: 0, lost: 0, cpaGlobal: null, campaigns: 1, withSpend: 1 },
    });
    assert.ok(report.includes('Gasto sem nenhum lead: Campanha Queimada (R$ 200,00)'));
  });
});

describe('zeroOutcome', () => {
  test('outcome zerado novo a cada chamada', () => {
    const a = zeroOutcome();
    const b = zeroOutcome();
    assert.notEqual(a, b);
    assert.deepEqual(a, b);
    assert.equal(a.leads, 0);
  });
});
