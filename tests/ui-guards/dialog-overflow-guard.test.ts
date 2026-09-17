/**
 * Contrato de UI — GUARDA SISTÊMICA anti-overflow horizontal em janelas
 * (2026-09, motivado pelo relato do modal "Editar Cliente" exigindo
 * rolagem horizontal em produção).
 *
 * Toda janela do sistema (Dialog, AlertDialog, Sheet e os modais hand-rolled)
 * deve carregar a guarda de 4 partes:
 *
 *   1. min-w-0            → o box da janela pode encolher abaixo do
 *                           min-width:auto do conteúdo (grid/flex blowout);
 *   2. [&>*]:min-w-0      → filhos diretos (form/header/footer) encolhem;
 *   3. wrap-anywhere      → textos longos (palavras/emails/URLs) quebram
 *                           em vez de empurrar a largura (herdado pela
 *                           subárvore inteira);
 *   4. overflow-x-hidden  → retrocesso final: NUNCA há scrollbar horizontal
 *                           na janela (sobrescrevível por chamada via
 *                           tw-merge para o raro caso que queira optar out).
 *
 * Além disso, contêineres de scroll VERTICAL dentro de janelas devem usar
 * overflow-x-hidden — scrollbar horizontal numa área de scroll vertical é
 * sempre o defeito reportado. (Contêineres overflow-x-auto INTENCIONAIS,
 * como o container de tabelas ui/table.tsx, permanecem permitidos.)
 *
 * Se este teste falhar, a classe de defeito "janela exige rolagem
 * horizontal" voltou a ser possível — reverter a mudança imediatamente.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const GUARD_CLASSES = ['min-w-0', '[&>*]:min-w-0', 'wrap-anywhere', 'overflow-x-hidden'];

/** Extrai o primeiro literal de classe estática do cn(...) de um componente. */
function firstCnLiteral(source, marker) {
  const idx = source.indexOf(marker);
  assert.ok(idx !== -1, `marcador "${marker}" não encontrado`);
  const openQuote = source.indexOf('"', source.indexOf('cn(', idx));
  assert.ok(openQuote !== -1, `cn( não encontrado após "${marker}"`);
  const closeQuote = source.indexOf('"', openQuote + 1);
  return source.slice(openQuote + 1, closeQuote);
}

test('DialogContent (base) carrega a guarda anti-overflow horizontal completa', () => {
  const src = read('src/components/ui/dialog.tsx');
  const cls = firstCnLiteral(src, 'data-slot="dialog-content"');
  for (const g of GUARD_CLASSES) {
    assert.ok(cls.includes(g), `DialogContent sem "${g}" — guarda sistêmica regrediu`);
  }
});

test('AlertDialogContent (base) carrega a guarda anti-overflow horizontal completa', () => {
  const src = read('src/components/ui/alert-dialog.tsx');
  const cls = firstCnLiteral(src, 'data-slot="alert-dialog-content"');
  for (const g of GUARD_CLASSES) {
    assert.ok(cls.includes(g), `AlertDialogContent sem "${g}" — guarda sistêmica regrediu`);
  }
});

test('SheetContent (base) carrega a guarda anti-overflow horizontal completa', () => {
  const src = read('src/components/ui/sheet.tsx');
  const cls = firstCnLiteral(src, 'data-slot="sheet-content"');
  for (const g of GUARD_CLASSES) {
    assert.ok(cls.includes(g), `SheetContent sem "${g}" — guarda sistêmica regrediu`);
  }
});

test('nenhuma janela reabilita overflow-x auto/scroll na própria janela', () => {
  // A guarda da base pode ser sobrescrita via className. Varredura dos usos:
  // nenhuma janela deve passar overflow-x-auto/scroll — rolagem horizontal
  // intencional usa container INTERNO (padrão ui/table.tsx), nunca a janela.
  const files = [
    'src/components/crm/client-detail.tsx',
    'src/components/crm/extraction-review.tsx',
    'src/components/crm/ai-context-memory.tsx',
    'src/components/crm/dashboard-view.tsx',
    'src/components/crm/tags-view.tsx',
    'src/components/crm/reminders-view.tsx',
    'src/components/crm/teams-tab.tsx',
    'src/components/crm/client-form.tsx',
    'src/components/crm/enterprise-management.tsx',
    'src/components/crm/resale-pdf-import-dialog.tsx',
    'src/components/crm/admin-panel.tsx',
    'src/app/portal/page.tsx',
    'src/components/crm/meta-ads/temperature-tab.tsx',
    'src/components/crm/meta-ads/account-config-card.tsx',
    'src/components/crm/meta-ads/traffic-insights-section.tsx',
    'src/components/crm/meta-ads/capi-quality-dialog.tsx',
    'src/components/crm/meta-ads/ad-accounts-group.tsx',
  ];
  for (const rel of files) {
    let src = '';
    try {
      src = read(rel);
    } catch {
      continue; // arquivo removido/renomeado — não falha o contrato
    }
    const re = /<(Dialog|AlertDialog)Content[^>]*className="([^"]*)"/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const cls = m[2];
      assert.ok(
        !/\boverflow-x-(auto|scroll)\b/.test(cls),
        `${rel}: janela com overflow-x auto/scroll reabilita o defeito — use container interno`
      );
    }
  }
});

test('modais hand-rolled (fora do ui/dialog) carregam overflow-x-hidden', () => {
  const handRolled = [
    'src/components/crm/revenda-view.tsx',
    'src/components/crm/resale-properties-view.tsx',
    'src/components/crm/form-field-manager.tsx',
  ];
  for (const rel of handRolled) {
    const src = read(rel);
    assert.ok(
      src.includes('overflow-x-hidden'),
      `${rel}: modal hand-rolled sem overflow-x-hidden — janela pode voltar a exigir rolagem horizontal`
    );
  }
});

test('contêineres de scroll vertical dentro de janelas usam overflow-x-hidden', () => {
  // Amostragem dos pontos corrigidos em 2026-09 (scroll-y interno de janelas
  // flex-col e corpos com rolagem própria). Cada linha deve manter o par
  // overflow-y-auto + overflow-x-hidden.
  const expectations = [
    ['src/components/crm/client-detail.tsx', 'flex-1 overflow-y-auto overflow-x-hidden px-6 pb-8'],
    ['src/components/crm/enterprise-management.tsx', 'py-4 overflow-y-auto overflow-x-hidden flex-1 min-h-0'],
    ['src/components/crm/resale-pdf-import-dialog.tsx', 'flex-1 overflow-y-auto overflow-x-hidden'],
    ['src/components/crm/meta-ads/temperature-tab.tsx', 'min-h-0 overflow-y-auto overflow-x-hidden therm-scroll'],
  ];
  for (const [rel, fragment] of expectations) {
    const src = read(rel);
    assert.ok(src.includes(fragment), `${rel}: esperado fragmento "${fragment}" — scroll interno sem guarda`);
  }
});
