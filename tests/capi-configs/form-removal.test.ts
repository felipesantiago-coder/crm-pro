/**
 * form-removal.test.ts — Remoção de formulário aprendido da aba
 * "Formulários" do card de conta Meta (admin). Cobre a lib pura:
 * escopo da exclusão (conta específica vs grupo global) e a limpeza
 * do formId dos arrays formIds dos MetaCapConfig (match exato com
 * aspas, sem tocar prefixos nem JSON inválido).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  removeFormMapping,
  buildFormRemovalConfirmMessage,
  type FormRemovalDb,
} from '../../src/lib/lead-form-removal.ts';

interface MappingRow {
  id: string;
  formId: string;
  adAccountId: string | null;
  capiConfigId?: string | null;
}

interface ConfigRow {
  id: string;
  formIds: string | null;
}

function fakeDb(opts: { mappings?: MappingRow[]; configs?: ConfigRow[] } = {}) {
  const state = {
    deleteWhere: null as unknown,
    deletedIds: [] as string[],
    updates: [] as Array<{ id: string; formIds: string }>,
  };

  const db: FormRemovalDb = {
    leadFormMapping: {
      deleteMany: async (args) => {
        state.deleteWhere = args.where;
        const { formId, adAccountId } = args.where;
        const toDelete = (opts.mappings || []).filter(
          (m) =>
            m.formId === formId &&
            (adAccountId === undefined ? true : m.adAccountId === adAccountId)
        );
        state.deletedIds = toDelete.map((m) => m.id);
        return { count: toDelete.length };
      },
    },
    metaCapConfig: {
      findMany: async (args) =>
        (opts.configs || []).filter((c) =>
          (c.formIds || '').includes(args.where.formIds.contains)
        ),
      update: async (args) => {
        state.updates.push({ id: args.where.id, formIds: args.data.formIds });
        const row = (opts.configs || []).find((c) => c.id === args.where.id);
        if (row) row.formIds = args.data.formIds;
        return row;
      },
    },
  };

  return { db, state };
}

// ── removeFormMapping: escopo da exclusão ──────────────────────

test('removeFormMapping: deleta SOMENTE as linhas (formId + adAccountId) da conta', async () => {
  const { db, state } = fakeDb({
    mappings: [
      { id: 'm1', formId: 'F1', adAccountId: 'acc-A' },
      { id: 'm2', formId: 'F1', adAccountId: 'acc-A' },
      { id: 'm3', formId: 'F1', adAccountId: 'acc-B' },
      { id: 'm4', formId: 'F1', adAccountId: null },
      { id: 'm5', formId: 'F2', adAccountId: 'acc-A' },
    ],
  });

  const result = await removeFormMapping(db, { formId: 'F1', adAccountId: 'acc-A' });

  assert.equal(result.deleted, 2);
  assert.deepEqual(state.deletedIds.sort(), ['m1', 'm2']);
  assert.deepEqual(state.deleteWhere, { formId: 'F1', adAccountId: 'acc-A' });
});

test('removeFormMapping: adAccountId null → escopo global (linhas sem conta)', async () => {
  const { db, state } = fakeDb({
    mappings: [
      { id: 'g1', formId: 'F1', adAccountId: null },
      { id: 'a1', formId: 'F1', adAccountId: 'acc-A' },
    ],
  });

  const result = await removeFormMapping(db, { formId: 'F1', adAccountId: null });

  assert.equal(result.deleted, 1);
  assert.deepEqual(state.deleteWhere, { formId: 'F1', adAccountId: null });
  assert.deepEqual(state.deletedIds, ['g1']);
});

// ── removeFormMapping: limpeza do formIds dos configs CAPI ─────

test('removeFormMapping: limpa o formId do array formIds do config CAPI que o referencia', async () => {
  const { db, state } = fakeDb({
    configs: [
      { id: 'cfg1', formIds: JSON.stringify(['F1', 'F9']) },
      { id: 'cfg2', formIds: JSON.stringify(['F8']) },
    ],
  });

  const result = await removeFormMapping(db, { formId: 'F1', adAccountId: 'acc-A' });

  assert.equal(result.deleted, 0); // nenhum mapping no fake — só a limpeza
  assert.deepEqual(result.cleanedConfigs, ['cfg1']);
  assert.equal(state.updates.length, 1);
  assert.deepEqual(JSON.parse(state.updates[0].formIds), ['F9']);
});

test('removeFormMapping: match EXATO — formId prefixo não vaza para ID maior', async () => {
  const { db, state } = fakeDb({
    configs: [{ id: 'cfg-prefix', formIds: JSON.stringify(['F1234', 'F99']) }],
  });

  const result = await removeFormMapping(db, { formId: 'F123', adAccountId: null });

  // "F123" (com aspas) não casa com "F1234" → nada a limpar
  assert.deepEqual(result.cleanedConfigs, []);
  assert.equal(state.updates.length, 0);
});

test('removeFormMapping: formIds JSON inválido é ignorado sem quebrar a remoção', async () => {
  const { db, state } = fakeDb({
    configs: [{ id: 'cfg-broken', formIds: 'não-é-json' }],
  });

  const result = await removeFormMapping(db, { formId: 'F1', adAccountId: 'acc-A' });

  // contains `"F1"` não casa em 'não-é-json' → config nem é visitado;
  // mesmo se visitado, JSON.parse falha e é ignorado silenciosamente.
  assert.deepEqual(result.cleanedConfigs, []);
  assert.equal(state.updates.length, 0);
});

test('removeFormMapping: JSON não-array é ignorado', async () => {
  const { db, state } = fakeDb({
    configs: [{ id: 'cfg-obj', formIds: '{"F1":true}' }],
  });

  const result = await removeFormMapping(db, { formId: 'F1', adAccountId: 'acc-A' });

  assert.deepEqual(result.cleanedConfigs, []);
  assert.equal(state.updates.length, 0);
});

// ── buildFormRemovalConfirmMessage ─────────────────────────────

test('buildFormRemovalConfirmMessage: com nome e leads — menciona preservação e re-aprendizado', () => {
  const msg = buildFormRemovalConfirmMessage({
    formId: 'F1',
    formName: 'Lead - Apartamentos',
    totalLeads: 7,
  });
  assert.match(msg, /"Lead - Apartamentos" \(F1\) desta conta\?/);
  assert.match(msg, /7 lead\(s\) JÁ capturados por este formulário NÃO são apagados/);
  assert.match(msg, /reaparece aqui automaticamente/);
  assert.match(msg, /fila, config CAPI/);
});

test('buildFormRemovalConfirmMessage: sem nome usa só o formId; sem leads usa frase genérica', () => {
  const msg = buildFormRemovalConfirmMessage({ formId: 'F2' });
  assert.match(msg, /formulário F2 desta conta\?/);
  assert.match(msg, /Leads já capturados NÃO são apagados/);
});
