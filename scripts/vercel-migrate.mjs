#!/usr/bin/env node
/**
 * Prisma Migrate Deploy resiliente para o build da Vercel.
 *
 * CONTEXTO (causa da falha de deploy do commit 825c9a7):
 *   O DATABASE_URL configurado na Vercel aponta para o pooler de TRANSAÇÕES
 *   do Supabase (porta 6543). O Prisma Migrate exige conexão de sessão/direta
 *   (advisory locks + prepared statements não funcionam por pgbouncer em
 *   transaction mode), portanto `prisma migrate deploy` travava/falhava e o
 *   build morria exatamente na etapa de migrate.
 *
 * ESTRATÉGIA DE CONEXÃO (em ordem de prioridade):
 *   1. DIRECT_DATABASE_URL, se definida (ideal: conexão de sessão — mesmo
 *      host do pooler na porta 5432, ou db.<ref>.supabase.co:5432);
 *   2. Sem DIRECT_DATABASE_URL: se a URL estiver na porta 6543, tenta a
 *      MESMA URL na porta 5432 (session pooler do Supabase — mesmo host,
 *      mesmas credenciais, mesmo banco);
 *   3. Último recurso: a URL original (caso o pooler aceite a sessão).
 *
 * POLÍTICA DE FALHA:
 *   - O código em produção DEPENDE das colunas da migration (roteamento
 *     multi-anúncio). Entra no ar SEM as colunas = webhook/polling/painel
 *     Meta quebrados em runtime. Portanto, se nenhuma conexão conseguir
 *     aplicar as migrations, o build FALHA com instruções objetivas — o
 *     deploy anterior (saudável) continua servindo enquanto isso.
 *   - Escape para builds locais sem banco: MIGRATE_ON_FAIL=skip
 *     (degrada para aviso e NÃO falha o build).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');

function log(...args) {
  console.log('[migrate]', ...args);
}

function warn(...args) {
  console.warn('[migrate] ⚠️ ', ...args);
}

/** Troca a porta 6543 (transaction pooler) por 5432 (session/direta). */
function withSessionPort(url) {
  if (!/:6543/.test(url)) return null;
  return url.replace(':6543', ':5432');
}

function maskUrl(url) {
  return url.replace(/(\/\/[^:/@]+):([^@]+)@/, '$1:***@');
}

function runPrismaMigrateDeploy(url) {
  // Nota: `prisma migrate deploy` NÃO aceita --url no Prisma 6.x.
  // A sobrescrita correta é via env DATABASE_URL (process env tem
  // precedência sobre o .env do projeto).
  const res = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL: url },
  });
  return res.status === 0;
}

function printFailureHelp(attempts) {
  console.error('');
  console.error('============================================================');
  console.error('[migrate] ❌ FALHA AO APLICAR MIGRATIONS (prisma migrate deploy)');
  console.error('============================================================');
  console.error('Conexões tentadas:');
  for (const a of attempts) {
    console.error(`  - ${a.label}: ${maskUrl(a.url)}`);
  }
  console.error('');
  console.error('O código deste build EXIGE as colunas da migration');
  console.error('20260903_meta_multi_ad_queue_routing (queueId em');
  console.error('meta_cap_configs e lead_form_mappings). Subir este build');
  console.error('sem elas quebraria webhook/polling/painel Meta em runtime.');
  console.error('');
  console.error('Como resolver (qualquer uma das opções):');
  console.error('  1) RECOMENDADO: defina a variável de ambiente DIRECT_DATABASE_URL');
  console.error('     na Vercel apontando para uma conexão de SESSÃO/direta do');
  console.error('     Supabase (mesmo host do pooler, porta 5432), ex.:');
  console.error('       postgresql://<user>:<pass>@aws-1-<region>.pooler.supabase.com:5432/<db>');
  console.error('     Depois faça "Redeploy".');
  console.error('  2) Local, a partir da sua máquina (conexão direta/sessão):');
  console.error('       DATABASE_URL="<url-sessao>" npm run db:deploy');
  console.error('  3) Se o erro indicar drift (P3005/P3018 — ex.: banco gerenciado');
  console.error('     por db push, sem histórico de migrations), baselize UMA vez:');
  console.error('       npm run db:baseline -- --url "<url-sessao>" --yes');
  console.error('     e depois faça redeploy.');
  console.error('============================================================');
}
// ---------------------------------------------------------------
// Resolve a(s) URL(s) candidatas
// ---------------------------------------------------------------
const direct = process.env.DIRECT_DATABASE_URL || '';
const databaseUrl = process.env.DATABASE_URL || '';

if (!databaseUrl && !direct) {
  warn('DATABASE_URL/DIRECT_DATABASE_URL ausentes — pulando migrate deploy.');
  process.exit(0);
}

// O apontamento do DATABASE_URL no repositório é placeholder local (sqlite/file:)
// — nesse caso não há o que migrar neste ambiente.
if (!direct && !/^postgres(ql)?:\/\//i.test(databaseUrl)) {
  warn(
    `DATABASE_URL não é Postgres (${databaseUrl.split(':')[0]}:...) — pulando migrate deploy.`,
  );
  process.exit(0);
}

const candidates = [];
const seen = new Set();
function pushCandidate(label, url) {
  if (!url || seen.has(url)) return;
  seen.add(url);
  candidates.push({ label, url });
}

if (direct) pushCandidate('DIRECT_DATABASE_URL', direct);
const swapped = withSessionPort(direct || databaseUrl);
if (swapped) pushCandidate('mesma URL na porta 5432 (session pooler)', swapped);
if (!direct) pushCandidate('DATABASE_URL original', databaseUrl);

if (!direct && (direct || databaseUrl).includes(':6543')) {
  warn(
    'DATABASE_URL aponta para a porta 6543 (pooler de transações do Supabase).',
  );
  warn(
    'Prisma Migrate não funciona por transaction pooler — tentando a porta 5432 (session pooler) primeiro.',
  );
}

if (!existsSync(path.join(projectRoot, 'prisma', 'migrations'))) {
  warn('Diretório prisma/migrations inexistente — nada a migrar.');
  process.exit(0);
}

// ---------------------------------------------------------------
// Tenta aplicar as migrations
// ---------------------------------------------------------------
const attempts = [];
let applied = false;

for (const candidate of candidates) {
  log(`Tentando migrate deploy via ${candidate.label} → ${maskUrl(candidate.url)}`);
  attempts.push(candidate);
  if (runPrismaMigrateDeploy(candidate.url)) {
    log(`✅ Migrations aplicadas/verificadas via ${candidate.label}.`);
    applied = true;
    break;
  }
  warn(`Falhou via ${candidate.label}.`);
}

if (!applied) {
  if (process.env.MIGRATE_ON_FAIL === 'skip') {
    warn('MIGRATE_ON_FAIL=skip — build continua mesmo sem migrations aplicadas.');
    warn('O roteamento multi-anúncio ficará degradado até aplicar as migrations.');
    process.exit(0);
  }
  printFailureHelp(attempts);
  process.exit(1);
}

process.exit(0);
