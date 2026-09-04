/**
 * enterprise-info.test.ts — Cadeia pública §12-v2: publicado → verificado,
 * SOMENTE com base documental presente. Rascunho NUNCA é público; legado
 * cachedInfo e catálogo estático NUNCA mais alimentam superfícies públicas
 * (regressão Task 40: "preço público ≠ base enviada" / "base removida →
 * nada exibido").
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
    pdfContent: 'conteúdo da base',
    publishedInfo: info(),
    publishedAt: new Date('2026-09-01T12:00:00Z'),
    publishedVersion: 3,
    verifiedInfo: info({ price: 'R$ 999.999' }),
  };
  const r = resolvePublicEnterpriseInfo(src, { requireBaseDocument: true });
  assert.equal(r.source, 'published');
  assert.equal(r.info?.price, 'R$ 350.000');
  assert.equal(r.version, 3);
  assert.equal(r.referenceDate, '2026-09-01T12:00:00.000Z');
});

test('sem publicado, usa verificado', () => {
  const src: PublicEnterpriseSource = {
    id: 'e2',
    pdfContent: 'conteúdo da base',
    publishedInfo: null,
    verifiedInfo: info({ price: 'R$ 500.000' }),
    verifiedInfoAt: new Date('2026-09-02T10:00:00Z'),
  };
  const r = resolvePublicEnterpriseInfo(src, { requireBaseDocument: true });
  assert.equal(r.source, 'verified');
  assert.equal(r.info?.price, 'R$ 500.000');
  assert.ok(r.referenceDate?.startsWith('2026-09-02'));
});

test('publishedInfo corrompido cai para verified (público nunca corrompe)', () => {
  const src: PublicEnterpriseSource = {
    id: 'e4',
    pdfContent: 'conteúdo da base',
    publishedInfo: { quebrado: true },
    verifiedInfo: info(),
  };
  const r = resolvePublicEnterpriseInfo(src, { requireBaseDocument: true });
  assert.equal(r.source, 'verified');
});

test('REGRESSÃO §12-v2: legado cachedInfo NUNCA mais é público', () => {
  // Antes: cachedInfo alimentava a landing (fonte do preço desatualizado).
  const src = {
    id: 'e3-legacy',
    pdfContent: 'conteúdo da base',
    publishedInfo: null,
    verifiedInfo: null,
    cachedInfo: info({ price: 'R$ 590.000 (legado antigo)' }),
  } as unknown as PublicEnterpriseSource;
  const r = resolvePublicEnterpriseInfo(src, { requireBaseDocument: true });
  assert.equal(r.source, 'none');
  assert.equal(r.info, null);
});

test('REGRESSÃO §12-v2: base removida → NADA é público, mesmo com publishedInfo presente', () => {
  const src: PublicEnterpriseSource = {
    id: 'e7',
    pdfContent: null, // admin removeu a base documental
    publishedInfo: info({ price: 'R$ 690.000' }),
    publishedAt: new Date('2026-09-04T12:00:00Z'),
    publishedVersion: 2,
    verifiedInfo: info({ price: 'R$ 690.000' }),
  };
  const r = resolvePublicEnterpriseInfo(src, { requireBaseDocument: true });
  assert.equal(r.source, 'none');
  assert.equal(r.info, null);
  assert.equal(r.referenceDate, null);
});

test('gate de base aceita pdfContent vazio como ausente', () => {
  const src: PublicEnterpriseSource = {
    id: 'e8',
    pdfContent: '   ',
    publishedInfo: info(),
    publishedVersion: 1,
  };
  const r = resolvePublicEnterpriseInfo(src, { requireBaseDocument: true });
  assert.equal(r.source, 'none');
});

test('sem o gate (uso interno), publishedInfo resolve mesmo sem base', () => {
  const src: PublicEnterpriseSource = {
    id: 'e9',
    pdfContent: null,
    publishedInfo: info({ price: 'R$ 1.000.000' }),
    publishedVersion: 5,
  };
  const r = resolvePublicEnterpriseInfo(src);
  assert.equal(r.source, 'published');
  assert.equal(r.info?.price, 'R$ 1.000.000');
});

test('nada disponível → none (nada é inventado)', () => {
  const r = resolvePublicEnterpriseInfo({
    id: 'e5',
    pdfContent: 'base',
    publishedInfo: null,
    verifiedInfo: null,
  }, { requireBaseDocument: true });
  assert.equal(r.source, 'none');
  assert.equal(r.info, null);
});

test('extractionDraft (rascunho) nunca entra na cadeia pública', () => {
  const src: PublicEnterpriseSource = {
    id: 'e6',
    pdfContent: 'base',
    publishedInfo: null,
    verifiedInfo: null,
    // extractionDraft NEM EXISTE no tipo de entrada — o resolver não o aceita
  };
  const r = resolvePublicEnterpriseInfo(src, { requireBaseDocument: true });
  assert.equal(r.source, 'none');
});
