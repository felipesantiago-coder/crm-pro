/**
 * snapshot.test.ts — contratos da Fase 7 (otimização Vercel): snapshot
 * público versionado com invalidação por IMPRESSÃO DIGITAL de frescor
 * (Enterprise.updatedAt + publishedVersion).
 *
 * Prova de cobertura de invalidação exigida pelo doc de otimização
 * ("invalidação exige prova de cobertura por locale/fluxo de publicação"):
 *   - publish/troca  → updatedAt e/ou publishedVersion divergem → recompute
 *   - remoção de base → compose null → 404 imediato
 *   - locale PT/EN/ES → chaves (slug, locale) independentes
 *   - concorrência publish/request → convergência sem lock (digital)
 *   - higiene        → payload NUNCA carrega pdfContent/draft/brutos/PII
 *
 * Fakes implementam a semântica real (regra 2 do prompt) — nenhum banco.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  servePublicEnterprise,
  invalidatePublicSnapshotsForEnterprise,
  publicSnapshotTtlSeconds,
  type PublicSnapshotDeps,
  type EnterpriseFreshness,
  type PublicSnapshotRow,
  type SaveSnapshotInput,
} from '../../src/lib/public-snapshot.ts';
import {
  buildPublicEnterprisePayload,
  PUBLIC_LOCALES,
  resolveI18nString,
} from '../../src/lib/public-enterprise-view.ts';

// ── Fixtures ────────────────────────────────────────────────────────

const T1 = new Date('2026-09-10T12:00:00.000Z');
const T2 = new Date('2026-09-11T15:30:00.000Z');
const NOW = new Date('2026-09-11T16:00:00.000Z');

/** EnterpriseInfo VÁLIDA no enterpriseInfoSchema (contrato de publish). */
const VALID_INFO = {
  location: {
    address: 'Rua das Acácias, 100', neighborhood: 'Portal do Parque',
    city: 'Campinas', state: 'SP', region: 'Portal do Parque', additionalInfo: null,
  },
  builder: 'Construtora Alfa', architecture: null, landscaping: null,
  status: 'Em Construção', deliveryDate: 'Dez/2027', price: 'R$ 400 mil',
  totalUnits: 120, floors: 8, parkingSpots: 140,
  differentials: ['Varanda gourmet'],
  apartmentTypes: [{ name: 'Tipo 1', area: '72 m²', bedrooms: '2', description: null, price: 'R$ 400 mil' }],
  summary: 'ficha publicada',
};

const PAYLOAD_V1 = Object.freeze({ id: 'e1', name: 'Villa Bianco', infoSource: 'published', cachedInfo: { summary: 'v1' } }) as Record<string, unknown>;
const PAYLOAD_V2 = Object.freeze({ id: 'e1', name: 'Villa Bianco', infoSource: 'published', cachedInfo: { summary: 'v2' } }) as Record<string, unknown>;

interface FakeState {
  freshness: EnterpriseFreshness | null;
  snapshot: PublicSnapshotRow | null;
  /** Locale da linha `snapshot` (modela a chave UNIQUE (slug, locale)). */
  snapshotLocale?: string;
  composeResult: Record<string, unknown> | null;
  composeDelayMs?: number;
  /** Simula publish concorrente: roda APÓS a freshness lida, durante a compose. */
  onCompose?: () => void;
  failFindSnapshot?: boolean;
  failSave?: boolean;
}

function makeDeps(state: FakeState) {
  const calls = {
    freshness: 0,
    findSnapshot: 0,
    compose: 0,
    save: 0,
    savedInputs: [] as SaveSnapshotInput[],
    snapshotLookups: [] as Array<{ slug: string; locale: string }>,
  };
  const deps: PublicSnapshotDeps = {
    async findEnterpriseFreshness() {
      calls.freshness++;
      return state.freshness;
    },
    async findSnapshot(slug, locale) {
      calls.findSnapshot++;
      calls.snapshotLookups.push({ slug, locale });
      if (state.failFindSnapshot) throw new Error('P2021: tabela ausente');
      // A chave de leitura real é (slug, locale) — a linha só existe para
      // o locale dela (UNIQUE enterprise_public_snapshots_slug_locale_key).
      if ((state.snapshotLocale ?? 'pt-BR') !== locale) return null;
      return state.snapshot;
    },
    async compose() {
      calls.compose++;
      if (state.composeDelayMs) {
        await new Promise((r) => setTimeout(r, state.composeDelayMs));
      }
      // Publish concorrente commita DURANTE a composição (a freshness da
      // request em voo fica antiga — exatamente a corrida real).
      state.onCompose?.();
      return state.composeResult;
    },
    async saveSnapshot(input) {
      calls.save++;
      if (state.failSave) throw new Error('save falhou');
      calls.savedInputs.push(input);
      // Semântica real de UPSERT: linha passa a ser o estado salvo.
      state.snapshot = {
        payload: input.payload,
        baseUpdatedAt: input.baseUpdatedAt,
        version: input.version,
        refreshedAt: input.now,
      };
      state.snapshotLocale = input.locale;
    },
  };
  return { deps, calls };
}

// ── Caminho feliz (hit) ─────────────────────────────────────────────

describe('servePublicEnterprise — caminho feliz', () => {
  test('hit: digital bate e TTL vigente → serve snapshot SEM recompor', async () => {
    const state: FakeState = {
      freshness: { id: 'e1', updatedAt: T1, publishedVersion: 3 },
      snapshot: { payload: PAYLOAD_V1, baseUpdatedAt: T1, version: 3, refreshedAt: new Date(NOW.getTime() - 10_000) },
      composeResult: PAYLOAD_V2,
    };
    const { deps, calls } = makeDeps(state);
    const served = await servePublicEnterprise(deps, { slug: 'villa-bianco', locale: 'pt-BR', now: NOW });
    assert.equal(served?.fromSnapshot, true);
    assert.deepEqual(served?.payload, PAYLOAD_V1);
    assert.equal(calls.compose, 0, 'hit NÃO deve recompor');
    assert.equal(calls.freshness, 1, 'frescor verificado a CADA request');
    assert.equal(calls.save, 0);
  });

  test('publish (updatedAt diverge) → recomposição IMEDIATA no request seguinte', async () => {
    const state: FakeState = {
      freshness: { id: 'e1', updatedAt: T2, publishedVersion: 4 },
      snapshot: { payload: PAYLOAD_V1, baseUpdatedAt: T1, version: 3, refreshedAt: new Date(NOW.getTime() - 1_000) },
      composeResult: PAYLOAD_V2,
    };
    const { deps, calls } = makeDeps(state);
    const served = await servePublicEnterprise(deps, { slug: 'villa-bianco', locale: 'pt-BR', now: NOW });
    assert.equal(served?.fromSnapshot, false);
    assert.deepEqual(served?.payload, PAYLOAD_V2);
    assert.equal(calls.compose, 1);
    assert.equal(calls.save, 1);
    assert.equal(calls.savedInputs[0]?.version, 4, 'snapshot regravado com a version nova');
    assert.equal(calls.savedInputs[0]?.baseUpdatedAt?.getTime(), T2.getTime());
  });

  test('publishedVersion diverge (mesma updatedAt) → recompute', async () => {
    const state: FakeState = {
      freshness: { id: 'e1', updatedAt: T1, publishedVersion: 5 },
      snapshot: { payload: PAYLOAD_V1, baseUpdatedAt: T1, version: 4, refreshedAt: new Date(NOW.getTime() - 1_000) },
      composeResult: PAYLOAD_V2,
    };
    const { deps, calls } = makeDeps(state);
    const served = await servePublicEnterprise(deps, { slug: 's', locale: 'pt-BR', now: NOW });
    assert.equal(calls.compose, 1);
    assert.deepEqual(served?.payload, PAYLOAD_V2);
  });

  test('TTL de segurança expira → recompute mesmo com digital igual', async () => {
    const ttl = publicSnapshotTtlSeconds() * 1000;
    const state: FakeState = {
      freshness: { id: 'e1', updatedAt: T1, publishedVersion: 3 },
      snapshot: { payload: PAYLOAD_V1, baseUpdatedAt: T1, version: 3, refreshedAt: new Date(NOW.getTime() - ttl - 1) },
      composeResult: PAYLOAD_V2,
    };
    const { deps, calls } = makeDeps(state);
    await servePublicEnterprise(deps, { slug: 's', locale: 'pt-BR', now: NOW });
    assert.equal(calls.compose, 1, 'snapshot mais velho que o TTL é revalidado');
  });
});

// ── Locale PT/EN/ES ────────────────────────────────────────────────

describe('servePublicEnterprise — locale PT/EN/ES', () => {
  test('cada locale é um snapshot independente (miss em um não serve outro)', async () => {
    const state: FakeState = {
      freshness: { id: 'e1', updatedAt: T1, publishedVersion: 3 },
      // snapshot só do pt-BR
      snapshot: { payload: PAYLOAD_V1, baseUpdatedAt: T1, version: 3, refreshedAt: NOW },
      composeResult: { ...PAYLOAD_V1, infoSource: 'published' },
    };
    const { deps, calls } = makeDeps(state);

    const pt = await servePublicEnterprise(deps, { slug: 's', locale: 'pt-BR', now: NOW });
    assert.equal(pt?.fromSnapshot, true, 'pt-BR bate com o snapshot existente');

    const en = await servePublicEnterprise(deps, { slug: 's', locale: 'en', now: NOW });
    assert.equal(en?.fromSnapshot, false, 'en não pode servir o snapshot do pt-BR');
    assert.deepEqual(
      calls.snapshotLookups,
      [
        { slug: 's', locale: 'pt-BR' },
        { slug: 's', locale: 'en' },
      ],
    );
  });

  test('locales suportados pela fonte única: pt-BR, en, es', () => {
    assert.deepEqual([...PUBLIC_LOCALES], ['pt-BR', 'en', 'es']);
  });
});

// ── Remoção (404 imediato) ─────────────────────────────────────────

describe('servePublicEnterprise — remoção', () => {
  test('base removida → compose null → serve null (página some por request)', async () => {
    const state: FakeState = {
      freshness: { id: 'e1', updatedAt: T2, publishedVersion: 3 },
      snapshot: { payload: PAYLOAD_V1, baseUpdatedAt: T1, version: 3, refreshedAt: NOW },
      composeResult: null, // gate §12-v2: source 'none'
    };
    const { deps, calls } = makeDeps(state);
    const served = await servePublicEnterprise(deps, { slug: 's', locale: 'pt-BR', now: NOW });
    assert.equal(served, null);
    assert.equal(calls.compose, 1);
    assert.equal(calls.save, 0, 'nada é salvo quando não há payload público');
  });

  test('slug inexistente → null sem nem consultar snapshot', async () => {
    const state: FakeState = {
      freshness: null,
      snapshot: null,
      composeResult: null,
    };
    const { deps, calls } = makeDeps(state);
    const served = await servePublicEnterprise(deps, { slug: 'nao-existe', locale: 'pt-BR', now: NOW });
    assert.equal(served, null);
    assert.equal(calls.findSnapshot, 0);
    assert.equal(calls.compose, 0);
  });
});

// ── Degradação automática (padrão Fases 3/4/6) ─────────────────────

describe('servePublicEnterprise — degradação', () => {
  test('tabela ausente (P2021) no findSnapshot → composição dinâmica, sem quebrar', async () => {
    const state: FakeState = {
      freshness: { id: 'e1', updatedAt: T1, publishedVersion: 3 },
      snapshot: null,
      composeResult: PAYLOAD_V1,
      failFindSnapshot: true,
    };
    const { deps, calls } = makeDeps(state);
    const served = await servePublicEnterprise(deps, { slug: 's', locale: 'pt-BR', now: NOW });
    assert.equal(served?.fromSnapshot, false);
    assert.deepEqual(served?.payload, PAYLOAD_V1);
    assert.equal(calls.compose, 1, 'degrada para a composição canônica');
  });

  test('falha ao SALVAR snapshot não falha a request pública', async () => {
    const state: FakeState = {
      freshness: { id: 'e1', updatedAt: T1, publishedVersion: 3 },
      snapshot: null,
      composeResult: PAYLOAD_V1,
      failSave: true,
    };
    const { deps, calls } = makeDeps(state);
    const served = await servePublicEnterprise(deps, { slug: 's', locale: 'pt-BR', now: NOW });
    assert.deepEqual(served?.payload, PAYLOAD_V1, 'payload servido mesmo sem persistir');
    assert.equal(calls.save, 1, 'save foi tentado');
  });

  test('flag PUBLIC_SNAPSHOT_V2=legacy → composição direta, sem tocar snapshot', async () => {
    process.env.PUBLIC_SNAPSHOT_V2 = 'legacy';
    try {
      const state: FakeState = {
        freshness: { id: 'e1', updatedAt: T1, publishedVersion: 3 },
        snapshot: { payload: PAYLOAD_V1, baseUpdatedAt: T1, version: 3, refreshedAt: NOW },
        composeResult: PAYLOAD_V2,
      };
      const { deps, calls } = makeDeps(state);
      const served = await servePublicEnterprise(deps, { slug: 's', locale: 'pt-BR', now: NOW });
      assert.equal(served?.fromSnapshot, false);
      assert.deepEqual(served?.payload, PAYLOAD_V2);
      assert.equal(calls.freshness, 0, 'caminho legacy nem lê a digital');
      assert.equal(calls.findSnapshot, 0);
    } finally {
      delete process.env.PUBLIC_SNAPSHOT_V2;
    }
  });
});

// ── Invalidação explícita (tabelas filhas) ─────────────────────────

describe('invalidatePublicSnapshotsForEnterprise', () => {
  test('deleteMany escopado por enterpriseId', async () => {
    const deleted: unknown[] = [];
    const dbLike = {
      enterprisePublicSnapshot: {
        async deleteMany(args: { where: { enterpriseId: string } }) {
          deleted.push(args);
          return { count: 3 };
        },
      },
    };
    await invalidatePublicSnapshotsForEnterprise(dbLike, 'e1');
    assert.deepEqual(deleted, [{ where: { enterpriseId: 'e1' } }]);
  });

  test('falha na invalidação NUNCA propaga (TTL cobre a convergência)', async () => {
    const dbLike = {
      enterprisePublicSnapshot: {
        async deleteMany() {
          throw new Error('P2021');
        },
      },
    };
    await assert.doesNotReject(
      invalidatePublicSnapshotsForEnterprise(dbLike, 'e1'),
    );
  });
});

// ── Higiene do payload (nunca cacheie draft/PII/documento) ─────────

describe('higiene do payload público (fonte única da compose)', () => {
  const ENTERPRISE_COMPLETO = {
    id: 'e1',
    name: 'Villa Bianco',
    slug: 'villa-bianco',
    region: 'Portal do Parque',
    imageUrl: 'https://cdn/hero.webp',
    landingTitle: { 'pt-BR': 'Villa', en: 'Villa', es: 'Villa' },
    landingSubtitle: { 'pt-BR': 'Sub PT', en: 'Sub EN', es: 'Sub ES' },
    landingDescription: { 'pt-BR': 'Desc PT' },
    pdfContent: 'DOCUMENTO INTERNO INTEIRO — NUNCA PÚBLICO',
    documentHash: 'abc123',
    extractionDraft: { fields: [{ field: 'price', status: 'found' }] },
    publishedInfo: VALID_INFO,
    publishedAt: T1,
    publishedVersion: 3,
    verifiedInfo: VALID_INFO,
    verifiedInfoAt: T1,
    cachedInfo: null,
    cachedInfoI18n: { en: { summary: 'published sheet' } },
    mapLatitude: -23.5,
    mapLongitude: -46.6,
    createdAt: T1,
    _count: { clients: 42 },
    images: [{ id: 'i1', url: 'https://cdn/1.webp', altText: 'Fachada', sortOrder: 0 }],
    floorPlans: [{ id: 'f1', url: null, name: 'Torre A', sortOrder: 0 }],
    formFields: [{ id: 'ff1', label: 'Nome', fieldType: 'text', required: true, sortOrder: 0 }],
  };

  test('payload NUNCA contém pdfContent/draft/hash/publishedInfo/verifiedInfo/cachedInfoI18n', () => {
    const payload = buildPublicEnterprisePayload(ENTERPRISE_COMPLETO, 'pt-BR');
    assert.ok(payload, 'enterprise com base+publicado deve compor payload');
    for (const proibido of ['pdfContent', 'documentHash', 'extractionDraft', 'publishedInfo', 'verifiedInfo', 'cachedInfoI18n', 'verifiedInfoBy', 'extractionDraftAt']) {
      assert.equal(proibido in payload, false, `campo interno vazando: ${proibido}`);
    }
  });

  test('payload contém o que a landing consome + infoSource', () => {
    const payload = buildPublicEnterprisePayload(ENTERPRISE_COMPLETO, 'pt-BR')!;
    assert.equal(payload.infoSource, 'published');
    assert.deepEqual(payload.cachedInfo, VALID_INFO);
    assert.equal(payload.landingTitle, 'Villa');
    assert.equal(payload.landingSubtitle, 'Sub PT');
    assert.equal((payload.images as unknown[]).length, 1);
    assert.equal((payload.formFields as unknown[]).length, 1);
    assert.deepEqual(payload._count, { clients: 42 });
    assert.equal(typeof payload.createdAt, 'string');
  });

  test('i18n: en resolve tradução da ficha; sem tradução mantém base', () => {
    const en = buildPublicEnterprisePayload(ENTERPRISE_COMPLETO, 'en');
    assert.ok(en, 'base+publicado válidos → payload não pode ser null');
    assert.deepEqual(en.cachedInfo, { ...VALID_INFO, summary: 'published sheet' });
    assert.equal(en.landingSubtitle, 'Sub EN');
    const es = buildPublicEnterprisePayload(ENTERPRISE_COMPLETO, 'es')!;
    assert.deepEqual(es.cachedInfo, VALID_INFO, 'sem tradução es → base pt-BR (não ressuscita)');
    assert.equal(es.landingSubtitle, 'Sub ES');
  });

  test('gate §12-v2: sem base documental → null mesmo com publicado', () => {
    const semBase = { ...ENTERPRISE_COMPLETO, pdfContent: null };
    assert.equal(buildPublicEnterprisePayload(semBase, 'pt-BR'), null);
  });

  test('resolveI18nString: locale → pt-BR → primeiro valor → null', () => {
    const field = { 'pt-BR': 'base', en: 'inglês' } as Record<string, string>;
    assert.equal(resolveI18nString(field, 'en'), 'inglês');
    assert.equal(resolveI18nString(field, 'pt-BR'), 'base');
    assert.equal(resolveI18nString(field, 'es'), 'base');
    assert.equal(resolveI18nString({ en: 'x' } as Record<string, string>, 'en'), 'x');
    assert.equal(resolveI18nString(null, 'en'), null);
  });
});

// ── Concorrência publish/request ───────────────────────────────────

describe('concorrência publish × request', () => {
  test('publish commita DURANTE a compose: request em voo responde, próxima revalida', async () => {
    // freshness lida = T1/v3; o publish muda o banco para T2/v4 DURANTE a
    // composição; a compose devolve o payload NOVO (leitura pós-publish).
    // Snapshot é salvo com a digital LIDA (T1/v3) → INSTANTANEAMENTE stale
    // → o request seguinte recompõe. Sem lock: a digital é a verdade.
    const state: FakeState = {
      freshness: { id: 'e1', updatedAt: T1, publishedVersion: 3 },
      snapshot: null,
      composeResult: PAYLOAD_V2,
      composeDelayMs: 5,
      onCompose: () => {
        state.freshness = { id: 'e1', updatedAt: T2, publishedVersion: 4 };
      },
    };
    const { deps, calls } = makeDeps(state);
    const served = await servePublicEnterprise(deps, { slug: 's', locale: 'pt-BR', now: NOW });
    assert.deepEqual(served?.payload, PAYLOAD_V2, 'request em voo responde com o que compôs (post-publish)');
    assert.equal(calls.savedInputs[0]?.baseUpdatedAt?.getTime(), T1.getTime(), 'snapshot carrega a digital LIDA no início da request');
    const next = await servePublicEnterprise(deps, { slug: 's', locale: 'pt-BR', now: NOW });
    assert.equal(next?.fromSnapshot, false, 'snapshot pré-publish é revalidado no request seguinte');
    assert.equal(calls.compose, 2);
  });

  test('publish visível ANTES da compose: snapshot já sai fresco (digital nova)', async () => {
    const state: FakeState = {
      freshness: { id: 'e1', updatedAt: T2, publishedVersion: 4 },
      snapshot: null,
      composeResult: PAYLOAD_V2,
    };
    const { deps, calls } = makeDeps(state);
    const served = await servePublicEnterprise(deps, { slug: 's', locale: 'pt-BR', now: NOW });
    assert.deepEqual(served?.payload, PAYLOAD_V2);
    assert.equal(calls.savedInputs[0]?.baseUpdatedAt?.getTime(), T2.getTime());
    const next = await servePublicEnterprise(deps, { slug: 's', locale: 'pt-BR', now: NOW });
    assert.equal(next?.fromSnapshot, true, 'snapshot salvo fresco serve no request seguinte');
  });

  test('upsert simultâneo por (slug, locale) não duplica — ON CONFLICT', async () => {
    // Semântica real do UNIQUE slug+locale: 2 saves para a mesma chave
    // deixam UMA linha (a última). Fake simula com mapa.
    const rows = new Map<string, SaveSnapshotInput>();
    const dbLike = {
      enterprisePublicSnapshot: {
        async upsert(args: { where: { slug_locale: { slug: string; locale: string } }; create: SaveSnapshotInput & { refreshedAt?: Date }; update: Record<string, unknown> }) {
          const key = `${args.where.slug_locale.slug}|${args.where.slug_locale.locale}`;
          rows.set(key, args.create as SaveSnapshotInput); // last-writer-wins
          return {};
        },
      },
    };
    const now = NOW;
    const mk = (summary: string): SaveSnapshotInput => ({
      enterpriseId: 'e1', slug: 's', locale: 'pt-BR', version: 3,
      baseUpdatedAt: T1, payload: { summary }, now,
    });
    await Promise.all([
      invalidateNothing(dbLike),
      (async () => {
        // simula dois composes concorrentes salvando
        const save1 = mk('a');
        const save2 = mk('b');
        await dbLike.enterprisePublicSnapshot.upsert({
          where: { slug_locale: { slug: save1.slug, locale: save1.locale } },
          create: save1,
          update: {},
        });
        await dbLike.enterprisePublicSnapshot.upsert({
          where: { slug_locale: { slug: save2.slug, locale: save2.locale } },
          create: save2,
          update: {},
        });
      })(),
    ]);
    assert.equal(rows.size, 1, 'UNIQUE(slug, locale) → uma linha por chave');
    assert.deepEqual((rows.get('s|pt-BR')?.payload as { summary?: string }).summary, 'b');
  });
});

/** Helper noop para Promise.all do teste acima. */
async function invalidateNothing(_dbLike: unknown): Promise<void> {}
