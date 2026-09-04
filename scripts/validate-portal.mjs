/**
 * validate-portal.mjs — valida a base adaptada do Residencial Portal do Parque II
 * contra o parser determinístico real (src/lib/ai/markdown-parser.ts).
 * Executar de dentro de crm-pro: node --import ./tests/ai/register.mjs scripts/validate-portal.mjs
 */
import { readFileSync } from 'node:fs';
import {
  parseStandardMarkdown,
  matchesStandardMarkdown,
  SECTION_MATCH_THRESHOLD,
} from '../src/lib/ai/markdown-parser.ts';

const FILE = '/home/z/my-project/download/portal-do-parque-base-dados-v2.md';
const content = readFileSync(FILE, 'utf8');

console.log('matchesStandardMarkdown:', matchesStandardMarkdown(content));
const result = parseStandardMarkdown(content, { fallbackRegion: 'Guará II' });

if (!result) {
  console.error('FALHA: parseStandardMarkdown retornou null (documento fora do padrão)');
  process.exit(1);
}

console.log('seções canônicas:', result.sectionsFound.join(', '));
console.log('limite mínimo:', SECTION_MATCH_THRESHOLD, '→ reconhecidas:', result.sectionsFound.length);
console.log('needsReview:', result.needsReview);
console.log('limitations:', result.limitations);

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`);
  if (!cond) failures++;
};

const byField = new Map(result.fields.map((f) => [f.field, f]));
const get = (field) => byField.get(field);

const status = get('status');
check('status = "Em Construção"', status?.value === 'Em Construção', JSON.stringify(status?.value));
check('status method = rule', status?.method === 'rule');
check('status sem conflito', status?.status === 'found' && status?.confidence !== 'conflicting', status?.status);

const delivery = get('deliveryDate');
check('deliveryDate contém Agosto/2027', /agosto\/2027/i.test(delivery?.value ?? ''), delivery?.value);
check('deliveryDate sem conflito', delivery?.status === 'found', delivery?.status);

const price = get('price');
check('price contém 668.255', (price?.value ?? '').includes('668.255'), price?.value);
check('price menciona lojas 524.875', (price?.value ?? '').includes('524.875'), price?.value);
check('price sem conflito', price?.status === 'found', price?.status);

const locAddr = get('location.address');
const locCity = get('location.city');
const locState = get('location.state');
const locRegion = get('location.region');
const locHood = get('location.neighborhood');
const locInfo = get('location.additionalInfo');
check('endereço = QE 48 / Conjunto A / Lotes', /qe 48/i.test(locAddr?.value ?? '') && /conjunto a/i.test(locAddr?.value ?? '') && /lotes/i.test(locAddr?.value ?? ''), locAddr?.value);
check('bairro = Guará II', /guará ii/i.test(locHood?.value ?? ''), locHood?.value);
check('cidade = Guará', /guará/i.test(locCity?.value ?? ''), locCity?.value);
check('estado = DF', locState?.value === 'DF', locState?.value);
check('região contém Guará', /guará/i.test(locRegion?.value ?? ''), locRegion?.value);
check('info adicional presente', (locInfo?.value ?? '').length > 20, locInfo?.value);

const builder = get('builder');
check('builder = BI 12 / Brasília Incorporadora', /bi 12/i.test(builder?.value ?? '') && /brasília incorporadora/i.test(builder?.value ?? ''), builder?.value);

const units = get('totalUnits');
check('totalUnits = 150', units?.value === 150, String(units?.value));
const floors = get('floors');
check('floors = 9', floors?.value === 9, String(floors?.value));
const parking = get('parkingSpots');
check('parkingSpots = 1', parking?.value === 1, String(parking?.value));

const summary = get('summary');
check('summary presente e ≤300', !!summary?.value && summary.value.length <= 300, `${summary?.value?.length} chars`);

const types = get('apartmentTypes');
const tv = Array.isArray(types?.value) ? types.value : [];
check('4 tipologias', tv.length === 4, String(tv.length));
const namesOk = tv.every((t) => t.name && t.area && t.price && t.description);
check('todas as tipologias completas (nome/área/preço/descrição)', namesOk, tv.map((t) => t.name).join(' ; '));
check('preço 2 quartos = 668.255', (tv.find((t) => t.name.includes('2 Quartos'))?.price ?? '').includes('668.255'));
check('preço 3 quartos = 770.889', (tv.find((t) => t.name.includes('3 Quartos') && !t.name.includes('Garden'))?.price ?? '').includes('770.889'));
check('preço garden = 869.657', (tv.find((t) => t.name.includes('Garden'))?.price ?? '').includes('869.657'));
check('preço loja = 524.875', (tv.find((t) => t.name.includes('Loja'))?.price ?? '').includes('524.875'));
check('dormitórios declarados nas residenciais', tv.filter((t) => !t.name.includes('Loja')).every((t) => !!t.bedrooms), tv.map((t) => t.bedrooms).join(','));

const diffs = get('differentials');
const dv = Array.isArray(diffs?.value) ? diffs.value : [];
check('10 diferenciais', dv.length === 10, String(dv.length));
check('todos diferenciais ≤80 chars', dv.every((d) => d.length <= 80), dv.map((d) => d.length).join(','));

const conflicted = result.fields.filter((f) => f.status === 'conflicting');
check('nenhum campo conflicting', conflicted.length === 0, conflicted.map((f) => f.field).join(','));
check('needsReview = false', result.needsReview === false, String(result.needsReview));

console.log('\n--- campos extraídos ---');
for (const f of result.fields) {
  const v = typeof f.value === 'object' && f.value !== null ? JSON.stringify(f.value) : f.value;
  console.log(`  [${f.status}] ${f.field} = ${String(v).slice(0, 110)}`);
}

console.log(`\n=== ${failures === 0 ? 'TODOS OS CHECKS PASSARAM' : failures + ' CHECK(S) FALHARAM'} ===`);
process.exit(failures === 0 ? 0 : 1);
