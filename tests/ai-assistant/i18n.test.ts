/**
 * i18n.test.ts — Paridade e contratos de i18n (prompt v2.0 §25/§28).
 * Import direto dos JSON: roda via node --test com strip-types
 * (assert with resolveJsonModule não disponível — usamos import attributes).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const localesDir = join(here, '../../src/i18n/locales/assistant');

function load(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(localesDir, `${locale}.json`), 'utf8')).aiAssistant;
}

function flatKeys(obj: unknown, prefix = ''): Set<string> {
  const out = new Set<string>();
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const sub of flatKeys(v, path)) out.add(sub);
      } else {
        out.add(path);
      }
    }
  }
  return out;
}

const pt = load('pt-BR');
const en = load('en');
const es = load('es');

test('pt-BR é a fonte semântica; en e es têm paridade total de chaves (§25)', () => {
  const ptKeys = flatKeys(pt);
  const enKeys = flatKeys(en);
  const esKeys = flatKeys(es);

  const missingEn = [...ptKeys].filter((k) => !enKeys.has(k));
  const extraEn = [...enKeys].filter((k) => !ptKeys.has(k));
  const missingEs = [...ptKeys].filter((k) => !esKeys.has(k));
  const extraEs = [...esKeys].filter((k) => !ptKeys.has(k));

  assert.deepEqual(missingEn, [], `en sem chaves: ${missingEn.join(', ')}`);
  assert.deepEqual(extraEn, [], `en com chaves extras: ${extraEn.join(', ')}`);
  assert.deepEqual(missingEs, [], `es sem chaves: ${missingEs.join(', ')}`);
  assert.deepEqual(extraEs, [], `es com chaves extras: ${extraEs.join(', ')}`);
});

test('erro 429 usa a chave rate_limit (contrato com RequestErrorKind §7.3)', () => {
  const errors = pt.errors as Record<string, string>;
  assert.ok(typeof errors.rate_limit === 'string' && errors.rate_limit.length > 0);
  assert.equal('rateLimit' in errors, false, 'chave antiga rateLimit ainda existe');
});

test('erros obrigatórios presentes (§16)', () => {
  for (const locale of [pt, en, es]) {
    const errors = (locale as typeof pt).errors as Record<string, string>;
    for (const kind of ['network', 'rate_limit', 'session', 'unavailable', 'timeout', 'partial_data', 'unknown', 'retry']) {
      assert.ok(typeof errors[kind] === 'string' && errors[kind].length > 0, `erro ${kind} vazio`);
    }
  }
});

test('estados de loading por intent presentes (§7.8)', () => {
  for (const locale of [pt, en, es]) {
    const loading = (locale as typeof pt).states.loading as Record<string, string>;
    for (const key of ['clients', 'schedules', 'reminders', 'enterprise', 'reports', 'help']) {
      assert.ok(loading[key].length > 0, `loading.${key} vazio`);
    }
  }
});

test('catálogo cobre todas as entradas do suggestion-catalog com label e prompt', async () => {
  const { ASSISTANT_SUGGESTION_CATALOG } = await import('../../src/lib/ai-assistant/suggestion-catalog.ts');
  const catalog = pt.catalog as Record<string, { label?: string; prompt?: string }>;
  for (const entry of ASSISTANT_SUGGESTION_CATALOG) {
    const localized = catalog[entry.id];
    assert.ok(localized, `catálogo i18n sem "${entry.id}"`);
    assert.ok(localized.label?.length, `label vazio para "${entry.id}"`);
    // Sugestões de navegação não chamam o modelo — prompt vazio é aceitável.
    if (!entry.action) {
      assert.ok(localized.prompt?.length, `prompt vazio para "${entry.id}"`);
    }
  }
});

test('nenhum texto hardcoded "+" ou "–" como controle (§10/§25)', () => {
  const ui = pt.suggestionsUI as Record<string, string>;
  assert.ok(ui.more.length > 2, 'botão "Ver mais" sem texto descritivo');
  assert.ok(ui.less.length > 2);
  assert.notEqual(ui.more.trim(), '+');
  assert.notEqual(ui.less.trim(), '–');
});

test('pluralização explícita para nudges (§13.4/§25)', () => {
  for (const locale of [pt, en, es]) {
    const proactive = (locale as typeof pt).proactive as Record<string, string>;
    assert.ok(proactive.remindersOne.length > 0);
    assert.ok(proactive.remindersMany.includes('{count}'));
    assert.ok(proactive.clientsOne.length > 0);
    assert.ok(proactive.clientsMany.includes('{count}'));
  }
});
