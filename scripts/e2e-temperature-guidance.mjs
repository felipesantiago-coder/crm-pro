/**
 * E2E local — classificação do lead no perfil do CRM + tratativa.
 * Semeadura de 3 leads (QUENTE/MORNO/FRIO) + validação da API.
 * Requer dev server em :3000 e seed prévio: node scripts/seed-temperature.mjs
 */
import { PrismaClient } from '@prisma/client';

const BASE = 'http://localhost:3000';
const db = new PrismaClient();

const CASES = [
  { name: 'Marcos Quente E2E', temperature: 'QUENTE', score: 17, email: 'marcos.quente@e2e.local' },
  { name: 'Helena Morna E2E', temperature: 'MORNO', score: 8, email: 'helena.morna@e2e.local' },
  { name: 'Caio Frio E2E', temperature: 'FRIO', score: 2, email: 'caio.frio@e2e.local' },
];

async function login() {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const cookie1 = csrfRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { csrfToken } = await csrfRes.json();
  const body = new URLSearchParams({
    csrfToken,
    email: 'admin@crm.local',
    password: 'crm12345',
    callbackUrl: `${BASE}/`,
    json: 'true',
  });
  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie1 },
    body,
    redirect: 'manual',
  });
  const setCookies = loginRes.headers.getSetCookie().map((c) => c.split(';')[0]);
  const session = setCookies.find((c) => c.includes('session-token'));
  if (!session) throw new Error(`Login falhou (status ${loginRes.status})`);
  return session;
}

async function main() {
  const admin = await db.user.findUnique({ where: { email: 'admin@crm.local' } });
  if (!admin) throw new Error('Seed prévio necessário: node scripts/seed-temperature.mjs');

  // ── Semeadura: um lead por classificação, atribuído ao admin ──
  const ids = {};
  for (const c of CASES) {
    const existing = await db.client.findFirst({
      where: { name: c.name, createdBy: admin.id },
    });
    const data = {
      name: c.name,
      phone: '+5561993000001',
      email: c.email,
      region: 'Brasília',
      enterprise: 'Villa Bianco',
      stage: 'LEAD',
      createdBy: admin.id,
      metaTemperature: c.temperature,
      metaScore: c.score,
      utmCampaign: 'VB - Orçamento',
    };
    const client = existing
      ? await db.client.update({ where: { id: existing.id }, data })
      : await db.client.create({ data });
    ids[c.temperature] = client.id;
  }
  console.log('✓ Leads semeados:', JSON.stringify(ids));

  // ── Validação da API (perfil do lead retorna a classificação) ──
  const session = await login();
  for (const c of CASES) {
    const res = await fetch(`${BASE}/api/clients/${ids[c.temperature]}`, {
      headers: { Cookie: session },
    });
    if (!res.ok) throw new Error(`GET /api/clients falhou para ${c.name}: ${res.status}`);
    const client = await res.json();
    if (client.metaTemperature !== c.temperature || client.metaScore !== c.score) {
      throw new Error(`Classificação ausente na API para ${c.name}: ${JSON.stringify({
        metaTemperature: client.metaTemperature,
        metaScore: client.metaScore,
      })}`);
    }
  }
  console.log('✓ GET /api/clients/[id] retorna metaTemperature + metaScore para as 3 classificações');

  // ── Lista também expõe (para o badge no cartão da lista) ──
  const listRes = await fetch(`${BASE}/api/clients?search=Quente E2E`, {
    headers: { Cookie: session },
  });
  if (listRes.ok) {
    const list = await listRes.json();
    const row = Array.isArray(list) ? list.find((x) => x.name === 'Marcos Quente E2E') : null;
    if (row && row.metaTemperature) {
      console.log('✓ GET /api/clients (lista) expõe metaTemperature:', row.metaTemperature);
    } else {
      console.log('⚠ Lista sem metaTemperature visível (badge na lista não depende disso no perfil)');
    }
  }

  console.log('E2E_API_OK ids=' + JSON.stringify(ids));
}

main()
  .catch((err) => {
    console.error('✗', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
