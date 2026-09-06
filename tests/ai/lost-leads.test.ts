/**
 * lost-leads.test.ts — Helpers puros da "rede de segurança" de leads
 * perdidos: filtro compartilhado entre listagem (GET) e deleção em lote
 * (DELETE ?all=true, exclusivo ADMIN) e descrição legível do escopo.
 *
 * Garantia central: o MESMO where usado no GET define o escopo apagado
 * no DELETE em lote — o total exibido na UI é exatamente o número de
 * registros removidos.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLostLeadWhere, describeLostLeadScope } from '../../src/lib/lost-leads.ts';

// ── buildLostLeadWhere ─────────────────────────────────────────

test('buildLostLeadWhere: padrão (sem opções) abrange apenas pendentes', () => {
  assert.deepEqual(buildLostLeadWhere({}), { isRecovered: false });
  assert.deepEqual(buildLostLeadWhere({ showRecovered: false }), { isRecovered: false });
});

test('buildLostLeadWhere: showRecovered=true abrange pendentes E recuperados', () => {
  // isRecovered: undefined = sem filtro de recuperação
  assert.deepEqual(buildLostLeadWhere({ showRecovered: true }), { isRecovered: undefined });
});

test('buildLostLeadWhere: slug presente restringe o escopo', () => {
  assert.deepEqual(buildLostLeadWhere({ slug: 'villa-bianco' }), {
    isRecovered: false,
    slug: 'villa-bianco',
  });
  assert.deepEqual(buildLostLeadWhere({ showRecovered: true, slug: 'moment' }), {
    isRecovered: undefined,
    slug: 'moment',
  });
});

test('buildLostLeadWhere: slug vazio/null é ignorado (sem chave slug)', () => {
  assert.deepEqual(buildLostLeadWhere({ slug: '' }), { isRecovered: false });
  assert.deepEqual(buildLostLeadWhere({ slug: null }), { isRecovered: false });
  const where = buildLostLeadWhere({ slug: '' });
  assert.ok(!('slug' in where), 'chave slug não deve existir quando vazio');
});

test('buildLostLeadWhere: GET e DELETE em lote produzem o MESMO where (contrato UI)', () => {
  // A UI usa total do GET com os mesmos parâmetros enviados ao DELETE —
  // qualquer divergência aqui faria o confirm anunciar um número errado.
  const casos = [
    { showRecovered: false, slug: undefined },
    { showRecovered: false, slug: 'belgrado' },
    { showRecovered: true, slug: undefined },
    { showRecovered: true, slug: 'villa-bianco' },
  ];
  for (const opcoes of casos) {
    assert.deepEqual(
      buildLostLeadWhere(opcoes),
      buildLostLeadWhere({ ...opcoes }),
      `where divergente para ${JSON.stringify(opcoes)}`
    );
  }
});

// ── describeLostLeadScope ──────────────────────────────────────

test('describeLostLeadScope: escopo padrão menciona pendentes', () => {
  assert.equal(describeLostLeadScope({}), 'pendentes');
});

test('describeLostLeadScope: slug e recuperados entram na descrição', () => {
  assert.equal(
    describeLostLeadScope({ slug: 'villa-bianco' }),
    'pendentes do slug "villa-bianco"'
  );
  assert.equal(
    describeLostLeadScope({ showRecovered: true }),
    'pendentes incluindo recuperados'
  );
  assert.equal(
    describeLostLeadScope({ showRecovered: true, slug: 'moment' }),
    'pendentes do slug "moment" incluindo recuperados'
  );
});
