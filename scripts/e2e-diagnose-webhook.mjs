/**
 * e2e-diagnose-webhook.mjs — Valida o diagnóstico aprimorado do webhook:
 *   1) semeia uma conta Meta (app secret correto) → POST selftest deve ser OK
 *   2) troca o app secret para um valor errado → POST selftest deve ser ERRO (401)
 *   3) imprime os checks novos (webhook_selftest / webhook_post_selftest / webhook_lost_leads)
 * Uso: node scripts/e2e-diagnose-webhook.mjs (server precisa estar no ar em :3000)
 */
const BASE = process.env.BASE || 'http://localhost:3000';

async function login() {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const cookie1 = csrfRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const csrf = (await csrfRes.json()).csrfToken;
  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie1 },
    body: new URLSearchParams({
      csrfToken: csrf,
      email: 'admin@crm.local',
      password: 'crm12345',
      callbackUrl: `${BASE}/`,
      json: 'true',
    }),
    redirect: 'manual',
  });
  const setCookies = loginRes.headers.getSetCookie().map((c) => c.split(';')[0]);
  const session = setCookies.find((c) => c.includes('session-token'));
  if (!session) throw new Error(`Login falhou (status ${loginRes.status})`);
  return `${cookie1}; ${session}`;
}

async function diagnose(cookie, accountId) {
  const res = await fetch(`${BASE}/api/meta-ad-accounts/${accountId}/diagnose`, { headers: { Cookie: cookie } });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`diagnose HTTP ${res.status}: ${JSON.stringify(json)?.slice(0, 300)}`);
  return json;
}

function showChecks(label, data) {
  console.log(`\n=== ${label} (summary: ${JSON.stringify(data.summary)}) ===`);
  for (const key of ['webhook_selftest', 'webhook_post_selftest', 'webhook_lost_leads']) {
    const c = data.checks.find((x) => x.key === key);
    console.log(`[${key}] ${c ? c.status.toUpperCase() : 'AUSENTE'} — ${c ? c.details.slice(0, 160) : 'n/a'}`);
  }
}

async function main() {
  const cookie = await login();

  // Conta de teste: secret CORRETO conhecido
  const SECRET = 'diag_smoke_secret_123';
  const seedRes = await fetch(`${BASE}/api/meta-ad-accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      name: 'Diag Smoke Webhook',
      adAccountId: '999000111',
      accessToken: 'diag_invalid_token_on_purpose',
      appSecret: SECRET,
      verifyToken: 'diag_smoke_verify_token',
      pageIds: [],
      formIds: [],
      enabled: true,
      webhookEnabled: true,
      pollingEnabled: false,
    }),
  });
  const seeded = await seedRes.json().catch(() => null);
  if (!seedRes.ok) throw new Error(`seed HTTP ${seedRes.status}: ${JSON.stringify(seeded)?.slice(0, 300)}`);
  const accountId = seeded?.id;
  if (!accountId) throw new Error(`seed sem id: ${JSON.stringify(seeded)?.slice(0, 200)}`);

  // 1) secret CORRETO → POST selftest ok
  showChecks('SECRET CORRETO', await diagnose(cookie, accountId));

  // 2) Simula entrega REAL com assinatura inválida (secret estranho) —
  //    o webhook deve salvar lostLead meta_webhook_invalid_signature e o
  //    diagnóstico seguinte deve REPORTAR o erro com a causa raiz.
  const foreign = JSON.stringify({
    object: 'page',
    entry: [{ id: 'diag_foreign_page', time: Math.floor(Date.now() / 1000), changes: [{ field: 'leadgen', value: {} }] }],
  });
  const badSig = 'sha256=' + Buffer.from('nao-e-o-secret').toString('hex').slice(0, 64).padEnd(64, '0');
  const badRes = await fetch(`${BASE}/api/webhooks/meta-leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': badSig, 'User-Agent': 'Diag-Smoke/1.0' },
    body: foreign,
  });
  console.log(`\nEntrega com assinatura estrangeira → HTTP ${badRes.status} (esperado 401)`);
  await diagnose(cookie, accountId); // diagnóstico com lostLead presente
  const data2 = await diagnose(cookie, accountId);
  showChecks('APÓS ASSINATURA INVÁLIDA (deve ser ERROR)', data2);

  // Cleanup: conta de teste + lostLead de teste (criado pela sonda inválida)
  await fetch(`${BASE}/api/meta-ad-accounts/${accountId}`, { method: 'DELETE', headers: { Cookie: cookie } }).catch(() => {});
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  const del = await db.lostLead.deleteMany({
    // Sonda de teste = rejeição SEM leadgen (nome "… 0 lead(s): ");
    // entregas reais de leads têm ids no nome e nunca são apagadas aqui.
    where: { source: 'meta_webhook_invalid_signature', name: { contains: '0 lead(s): ' } },
  });
  console.log(`Cleanup: lostLead(s) de teste removidos: ${del.count}`);
  await db.$disconnect();
  console.log('\nCleanup OK');
}

main().catch((err) => {
  console.error('FALHA:', err.message);
  process.exit(1);
});
