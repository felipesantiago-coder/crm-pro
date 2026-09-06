/**
 * google-calendar-auth.test.ts — Contrato da URL de consentimento do
 * Google Calendar usada por GET /api/google-calendar/auth.
 *
 * Regressão chave: essa rota é navegada DIRETO pelo botão "Conectar
 * Google Calendar" (window.location.href), então ela deve responder 30x
 * (redirect), nunca JSON. Aqui travamos o contrato da URL de consentimento
 * (escopos, offline/consent, state percent-encoded) gerada por
 * buildCalendarConsentUrl — funções puras, sem rede e sem banco.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCalendarConsentUrl,
  resolveGoogleRedirectUri,
} from '../../src/lib/google-calendar.ts';

const CLIENT_ID = '498896139293-test.apps.googleusercontent.com';
const REDIRECT_URI = 'https://www.crm-pro.site/api/google-calendar/callback';
const STATE = 'cmtp1rp590000js04uuhvvuo5:ab0f7c7d960fa73222490168408efed9';

// ── helpers de env (save/restore) ──────────────────────────────

const ENV_KEYS = ['GOOGLE_REDIRECT_URI', 'NEXTAUTH_URL'] as const;

function withEnv(values: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  try {
    for (const k of ENV_KEYS) {
      if (values[k] === undefined) delete process.env[k];
      else process.env[k] = values[k];
    }
    fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

function parsed(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

// ── buildCalendarConsentUrl ────────────────────────────────────

test('buildCalendarConsentUrl: URL absoluta no endpoint OAuth do Google', () => {
  const url = buildCalendarConsentUrl({
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    state: STATE,
  });
  assert.ok(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'));
  assert.equal(new URL(url).origin, 'https://accounts.google.com');
});

test('buildCalendarConsentUrl: client_id e redirect_uri percent-encoded', () => {
  const params = parsed(
    buildCalendarConsentUrl({
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      state: STATE,
    })
  );
  assert.equal(params.get('client_id'), CLIENT_ID);
  assert.equal(params.get('redirect_uri'), REDIRECT_URI);
  // https:// não pode aparecer cru no valor serializado
  assert.match(params.get('redirect_uri') ?? '', /^https:\/\//);
  assert.ok(!params.toString().includes('redirect_uri=https%3A%2F%2F='));
});

test('buildCalendarConsentUrl: response_type=code (fluxo authorization code)', () => {
  const params = parsed(
    buildCalendarConsentUrl({
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      state: STATE,
    })
  );
  assert.equal(params.get('response_type'), 'code');
});

test('buildCalendarConsentUrl: escopos calendar.readonly + calendar.events', () => {
  const params = parsed(
    buildCalendarConsentUrl({
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      state: STATE,
    })
  );
  const scopes = (params.get('scope') ?? '').split(' ');
  assert.ok(scopes.includes('https://www.googleapis.com/auth/calendar.readonly'));
  assert.ok(scopes.includes('https://www.googleapis.com/auth/calendar.events'));
  assert.equal(scopes.length, 2);
});

test('buildCalendarConsentUrl: access_type=offline + prompt=consent garantem refresh_token', () => {
  const params = parsed(
    buildCalendarConsentUrl({
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      state: STATE,
    })
  );
  assert.equal(params.get('access_type'), 'offline');
  assert.equal(params.get('prompt'), 'consent');
});

test('buildCalendarConsentUrl: state com ":" é percent-encoded e sobrevive ao round-trip', () => {
  const url = buildCalendarConsentUrl({
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    state: STATE,
  });
  // formato cru não pode quebrar a query
  assert.ok(!url.includes('state=cmtp1rp590000js04uuhvvuo5:'));
  // round-trip: callback lê exatamente o state original
  assert.equal(parsed(url).get('state'), STATE);
});

test('buildCalendarConsentUrl: produz a mesma URL que a rota servia antes (contrato de produção)', () => {
  // snapshot do formato observado em produção (com client_id real abstraído)
  const url = buildCalendarConsentUrl({
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    state: STATE,
  });
  assert.equal(
    url,
    'https://accounts.google.com/o/oauth2/v2/auth?' +
      new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope:
          'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events',
        access_type: 'offline',
        prompt: 'consent',
        state: STATE,
      }).toString()
  );
});

// ── resolveGoogleRedirectUri ───────────────────────────────────

test('resolveGoogleRedirectUri: GOOGLE_REDIRECT_URI explícita tem prioridade', () => {
  withEnv(
    {
      GOOGLE_REDIRECT_URI: 'https://crm-pro.site/api/google-calendar/callback',
      NEXTAUTH_URL: 'https://www.crm-pro.site',
    },
    () => {
      assert.equal(
        resolveGoogleRedirectUri(),
        'https://crm-pro.site/api/google-calendar/callback'
      );
    }
  );
});

test('resolveGoogleRedirectUri: fallback deriva de NEXTAUTH_URL', () => {
  withEnv({ GOOGLE_REDIRECT_URI: undefined, NEXTAUTH_URL: 'https://www.crm-pro.site' }, () => {
    assert.equal(resolveGoogleRedirectUri(), REDIRECT_URI);
  });
});

test('resolveGoogleRedirectUri: trailing slash de NEXTAUTH_URL não gera barra dupla', () => {
  withEnv({ GOOGLE_REDIRECT_URI: undefined, NEXTAUTH_URL: 'https://www.crm-pro.site/' }, () => {
    assert.equal(resolveGoogleRedirectUri(), REDIRECT_URI);
  });
});

test('resolveGoogleRedirectUri: override com barra final também é normalizado', () => {
  withEnv(
    { GOOGLE_REDIRECT_URI: 'https://www.crm-pro.site/api/google-calendar/callback/', NEXTAUTH_URL: undefined },
    () => {
      assert.equal(resolveGoogleRedirectUri(), REDIRECT_URI);
    }
  );
});

test('resolveGoogleRedirectUri: sem nenhuma das envs lança erro explicativo', () => {
  withEnv({ GOOGLE_REDIRECT_URI: undefined, NEXTAUTH_URL: undefined }, () => {
    assert.throws(() => resolveGoogleRedirectUri(), /GOOGLE_REDIRECT_URI ou NEXTAUTH_URL/);
  });
});

test('CONTRATO OAuth: redirect_uri do consentimento ≡ resolveGoogleRedirectUri (evita 400 mismatch)', () => {
  // O Google exige que o redirect_uri enviado na tela de consentimento seja
  // EXATAMENTE o mesmo do token exchange (e o ambos registrados no Console).
  // Esta rota era a causa latente do "Erro 400: redirect_uri_mismatch".
  withEnv({ GOOGLE_REDIRECT_URI: undefined, NEXTAUTH_URL: 'https://www.crm-pro.site' }, () => {
    const redirectUri = resolveGoogleRedirectUri();
    const url = buildCalendarConsentUrl({ clientId: CLIENT_ID, redirectUri, state: STATE });
    assert.equal(parsed(url).get('redirect_uri'), redirectUri);
    assert.equal(redirectUri, 'https://www.crm-pro.site/api/google-calendar/callback');
  });
});
