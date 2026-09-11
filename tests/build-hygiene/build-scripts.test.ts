/**
 * Contrato de higiene do build (Fase 1 da otimização Vercel).
 *
 * Garante que o pipeline de BUILD da Vercel jamais execute alterações de
 * schema em banco de produção (migrate deploy / db push / baseline /
 * migrate resolve). Alterações de schema são aplicadas EXPLICITAMENTE por
 * `npm run db:release` (scripts/vercel-migrate.mjs), uma única vez por
 * release, a partir de ambiente protegido com conexão de sessão (5432).
 *
 * Se este teste falhar, um build (inclusive preview de branch) pode
 * escrever no banco de produção — regredir a mudança imediatamente.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

const FORBIDDEN_IN_BUILD = [
  'vercel-migrate',
  'migrate deploy',
  'migrate resolve',
  'migrate dev',
  'db push',
  'db:push',
  'db:baseline',
  'db-baseline',
  'db:reset',
  'migrate reset',
];

test('build não executa nenhuma alteração de schema (Fase 1)', () => {
  const build = pkg.scripts.build || '';
  for (const forbidden of FORBIDDEN_IN_BUILD) {
    assert.ok(
      !build.toLowerCase().includes(forbidden.toLowerCase()),
      `script "build" não pode conter "${forbidden}" — aplicação de schema deve ser explícita via db:release. Atual: ${build}`,
    );
  }
});

test('build mantém geração do Prisma Client e montagem do standalone', () => {
  const build = pkg.scripts.build || '';
  assert.ok(build.includes('prisma generate'), 'build precisa gerar o Prisma Client (offline)');
  assert.ok(build.includes('next build'), 'build precisa compilar o Next');
  assert.ok(build.includes('.next/standalone'), 'build precisa montar o standalone');
});

test('db:release é o comando explícito de release (vercel-migrate.mjs)', () => {
  const release = pkg.scripts['db:release'] || '';
  assert.ok(
    release.includes('vercel-migrate.mjs'),
    'db:release deve chamar scripts/vercel-migrate.mjs (conversão 6543→5432 + baseline controlado)',
  );
});

test('typecheck existe e é executável como gate local/CI', () => {
  assert.ok(pkg.scripts.typecheck, 'script "typecheck" ausente');
});

test('nenhum gancho de ciclo de vida executa migrate/baseline', () => {
  const lifecycle = ['prebuild', 'postbuild', 'preinstall', 'postinstall', 'prepare', 'prevercel', 'postvercel'];
  for (const hook of lifecycle) {
    const cmd = pkg.scripts[hook];
    if (!cmd) continue;
    if (hook === 'postinstall') {
      // postinstall é permitido APENAS para prisma generate (offline)
      assert.equal(cmd.trim(), 'prisma generate', `postinstall deve ser apenas "prisma generate", atual: "${cmd}"`);
      continue;
    }
    for (const forbidden of FORBIDDEN_IN_BUILD) {
      assert.ok(
        !cmd.toLowerCase().includes(forbidden.toLowerCase()),
        `gancho "${hook}" não pode conter "${forbidden}"`,
      );
    }
  }
});

test('db:baseline permanece como comando MANUAL documentado', () => {
  assert.ok(
    (pkg.scripts['db:baseline'] || '').includes('db-baseline.mjs'),
    'db:baseline deve continuar existindo para recuperação manual de drift (documentado)',
  );
});
