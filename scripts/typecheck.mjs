#!/usr/bin/env node
/**
 * Gate de typecheck (Fase 2 — otimização Vercel).
 *
 * Roda `tsc --noEmit` e trata como únicos aceitáveis os ARTEFATOS
 * DOCUMENTADOS do provider sqlite do sandbox (docs/typecheck-baseline.md):
 * filtros `mode: 'insensitive'` existem no Prisma para PostgreSQL (provider
 * de produção, aplicado pelo GUARD B do push-to-main.sh) mas não para
 * sqlite (provider local de dev). Na Vercel esses erros NÃO ocorrem.
 *
 * Qualquer outro erro → exit 1 com a lista. Nada é mascarado com any/cast.
 */
import { spawnSync } from 'node:child_process';

const res = spawnSync('npx', ['tsc', '--noEmit', '--pretty', 'false'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
  maxBuffer: 64 * 1024 * 1024,
});

const out = `${res.stdout || ''}${res.stderr || ''}`;
const errorLines = out.split('\n').filter((l) => /error TS\d+/.test(l));

// Artefato documentado: filtro `mode` de string (SQLite não suporta; Postgres sim).
const SQLITE_MODE_ARTIFACT = /'mode' does not exist in type '(?:String|Int|Enum)Filter/;

const known = [];
const unknown = [];
for (const line of errorLines) {
  if (SQLITE_MODE_ARTIFACT.test(line)) known.push(line);
  else unknown.push(line);
}

if (known.length) {
  console.log(`[typecheck] ${known.length} artefato(s) sqlite→postgres documentado(s) e ignorado(s):`);
  for (const l of known) console.log(`  ${l.slice(0, 160)}`);
}

if (unknown.length) {
  console.error(`\n[typecheck] ❌ ${unknown.length} erro(s) REAL(is) de TypeScript:`);
  console.error(unknown.join('\n'));
  console.error('\nCorrija os erros acima — não use any/cast/eslint-disable para mascarar.');
  process.exit(1);
}

if (!res.status && !errorLines.length) {
  console.log('[typecheck] ✅ tsc --noEmit 100% limpo');
} else {
  console.log('[typecheck] ✅ Sem erros reais (apenas artefatos documentados do provider sqlite local)');
}
process.exit(0);
