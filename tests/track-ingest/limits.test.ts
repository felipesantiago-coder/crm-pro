/**
 * limits.test.ts — contratos da Fase 6 (otimização Vercel): limites
 * de corpo/eventos, validação de strings/metadata e escrita
 * particionada com concorrência limitada do /api/track.
 *
 * Fakes implementam a semântica real de escrita (upsert → create →
 * link identify) sem banco (regra 2 do prompt), mesmo padrão dos
 * testes das Fases 3/4 (tests/meta-ingest, tests/lead-queue).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACK_MAX_EVENTS_PER_BATCH,
  TRACK_MAX_URL_LENGTH,
  TRACK_MAX_SHORT_LENGTH,
  TRACK_MAX_ID_LENGTH,
  TRACK_MAX_METADATA_BYTES,
  TRACK_WRITE_CHUNK_SIZE,
  normalizeTrackingEvent,
  normalizeBatch,
  partitionBatch,
  writeEventBatch,
  type TrackingWriteDb,
} from '../../src/lib/track-ingest.ts';

describe('normalizeTrackingEvent — mapeamento snake_case→camelCase preservado', () => {
  test('mapeia campos do pixel (vid/sid/site_id/event/utm_*)', () => {
    const e = normalizeTrackingEvent({
      vid: 'v-123',
      sid: 's-456',
      site_id: 'site-1',
      event: 'cta_click',
      event_name: 'Botão WhatsApp',
      url: 'https://exemplo.com/lp?utm_source=ig',
      utm_source: 'instagram',
      utm_campaign: 'empreendimento-x',
    });
    assert.ok(e);
    assert.equal(e.visitorId, 'v-123');
    assert.equal(e.sessionId, 's-456');
    assert.equal(e.siteId, 'site-1');
    assert.equal(e.eventType, 'cta_click');
    assert.equal(e.eventName, 'Botão WhatsApp');
    assert.equal(e.pageUrl, 'https://exemplo.com/lp?utm_source=ig');
    assert.equal(e.utmSource, 'instagram');
    assert.equal(e.utmCampaign, 'empreendimento-x');
  });

  test('camelCase direto também funciona (API JSON)', () => {
    const e = normalizeTrackingEvent({
      visitorId: 'v-1',
      sessionId: 's-1',
      siteId: 'site-1',
      eventType: 'pageview',
      pageUrl: 'https://exemplo.com/',
    });
    assert.ok(e);
    assert.equal(e.eventType, 'pageview');
    assert.equal(e.utmSource, null);
  });

  test('event sem tipo explícito não quebra (defensivo)', () => {
    const e = normalizeTrackingEvent({ visitorId: 'v-1', siteId: 'site-1' });
    assert.ok(e);
    assert.equal(e.eventType, 'pageview');
  });

  test('eventos inválidos → null (visitorId/siteId ausentes, não-objeto)', () => {
    assert.equal(normalizeTrackingEvent(null), null);
    assert.equal(normalizeTrackingEvent('string'), null);
    assert.equal(normalizeTrackingEvent({ siteId: 'site-1' }), null); // sem visitorId
    assert.equal(normalizeTrackingEvent({ visitorId: 'v-1' }), null); // sem siteId
    assert.equal(normalizeTrackingEvent({ visitorId: 123, siteId: 's' }), null); // não-string
  });
});

describe('limites de strings (Fase 6: valide tamanho de strings)', () => {
  test('pageUrl/referrer cortados em 2048', () => {
    const big = 'https://exemplo.com/?x=' + 'a'.repeat(3000);
    const e = normalizeTrackingEvent({
      visitorId: 'v-1', siteId: 's-1', eventType: 'pageview',
      pageUrl: big, referrer: big,
    });
    assert.ok(e);
    assert.equal(e.pageUrl!.length, TRACK_MAX_URL_LENGTH);
    assert.equal(e.referrer!.length, TRACK_MAX_URL_LENGTH);
  });

  test('utm*/eventName cortados em 256', () => {
    const big = 'u'.repeat(1000);
    const e = normalizeTrackingEvent({
      visitorId: 'v-1', siteId: 's-1', eventType: 'pageview',
      eventName: big, utmSource: big, utmTerm: big,
    });
    assert.ok(e);
    assert.equal(e.eventName!.length, TRACK_MAX_SHORT_LENGTH);
    assert.equal(e.utmSource!.length, TRACK_MAX_SHORT_LENGTH);
    assert.equal(e.utmTerm!.length, TRACK_MAX_SHORT_LENGTH);
  });

  test('ids cortados em 128 (visitorId/sessionId/siteId/eventType)', () => {
    const big = 'i'.repeat(500);
    const e = normalizeTrackingEvent({
      visitorId: big, siteId: big, eventType: big,
    });
    assert.ok(e);
    assert.equal(e.visitorId.length, TRACK_MAX_ID_LENGTH);
    assert.equal(e.siteId.length, TRACK_MAX_ID_LENGTH);
    assert.equal(e.eventType.length, TRACK_MAX_ID_LENGTH);
  });

  test('metadata gigante (>8KB serializada) → marcador de truncamento', () => {
    const e = normalizeTrackingEvent({
      visitorId: 'v-1', siteId: 's-1', eventType: 'pageview',
      junk: 'x'.repeat(TRACK_MAX_METADATA_BYTES + 100),
    });
    assert.ok(e);
    assert.ok(e.metadata);
    assert.equal(e.metadata!._truncated, true);
    assert.equal(e.metadata!._keys, 1);
    // o conteúdo gigante NÃO foi replicado
    const serialized = JSON.stringify(e.metadata);
    assert.ok(serialized.length < 100);
  });

  test('metadata pequena preserva TODOS os campos extras (contrato do pixel)', () => {
    const e = normalizeTrackingEvent({
      visitorId: 'v-1', siteId: 's-1', eventType: 'pageview',
      screen: '390x844', timezone: 'America/Sao_Paulo', geo_hint: 'America/Sao_Paulo',
      cookie_consent: 'granted',
    });
    assert.ok(e);
    // cookie_consent é campo mapeado (não vai para metadata)
    assert.equal(e.metadata?.cookie_consent, undefined);
    assert.equal(e.metadata?.screen, '390x844');
    assert.equal(e.metadata?.timezone, 'America/Sao_Paulo');
    assert.equal(e.metadata?.geo_hint, 'America/Sao_Paulo');
  });

  test('sub-objeto metadata explícito é preservado e truncável', () => {
    const e = normalizeTrackingEvent({
      visitorId: 'v-1', siteId: 's-1', eventType: 'pageview',
      metadata: { foo: 'bar' },
    });
    assert.ok(e);
    assert.equal(e.metadata?.foo, 'bar');
  });

  test('IDENTIFY preservado: lead_id extraído ANTES do truncamento da metadata', () => {
    const e = normalizeTrackingEvent({
      visitorId: 'v-1', siteId: 's-1', eventType: 'identify',
      lead_id: 'lead-42',
      junk: 'x'.repeat(TRACK_MAX_METADATA_BYTES + 100),
    });
    assert.ok(e);
    assert.equal(e.identifyLeadId, 'lead-42');
    assert.equal(e.metadata!._truncated, true);
  });

  test('lead_id cortado em 128', () => {
    const e = normalizeTrackingEvent({
      visitorId: 'v-1', siteId: 's-1', eventType: 'identify',
      lead_id: 'L'.repeat(500),
    });
    assert.ok(e);
    assert.equal(e.identifyLeadId!.length, TRACK_MAX_ID_LENGTH);
  });
});

describe('normalizeBatch — limite de quantidade de eventos (Fase 6)', () => {
  test('objeto único vira lote de 1', () => {
    const { events, stats } = normalizeBatch({ visitorId: 'v-1', siteId: 's-1' });
    assert.equal(events.length, 1);
    assert.deepEqual(stats, { received: 1, kept: 1, truncatedMetadata: 0 });
  });

  test('lote acima do teto é CORTADO (100), não rejeitado — sendBeacon não perde o resto do fluxo', () => {
    const body = Array.from({ length: 250 }, (_, i) => ({ visitorId: `v-${i}`, siteId: 's-1' }));
    const { events, stats } = normalizeBatch(body);
    assert.equal(events.length, TRACK_MAX_EVENTS_PER_BATCH);
    assert.equal(stats.received, 250);
    assert.equal(stats.kept, 100);
  });

  test('lote dentro do teto passa intacto', () => {
    const body = Array.from({ length: 100 }, (_, i) => ({ visitorId: `v-${i}`, siteId: 's-1' }));
    const { events, stats } = normalizeBatch(body);
    assert.equal(events.length, 100);
    assert.equal(stats.received, 100);
    assert.equal(stats.kept, 100);
  });

  test('eventos inválidos são filtrados com estatística', () => {
    const { events, stats } = normalizeBatch([
      { visitorId: 'v-1', siteId: 's-1' },
      { invalid: true },
      null,
      { visitorId: 'v-2', siteId: 's-1' },
    ]);
    assert.equal(events.length, 2);
    assert.equal(stats.received, 4);
    assert.equal(stats.kept, 2);
  });
});

describe('partitionBatch — particionamento do lote', () => {
  test('25 itens com chunk 10 → [10,10,5]', () => {
    const chunks = partitionBatch(Array.from({ length: 25 }, (_, i) => i), 10);
    assert.deepEqual(chunks.map((c) => c.length), [10, 10, 5]);
  });

  test('lote menor que o chunk → 1 chunk', () => {
    const chunks = partitionBatch([1, 2, 3], TRACK_WRITE_CHUNK_SIZE);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].length, 3);
  });

  test('lote vazio → nenhum chunk', () => {
    assert.deepEqual(partitionBatch([], 10), []);
  });
});

describe('writeEventBatch — escrita com concorrência limitada (Fase 6)', () => {
  /**
   * Fake da fatia TrackingWriteDb com a semântica REAL:
   * conta escritas em voo (pico de concorrência), preserva a ordem
   * upsert → create e aplica o link identify.
   */
  function makeDb(opts?: { failEventVisitor?: string }) {
    let inFlight = 0;
    const state = {
      maxInFlight: 0,
      visitorUpserts: [] as string[],
      eventCreates: [] as { visitorId: string; eventType: string; metadata: unknown }[],
      identifyLinks: [] as { visitorId: string; leadId: string }[],
    };

    const db: TrackingWriteDb = {
      trackingVisitor: {
        async upsert(args) {
          inFlight++;
          state.maxInFlight = Math.max(state.maxInFlight, inFlight);
          try {
            if (args.where.visitorId === opts?.failEventVisitor) throw new Error('db down');
            state.visitorUpserts.push(args.where.visitorId);
          } finally {
            inFlight--;
          }
        },
        async update(args) {
          state.identifyLinks.push({ visitorId: args.where.visitorId, leadId: args.data.leadId });
        },
      },
      trackingEvent: {
        async create(args) {
          inFlight++;
          state.maxInFlight = Math.max(state.maxInFlight, inFlight);
          try {
            const d = args.data as { visitorId: string; eventType: string; metadata?: unknown };
            if (d.visitorId === opts?.failEventVisitor) throw new Error('db down');
            state.eventCreates.push({ visitorId: d.visitorId, eventType: d.eventType, metadata: d.metadata });
          } finally {
            inFlight--;
          }
        },
      },
    };
    return { db, state };
  }

  const ip = '203.0.113.9';
  const ua = 'test-agent';

  test('ordem upsert → create por evento e contagem written', async () => {
    const { db, state } = makeDb();
    const events = Array.from({ length: 7 }, (_, i) =>
      normalizeTrackingEvent({ visitorId: `v-${i}`, siteId: 's-1', eventType: 'pageview' })!,
    );
    const result = await writeEventBatch(events, { db, ip, userAgent: ua });
    assert.equal(result.written, 7);
    assert.equal(result.failed, 0);
    assert.equal(state.visitorUpserts.length, 7);
    assert.equal(state.eventCreates.length, 7);
    // todos os visitorIds presentes
    assert.deepEqual(
      state.visitorUpserts.slice().sort(),
      Array.from({ length: 7 }, (_, i) => `v-${i}`).sort(),
    );
  });

  test('concurrência limitada ao chunk (máx in-flight ≤ chunkSize)', async () => {
    const { db, state } = makeDb();
    const events = Array.from({ length: 50 }, (_, i) =>
      normalizeTrackingEvent({ visitorId: `v-${i}`, siteId: 's-1', eventType: 'pageview' })!,
    );
    await writeEventBatch(events, { db, ip, userAgent: ua });
    // 50 eventos → 5 chunks de 10; pico de promessas em voo ≤ 10
    assert.ok(state.maxInFlight <= TRACK_WRITE_CHUNK_SIZE, `maxInFlight=${state.maxInFlight}`);
  });

  test('chunkSize custom respeitado (concurrência 1 = totalmente sequencial)', async () => {
    const { db, state } = makeDb();
    const events = Array.from({ length: 5 }, (_, i) =>
      normalizeTrackingEvent({ visitorId: `v-${i}`, siteId: 's-1', eventType: 'pageview' })!,
    );
    await writeEventBatch(events, { db, ip, userAgent: ua, chunkSize: 1 });
    assert.ok(state.maxInFlight <= 1);
  });

  test('identify cria o link visitor→lead com o lead_id preservado', async () => {
    const { db, state } = makeDb();
    const events = [
      normalizeTrackingEvent({
        visitorId: 'v-lead', siteId: 's-1', eventType: 'identify', lead_id: 'lead-99',
      })!,
    ];
    await writeEventBatch(events, { db, ip, userAgent: ua });
    assert.deepEqual(state.identifyLinks, [{ visitorId: 'v-lead', leadId: 'lead-99' }]);
  });

  test('evento NÃO-identify não cria link', async () => {
    const { db, state } = makeDb();
    const events = [
      normalizeTrackingEvent({
        visitorId: 'v-1', siteId: 's-1', eventType: 'pageview', lead_id: 'lead-99',
      })!,
    ];
    await writeEventBatch(events, { db, ip, userAgent: ua });
    assert.equal(state.identifyLinks.length, 0);
  });

  test('falha de UM evento não interrompe os demais (failed contado)', async () => {
    const { db, state } = makeDb({ failEventVisitor: 'v-3' });
    const events = Array.from({ length: 5 }, (_, i) =>
      normalizeTrackingEvent({ visitorId: `v-${i}`, siteId: 's-1', eventType: 'pageview' })!,
    );
    const result = await writeEventBatch(events, { db, ip, userAgent: ua });
    assert.equal(result.written, 4);
    assert.equal(result.failed, 1);
    assert.equal(state.eventCreates.length, 4);
  });

  test('metadata truncada é escrita como marcador (não explode a coluna Json)', async () => {
    const { db, state } = makeDb();
    const events = [
      normalizeTrackingEvent({
        visitorId: 'v-1', siteId: 's-1', eventType: 'pageview',
        junk: 'x'.repeat(TRACK_MAX_METADATA_BYTES + 10),
      })!,
    ];
    await writeEventBatch(events, { db, ip, userAgent: ua });
    assert.equal((state.eventCreates[0].metadata as { _truncated?: boolean })._truncated, true);
  });
});
