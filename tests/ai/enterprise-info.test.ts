/**
 * enterprise-info.test.ts — Cadeia pública publicado → verificado → legado
 * (prompt v1.0 §12 — Fase 5). Rascunho NUNCA é público.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePublicEnterpriseInfo,
  mergePublicInfoWithCatalog,
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

// ── mergePublicInfoWithCatalog — fallback único do catálogo estático ──
// REGRESSÃO (Task 39, "seção pública desatualizada"): o valor publicado no
// banco NUNCA pode ser mascarado pelo catálogo estático.

test('merge: valor do banco vence; catálogo preenche apenas nulos', () => {
  const dbInfo = info({ price: 'R$ 700.000', builder: null });
  const catalog = { price: 'R$ 300.000 (antigo)', builder: 'Construtora do catálogo' };
  const merged = mergePublicInfoWithCatalog(dbInfo, catalog) as Record<string, unknown>;
  assert.equal(merged.price, 'R$ 700.000'); // publicado NOVO preservado
  assert.equal(merged.builder, 'Construtora do catálogo'); // catálogo só preenche nulo
});

test('merge: arrays do banco prevalecem mesmo com catálogo disponível', () => {
  const dbInfo = info({ differentials: ['Piscina nova'], apartmentTypes: [] });
  const catalog = { differentials: ['Diferencial antigo'], apartmentTypes: [{ name: 'Tipo catálogo' }] };
  const merged = mergePublicInfoWithCatalog(dbInfo, catalog) as Record<string, unknown>;
  assert.deepEqual(merged.differentials, ['Piscina nova']);
  assert.deepEqual(merged.apartmentTypes, [{ name: 'Tipo catálogo' }]); // banco vazio → catálogo
});

test('merge: location é preenchida campo a campo', () => {
  const dbInfo = info({ location: { address: null, neighborhood: 'Park Sul', city: null, state: 'DF', region: null, additionalInfo: null } });
  const catalog = {
    location: { address: 'SQPS 103', neighborhood: 'Bairro do catálogo', city: 'Brasília', state: 'DF', region: 'Park Sul', additionalInfo: null },
  };
  const merged = mergePublicInfoWithCatalog(dbInfo, catalog) as Record<string, unknown>;
  const loc = merged.location as Record<string, unknown>;
  assert.equal(loc.address, 'SQPS 103'); // nulo no banco → catálogo
  assert.equal(loc.neighborhood, 'Park Sul'); // banco vence
  assert.equal(loc.city, 'Brasília');
  assert.equal(loc.additionalInfo, null); // catálogo nulo é ignorado
});

test('merge: info nula com catálogo constrói do catálogo; sem catálogo preserva entrada', () => {
  const fromCatalog = mergePublicInfoWithCatalog(null, { price: 'R$ 1.000' }) as Record<string, unknown>;
  assert.equal(fromCatalog.price, 'R$ 1.000');
  const kept = mergePublicInfoWithCatalog(info(), undefined) as Record<string, unknown>;
  assert.equal(kept.price, 'R$ 350.000');
  const nullKept = mergePublicInfoWithCatalog(null, null);
  assert.equal(nullKept, null);
});

test('REGRESSÃO listagem: cadeia pública + merge reflete base nova publicada (Villa Bianco)', () => {
  // Cenário do bug: base nova publicada com preço novo; catálogo/legado têm preço antigo.
  const novoPreco = info({ price: 'R$ 690.000', summary: 'A partir de R$ 690.000' });
  const src: PublicEnterpriseSource = {
    id: 'vb',
    publishedInfo: novoPreco,
    publishedAt: new Date('2026-09-04T12:00:00Z'),
    publishedVersion: 2,
    cachedInfo: info({ price: 'R$ 590.000', summary: 'A partir de R$ 590.000' }), // legado antigo
  };
  const resolved = resolvePublicEnterpriseInfo(src);
  const merged = mergePublicInfoWithCatalog(resolved.info, {
    price: 'R$ 590.000', // catálogo estático antigo
    summary: 'Resumo antigo do catálogo',
  }) as Record<string, unknown>;
  assert.equal(resolved.source, 'published');
  assert.equal(merged.price, 'R$ 690.000');
  assert.equal(merged.summary, 'A partir de R$ 690.000');
});
