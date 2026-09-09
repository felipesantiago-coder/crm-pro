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
  fetchLeadsRetrievalGranted,
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

// ── buildSyncFormsPermissionHint: leads_retrieval JÁ CONCEDIDA ──
// Caso real 2 (segunda rodada do usuário): /me/permissions mostra
// leads_retrieval granted, mas o "#100 + campanhas OK" persiste —
// culpar a permissão vira pista falsa; causas remanescentes: lado do
// app (Advanced Access/modo, app do token) e página/formulário dono.

test('hint granted=true + página com 0 forms → NÃO culpa leads_retrieval; aponta app e formulário/página', () => {
  const hint = buildSyncFormsPermissionHint({ attempts: USER_CASE, pageCount: 1, leadsRetrievalGranted: true });
  assert.match(hint, /JÁ TEM leads_retrieval concedida/);
  assert.match(hint, /NÃO se aplica/);
  assert.match(hint, /Acesso avançado/); // app "Ao vivo" sem Advanced Access
  assert.match(hint, /Reconectar com o Facebook/); // token de app diferente
  assert.match(hint, /MAIS IMPORTANTE/); // página com 0 forms → form não pertence a ela
  assert.match(hint, /PÁGINA dona/);
  assert.match(hint, /webhook/i);
  assert.doesNotMatch(hint, /O bloqueio real é a permissão leads_retrieval/);
  assert.doesNotMatch(hint, /Conceda ads_read/);
});

test('hint granted=true sem página com 0 forms → passo 2 genérico de dona do formulário', () => {
  const attempts: LeadgenFormsAttemptLike[] = [
    { via: 'account', ok: false, code: '100', msg: '(#100) Tried accessing nonexisting field (leadgen_forms)' },
    { via: 'campaigns', ok: true, msg: 'OK — 2 formulário(s)' },
  ];
  const hint = buildSyncFormsPermissionHint({ attempts, pageCount: 1, leadsRetrievalGranted: true });
  assert.match(hint, /JÁ TEM leads_retrieval concedida/);
  assert.match(hint, /PÁGINA dona do formulário/);
  assert.doesNotMatch(hint, /MAIS IMPORTANTE/);
});

test('hint granted=false (ausente/revogada) → variante clássica preservada', () => {
  const hint = buildSyncFormsPermissionHint({ attempts: USER_CASE, pageCount: 1, leadsRetrievalGranted: false });
  assert.match(hint, /O bloqueio real é a permissão leads_retrieval/);
  assert.match(hint, /NÃO contorna/);
});

test('hint granted=null/omitido (inconclusivo) → variante clássica preservada (backward compat)', () => {
  const a = buildSyncFormsPermissionHint({ attempts: USER_CASE, pageCount: 1, leadsRetrievalGranted: null });
  const b = buildSyncFormsPermissionHint({ attempts: USER_CASE, pageCount: 1 });
  assert.match(a, /O bloqueio real é a permissão leads_retrieval/);
  assert.equal(a, b); // omitir = null
});

// ── fetchLeadsRetrievalGranted (probe /me/permissions) ──────────

type FetchMock = (input: any, init?: any) => Promise<Response>;

async function withFetchMock(mock: FetchMock, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = mock as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test('fetchLeadsRetrievalGranted: granted → true; URL v26.0/me/permissions com token', async () => {
  let calledUrl = '';
  await withFetchMock(async (input) => {
    calledUrl = String(input);
    return new Response(JSON.stringify({ data: [{ permission: 'leads_retrieval', status: 'granted' }] }), { status: 200 });
  }, async () => {
    assert.equal(await fetchLeadsRetrievalGranted('EAABtesttoken'), true);
    assert.match(calledUrl, /graph\.facebook\.com\/v26\.0\/me\/permissions/);
    assert.match(calledUrl, /access_token=EAABtesttoken/);
  });
});

test('fetchLeadsRetrievalGranted: declined → false (conclusivo)', async () => {
  await withFetchMock(async () => new Response(JSON.stringify({ data: [{ permission: 'leads_retrieval', status: 'declined' }] }), { status: 200 }), async () => {
    assert.equal(await fetchLeadsRetrievalGranted('T'), false);
  });
});

test('fetchLeadsRetrievalGranted: permissão nem consta (listagem OK) → false (conclusivo)', async () => {
  await withFetchMock(async () => new Response(JSON.stringify({ data: [{ permission: 'ads_read', status: 'granted' }] }), { status: 200 }), async () => {
    assert.equal(await fetchLeadsRetrievalGranted('T'), false);
  });
});

test('fetchLeadsRetrievalGranted: page/System User token (HTTP 400) → null (inconclusivo)', async () => {
  await withFetchMock(async () => new Response(JSON.stringify({ error: { message: 'Invalid oauth access token', code: 190 } }), { status: 400 }), async () => {
    assert.equal(await fetchLeadsRetrievalGranted('page-token'), null);
  });
});

test('fetchLeadsRetrievalGranted: resposta sem data[] → null; rede quebrada → null (nunca lança)', async () => {
  await withFetchMock(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }), async () => {
    assert.equal(await fetchLeadsRetrievalGranted('T'), null);
  });
  await withFetchMock(async () => { throw new Error('network down'); }, async () => {
    assert.equal(await fetchLeadsRetrievalGranted('T'), null);
  });
});
