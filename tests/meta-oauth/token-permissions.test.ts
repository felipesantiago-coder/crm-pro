/**
 * token-permissions.test.ts — Diagnóstico da causa raiz dos erros de
 * leitura de formulários/leads quando o token é VÁLIDO mas a Graph
 * oculta as edges de leads: "#100 nonexisting field (leadgen_forms)"
 * no Sync Forms e "Unsupported get request … missing permissions" na
 * leitura. Cenário real coberto: campanhas da conta respondem OK
 * (prova ads_read + papel na conta) e a dica clássica "conceda
 * ads_read" vira pista falsa — o bloqueio real é leads_retrieval.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateTokenPermissions,
  isLeadgenFormsHiddenByLeadsRetrieval,
  buildSyncFormsPermissionHint,
  LEAD_TOKEN_PERMISSIONS,
  type LeadgenFormsAttemptLike,
} from '../../src/lib/meta-oauth.ts';

// ── evaluateTokenPermissions ────────────────────────────────────

test('evaluateTokenPermissions: null → inconclusivo (page/System User token)', () => {
  assert.deepEqual(evaluateTokenPermissions(null), { inconclusive: true });
});

test('evaluateTokenPermissions: todas concedidas → granted, sem bloqueios', () => {
  const granted = {
    leads_retrieval: true,
    ads_read: true,
    pages_show_list: true,
    pages_read_engagement: true,
    pages_manage_metadata: true,
  };
  const s = evaluateTokenPermissions(granted);
  assert.equal(s.inconclusive, false);
  if (s.inconclusive) return;
  assert.equal(s.leadsRetrievalMissing, false);
  assert.equal(s.adsReadMissing, false);
  assert.equal(s.permissions.length, LEAD_TOKEN_PERMISSIONS.length);
  assert.ok(s.permissions.every((p) => p.status === 'granted'));
});

test('evaluateTokenPermissions: leads_retrieval DECLINED (revogada) → leadsRetrievalMissing', () => {
  const s = evaluateTokenPermissions({ leads_retrieval: false, ads_read: true });
  assert.equal(s.inconclusive, false);
  if (s.inconclusive) return;
  assert.equal(s.leadsRetrievalMissing, true);
  assert.equal(s.adsReadMissing, false);
  const lr = s.permissions.find((p) => p.permission === 'leads_retrieval');
  assert.equal(lr?.status, 'declined');
});

test('evaluateTokenPermissions: permissão AUSENTE (nunca pedida) ≠ declined', () => {
  const s = evaluateTokenPermissions({ ads_read: true }); // leads_retrieval nem aparece
  assert.equal(s.inconclusive, false);
  if (s.inconclusive) return;
  assert.equal(s.leadsRetrievalMissing, true);
  const lr = s.permissions.find((p) => p.permission === 'leads_retrieval');
  assert.equal(lr?.status, 'absent');
});

test('evaluateTokenPermissions: só ads_read ausente → warns separados', () => {
  const s = evaluateTokenPermissions({ leads_retrieval: true });
  assert.equal(s.inconclusive, false);
  if (s.inconclusive) return;
  assert.equal(s.leadsRetrievalMissing, false);
  assert.equal(s.adsReadMissing, true);
});

// ── isLeadgenFormsHiddenByLeadsRetrieval ────────────────────────

/** Caso REAL reportado pelo usuário (conta nova, aba Polling):
 *  conta → #100 nonexisting field (leadgen_forms); campanhas → OK;
 *  página → OK (0 forms). */
const USER_CASE: LeadgenFormsAttemptLike[] = [
  { via: 'account', label: 'conta act_409755809722451', ok: false, code: '100', msg: '(#100) Tried accessing nonexisting field (leadgen_forms)' },
  { via: 'campaigns', label: 'campanhas da conta', ok: true, found: 0, msg: 'OK — 0 formulário(s)' },
  { via: 'page', label: 'página 106980164057325', ok: true, found: 0, msg: 'OK — 0 formulário(s)' },
];

test('isLeadgenFormsHiddenByLeadsRetrieval: caso real (#100 na conta + campanhas OK) → TRUE', () => {
  assert.equal(isLeadgenFormsHiddenByLeadsRetrieval(USER_CASE), true);
});

test('isLeadgenFormsHiddenByLeadsRetrieval: campanhas também falharam → FALSE (ads_read pode ser a causa)', () => {
  const attempts: LeadgenFormsAttemptLike[] = [
    { via: 'account', ok: false, code: '100', msg: '(#100) Tried accessing nonexisting field (leadgen_forms)' },
    { via: 'campaigns', ok: false, code: '100', msg: '(#100) Tried accessing nonexisting field (campaigns)' },
  ];
  assert.equal(isLeadgenFormsHiddenByLeadsRetrieval(attempts), false);
});

test('isLeadgenFormsHiddenByLeadsRetrieval: token expirado (190) → FALSE', () => {
  const attempts: LeadgenFormsAttemptLike[] = [
    { via: 'account', ok: false, code: '190', msg: 'Error validating access token' },
    { via: 'campaigns', ok: true, found: 0, msg: 'OK — 0 formulário(s)' },
  ];
  assert.equal(isLeadgenFormsHiddenByLeadsRetrieval(attempts), false);
});

test('isLeadgenFormsHiddenByLeadsRetrieval: edge da conta respondeu → FALSE', () => {
  const attempts: LeadgenFormsAttemptLike[] = [
    { via: 'account', ok: true, found: 3, msg: 'OK — 3 formulário(s)' },
    { via: 'campaigns', ok: true, found: 0, msg: 'OK — 0 formulário(s)' },
  ];
  assert.equal(isLeadgenFormsHiddenByLeadsRetrieval(attempts), false);
});

test('isLeadgenFormsHiddenByLeadsRetrieval: #100 sem leadgen_forms na msg → FALSE', () => {
  const attempts: LeadgenFormsAttemptLike[] = [
    { via: 'account', ok: false, code: '100', msg: 'Erro genérico de parâmetro' },
    { via: 'campaigns', ok: true, found: 0, msg: 'OK — 0 formulário(s)' },
  ];
  assert.equal(isLeadgenFormsHiddenByLeadsRetrieval(attempts), false);
});

// ── buildSyncFormsPermissionHint ────────────────────────────────

test('buildSyncFormsPermissionHint: caso real → aponta leads_retrieval, NÃO ads_read, e avisa que IDs manuais não contornam', () => {
  const hint = buildSyncFormsPermissionHint({ attempts: USER_CASE, pageCount: 1 });
  assert.match(hint, /leads_retrieval/);
  assert.match(hint, /CORRETOS/);
  assert.match(hint, /ads_read e o papel na conta de anúncios estão CORRETOS/);
  assert.match(hint, /NÃO contorna/); // IDs manuais não resolvem (polling lê /leads com o token)
  assert.match(hint, /Reconectar com o Facebook/);
  assert.doesNotMatch(hint, /Conceda ads_read/); // a dica falsa não pode mais aparecer
});

test('buildSyncFormsPermissionHint: dica antiga preservada quando o padrão é de ads_read (páginas vinculadas)', () => {
  const attempts: LeadgenFormsAttemptLike[] = [
    { via: 'account', ok: false, code: '190', msg: 'Error validating access token' },
  ];
  const hint = buildSyncFormsPermissionHint({ attempts, pageCount: 2 });
  assert.match(hint, /Conceda ads_read/);
  assert.match(hint, /páginas vinculadas também foram consultadas/);
  assert.doesNotMatch(hint, /CORRETOS/);
});

test('buildSyncFormsPermissionHint: dica antiga preservada sem page IDs (convite para salvar páginas)', () => {
  const attempts: LeadgenFormsAttemptLike[] = [
    { via: 'account', ok: false, code: '190', msg: 'Error validating access token' },
  ];
  const hint = buildSyncFormsPermissionHint({ attempts, pageCount: 0 });
  assert.match(hint, /Conceda ads_read/);
  assert.match(hint, /Nenhum Page ID está salvo/);
});
