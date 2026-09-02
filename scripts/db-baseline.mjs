#!/usr/bin/env node
/**
 * Baseline de migrations — uso ÚNICO para bancos cujo schema foi gerenciado
 * por `prisma db push` (ou criado sem histórico de migrations) e que por isso
 * falham em `prisma migrate deploy` com drift (P3005/P3018).
 *
 * O que faz (ordem):
 *   1. `prisma db push --skip-generate` — leva o schema do banco ao estado
 *      ATUAL do schema.prisma (a diff do roteamento multi-anúncio é puramente
 *      aditiva; sem --accept-data-loss nada é destruído);
 *   2. Marca TODAS as migrations existentes como aplicadas
 *      (`prisma migrate resolve --applied <nome>`), tolerando as já marcadas;
 *   3. `prisma migrate status` + `prisma migrate deploy` para confirmar que
 *      ficou tudo consistente.
 *
 * Uso:
 *   npm run db:baseline -- --url "postgresql://<user>:<pass>@host:5432/<db>" [--yes]
 *   (sem --url usa DIRECT_DATABASE_URL || DATABASE_URL do ambiente)
 *
 * Confirmação: em TTY interativo pergunta antes de prosseguir; em CI/pipe
 * exige a flag --yes explicitamente.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const migrationsDir = path.join(projectRoot, 'prisma', 'migrations');

const args = process.argv.slice(2);
function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}
const urlArg = argValue('--url') || process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || '';
const yes = args.includes('--yes');

function maskUrl(u) {
  return u.replace(/(\/\/[^:/@]+):([^@]+)@/, '$1:***@');
}
function log(...a) {
  console.log('[baseline]', ...a);
}
function run(cmd, cmdArgs, { inherit = false, dbUrl = sessionUrl } = {}) {
  // Nota: os comandos `prisma migrate *` não aceitam --url no Prisma 6.x;
  // a sobrescrita correta é via env DATABASE_URL (precede o .env do projeto).
  const res = spawnSync(cmd, cmdArgs, {
    cwd: projectRoot,
    stdio: inherit ? 'inherit' : 'pipe',
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL: dbUrl },
  });
  return { ok: res.status === 0, status: res.status, stdout: res.stdout?.toString() || '', stderr: res.stderr?.toString() || '' };
}

if (!urlArg || !/^postgres(ql)?:\/\//i.test(urlArg)) {
  console.error('[baseline] ❌ Informe uma URL Postgres de conexão de sessão/direta:');
  console.error('   npm run db:baseline -- --url "postgresql://user:pass@host:5432/db" --yes');
  process.exit(1);
}

// Migrations/db push exigem conexão de sessão/direta: converte 6543→5432
// automaticamente (mesmo host/credenciais/banco) e avisa.
let sessionUrl = urlArg;
if (/:6543/.test(sessionUrl)) {
  sessionUrl = sessionUrl.replace(':6543', ':5432');
  console.error('[baseline] ⚠️  URL na porta 6543 (transaction pooler) detectada — convertida para 5432 (session pooler).');
  console.error('[baseline]    db push/baseline exigem conexão de sessão; o runtime do app continua na 6543, sem alterações.');
}

if (!existsSync(migrationsDir)) {
  console.error('[baseline] ❌ prisma/migrations não encontrado.');
  process.exit(1);
}

const migrations = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

log('URL:', maskUrl(sessionUrl));
log(`${migrations.length} migrations encontradas.`);
log('Primeiro estado do banco:');
run('npx', ['prisma', 'migrate', 'status'], { inherit: true });

if (!yes && process.stdin.isTTY) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question('[baseline] Aplicar db push + baselizar todas as migrations? (sim/não) ', resolve);
  });
  rl.close();
  if (!/^s/i.test(answer)) {
    log('Cancelado pelo usuário.');
    process.exit(0);
  }
} else if (!yes) {
  console.error('[baseline] ❌ Execução não-interativa: confirme com a flag --yes.');
  process.exit(1);
}

// 1. Sincroniza o schema ao estado atual (aditivo; sem --accept-data-loss nada é destruído)
log('Passo 1/3 — prisma db push (sincroniza schema; aditivo)…');
const push = run('npx', ['prisma', 'db', 'push', '--skip-generate'], { inherit: true });
if (!push.ok) {
  console.error('[baseline] ❌ db push falhou. Se o motivo for perda de dados potencial,');
  console.error('   revise o diff (prisma migrate diff) e, se tiver certeza, reexecute com:');
  console.error('   npx prisma db push --skip-generate --accept-data-loss --url "<url>"');
  process.exit(1);
}

// 2. Marca todas as migrations como aplicadas (tolerante às já marcadas)
log('Passo 2/3 — marcando migrations como aplicadas (resolve --applied)…');
let marked = 0;
let already = 0;
for (const name of migrations) {
  const res = run('npx', ['prisma', 'migrate', 'resolve', '--applied', name]);
  if (res.ok) {
    marked += 1;
    log(`  ✓ ${name}`);
  } else {
    already += 1;
    log(`  • ${name} — já marcada/ignorada`);
  }
}
log(`Resumo: ${marked} marcadas agora, ${already} já estavam.`);

// 3. Confirmação final
log('Passo 3/3 — verificação final:');
run('npx', ['prisma', 'migrate', 'status'], { inherit: true });
const deploy = run('npx', ['prisma', 'migrate', 'deploy'], { inherit: true });
if (!deploy.ok) {
  console.error('[baseline] ⚠️ Baseline concluído, mas migrate deploy ainda reporta problema.');
  console.error('   Revise a saída acima. Se persistir, ajuste o schema manualmente.');
  process.exit(1);
}
log('✅ Banco baselizado e consistente. Agora o build da Vercel (migrate deploy) funcionará normalmente.');
