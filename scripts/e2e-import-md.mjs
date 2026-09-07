/**
 * E2E local — importação de regras de lead scoring em markdown
 * (parser → preview → apply → GET confirma). Requer dev server em :3000
 * e seed prévio: node scripts/seed-temperature.mjs
 */
const BASE = 'http://localhost:3000';
const FORM_MAIN = { id: 'form_orcamento_001', name: 'Orçamento Villa Bianco' };

const MD_GOOD = `# Formulário: ${FORM_MAIN.name}

Limiar morno: 6
Limiar quente: 14

## Qual é o seu orçamento?

| Resposta | Pontos |
|---|---|
| Até R$ 500 mil | 0 |
| R$ 500 mil a R$ 800 mil | 5 |
| Acima de R$ 800 mil | 10 |
| Entre R$ 800 mil e R$ 1 milhão | 7 |

## Quando pretende comprar?

- Neste mês: 8
- Em 3 meses: 4
- Só estou pesquisando: 0

## Já trabalha com corretor?

> Pergunta dissertativa — nota fixa para qualquer resposta.

Nota da pergunta: 2
`;

const MD_WRONG = MD_GOOD.replace(FORM_MAIN.name, 'Formulário Inexistente XYZ');

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

async function post(path, data, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(data),
  });
  return { status: res.status, json: await res.json() };
}

async function main() {
  const cookie = await login();
  console.log('✓ login admin OK');

  // 1. Preview com arquivo CORRETO
  const preview = await post('/api/meta-ads/temperature/import-md', { content: MD_GOOD, formId: FORM_MAIN.id }, cookie);
  console.log('\n── PREVIEW (arquivo correto) ──', preview.status);
  console.log('ok:', preview.json.ok, '| targetIndex:', preview.json.targetIndex);
  console.log('match:', preview.json.forms?.[0]?.match);
  console.log('perguntas:', preview.json.forms?.[0]?.questions?.length,
    '| respostas:', preview.json.forms?.[0]?.questions?.reduce((a, q) => a + q.answers.length, 0));
  console.log('issues:', preview.json.issues?.length, JSON.stringify(preview.json.issues?.slice(0, 3)));
  console.log('review:', JSON.stringify(preview.json.review));
  if (preview.status !== 200 || !preview.json.ok || preview.json.targetIndex === null) {
    throw new Error('Preview do arquivo correto deveria passar');
  }

  // 2. Preview com arquivo de OUTRO formulário
  const wrong = await post('/api/meta-ads/temperature/import-md', { content: MD_WRONG, formId: FORM_MAIN.id }, cookie);
  console.log('\n── PREVIEW (nome errado) ──', wrong.status);
  console.log('ok:', wrong.json.ok, '| targetIndex:', wrong.json.targetIndex);
  console.log('erro esperado:', wrong.json.issues?.find((i) => i.severity === 'error')?.message);
  if (wrong.json.ok !== false || wrong.json.targetIndex !== null) {
    throw new Error('Arquivo com nome errado deveria bloquear');
  }

  // 3. Apply do arquivo correto
  const target = preview.json.forms[preview.json.targetIndex];
  const apply = await post('/api/meta-ads/temperature/import-md/apply', {
    formId: FORM_MAIN.id,
    formName: target.formName,
    enabled: true,
    warmMin: target.warmMin,
    hotMin: target.hotMin,
    questions: target.questions,
    reclassify: true,
  }, cookie);
  console.log('\n── APPLY ──', apply.status);
  console.log('ok:', apply.json.ok, '| enabled:', apply.json.scoring?.enabled,
    '| limiares:', apply.json.scoring?.warmMin, '/', apply.json.scoring?.hotMin);
  console.log('perguntas salvas:', apply.json.scoring?.questions?.length);
  console.log('reclassify:', JSON.stringify(apply.json.reclassifyResult));
  if (apply.status !== 200 || !apply.json.ok) throw new Error('Apply falhou');

  // 4. GET confirma persistência
  const detail = await fetch(`${BASE}/api/meta-ads/temperature?formId=${FORM_MAIN.id}`, { headers: { Cookie: cookie } });
  const detailJson = await detail.json();
  console.log('\n── GET pós-import ──', detail.status);
  console.log('config ativa:', detailJson.scoring?.enabled, '| perguntas:', detailJson.scoring?.questions?.length);
  console.log('primeira pergunta:', JSON.stringify(detailJson.scoring?.questions?.[0]));
  console.log('temperaturas:', JSON.stringify(detailJson.temperatureCounts));

  // 5. Validações de defesa
  const noQuestions = await post('/api/meta-ads/temperature/import-md/apply', {
    formId: FORM_MAIN.id, questions: [], enabled: true,
  }, cookie);
  console.log('\n── APPLY sem perguntas ──', noQuestions.status, noQuestions.json.error);

  const empty = await post('/api/meta-ads/temperature/import-md', { content: '   ' }, cookie);
  console.log('── PREVIEW vazio ──', empty.status, empty.json.error);

  const unauth = await fetch(`${BASE}/api/meta-ads/temperature/import-md`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: MD_GOOD }) });
  console.log('── PREVIEW sem sessão ──', unauth.status, unauth.status === 401 || unauth.status === 403 ? '(bloqueado ✓)' : '(FALHA: deveria bloquear)');

  console.log('\n✓ E2E import-md concluído com sucesso');
}

main().catch((err) => {
  console.error('✗ E2E FALHOU:', err.message);
  process.exit(1);
});
