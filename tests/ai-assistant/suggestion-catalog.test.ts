/**
 * suggestion-catalog.test.ts — Catálogo determinístico (prompt v2.0 §10/§28).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSISTANT_SUGGESTION_CATALOG,
  selectOpeningSuggestions,
  selectFollowUpSuggestions,
  FOLLOW_UP_SUGGESTIONS,
} from '../../src/lib/ai-assistant/suggestion-catalog.ts';
import type { AssistantIntent } from '../../src/lib/ai-assistant/intent-resolver.ts';

test('limite de quatro sugestões na abertura (§10)', () => {
  const views = ['dashboard', 'clients', 'closed-deals', 'tags', 'reminders', 'enterprises', 'reports', 'settings'] as const;
  for (const view of views) {
    const result = selectOpeningSuggestions({ view });
    assert.ok(result.length <= 4, `${view} excedeu 4 sugestões: ${result.length}`);
    assert.ok(result.length > 0, `${view} sem sugestões`);
  }
});

test('sugestões ADMIN não aparecem para USER (§9.2/§10)', () => {
  const admin = selectOpeningSuggestions({ view: 'meta-ads', role: 'ADMIN' });
  assert.ok(admin.length > 0, 'ADMIN deve ver sugestões em meta-ads');
  const user = selectOpeningSuggestions({ view: 'meta-ads', role: 'USER' });
  assert.equal(user.length, 0, 'USER não deve ver sugestões em meta-ads');
  const adminPanel = selectOpeningSuggestions({ view: 'admin', role: 'USER' });
  assert.equal(adminPanel.length, 0);
});

test('requiresEntity: ficha só com cliente selecionado', () => {
  const withEntity = selectOpeningSuggestions({
    view: 'clients',
    entity: { type: 'client', id: 'c1' },
  });
  assert.ok(withEntity.some((s) => s.id === 'client.summary'));

  const withoutEntity = selectOpeningSuggestions({ view: 'clients' });
  assert.ok(!withoutEntity.some((s) => s.id === 'client.summary'));
});

test('tags.first apenas quando não há tags (§11)', () => {
  const noTags = selectOpeningSuggestions({ view: 'tags', tagCount: 0 });
  assert.ok(noTags.some((s) => s.id === 'tags.first'));
  const withTags = selectOpeningSuggestions({ view: 'tags', tagCount: 5 });
  assert.ok(!withTags.some((s) => s.id === 'tags.first'));
});

test('deduplicação semântica: um item por intent na abertura', () => {
  const result = selectOpeningSuggestions({ view: 'dashboard' });
  const intents = result.map((s) => s.intent);
  assert.equal(new Set(intents).size, intents.length, 'intents repetidos na abertura');
});

test('IDs estáveis e únicos no catálogo inteiro', () => {
  const ids = ASSISTANT_SUGGESTION_CATALOG.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'IDs duplicados no catálogo');
});

test('sugestões obrigatórias por tela (§11) presentes no catálogo', () => {
  const required = [
    'dashboard.today_summary', 'dashboard.followups', 'dashboard.explain',
    'clients.filtered_summary', 'clients.stale', 'clients.funnel_help',
    'client.summary', 'client.last_interaction', 'client.missing_fields',
    'closed.summary', 'closed.won_count', 'closed.explain',
    'tags.organize', 'tags.most_used', 'tags.first',
    'reminders.overdue', 'reminders.today', 'reminders.calendar_help',
    'enterprise.region_search', 'enterprise.types_help', 'enterprise.summary',
    'reports.summary', 'reports.stage_distribution', 'reports.explain',
    'meta.summary', 'meta.campaigns', 'meta.queues',
    'admin.overview', 'admin.create_user', 'admin.roles',
    'settings.calendar', 'settings.telegram', 'settings.profile', 'settings.theme',
  ];
  for (const id of required) {
    assert.ok(ASSISTANT_SUGGESTION_CATALOG.some((s) => s.id === id), `faltou ${id}`);
  }
});

test('continuidade pós-resposta: 2-3 itens por intent (§12)', () => {
  const intents: AssistantIntent[] = [
    'today_schedule', 'reminders', 'client_summary', 'funnel_help',
    'enterprise_summary', 'report_summary', 'feature_help',
  ];
  for (const intent of intents) {
    assert.ok(Array.isArray(FOLLOW_UP_SUGGESTIONS[intent]), `sem continuidade para ${intent}`);
    const result = selectFollowUpSuggestions(intent, { role: 'ADMIN' });
    assert.ok(result.length >= 2 && result.length <= 3, `${intent}: ${result.length} sugestões de continuidade`);
  }
});

test('continuidade com entidade resolve sugestões de cliente', () => {
  const result = selectFollowUpSuggestions('client_summary', {
    entity: { type: 'client', id: 'c1' },
  });
  assert.ok(result.length > 0);
});
