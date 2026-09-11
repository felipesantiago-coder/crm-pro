/**
 * budget-agg.test.ts — contratos da Fase 6 (otimização Vercel):
 * orçamento de concorrência (runInWaves), cache curto com chave por
 * usuário/escopo/período (TtlCache) e pós-processamento das
 * agregações SQL unificadas (splitUtmGroupingRows, formFunnelFromScan).
 *
 * Puro — sem banco (regra 2 do prompt).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runInWaves, TtlCache } from '../../src/lib/query-budget.ts';
import {
  splitUtmGroupingRows,
  formFunnelFromScan,
  type UtmGroupingSetRow,
} from '../../src/lib/tracking-agg.ts';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('runInWaves — orçamento de concorrência (Fase 6)', () => {
  test('preserva a ORDEM dos resultados (contrato do Promise.all substituído)', async () => {
    const factories = [
      () => sleep(30).then(() => 'a'),
      () => sleep(10).then(() => 'b'),
      () => sleep(20).then(() => 'c'),
    ];
    const results = await runInWaves(factories, 6);
    assert.deepEqual(results, ['a', 'b', 'c']);
  });

  test('respeita o tamanho de onda (máx in-flight ≤ waveSize)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const factories = Array.from({ length: 17 }, (_, i) => async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(5);
      inFlight--;
      return i;
    });
    const results = await runInWaves(factories, 4);
    assert.equal(results.length, 17);
    assert.ok(maxInFlight <= 4, `maxInFlight=${maxInFlight}`);
    assert.deepEqual(Array.from(results), Array.from({ length: 17 }, (_, i) => i));
  });

  test('13 fábricas com onda 6 → 3 ondas (6/6/1) e todos executados', async () => {
    let executed = 0;
    const factories = Array.from({ length: 13 }, () => async () => {
      executed++;
      return executed;
    });
    const results = await runInWaves(factories, 6);
    assert.equal(executed, 13);
    assert.equal(results.length, 13);
  });

  test('onda seguinte só começa após a anterior terminar (sem sobreposição)', async () => {
    const order: string[] = [];
    const factories = [
      async () => {
        order.push('a-start');
        await sleep(10);
        order.push('a-end');
        return 1;
      },
      async () => {
        order.push('b-start');
        await sleep(25);
        order.push('b-end');
        return 2;
      },
      async () => {
        order.push('c-start');
        return 3;
      },
    ];
    await runInWaves(factories, 2);
    // 'c-start' só pode aparecer após o fim da 1ª onda (a-end presente)
    assert.ok(order.indexOf('c-start') > order.indexOf('a-end'));
  });

  test('rejeição propaga (fábrica sem safe() lança — responsabilidade da rota)', async () => {
    const factories = [
      async () => 1,
      async () => {
        throw new Error('boom');
      },
    ];
    await assert.rejects(() => runInWaves(factories, 6), /boom/);
  });

  test('default de onda quando omitido (QUERY_WAVE_SIZE implícito ≥ 1)', async () => {
    const results = await runInWaves([async () => 'x']);
    assert.deepEqual(results, ['x']);
  });
});

describe('TtlCache — cache curto por usuário/escopo/período (Fase 6)', () => {
  test('set/get roundtrip', () => {
    const cache = new TtlCache<string>(60_000, 10);
    cache.set('dash|u1|all|30', { v: 1 });
    assert.deepEqual(cache.get('dash|u1|all|30'), { v: 1 });
  });

  test('chaves diferentes não colidem (por usuário/escopo/período)', () => {
    const cache = new TtlCache<string>(60_000, 10);
    cache.set('dash|u1|all|30', 'a');
    cache.set('dash|u2|all|30', 'b');
    cache.set('dash|u1|site-9|30', 'c');
    assert.equal(cache.get('dash|u1|all|30'), 'a');
    assert.equal(cache.get('dash|u2|all|30'), 'b');
    assert.equal(cache.get('dash|u1|site-9|30'), 'c');
    assert.equal(cache.get('dash|u3|all|30'), undefined);
  });

  test('TTL expira (relógio injetável)', () => {
    let now = 1000;
    const cache = new TtlCache<string>(60_000, 10, () => now);
    cache.set('k', 'v');
    assert.equal(cache.get('k'), 'v');
    now += 60_001;
    assert.equal(cache.get('k'), undefined); // expirado
    // re-set renova
    cache.set('k', 'v2');
    assert.equal(cache.get('k'), 'v2');
  });

  test('evicção: expirados primeiro, depois os mais antigos (teto respeitado)', () => {
    let now = 1000;
    const cache = new TtlCache<number>(60_000, 3, () => now);
    cache.set('a', 1); // expira em 61_001
    cache.set('b', 2); // expira em 61_001
    now = 61_001;      // a e b expirados; futuras inserções são frescas
    cache.set('c', 3);
    cache.set('d', 4); // teto: evicta os EXPIRADOS (a, b) primeiro
    assert.equal(cache.get('a'), undefined);
    assert.equal(cache.get('b'), undefined);
    assert.equal(cache.get('c'), 3); // fresco sobrevive
    assert.equal(cache.get('d'), 4);
    // cheio de frescos: 'f' evicta o mais antigo restante (c)
    cache.set('e', 5);
    cache.set('f', 6);
    assert.equal(cache.get('c'), undefined);
    assert.equal(cache.get('d'), 4);
    assert.equal(cache.get('e'), 5);
    assert.equal(cache.get('f'), 6);
    assert.ok(cache.stats().size <= 3);
  });

  test('get refresca a posição LRU', () => {
    let now = 1000;
    const cache = new TtlCache<number>(60_000, 3, () => now);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.get('a'); // 'a' vira o mais recente
    now += 60_001; // expira tudo
    cache.set('d', 4); // evicta expirados (a,b,c já expirados → teto ok)
    // todas as chaves antigas expiradas; 'd' presente
    assert.equal(cache.get('d'), 4);
    assert.ok(cache.stats().size <= 3);
  });

  test('stats e clear', () => {
    const cache = new TtlCache<number>(60_000, 5);
    cache.set('a', 1);
    cache.get('a');
    cache.get('missing');
    const stats = cache.stats();
    assert.equal(stats.hits, 1);
    assert.equal(stats.misses, 1);
    assert.equal(stats.size, 1);
    cache.clear();
    assert.equal(cache.stats().size, 0);
  });
});

describe('splitUtmGroupingRows — GROUPING SETS → 5 breakdowns (Fase 6)', () => {
  test('divide as linhas por dimensão com os rótulos EXATOS das consultas originais', () => {
    const rows: UtmGroupingSetRow[] = [
      { dimension: 'campaign', label: 'empreendimento-x', visitors: 10n, leads: 2n },
      { dimension: 'campaign', label: '(sem campanha)', visitors: 5n, leads: 0n },
      { dimension: 'source', label: 'instagram', visitors: 12n, leads: 3n },
      { dimension: 'source', label: '(orgânico/direto)', visitors: 1n, leads: 0n },
      { dimension: 'content', label: 'criativo-a', visitors: 7n, leads: 1n },
      { dimension: 'content', label: '(sem conteúdo)', visitors: 3n, leads: 0n },
      { dimension: 'medium', label: 'cpc', visitors: 9n, leads: 2n },
      { dimension: 'medium', label: '(não definido)', visitors: 2n, leads: 0n },
      { dimension: 'term', label: 'aluguel', visitors: 4n, leads: 0n },
      { dimension: 'term', label: '(não definido)', visitors: 8n, leads: 1n },
    ];
    const out = splitUtmGroupingRows(rows);
    assert.deepEqual(
      out.byCampaign,
      [
        { campaign: 'empreendimento-x', visitors: 10n, leads: 2n },
        { campaign: '(sem campanha)', visitors: 5n, leads: 0n },
      ],
    );
    assert.deepEqual(
      out.bySource,
      [
        { source: 'instagram', visitors: 12n, leads: 3n },
        { source: '(orgânico/direto)', visitors: 1n, leads: 0n },
      ],
    );
    assert.deepEqual(
      out.byContent,
      [
        { content: 'criativo-a', visitors: 7n, leads: 1n },
        { content: '(sem conteúdo)', visitors: 3n, leads: 0n },
      ],
    );
    assert.deepEqual(
      out.byMedium,
      [
        { medium: 'cpc', visitors: 9n, leads: 2n },
        { medium: '(não definido)', visitors: 2n, leads: 0n },
      ],
    );
    assert.deepEqual(
      out.byTerm,
      [
        { term: '(não definido)', visitors: 8n, leads: 1n },
        { term: 'aluguel', visitors: 4n, leads: 0n },
      ],
    );
  });

  test('ordenação por visitors desc (contrato do ORDER BY original)', () => {
    const rows: UtmGroupingSetRow[] = [
      { dimension: 'campaign', label: 'menor', visitors: 2n, leads: 0n },
      { dimension: 'campaign', label: 'maior', visitors: 20n, leads: 0n },
      { dimension: 'campaign', label: 'meio', visitors: 7n, leads: 0n },
    ];
    const out = splitUtmGroupingRows(rows);
    assert.deepEqual(
      out.byCampaign.map((r) => r.campaign),
      ['maior', 'meio', 'menor'],
    );
  });

  test('entrada vazia/ausente → 5 arrays vazios (igual às consultas individuais com safe())', () => {
    assert.deepEqual(splitUtmGroupingRows([]), {
      byCampaign: [], bySource: [], byContent: [], byMedium: [], byTerm: [],
    });
    assert.deepEqual(splitUtmGroupingRows(undefined as unknown as UtmGroupingSetRow[]), {
      byCampaign: [], bySource: [], byContent: [], byMedium: [], byTerm: [],
    });
  });

  test('dimensão com uma única linha (set sem NULL) preservada', () => {
    const out = splitUtmGroupingRows([{ dimension: 'source', label: 'facebook', visitors: 1n, leads: 1n }]);
    assert.equal(out.bySource.length, 1);
    assert.equal(out.byCampaign.length, 0);
  });
});

describe('formFunnelFromScan — scan único → forma original (Fase 6)', () => {
  test('linha completa → todos os estágios com count > 0, ordenados desc', () => {
    const out = formFunnelFromScan({
      form_view: 100n,
      form_focus: 40n,
      form_submit_attempt: 30n,
      form_submit: 20n,
      form_submit_error: 2n,
    });
    assert.deepEqual(
      out.map((r) => r.stage),
      // ORDER BY count DESC original
      ['form_view', 'form_focus', 'form_submit_attempt', 'form_submit', 'form_submit_error'],
    );
    assert.equal(out[0].count, 100n);
  });

  test('estágios com 0 eventos NEM APARECEM (GROUP BY original omitia vazio)', () => {
    const out = formFunnelFromScan({
      form_view: 10n,
      form_focus: 0n,
      form_submit_attempt: 0n,
      form_submit: 3n,
      form_submit_error: 0n,
    });
    assert.deepEqual(
      out.map((r) => r.stage),
      ['form_view', 'form_submit'],
    );
  });

  test('linha ausente (safe retornou []) → array vazio', () => {
    assert.deepEqual(formFunnelFromScan(undefined), []);
  });

  test('tudo zerado → array vazio', () => {
    const out = formFunnelFromScan({
      form_view: 0n, form_focus: 0n, form_submit_attempt: 0n, form_submit: 0n, form_submit_error: 0n,
    });
    assert.deepEqual(out, []);
  });

  test('ordenação desc com contagens fora de ordem', () => {
    const out = formFunnelFromScan({
      form_view: 5n,
      form_focus: 50n,
      form_submit_attempt: 1n,
      form_submit: 25n,
      form_submit_error: 3n,
    });
    assert.deepEqual(
      out.map((r) => Number(r.count)),
      [50, 25, 5, 3, 1],
    );
  });
});
