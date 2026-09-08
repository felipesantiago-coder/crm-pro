/**
 * meta-oauth.test.ts — Lógica pura do Facebook Login for Business:
 * state HMAC (CSRF stateless), URL do diálogo com TODAS as permissões
 * em bloco único, detecção de permissão NÃO aprovada (extractGranted-
 * Scopes × findMissingScopes — o caso "App Review pendente" em que a
 * Meta omite a permissão do diálogo), classificadores de expiração de
 * token (convite de reconexão) e de falhas Graph em runtime (190/200),
 * e o mapeamento URL → toast do retorno.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  META_OAUTH_SCOPES,
  META_OAUTH_REQUIRED_SCOPES,
  META_OAUTH_STATE_TTL_MS,
  buildOAuthDialogUrl,
  classifyGraphAuthFailure,
  classifyTokenStatus,
  extractGraphErrorCode,
  extractGrantedScopes,
  findMissingScopes,
  normalizeOAuthDialogError,
  resolveAccountAuthStatus,
  signOAuthState,
  verifyOAuthState,
} from '../../src/lib/meta-oauth.ts';
import { describeMetaOAuthFeedback } from '../../src/lib/meta-oauth-feedback.ts';

const SECRET = 'state-secret-de-teste';

// ── State HMAC ──────────────────────────────────────────────

test('state: roundtrip assinado verifica e devolve o payload', () => {
  const state = signOAuthState({ n: 'abc123', t: Date.now() }, SECRET);
  const payload = verifyOAuthState(state, SECRET);
  assert.ok(payload);
  assert.equal(payload.n, 'abc123');
});

test('state: carrega accountId de reconexão (r)', () => {
  const state = signOAuthState({ n: 'x', t: Date.now(), r: 'acc-42' }, SECRET);
  const payload = verifyOAuthState(state, SECRET);
  assert.ok(payload);
  assert.equal(payload.r, 'acc-42');
});

test('state: assinatura adulterada rejeitada', () => {
  const state = signOAuthState({ n: 'x', t: Date.now() }, SECRET);
  const [body] = state.split('.');
  // body intacto, assinatura de outro segredo
  const forged = signOAuthState({ n: 'x', t: Date.now() }, 'outro-segredo').split('.')[1];
  assert.equal(verifyOAuthState(`${body}.${forged}`, SECRET), null);
});

test('state: payload modificado rejeitado (HMAC não confere)', () => {
  const state = signOAuthState({ n: 'x', t: Date.now() }, SECRET);
  const parts = state.split('.');
  const decoded = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  decoded.r = 'conta-de-outro'; // trocar o alvo da reconexão
  const forgedBody = Buffer.from(JSON.stringify(decoded)).toString('base64url');
  assert.equal(verifyOAuthState(`${forgedBody}.${parts[1]}`, SECRET), null);
});

test('state: expirado (além do TTL) rejeitado', () => {
  const stale = signOAuthState({ n: 'x', t: Date.now() - META_OAUTH_STATE_TTL_MS - 1000 }, SECRET);
  assert.equal(verifyOAuthState(stale, SECRET), null);
});

test('state: segredo divergente rejeitado (deploy trocou o secret)', () => {
  const state = signOAuthState({ n: 'x', t: Date.now() }, SECRET);
  assert.equal(verifyOAuthState(state, 'secret-novo'), null);
});

test('state: lixo rejeitado sem lançar', () => {
  assert.equal(verifyOAuthState(null, SECRET), null);
  assert.equal(verifyOAuthState('', SECRET), null);
  assert.equal(verifyOAuthState('sem-ponto', SECRET), null);
  assert.equal(verifyOAuthState('a.b', SECRET), null);
  assert.equal(verifyOAuthState('....', SECRET), null);
});

// ── Diálogo OAuth ───────────────────────────────────────────

test('diálogo: pede TODAS as permissões em bloco único + code + state', () => {
  const url = new URL(buildOAuthDialogUrl({
    appId: '1234567890',
    redirectUri: 'https://crm.example.com/api/meta-ad-accounts/oauth/callback',
    state: 'st.ate',
  }));
  assert.equal(url.origin + url.pathname, 'https://www.facebook.com/v26.0/dialog/oauth');
  assert.equal(url.searchParams.get('client_id'), '1234567890');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://crm.example.com/api/meta-ad-accounts/oauth/callback');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 'st.ate');
  const requested = (url.searchParams.get('scope') || '').split(',');
  for (const scope of META_OAUTH_SCOPES) {
    assert.ok(requested.includes(scope), `escopo ausente do diálogo: ${scope}`);
  }
  // Bloco único — nunca incremental
  assert.equal(url.searchParams.get('auth_type'), null);
});

test('diálogo: reconexão usa auth_type=rerequest (re-perguntar negadas)', () => {
  const url = new URL(buildOAuthDialogUrl({
    appId: '1',
    redirectUri: 'https://x.y/cb',
    state: 's',
    authType: 'rerequest',
  }));
  assert.equal(url.searchParams.get('auth_type'), 'rerequest');
});

// ── Permissão não aprovada (a) ──────────────────────────────

test('debug_token granular_scopes → escopos concedidos', () => {
  const granted = extractGrantedScopes({
    granular_scopes: [
      { scope: 'leads_retrieval', target_ids: ['123'] },
      { scope: 'ads_management' },
      { scope: 'pages_show_list' },
      { scope: 'pages_manage_metadata' },
    ],
  });
  assert.deepEqual(granted.sort(), ['ads_management', 'leads_retrieval', 'pages_manage_metadata', 'pages_show_list']);
});

test('debug_token formato legado (scopes array e string) aceito', () => {
  assert.deepEqual(extractGrantedScopes({ scopes: ['email', 'public_profile'] }).sort(), ['email', 'public_profile']);
  assert.deepEqual(extractGrantedScopes({ scopes: 'email, public_profile' }).sort(), ['email', 'public_profile']);
  assert.deepEqual(extractGrantedScopes(null), []);
});

test('App Review pendente: leads_retrieval ausente é detectada', () => {
  // O que a Meta devolve quando o app NÃO tem Advanced Access: as
  // permissões avançadas simplesmente não aparecem no token.
  const granted = extractGrantedScopes({
    granular_scopes: [{ scope: 'ads_management' }, { scope: 'public_profile' }, { scope: 'email' }],
  });
  const missing = findMissingScopes(granted);
  assert.ok(missing.includes('leads_retrieval'));
  assert.ok(missing.includes('pages_manage_metadata'));
  assert.equal(missing.length, META_OAUTH_REQUIRED_SCOPES.length - 1); // ads_management concedida
});

test('App Review aprovado: nenhum escopo exigido falta', () => {
  const missing = findMissingScopes([...META_OAUTH_REQUIRED_SCOPES, 'ads_read']);
  assert.deepEqual(missing, []);
});

// ── Expiração de token (b) ──────────────────────────────────

test('token: sem expiração = unknown (System User/manual)', () => {
  assert.equal(classifyTokenStatus(null), 'unknown');
});

test('token: expirado, expirando (≤7d) e ok', () => {
  const now = new Date('2026-09-09T12:00:00Z');
  assert.equal(classifyTokenStatus(new Date('2026-09-08T12:00:00Z'), now), 'expired');
  assert.equal(classifyTokenStatus(new Date('2026-09-09T12:00:00Z'), now), 'expired');
  assert.equal(classifyTokenStatus(new Date('2026-09-12T12:00:00Z'), now), 'expiring');
  assert.equal(classifyTokenStatus(new Date('2026-09-16T11:59:00Z'), now), 'expiring');
  assert.equal(classifyTokenStatus(new Date('2026-09-16T12:00:01Z'), now), 'ok');
  assert.equal(classifyTokenStatus(new Date('2026-11-01T00:00:00Z'), now), 'ok');
});

test('token: status final da conta — expiração computada vence; stored cobre permission_denied', () => {
  const now = new Date('2026-09-09T12:00:00Z');
  assert.equal(resolveAccountAuthStatus({ tokenExpiresAt: new Date('2026-09-01T00:00:00Z'), authStatus: 'ok' }, now), 'expired');
  assert.equal(resolveAccountAuthStatus({ tokenExpiresAt: null, authStatus: 'permission_denied' }, now), 'permission_denied');
  assert.equal(resolveAccountAuthStatus({ tokenExpiresAt: null, authStatus: 'expired' }, now), 'expired');
  assert.equal(resolveAccountAuthStatus({ tokenExpiresAt: new Date('2026-10-01T00:00:00Z'), authStatus: 'permission_denied' }, now), 'permission_denied');
  assert.equal(resolveAccountAuthStatus({ tokenExpiresAt: new Date('2026-10-01T00:00:00Z'), authStatus: 'ok' }, now), 'ok');
  assert.equal(resolveAccountAuthStatus({}, now), 'unknown');
});

// ── Falhas Graph em runtime (b) ─────────────────────────────

test('classify: 190/102 = expirado; 200/10 = permissão; 1..17/613 = transitório; resto = null', () => {
  assert.equal(classifyGraphAuthFailure(190), 'expired');
  assert.equal(classifyGraphAuthFailure('190'), 'expired');
  assert.equal(classifyGraphAuthFailure(102), 'expired');
  assert.equal(classifyGraphAuthFailure(200), 'permission_denied');
  assert.equal(classifyGraphAuthFailure('10'), 'permission_denied');
  assert.equal(classifyGraphAuthFailure(17), 'transient');
  assert.equal(classifyGraphAuthFailure(4), 'transient');
  assert.equal(classifyGraphAuthFailure(613), 'transient');
  assert.equal(classifyGraphAuthFailure(100), null);
  assert.equal(classifyGraphAuthFailure(null), null);
  assert.equal(classifyGraphAuthFailure('batata'), null);
});

test('extractGraphErrorCode: corpo real do polling (HTTP 400 + JSON) → 190', () => {
  const raw = `HTTP 400: {"error":{"message":"Error validating access token: Session has expired","type":"OAuthException","code":190,"error_subcode":463,"fbtrace_id":"AbC"}}`;
  assert.equal(extractGraphErrorCode(raw), 190);
  assert.equal(extractGraphErrorCode('Form 123: HTTP 500: Internal Server Error'), null);
  assert.equal(extractGraphErrorCode(null), null);
});

// ── Erros do diálogo ────────────────────────────────────────

test('diálogo: access_denied/user_denied normalizados; resto preservado', () => {
  assert.equal(normalizeOAuthDialogError('access_denied', 'user_denied'), 'access_denied');
  assert.equal(normalizeOAuthDialogError('unknown_error', null), 'server_error');
  assert.equal(normalizeOAuthDialogError('weird_error', null), 'weird_error');
  assert.equal(normalizeOAuthDialogError(null, null), 'unknown');
});

// ── Feedback URL → toast ────────────────────────────────────

test('feedback: connected monta resumo com criadas e mantidas', () => {
  const [fb] = describeMetaOAuthFeedback({ meta_oauth: 'connected', accounts: '3', skipped: '1' });
  assert.equal(fb.kind, 'success');
  assert.match(fb.message, /3 conta\(s\)/);
  assert.match(fb.message, /1 já cadastrada\(s\)/);
});

test('feedback: connected com token curto (fallback) vira warning', () => {
  const [fb] = describeMetaOAuthFeedback({ meta_oauth: 'connected', accounts: '1', skipped: '0', short_lived: '1' });
  assert.equal(fb.kind, 'warning');
  assert.match(fb.message, /CURTA duração/);
});

test('feedback: reconnected cita a conta', () => {
  const [fb] = describeMetaOAuthFeedback({ meta_oauth: 'reconnected', name: 'Conta Suely' });
  assert.equal(fb.kind, 'success');
  assert.match(fb.message, /Conta Suely/);
});

test('feedback: missing_permissions explica App Review e lista escopos', () => {
  const [fb] = describeMetaOAuthFeedback({ meta_oauth_error: 'missing_permissions', scopes: 'leads_retrieval,pages_manage_metadata' });
  assert.equal(fb.kind, 'error');
  assert.match(fb.message, /leads_retrieval,pages_manage_metadata/);
  assert.match(fb.message, /App Review/);
  assert.match(fb.message, /OMITE/);
});

test('feedback: erros mapeados (cancelamento, config, redirect, state)', () => {
  const msgs = (params: Record<string, string>) => describeMetaOAuthFeedback(params).map((f) => f.message).join(' | ');
  assert.match(msgs({ meta_oauth_error: 'access_denied' }), /cancelada/i);
  assert.match(msgs({ meta_oauth_error: 'not_configured' }), /META_APP_ID/);
  assert.match(msgs({ meta_oauth_error: 'redirect_mismatch' }), /Valid OAuth Redirect URIs/);
  assert.match(msgs({ meta_oauth_error: 'invalid_state' }), /state/);
  assert.match(msgs({ meta_oauth_error: 'all_accounts_exist' }), /já estavam cadastradas/);
  assert.match(msgs({ meta_oauth_error: 'código_aleatório', detail: 'boom' }), /boom/);
});

test('feedback: sem params → vazio', () => {
  assert.deepEqual(describeMetaOAuthFeedback({}), []);
});
