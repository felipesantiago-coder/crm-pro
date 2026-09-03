/**
 * nudge.test.ts — Motor determinístico de nudges (prompt v2.0 §13/§28).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickNudge, type NudgeDisplayState } from '../../src/components/ai-assistant/nexo-proactive-nudge.ts';
import { NUDGE_DISMISS_TTL_MS } from '../../src/components/ai-assistant/assistant.constants.ts';

function state(overrides: Partial<NudgeDisplayState> = {}): NudgeDisplayState {
  return { shownThisSession: false, dismissedAt: {}, ...overrides };
}

test('no máximo um nudge por sessão (§13.2)', () => {
  const shown = state({ shownThisSession: true });
  assert.equal(pickNudge({ pendingReminders: 3 }, shown), null);
});

test('prioridade: lembretes antes de clientes desatualizados (§13.3)', () => {
  const picked = pickNudge(
    { pendingReminders: 2, overdueClients: 5 },
    state(),
  );
  assert.equal(picked?.kind, 'reminders_pending');
});

test('sem dado determinístico, nenhum nudge (nada de inventar fato)', () => {
  assert.equal(pickNudge({}, state()), null);
  assert.equal(pickNudge({ pendingReminders: 0, overdueClients: 0 }, state()), null);
});

test('"Agora não": mesmo nudge não volta por 24 h, outro pode (§13.2)', () => {
  const dismissed = state({
    dismissedAt: { reminders_pending: Date.now() - 1000 },
  });
  const sameKind = pickNudge({ pendingReminders: 2 }, dismissed);
  assert.equal(sameKind, null, 'nudge dispensado voltou antes de 24h');

  const otherKind = pickNudge({ overdueClients: 4 }, dismissed);
  assert.equal(otherKind?.kind, 'clients_stale');
});

test('dispensa expira após 24 h', () => {
  const expired = state({
    dismissedAt: { reminders_pending: Date.now() - NUDGE_DISMISS_TTL_MS - 1000 },
  });
  const picked = pickNudge({ pendingReminders: 2 }, expired);
  assert.equal(picked?.kind, 'reminders_pending');
});

test('contagem é carregada para pluralização (nunca conteúdo/PII)', () => {
  const picked = pickNudge({ pendingReminders: 7 }, state());
  assert.equal(picked?.count, 7);
  assert.ok(!('title' in (picked ?? {})));
});
