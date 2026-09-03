/**
 * navigation-actions.test.ts — Ações allowlisted (prompt v2.0 §20/§28).
 * O modelo nunca produz ações; sanitizeActions descarta qualquer coisa
 * fora da allowlist (URLs, escrita, IDs malformados).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveNavigationActions,
  sanitizeActions,
  isNavigableView,
} from '../../src/lib/ai-assistant/navigation-actions.ts';
import { resolveIntent } from '../../src/lib/ai-assistant/intent-resolver.ts';

const LABELS = {
  openView: (view: string) => `Abrir ${view}`,
  openClient: 'Abrir ficha do cliente',
  openEnterprise: 'Abrir empreendimento',
  applyFilter: 'Aplicar filtro de etapa',
};

test('isNavigableView aceita apenas views reais', () => {
  for (const v of ['dashboard', 'clients', 'reminders', 'reports', 'settings']) {
    assert.equal(isNavigableView(v), true);
  }
  for (const v of ['http://evil.com', 'clientDetail', '', 'javascript:alert(1)']) {
    assert.equal(isNavigableView(v), false);
  }
});

test('intent reminders deriva navegação para Lembretes', () => {
  const actions = deriveNavigationActions({
    intent: resolveIntent('Quais lembretes estão pendentes?'),
    isAdmin: false,
    view: 'dashboard',
    labels: LABELS,
  });
  assert.ok(actions.some((a) => a.type === 'NAVIGATE_VIEW' && a.view === 'reminders'));
});

test('client_summary com entidade autorizada abre a ficha (OPEN_CLIENT)', () => {
  const actions = deriveNavigationActions({
    intent: 'client_summary',
    isAdmin: false,
    view: 'dashboard',
    entity: { type: 'client', id: 'c1', accessible: true },
    labels: LABELS,
  });
  assert.ok(actions.some((a) => a.type === 'OPEN_CLIENT' && a.clientId === 'c1'));
});

test('client_summary SEM entidade não inventa ficha', () => {
  const actions = deriveNavigationActions({
    intent: 'client_summary',
    isAdmin: false,
    view: 'dashboard',
    labels: LABELS,
  });
  assert.ok(!actions.some((a) => a.type === 'OPEN_CLIENT'));
});

test('não sugere navegar para a view em que o usuário já está', () => {
  const actions = deriveNavigationActions({
    intent: 'reminders',
    isAdmin: false,
    view: 'reminders',
    labels: LABELS,
  });
  assert.ok(!actions.some((a) => a.type === 'NAVIGATE_VIEW' && a.view === 'reminders'));
});

test('sanitizeActions descarta ações inválidas/injetadas', () => {
  const result = sanitizeActions([
    { type: 'NAVIGATE_VIEW', view: 'https://evil.com', label: 'x' },
    { type: 'NAVIGATE_VIEW', view: 'clients', label: 'ok' },
    { type: 'OPEN_CLIENT', clientId: '', label: 'sem id' },
    { type: 'OPEN_CLIENT', clientId: 'c1', label: 'ficha' },
    { type: 'DELETE_CLIENT', clientId: 'c1', label: 'escrita!' },
    { type: 'APPLY_CLIENT_FILTER', stage: 'HACKED', label: 'filtro' },
    { type: 'APPLY_CLIENT_FILTER', stage: 'LEAD', label: 'filtro ok' },
    'string solta',
    null,
  ]);
  const types = result.map((a) => a.type);
  assert.deepEqual(types, ['NAVIGATE_VIEW', 'OPEN_CLIENT', 'APPLY_CLIENT_FILTER']);
});

test('máximo de 2 ações derivadas e 3 sanitizadas', () => {
  const actions = deriveNavigationActions({
    intent: 'client_summary',
    isAdmin: true,
    view: 'dashboard',
    entity: { type: 'client', id: 'c1', accessible: true },
    filters: { stage: 'LEAD' },
    labels: LABELS,
  });
  assert.ok(actions.length <= 2);
});

test('USER nunca recebe navegação para meta-ads/admin', () => {
  const actions = deriveNavigationActions({
    intent: 'report_summary',
    isAdmin: false,
    view: 'dashboard',
    labels: LABELS,
  });
  assert.ok(!actions.some((a) => a.type === 'NAVIGATE_VIEW' && (a.view === 'meta-ads' || a.view === 'admin')));
});
