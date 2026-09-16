/**
 * oauth-redirect.test.ts — redirect_uri OAuth por origem da requisição.
 *
 * Contratos testados (bug 2026-09 "Não autorizado" no callback do Google
 * Calendar):
 *   - origem pública via x-forwarded-host/proto (com listas) e fallback
 *   - origem == canônica → canonical intacto
 *   - host irmão www↔apex → canonical com hostname trocado, path/porta
 *     preservados (respeita override GOOGLE_REDIRECT_URI)
 *   - protocolo/porta divergentes, origens desconhecidas e localhost →
 *     fallback SEGURO para o canônico
 *   - allowlist extra (env) troca só o host
 *   - wrappers Google/Meta: mesmo contrato + null quando canônico ausente
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseExtraOriginsEnv,
  resolveOAuthRedirectUriForRequest,
  resolveRequestOrigin,
} from '../../src/lib/oauth-redirect.ts';
import { resolveGoogleRedirectUriForRequest } from '../../src/lib/google-calendar.ts';
import { resolveMetaOAuthRedirectUriForRequest } from '../../src/lib/meta-oauth.ts';

function headers(map: Record<string, string>): { get(name: string): string | null } {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

describe('resolveRequestOrigin', () => {
  test('usa x-forwarded-host/proto (padrão Vercel)', () => {
    assert.equal(
      resolveRequestOrigin(headers({ 'x-forwarded-host': 'crm-pro.site', 'x-forwarded-proto': 'https' }), 'https://fallback'),
      'https://crm-pro.site',
    );
  });

  test('lista "a, b" nos forwarded headers → primeiro elemento', () => {
    assert.equal(
      resolveRequestOrigin(headers({ 'x-forwarded-host': 'crm-pro.site, www.crm-pro.site', 'x-forwarded-proto': 'https,http' }), null),
      'https://crm-pro.site',
    );
  });

  test('sem x-forwarded-host → fallback (nextUrl.origin em dev)', () => {
    assert.equal(resolveRequestOrigin(headers({}), 'http://localhost:3000'), 'http://localhost:3000');
  });

  test('sem host e sem fallback → null', () => {
    assert.equal(resolveRequestOrigin(headers({}), null), null);
  });

  test('host sem proto → https por padrão', () => {
    assert.equal(resolveRequestOrigin(headers({ 'x-forwarded-host': 'crm-pro.site' }), null), 'https://crm-pro.site');
  });
});

describe('resolveOAuthRedirectUriForRequest', () => {
  const CANONICAL = 'https://www.crm-pro.site/api/google-calendar/callback';

  test('origem == canônica → canonical verbatim', () => {
    assert.equal(
      resolveOAuthRedirectUriForRequest({ canonicalRedirectUri: CANONICAL, requestOrigin: 'https://www.crm-pro.site' }),
      CANONICAL,
    );
  });

  test('requestOrigin null → canonical (comportamento anterior preservado)', () => {
    assert.equal(
      resolveOAuthRedirectUriForRequest({ canonicalRedirectUri: CANONICAL, requestOrigin: null }),
      CANONICAL,
    );
  });

  test('apex request + canônico www → irmão apex, path preservado', () => {
    assert.equal(
      resolveOAuthRedirectUriForRequest({ canonicalRedirectUri: CANONICAL, requestOrigin: 'https://crm-pro.site' }),
      'https://crm-pro.site/api/google-calendar/callback',
    );
  });

  test('canônico apex + request www → irmão www', () => {
    assert.equal(
      resolveOAuthRedirectUriForRequest({
        canonicalRedirectUri: 'https://crm-pro.site/api/google-calendar/callback',
        requestOrigin: 'https://www.crm-pro.site',
      }),
      'https://www.crm-pro.site/api/google-calendar/callback',
    );
  });

  test('override com path customizado preserva o path no swap', () => {
    assert.equal(
      resolveOAuthRedirectUriForRequest({
        canonicalRedirectUri: 'https://www.crm-pro.site/custom/cb',
        requestOrigin: 'https://crm-pro.site',
      }),
      'https://crm-pro.site/custom/cb',
    );
  });

  test('protocolo divergente → fallback seguro (não rebaixa https→http)', () => {
    assert.equal(
      resolveOAuthRedirectUriForRequest({ canonicalRedirectUri: CANONICAL, requestOrigin: 'http://crm-pro.site' }),
      CANONICAL,
    );
  });

  test('porta divergente → fallback seguro', () => {
    assert.equal(
      resolveOAuthRedirectUriForRequest({ canonicalRedirectUri: CANONICAL, requestOrigin: 'https://crm-pro.site:8443' }),
      CANONICAL,
    );
  });

  test('origem desconhecida (phishing) → fallback seguro', () => {
    assert.equal(
      resolveOAuthRedirectUriForRequest({ canonicalRedirectUri: CANONICAL, requestOrigin: 'https://evil.example.com' }),
      CANONICAL,
    );
  });

  test('requestOrigin inválida → fallback seguro', () => {
    assert.equal(
      resolveOAuthRedirectUriForRequest({ canonicalRedirectUri: CANONICAL, requestOrigin: 'not-a-url' }),
      CANONICAL,
    );
  });

  test('canonical inválida → devolvida como veio', () => {
    assert.equal(
      resolveOAuthRedirectUriForRequest({ canonicalRedirectUri: 'nope', requestOrigin: 'https://crm-pro.site' }),
      'nope',
    );
  });

  test('localhost não tem irmão www (portas divergentes caem no fallback)', () => {
    assert.equal(
      resolveOAuthRedirectUriForRequest({
        canonicalRedirectUri: 'http://localhost:3000/api/google-calendar/callback',
        requestOrigin: 'http://localhost:3001',
      }),
      'http://localhost:3000/api/google-calendar/callback',
    );
  });

  test('allowlist extra troca só o host (protocolo segue o canônico)', () => {
    assert.equal(
      resolveOAuthRedirectUriForRequest({
        canonicalRedirectUri: CANONICAL,
        requestOrigin: 'https://app.parceiro.com',
        extraAllowedOrigins: ['https://app.parceiro.com'],
      }),
      'https://app.parceiro.com/api/google-calendar/callback',
    );
  });

  test('origem fora da allowlist → fallback seguro', () => {
    assert.equal(
      resolveOAuthRedirectUriForRequest({
        canonicalRedirectUri: CANONICAL,
        requestOrigin: 'https://evil.example.com',
        extraAllowedOrigins: ['https://app.parceiro.com'],
      }),
      CANONICAL,
    );
  });

  test('entrada inválida na allowlist é ignorada sem quebrar as demais', () => {
    assert.equal(
      resolveOAuthRedirectUriForRequest({
        canonicalRedirectUri: CANONICAL,
        requestOrigin: 'https://app.parceiro.com',
        extraAllowedOrigins: [':::bad:::', 'https://app.parceiro.com'],
      }),
      'https://app.parceiro.com/api/google-calendar/callback',
    );
  });
});

describe('parseExtraOriginsEnv', () => {
  test('separa por vírgula, corta espaços e ignora vazios', () => {
    assert.deepEqual(parseExtraOriginsEnv(' https://a.com , ,https://b.com '), [
      'https://a.com',
      'https://b.com',
    ]);
  });

  test('env ausente → lista vazia', () => {
    assert.deepEqual(parseExtraOriginsEnv(undefined), []);
  });
});

describe('wrappers Google/Meta (env real)', () => {
  const ORIGINAL: Record<string, string | undefined> = {};

  before(() => {
    for (const key of [
      'NEXTAUTH_URL',
      'GOOGLE_REDIRECT_URI',
      'GOOGLE_OAUTH_REDIRECT_ORIGINS',
      'META_OAUTH_REDIRECT_URI',
      'META_OAUTH_REDIRECT_ORIGINS',
      'NEXT_PUBLIC_APP_URL',
    ]) {
      ORIGINAL[key] = process.env[key];
      delete process.env[key];
    }
    process.env.NEXTAUTH_URL = 'https://www.crm-pro.site';
  });

  after(() => {
    for (const [key, value] of Object.entries(ORIGINAL)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('google: host irmão do NEXTAUTH_URL', () => {
    assert.equal(
      resolveGoogleRedirectUriForRequest('https://crm-pro.site'),
      'https://crm-pro.site/api/google-calendar/callback',
    );
  });

  test('google: host canônico → canonical', () => {
    assert.equal(
      resolveGoogleRedirectUriForRequest('https://www.crm-pro.site'),
      'https://www.crm-pro.site/api/google-calendar/callback',
    );
  });

  test('google: env extra GOOGLE_OAUTH_REDIRECT_ORIGINS', () => {
    process.env.GOOGLE_OAUTH_REDIRECT_ORIGINS = 'https://app.parceiro.com';
    try {
      assert.equal(
        resolveGoogleRedirectUriForRequest('https://app.parceiro.com'),
        'https://app.parceiro.com/api/google-calendar/callback',
      );
    } finally {
      delete process.env.GOOGLE_OAUTH_REDIRECT_ORIGINS;
    }
  });

  test('google: sem NEXTAUTH_URL/GOOGLE_REDIRECT_URI → propaga erro (mesmo contrato)', () => {
    const saved = process.env.NEXTAUTH_URL;
    delete process.env.NEXTAUTH_URL;
    try {
      assert.throws(() => resolveGoogleRedirectUriForRequest(null), /GOOGLE_REDIRECT_URI ou NEXTAUTH_URL/);
    } finally {
      process.env.NEXTAUTH_URL = saved;
    }
  });

  test('meta: host irmão do NEXTAUTH_URL', () => {
    assert.equal(
      resolveMetaOAuthRedirectUriForRequest('https://crm-pro.site'),
      'https://crm-pro.site/api/meta-ad-accounts/oauth/callback',
    );
  });

  test('meta: NEXTAUTH_URL ausente e sem overrides → null (not_configured na rota)', () => {
    const saved = process.env.NEXTAUTH_URL;
    delete process.env.NEXTAUTH_URL;
    try {
      assert.equal(resolveMetaOAuthRedirectUriForRequest('https://crm-pro.site'), null);
    } finally {
      process.env.NEXTAUTH_URL = saved;
    }
  });

  test('meta: NEXT_PUBLIC_APP_URL como fallback do canônico', () => {
    const saved = process.env.NEXTAUTH_URL;
    delete process.env.NEXTAUTH_URL;
    process.env.NEXT_PUBLIC_APP_URL = 'https://www.crm-pro.site';
    try {
      assert.equal(
        resolveMetaOAuthRedirectUriForRequest('https://crm-pro.site'),
        'https://crm-pro.site/api/meta-ad-accounts/oauth/callback',
      );
    } finally {
      delete process.env.NEXT_PUBLIC_APP_URL;
      process.env.NEXTAUTH_URL = saved;
    }
  });
});
