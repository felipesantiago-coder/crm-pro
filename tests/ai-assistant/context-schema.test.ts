/**
 * context-schema.test.ts — Contrato estrito do contexto (prompt v2.0 §9/§28).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assistantRequestSchema,
  pageContextSchema,
} from '../../src/lib/ai-assistant/context-schema.ts';

test('request v1 sem contexto continua válido (retrocompatibilidade §28)', () => {
  const result = assistantRequestSchema.safeParse({
    messages: [{ role: 'user', content: 'Olá' }],
  });
  assert.equal(result.success, true);
});

test('request v2 com contexto válido', () => {
  const result = assistantRequestSchema.safeParse({
    messages: [{ role: 'user', content: 'Resuma' }],
    context: { version: 1, view: 'clients', entity: { type: 'client', id: 'c1' } },
    locale: 'pt-BR',
  });
  assert.equal(result.success, true);
});

test('chaves desconhecidas são rejeitadas (.strict §23)', () => {
  const result = pageContextSchema.safeParse({
    version: 1,
    view: 'clients',
    stolenField: 'boom',
  });
  assert.equal(result.success, false);
});

test('signals do cliente são limitados (nunca fatos, §9.2)', () => {
  const ok = pageContextSchema.safeParse({
    version: 1,
    view: 'dashboard',
    signals: { pendingReminders: 5 },
  });
  assert.equal(ok.success, true);

  const overflow = pageContextSchema.safeParse({
    version: 1,
    view: 'dashboard',
    signals: { pendingReminders: 99_999 },
  });
  assert.equal(overflow.success, false);
});

test('datas de relatório devem ser ISO YYYY-MM-DD', () => {
  const bad = pageContextSchema.safeParse({
    version: 1,
    view: 'reports',
    filters: { reportFrom: 'not-a-date' },
  });
  assert.equal(bad.success, false);

  const good = pageContextSchema.safeParse({
    version: 1,
    view: 'reports',
    filters: { reportFrom: '2026-09-01', reportTo: '2026-09-03' },
  });
  assert.equal(good.success, true);
});

test('view inválida rejeitada; meta-ads/admin exigem ADMIN na resolução', () => {
  const bad = pageContextSchema.safeParse({ version: 1, view: 'not-a-view' });
  assert.equal(bad.success, false);
});

test('limites de mensagens: máx 20 e 2000 chars (§23)', () => {
  const tooMany = assistantRequestSchema.safeParse({
    messages: Array.from({ length: 21 }, (_, i) => ({ role: 'user', content: `m${i}` })),
  });
  assert.equal(tooMany.success, false);

  const tooLong = assistantRequestSchema.safeParse({
    messages: [{ role: 'user', content: 'x'.repeat(2001) }],
  });
  assert.equal(tooLong.success, false);
});

test('roles fora de user/assistant rejeitados', () => {
  const bad = assistantRequestSchema.safeParse({
    messages: [{ role: 'system', content: 'evil' }],
  });
  assert.equal(bad.success, false);
});
