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
 *   Toda URL na porta 6543 (transaction pooler) é CONVERTIDA automaticamente
 *   para 5432 (session pooler — mesmo host, mesmas credenciais, mesmo banco).
 *   Ordem tentada:
 *   1. DIRECT_DATABASE_URL como conexão de sessão (convertida se estiver 6543);
 *   2. DATABASE_URL como conexão de sessão (convertida se estiver 6543);
 *   3. Último recurso: as URLs originais na 6543 (não suportado — tentado
 *      apenas se todas as variantes de sessão falharem).
 *   Nota: esta variável/script NÃO afetam o runtime do app — o app continua
 *   na 6543 (correto para Vercel serverless). A conversão vale só para o
 *   migrate desta etapa de build.
 *
 * POLÍTICA DE FALHA:
 *   - O código em produção DEPENDE das colunas da migration (roteamento
 *     multi-anúncio). Entra no ar SEM as colunas = webhook/polling/painel
 *     Meta quebrados em runtime. Portanto, se nenhuma conexão conseguir
 *     aplicar as migrations, o build FALHA com instruções objetivas — o
 *     deploy anterior (saudável) continua servindo enquanto isso.
 *   - TIMEOUT: cada tentativa tem timeout (MIGRATE_TIMEOUT_MS, padrão 120s).
 *     O transaction pooler pode PENDURAR o migrate indefinidamente
 *     (advisory lock do Prisma espera eternamente) — sem isso o build
 *     ficava travado até o limite de 45 min da Vercel.
 *   - DRIFT (P3005/P3018): banco com schema mas SEM histórico de migrations
 *     (típico de banco restaurado/criado via db push). Nesse caso o script
 *     executa o baseline automaticamente UMA vez por conexão de sessão
 *     (db push aditivo + migrate resolve --applied) e tenta o deploy de
 *     novo. Desligar com MIGRATE_AUTO_BASELINE=off.
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

/** Timeout por tentativa de migrate (transaction pooler pode pendurar). */
const MIGRATE_TIMEOUT_MS = Number(process.env.MIGRATE_TIMEOUT_MS || 120_000);
/** Timeout do baseline automático (db push + N resolves + verificação). */
const BASELINE_TIMEOUT_MS = Number(process.env.BASELINE_TIMEOUT_MS || 300_000);

function runPrismaMigrateDeploy(url) {
  // Nota: `prisma migrate deploy` NÃO aceita --url no Prisma 6.x.
  // A sobrescrita correta é via env DATABASE_URL (process env tem
  // precedência sobre o .env do projeto).
  // Saída capturada e re-ecoada: permite detectar P3005/P3018 e disparar o
  // baseline automático; o timeout impede build pendurado até 45 min.
  const res = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    timeout: MIGRATE_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    env: { ...process.env, DATABASE_URL: url },
  });
  const stdout = res.stdout?.toString() || '';
  const stderr = res.stderr?.toString() || '';
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  const timedOut = res.signal === 'SIGKILL' || res.error?.code === 'ETIMEDOUT';
  if (timedOut) {
    warn(
      `Tentativa excedeu ${Math.round(MIGRATE_TIMEOUT_MS / 1000)}s e foi abortada (conexão pendurada — típico de transaction pooler).`,
    );
  }
  return { ok: res.status === 0, timedOut, output: `${stdout}\n${stderr}` };
}

/** Erros de drift que o baseline automático resolve. */
const DRIFT_PATTERN = /P3005|P3018/;

function isDriftError(output) {
  return DRIFT_PATTERN.test(output);
}

function autoBaselineEnabled() {
  const flag = (process.env.MIGRATE_AUTO_BASELINE || '').toLowerCase();
  return !(flag === 'off' || flag === 'skip' || flag === '0' || flag === 'false');
}

/**
 * Baseline automático (uma vez por URL de sessão) para drift P3005/P3018:
 * alinha o schema via db push aditivo (sem --accept-data-loss — nada é
 * destruído) e marca as migrations existentes como aplicadas; em seguida o
 * migrate deploy é tentado novamente sobre a mesma conexão de sessão.
 */
function runAutoBaseline(sessionUrl) {
  if (!autoBaselineEnabled()) {
    warn('MIGRATE_AUTO_BASELINE=off — baseline automático desativado.');
    return false;
  }
  warn('Banco com schema mas SEM histórico de migrations (drift P3005/P3018).');
  warn('Executando baseline automático (db push aditivo + migrate resolve --applied)…');
  const res = spawnSync(
    'node',
    [path.join('scripts', 'db-baseline.mjs'), '--url', sessionUrl, '--yes'],
    {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      timeout: BASELINE_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      env: { ...process.env, DATABASE_URL: sessionUrl },
    },
  );
  if (res.signal === 'SIGKILL' || res.error?.code === 'ETIMEDOUT') {
    warn(`Baseline automático excedeu ${Math.round(BASELINE_TIMEOUT_MS / 1000)}s e foi abortado.`);
    return false;
  }
  if (res.status !== 0) {
    warn('Baseline automático falhou — revise a saída acima (nenhuma alteração destrutiva foi feita).');
    return false;
  }
  log('✅ Baseline automático concluído — tentando migrate deploy novamente.');
  return true;
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
  console.error('  1) RECOMENDADO: defina DIRECT_DATABASE_URL na Vercel com a conexão');
  console.error('     de SESSÃO/direta do Supabase (porta 5432), ex.:');
  console.error('       postgresql://<user>:<pass>@aws-1-<region>.pooler.supabase.com:5432/<db>');
  console.error('     Obs.: se ela estiver na 6543, o build já converte para 5432');
  console.error('     automaticamente — esta variável NÃO afeta o runtime do app.');
  console.error('  2) Local, a partir da sua máquina (conexão direta/sessão):');
  console.error('       DATABASE_URL="<url-sessao>" npm run db:deploy');
  console.error('  3) Se o erro indicar drift (P3005/P3018 — banco com schema mas sem');
  console.error('     histórico de migrations): o baseline automático JÁ FOI TENTADO.');
  console.error('     Se ele falhou, rode manualmente a partir da sua máquina:');
  console.error('       npm run db:baseline -- --url "<url-sessao-5432>" --yes');
  console.error('     e depois faça redeploy.');
  console.error('============================================================');
}
// ---------------------------------------------------------------
// Resolve a(s) URL(s) candidatas
// ---------------------------------------------------------------
// REGRA: migrations exigem conexão de SESSÃO/direta (porta 5432).
// URLs na porta 6543 (transaction pooler) são convertidas automaticamente
// para 5432 e só tentadas por último na forma original — assim funciona
// mesmo se DIRECT_DATABASE_URL estiver apontando para a 6543 (o build
// corrige sozinho; runtime do app NUNCA é afetado por esta variável).
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

/** Conexão de sessão: converte 6543→5432; mantém como está caso contrário. */
function sessionVariant(url) {
  return withSessionPort(url) || url;
}
function isTransactionPooler(url) {
  return /:6543/.test(url);
}

if (direct) {
  pushCandidate(
    isTransactionPooler(direct)
      ? 'DIRECT_DATABASE_URL convertida 6543→5432 (session pooler)'
      : 'DIRECT_DATABASE_URL (conexão de sessão/direta)',
    sessionVariant(direct),
  );
}
const dbSession = sessionVariant(databaseUrl);
if (dbSession && (!direct || dbSession !== sessionVariant(direct))) {
  pushCandidate(
    isTransactionPooler(databaseUrl)
      ? 'DATABASE_URL convertida 6543→5432 (session pooler)'
      : 'DATABASE_URL (conexão de sessão/direta)',
    dbSession,
  );
}
// Último recurso: URLs originais na 6543 (não suportado para migrations —
// tentado apenas se todas as variantes de sessão falharem).
if (direct && isTransactionPooler(direct)) {
  pushCandidate('DIRECT_DATABASE_URL original 6543 (último recurso — transaction pooler não é suportado p/ migrations)', direct);
}
if (isTransactionPooler(databaseUrl)) {
  pushCandidate('DATABASE_URL original 6543 (último recurso — transaction pooler não é suportado p/ migrations)', databaseUrl);
}

const anyPooler = (direct && isTransactionPooler(direct)) || isTransactionPooler(databaseUrl);
if (anyPooler) {
  warn('Detectada URL na porta 6543 (transaction pooler do Supabase).');
  warn('Prisma Migrate não funciona por transaction pooler — a etapa de migrate usa automaticamente a porta 5432 (session pooler, mesmo host/credenciais/banco).');
  warn('O runtime do app NÃO é afetado: continua na 6543 (correto para Vercel serverless).');
}

if (!existsSync(path.join(projectRoot, 'prisma', 'migrations'))) {
  warn('Diretório prisma/migrations inexistente — nada a migrar.');
  process.exit(0);
}

// ---------------------------------------------------------------
// Tenta aplicar as migrations
// ---------------------------------------------------------------
const attempts = [];
const baselineTriedFor = new Set(); // URLs de sessão que já receberam baseline
let applied = false;

for (const candidate of candidates) {
  log(`Tentando migrate deploy via ${candidate.label} → ${maskUrl(candidate.url)}`);
  attempts.push(candidate);
  const res = runPrismaMigrateDeploy(candidate.url);
  if (res.ok) {
    log(`✅ Migrations aplicadas/verificadas via ${candidate.label}.`);
    applied = true;
    break;
  }
  // Drift (P3005/P3018)? Tenta o baseline automático UMA vez por URL de
  // sessão e repete o deploy sobre a conexão de sessão correspondente.
  if (!res.timedOut && isDriftError(res.output)) {
    const sessionUrl = withSessionPort(candidate.url) || candidate.url;
    if (!baselineTriedFor.has(sessionUrl)) {
      baselineTriedFor.add(sessionUrl);
      if (runAutoBaseline(sessionUrl)) {
        const retry = runPrismaMigrateDeploy(sessionUrl);
        if (retry.ok) {
          log(`✅ Migrations aplicadas/verificadas via ${candidate.label} (após baseline automático).`);
          applied = true;
          break;
        }
      }
    }
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
