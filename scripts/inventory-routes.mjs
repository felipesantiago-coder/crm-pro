#!/usr/bin/env node
/**
 * Fase 0 — inventário de rotas do CRM Pro (docs/vercel-baseline.md).
 * Percorre todos os route.ts de src/app/api, extrai métodos HTTP e classifica
 * cada rota por criticidade de runtime (pública/webhook/cron/mídia/relatório/
 * realtime/autenticada). Também lista pages.tsx públicas.
 * Saída: markdown pronto para colar no doc.
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const API_DIR = join(ROOT, 'src', 'app');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (name === 'route.ts' || name === 'route.tsx') out.push(p);
  }
  return out;
}

/** Converte caminho filesystem → rota URL (app/api/x/[id]/route.ts → /api/x/:id). */
function toRoute(fsPath) {
  const rel = relative(API_DIR, fsPath).replace(/\\/g, '/');
  const noRoute = rel.replace(/\/route\.tsx?$/, '');
  return '/' + noRoute.replace(/\[(\w+)\]/g, ':$1');
}

function classify(route) {
  if (/\[slug\]|lp-view|list-public/.test(route)) return 'pública';
  if (/^\/api\/webhooks\//.test(route)) return 'webhook';
  if (/^\/api\/cron\//.test(route)) return 'cron';
  if (/^\/api\/track/.test(route)) return 'pública';
  if (/^\/api\/auth\//.test(route)) return 'pública (auth)';
  if (/upload|image|pdf|extract|floor|import|download/i.test(route)) return 'mídia/PDF';
  if (/report|dashboard|stats|metrics/i.test(route)) return 'relatório';
  if (/realtime|socket/i.test(route)) return 'realtime';
  return 'autenticada';
}

const routes = walk(API_DIR).map((p) => {
  const src = readFileSync(p, 'utf8');
  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].filter((m) =>
    new RegExp(`export\\s+(async\\s+function|const)\\s+${m}\\b`).test(src),
  );
  const maxDuration = src.match(/maxDuration\s*=\s*(\d+)/)?.[1] || '';
  const dynamic = src.match(/export\s+const\s+dynamic\s*=\s*['"](\w+)['"]/)?.[1] || '';
  return {
    route: toRoute(p),
    methods: methods.join(',') || '?',
    maxDuration: maxDuration ? `${maxDuration}s` : '',
    dynamic,
    cat: classify(toRoute(p)),
    file: relative(ROOT, p),
  };
});

const byCat = {};
for (const r of routes) byCat[r.cat] = (byCat[r.cat] || 0) + 1;

console.log('| Rota | Métodos | Categoria | maxDuration | dynamic |');
console.log('|---|---|---|---|---|');
for (const r of routes.sort((a, b) => a.route.localeCompare(b.route))) {
  console.log(`| \`${r.route}\` | ${r.methods} | ${r.cat} | ${r.maxDuration || '—'} | ${r.dynamic || '—'} |`);
}
console.log('\n### Totais por categoria\n');
for (const [cat, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
  console.log(`- ${cat}: ${n}`);
}
console.log(`\nTOTAL: ${routes.length} rotas de API`);

// Pages
const pageWalk = (dir, out = []) => {
  try {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const s = statSync(p);
      if (s.isDirectory()) pageWalk(p, out);
      else if (name === 'page.tsx') out.push(p);
    }
  } catch { /* fora de src/app */ }
  return out;
};
const pages = pageWalk(API_DIR).map((p) => '/' + relative(API_DIR, p).replace(/\\/g, '/').replace(/\/page\.tsx$/, ''));
console.log(`\n### Pages (${pages.length})\n`);
for (const p of pages.sort()) console.log(`- \`${p}\``);
