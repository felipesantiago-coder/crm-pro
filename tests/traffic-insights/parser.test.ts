/**
 * parser.test.ts — Fase 8 (gestor de tráfego): parser da resposta de
 * insights da Marketing API, janela UTC, URL, formatação e regex legada.
 *
 * Regras críticas testadas:
 *   - leadsMeta = MAX entre action_types de lead (NUNCA soma)
 *   - linhas sem entityId/data inválida são descartadas
 *   - level=adset carrega campaignId/campaignName do pai
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapInsightItems,
  computeInsightWindow,
  buildInsightsUrl,
  extractCampaignNameFromNotes,
  truncateError,
  fmtBRL,
  fmtPct,
  utcDateStr,
  dateAtUtc,
  isPrismaMissingTableError,
} from '../../src/lib/traffic-insights.ts';

const NOW = new Date('2026-09-13T15:30:00.000Z');

describe('computeInsightWindow', () => {
  test('janela de 7 dias termina hoje e começa 6 dias atrás (UTC)', () => {
    const w = computeInsightWindow(7, NOW);
    assert.equal(w.days, 7);
    assert.equal(w.untilStr, '2026-09-13');
    assert.equal(w.sinceStr, '2026-09-07');
    assert.equal(utcDateStr(w.since), '2026-09-07');
  });

  test('janela de 1 dia: since == until == hoje', () => {
    const w = computeInsightWindow(1, NOW);
    assert.equal(w.sinceStr, '2026-09-13');
    assert.equal(w.untilStr, '2026-09-13');
  });

  test('dias fracionários/negativos são truncados para mínimo 1', () => {
    assert.equal(computeInsightWindow(2.7, NOW).days, 2);
    assert.equal(computeInsightWindow(-5, NOW).days, 1);
  });

  test('dateAtUtc rejeita formatos inválidos', () => {
    assert.equal(dateAtUtc('2026-09-13')?.toISOString(), '2026-09-13T00:00:00.000Z');
    assert.equal(dateAtUtc('13/09/2026'), null);
    assert.equal(dateAtUtc(''), null);
    assert.equal(dateAtUtc(null), null);
  });
});

describe('mapInsightItems — level campaign', () => {
  test('mapeia métricas, strings numéricas e leads como MAX de action_types', () => {
    const rows = mapInsightItems(
      [
        {
          date_start: '2026-09-10',
          campaign_id: 'C1',
          campaign_name: 'Lançamento Porto',
          spend: '120.50',
          impressions: '10000',
          clicks: '500',
          reach: '8000',
          cpm: '12.05',
          cpc: '0.24',
          ctr: '5',
          actions: [
            { action_type: 'link_click', value: '400' },
            { action_type: 'lead', value: '10' },
            { action_type: 'onsite_conversion.lead_grouped', value: '12' },
          ],
        },
      ],
      'campaign',
      'act_123',
    );

    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.level, 'campaign');
    assert.equal(row.entityId, 'C1');
    assert.equal(row.entityName, 'Lançamento Porto');
    assert.equal(row.campaignId, 'C1');
    assert.equal(row.campaignName, 'Lançamento Porto');
    assert.equal(row.spend, 120.5);
    assert.equal(row.impressions, 10000);
    assert.equal(row.clicks, 500);
    assert.equal(row.leadsMeta, 12, 'MAX(lead=10, lead_grouped=12) = 12 — nunca soma (22)');
    assert.equal(row.date.toISOString(), '2026-09-10T00:00:00.000Z');
    assert.equal(row.adAccountId, 'act_123');
  });

  test('sem actions de lead → leadsMeta 0; sem campaign_name → null', () => {
    const rows = mapInsightItems(
      [{ date_start: '2026-09-10', campaign_id: 'C2', spend: '5', impressions: '10', clicks: '1', reach: '9' }],
      'campaign',
      'act_123',
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.leadsMeta, 0);
    assert.equal(rows[0]!.entityName, null);
  });

  test('linha sem campaign_id ou com data inválida é descartada', () => {
    const rows = mapInsightItems(
      [
        { date_start: '2026-09-10', spend: '5' },
        { date_start: '13/09/2026', campaign_id: 'C3', spend: '5' },
        'lixo',
        null,
      ],
      'campaign',
      'act_123',
    );
    assert.equal(rows.length, 0);
  });
});

describe('mapInsightItems — level adset', () => {
  test('usa adset_id/adset_name e preserva campaignId/campaignName do pai', () => {
    const rows = mapInsightItems(
      [
        {
          date_start: '2026-09-11',
          adset_id: 'A1',
          adset_name: 'Conjunto VIP',
          campaign_id: 'C1',
          campaign_name: 'Campanha Um',
          spend: '60',
          impressions: '1000',
          clicks: '80',
          reach: '900',
          actions: [{ action_type: 'lead', value: '7' }],
        },
      ],
      'adset',
      'act_456',
    );
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.level, 'adset');
    assert.equal(row.entityId, 'A1');
    assert.equal(row.entityName, 'Conjunto VIP');
    assert.equal(row.campaignId, 'C1');
    assert.equal(row.campaignName, 'Campanha Um');
    assert.equal(row.leadsMeta, 7);
  });
});

describe('buildInsightsUrl', () => {
  test('URL com level, janela, time_increment=1 e token', () => {
    const w = computeInsightWindow(7, NOW);
    const url = buildInsightsUrl({ adAccountId: 'act_123', accessToken: 'TOK&EN' }, 'adset', w);
    assert.ok(url.startsWith('https://graph.facebook.com/'));
    assert.ok(url.includes('/act_123/insights'));
    assert.ok(url.includes('level=adset'));
    assert.ok(url.includes('time_increment=1'));
    assert.ok(url.includes('adset_id'));
    assert.ok(url.includes('campaign_id'));
    assert.ok(url.includes(encodeURIComponent('TOK&EN')));
    assert.ok(url.includes(encodeURIComponent('{"since":"2026-09-07","until":"2026-09-13"}')));
  });
});

describe('extractCampaignNameFromNotes (fonte legada)', () => {
  test('extrai nome quando notes marcado [Meta Ads]', () => {
    const notes = '[Meta Ads] Lead recebido.\nAnúncio: Anúncio X\nCampanha: Campanha Um\nLead ID: 999';
    assert.equal(extractCampaignNameFromNotes(notes), 'Campanha Um');
  });

  test('null sem marcador ou sem linha Campanha:', () => {
    assert.equal(extractCampaignNameFromNotes('Sem marcador Campanha: X'), null);
    assert.equal(extractCampaignNameFromNotes('[Meta Ads] sem campanha'), null);
    assert.equal(extractCampaignNameFromNotes(null), null);
    assert.equal(extractCampaignNameFromNotes(''), null);
  });
});

describe('formatadores e utilitários', () => {
  test('fmtBRL pt-BR sem Intl', () => {
    assert.equal(fmtBRL(0), 'R$ 0,00');
    assert.equal(fmtBRL(1234.5), 'R$ 1.234,50');
    assert.equal(fmtBRL(1234567.89), 'R$ 1.234.567,89');
    assert.equal(fmtBRL(-2), '-R$ 2,00');
  });

  test('fmtPct', () => {
    assert.equal(fmtPct(null), '—');
    assert.equal(fmtPct(0), '0%');
    assert.equal(fmtPct(0.256), '26%');
    assert.equal(fmtPct(1), '100%');
  });

  test('truncateError limpa quebras e trunca com reticências', () => {
    assert.equal(truncateError('a\n b\t c'), 'a b c');
    const long = 'x'.repeat(500);
    const out = truncateError(long, 300);
    assert.equal(out.length, 300);
    assert.ok(out.endsWith('…'));
  });

  test('isPrismaMissingTableError reconhece P2021/P2022 apenas', () => {
    assert.equal(isPrismaMissingTableError({ code: 'P2021' }), true);
    assert.equal(isPrismaMissingTableError({ code: 'P2022' }), true);
    assert.equal(isPrismaMissingTableError({ code: 'P2002' }), false);
    assert.equal(isPrismaMissingTableError(new Error('x')), false);
    assert.equal(isPrismaMissingTableError(null), false);
  });
});
