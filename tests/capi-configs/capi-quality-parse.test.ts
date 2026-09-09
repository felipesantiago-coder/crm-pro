/**
 * capi-quality-parse.test.ts — Parser da resposta da Dataset Quality API
 * da Meta (GET /v26.0/dataset_quality). O parser é defensivo: a Meta varia
 * o shape entre versões/tipos de dataset, então campos ausentes precisam
 * virar null/[] sem quebrar — o painel exibe o que existir.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDatasetQuality, emqTone } from '../../src/lib/meta-dataset-quality.ts';

test('resposta completa: EMQ, match keys, coverage e diagnostics normalizados', () => {
  const raw = {
    web: [
      {
        event_name: 'Purchase',
        event_match_quality: {
          composite_score: 6.2,
          match_key_feedback: [
            { identifier: 'email', coverage: { percentage: 100 } },
            { identifier: 'ip_address', coverage: { percentage: 99.9 } },
          ],
          diagnostics: [
            {
              name: 'Missing fields',
              description: 'descr',
              solution: 'Send more fields',
              percentage: 59.5,
              affected_event_count: 18930,
              total_event_count: 31830,
            },
          ],
        },
        event_coverage: { percentage: 34.1, goal_percentage: 75 },
      },
    ],
  };
  const { events } = parseDatasetQuality(raw);
  assert.equal(events.length, 1);
  const ev = events[0];
  assert.equal(ev.eventName, 'Purchase');
  assert.equal(ev.emq, 6.2);
  assert.deepEqual(ev.matchKeys, [
    { identifier: 'email', percentage: 100 },
    { identifier: 'ip_address', percentage: 99.9 },
  ]);
  assert.deepEqual(ev.coverage, { percentage: 34.1, goal: 75 });
  assert.equal(ev.diagnostics.length, 1);
  assert.equal(ev.diagnostics[0].name, 'Missing fields');
  assert.equal(ev.diagnostics[0].affectedEventCount, 18930);
  assert.equal(ev.diagnostics[0].solution, 'Send more fields');
});

test('web vazio ou ausente → lista vazia (dataset novo, sem tráfego)', () => {
  assert.deepEqual(parseDatasetQuality({}).events, []);
  assert.deepEqual(parseDatasetQuality({ web: [] }).events, []);
  assert.deepEqual(parseDatasetQuality(null).events, []);
});

test('entrada sem campos opcionais → defaults defensivos (sem lançar)', () => {
  const { events } = parseDatasetQuality({ web: [{ event_name: 'Lead' }] });
  assert.equal(events.length, 1);
  assert.equal(events[0].emq, null);
  assert.deepEqual(events[0].matchKeys, []);
  assert.equal(events[0].coverage, null);
  assert.deepEqual(events[0].diagnostics, []);
});

test('score numérico em string ("7.2") é convertido; lixo vira null', () => {
  const { events } = parseDatasetQuality({
    web: [
      { event_name: 'A', event_match_quality: { composite_score: '7.2' } },
      { event_name: 'B', event_match_quality: { composite_score: 'abc' } },
    ],
  });
  assert.equal(events[0].emq, 7.2);
  assert.equal(events[1].emq, null);
});

test('match_key_feedback malformado é filtrado (identifier obrigatório)', () => {
  const { events } = parseDatasetQuality({
    web: [
      {
        event_name: 'X',
        event_match_quality: {
          match_key_feedback: [{ identifier: 'email', coverage: { percentage: 90 } }, null, {}, { coverage: { percentage: 1 } }],
        },
      },
    ],
  });
  assert.deepEqual(events[0].matchKeys, [{ identifier: 'email', percentage: 90 }]);
});

test('emqTone: faixas ≥7 bom, 4-6.9 médio, <4 fraco, null/NaN sem dados', () => {
  assert.equal(emqTone(8), 'good');
  assert.equal(emqTone(7), 'good');
  assert.equal(emqTone(6.9), 'mid');
  assert.equal(emqTone(4), 'mid');
  assert.equal(emqTone(3.9), 'low');
  assert.equal(emqTone(0), 'low');
  assert.equal(emqTone(null), 'none');
  assert.equal(emqTone(undefined), 'none');
  assert.equal(emqTone(NaN), 'none');
});
