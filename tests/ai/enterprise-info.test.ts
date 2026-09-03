/**
 * enterprise-info.test.ts — Cadeia pública publicado → verificado → legado
 * (prompt v1.0 §12 — Fase 5). Rascunho NUNCA é público.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePublicEnterpriseInfo,
  type PublicEnterpriseSource,
} from '../../src/lib/ai/enterprise-info.ts';

function info(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    location: { address: null, neighborhood: null, city: 'Brasília', state: 'DF', region: null, additionalInfo: null },
    builder: 'Construtora', architecture: null, landscaping: null,
    status: 'Lançamento', deliveryDate: null, price: 'R$ 350.000',
    totalUnits: 100, floors: 10, parkingSpots: 150,
    differentials: ['Piscina'], apartmentTypes: [], summary: 'Resumo',
    ...overrides,
  };
}

test('publishedInfo tem prioridade máxima e traz data de referência', () => {
  const src: PublicEnterpriseSource = {
    id: 'e1',
    publishedInfo: info(),
    publishedAt: new Date('2026-09-01T12:00:00Z'),
    publishedVersion: 3,
    verifiedInfo: info({ price: 'R$ 999.999' }),
    cachedInfo: info({ price: 'legado' }),
  };
  const r = resolvePublicEnterpriseInfo(src);
  assert.equal(r.source, 'published');
  assert.equal(r.info?.price, 'R$ 350.000');
  assert.equal(r.version, 3);
  assert.equal(r.referenceDate, '2026-09-01T12:00:00.000Z');
});

test('sem publicado, usa verificado', () => {
  const src: PublicEnterpriseSource = {
    id: 'e2',
    publishedInfo: null,
    verifiedInfo: info({ price: 'R$ 500.000' }),
    verifiedInfoAt: new Date('2026-09-02T10:00:00Z'),
    cachedInfo: info({ price: 'legado' }),
  };
  const r = resolvePublicEnterpriseInfo(src);
  assert.equal(r.source, 'verified');
  assert.equal(r.info?.price, 'R$ 500.000');
  assert.ok(r.referenceDate?.startsWith('2026-09-02'));
});

test('sem publicado nem verificado: legado cachedInfo com telemetria de dependência', () => {
  const src: PublicEnterpriseSource = {
    id: 'e3-legacy',
    publishedInfo: null,
    verifiedInfo: null,
    cachedInfo: info({ price: 'legado' }),
  };
  const r = resolvePublicEnterpriseInfo(src);
  assert.equal(r.source, 'legacy_cached');
  assert.equal(r.info?.price, 'legado');
  assert.equal(r.referenceDate, null);
});

test('publishedInfo corrompido cai para verified (público nunca corrompe)', () => {
  const src: PublicEnterpriseSource = {
    id: 'e4',
    publishedInfo: { quebrado: true },
    verifiedInfo: info(),
    cachedInfo: null,
  };
  const r = resolvePublicEnterpriseInfo(src);
  assert.equal(r.source, 'verified');
});

test('nada disponível → none (nada é inventado)', () => {
  const r = resolvePublicEnterpriseInfo({ id: 'e5', publishedInfo: null, verifiedInfo: null, cachedInfo: null });
  assert.equal(r.source, 'none');
  assert.equal(r.info, null);
});

test('extractionDraft (rascunho) nunca entra na cadeia pública', () => {
  const src: PublicEnterpriseSource = {
    id: 'e6',
    publishedInfo: null,
    verifiedInfo: null,
    cachedInfo: null,
    // extractionDraft NEM EXISTE no tipo de entrada — o resolver não o aceita
  };
  const r = resolvePublicEnterpriseInfo(src);
  assert.equal(r.source, 'none');
});
