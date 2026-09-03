/**
 * markdown-parser.test.ts — Extração determinística de bases no padrão
 * canônico (11 seções do prompt mestre) sem IA.
 *
 * Regressões cobertas: reconhecimento do padrão com tolerância de grafia,
 * valores canônicos verbatim, "Não informado" → ausente (nunca inventado),
 * sinônimos de status, inteiros com texto, conflitos por multi-ocorrência,
 * merge de tipologias, frontmatter/comentários ignorados e fallback para IA
 * de documentos fora do padrão (bases antigas).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStandardMarkdown,
  matchesStandardMarkdown,
  SECTION_MATCH_THRESHOLD,
  PARSER_MODEL_ID,
  PARSER_PROMPT_VERSION,
} from '../../src/lib/ai/markdown-parser.ts';

/** Documento canônico completo (template do prompt mestre). */
function canonicalDoc(): string {
  return `# BASE DE DADOS — Reserva do Parque

> Base de dados padronizada gerada em 2026-09-01. Compilação de materiais oficiais e fontes citadas na seção 10.

## 1. RESUMO
Apartamentos de 2 e 3 dormitórios a partir de R$ 980.000 no Itaim Bibi, São Paulo, com entrega prevista para Dezembro/2027.

## 2. LOCALIZAÇÃO
- Endereço: Rua Joaquim Floriano, 1000 – Itaim Bibi
- Bairro: Itaim Bibi
- Cidade: São Paulo
- Estado: SP
- Região: Zona Oeste de São Paulo
- Informações adicionais de localização: A 400 m da Estação Faria Lima (Linha 4-Amarela)

## 3. STATUS DA OBRA E DATA DE ENTREGA
- Status: Em Construção
- Data de entrega: Dezembro/2027

## 4. PREÇOS E VALORES
- Preço: a partir de R$ 980.000

## 5. TIPOLOGIAS
- Tipologia: Tipo A | Área: 62 m² privativos | Dormitórios: 2 dormitórios (1 suíte) | Preço: a partir de R$ 980.000 | Descrição: Planta com sala integrada, terraço gourmet e cozinha americanada opção.
- Tipologia: Tipo B | Área: 86 m² privativos | Dormitórios: 3 dormitórios (1 suíte) | Preço: a partir de R$ 1.250.000 | Descrição: Planta ampliada com sala para dois ambientes e varanda integrada.

## 6. DIMENSIONAMENTO
- Total de unidades: 120
- Andares por torre: 18
- Vagas por unidade: 2

## 7. CONSTRUTORA, ARQUITETURA E PAISAGISMO
- Construtora: Incorporadora X
- Arquitetura: Estúdio Y Arquitetura
- Paisagismo: Bia Abreu Paisagismo

## 8. DIFERENCIAIS E COMODIDADES
- Piscina coberta aquecida de 25 m
- Academia equipada de 120 m²
- Coworking com salas reserváveis

## 9. INFORMAÇÕES COMPLEMENTARES
Condições comerciais gerais disponíveis na incorporadora. Infraestrutura do bairro consolidada.

## 10. FONTES
| # | Fonte | Tipo | Campos sustentados | URL / Referência | Data de acesso |
|---|-------|------|--------------------|------------------|----------------|
| 1 | Site oficial | Site oficial | Preço; Status | https://exemplo.com | 2026-09-01 |

## 11. CONFLITOS E RESSALVAS
- Nenhum conflito identificado entre as fontes utilizadas.
`;
}

function fieldOf(fields: { field: string }[], name: string) {
  const c = fields.find((f) => f.field === name);
  assert.ok(c, `candidato ${name} deveria existir`);
  return c;
}

test('documento canônico completo: todos os campos extraídos com method rule', () => {
  const result = parseStandardMarkdown(canonicalDoc());
  assert.ok(result, 'documento canônico deveria ser reconhecido');
  assert.equal(result.sectionsFound.length, 11);
  assert.equal(result.needsReview, false);
  assert.ok(result.fields.length > 0);
  assert.ok(result.fields.every((f) => f.method === 'rule'), 'todo candidato deve ser rule');

  assert.equal(fieldOf(result.fields, 'summary').value, 'Apartamentos de 2 e 3 dormitórios a partir de R$ 980.000 no Itaim Bibi, São Paulo, com entrega prevista para Dezembro/2027.');
  assert.equal(fieldOf(result.fields, 'status').status, 'found');
  assert.equal(fieldOf(result.fields, 'status').value, 'Em Construção');
  assert.equal(fieldOf(result.fields, 'deliveryDate').value, 'Dezembro/2027');
  assert.equal(fieldOf(result.fields, 'price').value, 'a partir de R$ 980.000');

  assert.equal(fieldOf(result.fields, 'location.address').value, 'Rua Joaquim Floriano, 1000 – Itaim Bibi');
  assert.equal(fieldOf(result.fields, 'location.neighborhood').value, 'Itaim Bibi');
  assert.equal(fieldOf(result.fields, 'location.city').value, 'São Paulo');
  assert.equal(fieldOf(result.fields, 'location.state').value, 'SP');
  assert.equal(fieldOf(result.fields, 'location.region').value, 'Zona Oeste de São Paulo');
  assert.equal(fieldOf(result.fields, 'location.additionalInfo').value, 'A 400 m da Estação Faria Lima (Linha 4-Amarela)');

  assert.equal(fieldOf(result.fields, 'totalUnits').value, 120);
  assert.equal(fieldOf(result.fields, 'floors').value, 18);
  assert.equal(fieldOf(result.fields, 'parkingSpots').value, 2);

  assert.equal(fieldOf(result.fields, 'builder').value, 'Incorporadora X');
  assert.equal(fieldOf(result.fields, 'architecture').value, 'Estúdio Y Arquitetura');
  assert.equal(fieldOf(result.fields, 'landscaping').value, 'Bia Abreu Paisagismo');

  const diffs = fieldOf(result.fields, 'differentials');
  assert.deepEqual(diffs.value, ['Piscina coberta aquecida de 25 m', 'Academia equipada de 120 m²', 'Coworking com salas reserváveis']);

  const types = fieldOf(result.fields, 'apartmentTypes');
  assert.equal(types.status, 'found');
  const list = types.value as Array<Record<string, unknown>>;
  assert.equal(list.length, 2);
  assert.equal(list[0].name, 'Tipo A');
  assert.equal(list[0].area, '62 m² privativos');
  assert.equal(list[0].bedrooms, '2 dormitórios (1 suíte)');
  assert.equal(list[0].price, 'a partir de R$ 980.000');
  assert.equal(list[1].name, 'Tipo B');
  assert.equal(list[1].price, 'a partir de R$ 1.250.000');
});

test('tolerância de grafia: títulos minúsculos sem numeração, bullets *, sub-seções', () => {
  const doc = `# BASE DE DADOS — TESTE

<!-- arquivo: base-dados-teste.md -->

## resumo
Frase factual de resumo do empreendimento teste.

## Localização
* Endereço: Avenida Paulista, 1000
* Bairro: Bela Vista
* Cidade: São Paulo
* Estado: SP
* Região: Centro de São Paulo
* Informações adicionais de localização: Próximo ao metrô Trianon-Masp

## Status e Entrega
* Status: Lançamento
* Data de entrega: 2º semestre de 2028

## Preços
* Preço: a partir de R$ 350.000

## Tipologias
### Torres A e B
- Tipologia: Studio | Área: 28 m² privativos | Preço: a partir de R$ 350.000

## Dimensionamento
* Total de unidades: 300 unidades
* Andares por torre: 24
* Vagas por unidade: 1

## Construtora
* Construtora: Incorporadora Z
* Arquitetura: Atelier W
* Paisagismo: Studio V

## Diferenciais
* Piscina de 20 m
* Rooftop com vista

## Informações Complementares
Texto livre sem dados declarados.

## Fontes
| # | Fonte | Tipo | Campos sustentados | URL / Referência | Data de acesso |
|---|-------|------|--------------------|------------------|----------------|
| 1 | Portal | Portal imobiliário | Preço | https://exemplo.com | 2026-09-01 |

## Conflitos e Ressalvas
- Nenhum conflito identificado entre as fontes utilizadas.
`;
  const result = parseStandardMarkdown(doc);
  assert.ok(result, 'variações de grafia deveriam ser reconhecidas');
  assert.equal(result.sectionsFound.length, 11);
  assert.equal(fieldOf(result.fields, 'status').value, 'Lançamento');
  assert.equal(fieldOf(result.fields, 'deliveryDate').value, '2º semestre de 2028');
  assert.equal(fieldOf(result.fields, 'totalUnits').value, 300, 'inteiro com texto ("300 unidades") → 300');
  const types = fieldOf(result.fields, 'apartmentTypes').value as Array<Record<string, unknown>>;
  assert.equal(types.length, 1, 'sub-seção "### Torres A e B" não deve encerrar a seção de tipologias');
  assert.equal(types[0].name, 'Studio');
  assert.equal(types[0].bedrooms, null, 'campo não declarado permanece null');
});

test('"Não informado" vira ausente — crítico missing exige revisão (nunca inventa)', () => {
  const doc = canonicalDoc()
    .replace('- Status: Em Construção\n', '- Status: Não informado\n')
    .replace('- Preço: a partir de R$ 980.000\n', '');
  const result = parseStandardMarkdown(doc);
  assert.ok(result);
  const status = fieldOf(result.fields, 'status');
  assert.equal(status.value, null);
  assert.equal(status.status, 'missing');
  const price = fieldOf(result.fields, 'price');
  assert.equal(price.status, 'missing');
  assert.equal(result.needsReview, true, 'críticos missing devem disparar needsReview');
});

test('sinônimos de status fora do enum são normalizados sem criar conflito', () => {
  const doc = canonicalDoc().replace('- Status: Em Construção', '- Status: Em obras');
  const result = parseStandardMarkdown(doc);
  assert.ok(result);
  const status = fieldOf(result.fields, 'status');
  assert.equal(status.status, 'found');
  assert.equal(status.value, 'Em Construção');
});

test('preço repetido idêntico → found; divergente → conflicting com variantes na nota', () => {
  const identical = canonicalDoc().replace(
    '## 4. PREÇOS E VALORES\n- Preço: a partir de R$ 980.000\n',
    '## 4. PREÇOS E VALORES\n- Preço: a partir de R$ 980.000\n- Preço: a partir de R$ 980.000\n',
  );
  const r1 = parseStandardMarkdown(identical);
  assert.ok(r1);
  assert.equal(fieldOf(r1.fields, 'price').status, 'found');

  const divergent = canonicalDoc().replace(
    '## 4. PREÇOS E VALORES\n- Preço: a partir de R$ 980.000\n',
    '## 4. PREÇOS E VALORES\n- Preço: a partir de R$ 980.000\n- Preço: a partir de R$ 1.050.000\n',
  );
  const r2 = parseStandardMarkdown(divergent);
  assert.ok(r2);
  const price = fieldOf(r2.fields, 'price');
  assert.equal(price.status, 'conflicting');
  assert.equal(price.value, 'a partir de R$ 980.000');
  assert.ok(String(price.note).includes('1.050.000'), 'nota deve listar a variante divergente');
  assert.equal(r2.needsReview, true);
});

test('tipologia com nome duplicado e preço divergente → needs_review', () => {
  const doc = canonicalDoc().replace(
    '## 6. DIMENSIONAMENTO',
    '## 5. TIPOLOGIAS (repetida)\n- Tipologia: Tipo A | Área: 62 m² privativos | Preço: a partir de R$ 999.000\n\n## 6. DIMENSIONAMENTO',
  );
  const result = parseStandardMarkdown(doc);
  assert.ok(result);
  const types = fieldOf(result.fields, 'apartmentTypes');
  // a seção duplicada canônica é ignorada (1ª ocorrência vence) — sem conflito
  assert.equal(types.status, 'found');

  const sameSectionDup = canonicalDoc().replace(
    '- Tipologia: Tipo B | Área: 86 m² privativos | Dormitórios: 3 dormitórios (1 suíte) | Preço: a partir de R$ 1.250.000 | Descrição: Planta ampliada com sala para dois ambientes e varanda integrada.',
    '- Tipologia: Tipo A | Área: 62 m² privativos | Preço: a partir de R$ 1.050.000',
  );
  const r2 = parseStandardMarkdown(sameSectionDup);
  assert.ok(r2);
  const types2 = fieldOf(r2.fields, 'apartmentTypes');
  assert.equal(types2.status, 'needs_review');
  assert.equal(r2.needsReview, true);
});

test('frontmatter YAML e comentários HTML são ignorados', () => {
  const doc = `---
titulo: Base de Dados — Teste
versao: 1.0
---

<!-- arquivo: base-dados-teste.md -->

${canonicalDoc()}`;
  const result = parseStandardMarkdown(doc);
  assert.ok(result, 'frontmatter não deve impedir o reconhecimento');
  assert.equal(result.sectionsFound.length, 11);
  assert.equal(fieldOf(result.fields, 'status').value, 'Em Construção');
});

test('documento fora do padrão (base antiga com tabelas Campo|Informação) → null (fallback IA)', () => {
  const legacyDoc = `---
titulo: Base de Dados do Empreendimento — Villa Bianco
tipo_arquivo: base_de_dados_empreendimento
---

# Base de Dados do Empreendimento — Villa Bianco

## 1. Identificação do empreendimento

| Campo | Informação |
|---|---|
| Empreendimento | VILLA BIANCO |
| Endereço informado na tabela de preços | SQPS 103, Lote D-1, Park Sul |

## 2. Estrutura geral do empreendimento

| Item | Informação |
|---|---|
| Torres/Blocos | 4 blocos: A, B, C e D |
`;
  const result = parseStandardMarkdown(legacyDoc);
  assert.equal(result, null, 'estrutura antiga não tem seções canônicas → parser não se aplica');
  assert.equal(matchesStandardMarkdown(legacyDoc), false);
});

test(`documento com menos de ${SECTION_MATCH_THRESHOLD} seções canônicas → null`, () => {
  const doc = `# BASE DE DADOS — Incompleta

## 1. RESUMO
Frase de resumo.

## 2. LOCALIZAÇÃO
- Cidade: São Paulo

## 3. STATUS DA OBRA E DATA DE ENTREGA
- Status: Entregue
`;
  const result = parseStandardMarkdown(doc);
  assert.equal(result, null);
});

test('excesso é cortado aos limites do schema com limitation declarada', () => {
  const typologies = Array.from({ length: 14 }, (_, i) =>
    `- Tipologia: Tipo ${i + 1} | Área: ${40 + i} m² | Preço: a partir de R$ ${400 + i}.000`,
  ).join('\n');
  const differentials = Array.from({ length: 13 }, (_, i) => `- Diferencial ${i + 1}`).join('\n');
  const doc = canonicalDoc()
    .replace('- Tipologia: Tipo A | Área: 62 m² privativos | Dormitórios: 2 dormitórios (1 suíte) | Preço: a partir de R$ 980.000 | Descrição: Planta com sala integrada, terraço gourmet e cozinha americanada opção.\n- Tipologia: Tipo B | Área: 86 m² privativos | Dormitórios: 3 dormitórios (1 suíte) | Preço: a partir de R$ 1.250.000 | Descrição: Planta ampliada com sala para dois ambientes e varanda integrada.', typologies)
    .replace('- Piscina coberta aquecida de 25 m\n- Academia equipada de 120 m²\n- Coworking com salas reserváveis', differentials);
  const result = parseStandardMarkdown(doc);
  assert.ok(result);
  assert.equal((fieldOf(result.fields, 'apartmentTypes').value as unknown[]).length, 12);
  assert.equal((fieldOf(result.fields, 'differentials').value as unknown[]).length, 10);
  assert.ok(result.limitations.some((l) => l.includes('Tipologias limitadas a 12')));
  assert.ok(result.limitations.some((l) => l.includes('Diferenciais limitados a 10')));
});

test('região ausente no documento recebe fallback do cadastro (method rule)', () => {
  const doc = canonicalDoc().replace('- Região: Zona Oeste de São Paulo\n', '- Região: Não informado\n');
  const result = parseStandardMarkdown(doc, { fallbackRegion: 'Zona Sul de São Paulo' });
  assert.ok(result);
  const region = fieldOf(result.fields, 'location.region');
  assert.equal(region.status, 'found');
  assert.equal(region.value, 'Zona Sul de São Paulo');
  assert.equal(region.method, 'rule');
  assert.ok(String(region.note).includes('cadastro'));
});

test('resumo maior que 300 chars é truncado com limitation', () => {
  const long = 'x'.repeat(320);
  const doc = canonicalDoc().replace(
    'Apartamentos de 2 e 3 dormitórios a partir de R$ 980.000 no Itaim Bibi, São Paulo, com entrega prevista para Dezembro/2027.',
    long,
  );
  const result = parseStandardMarkdown(doc);
  assert.ok(result);
  const summary = fieldOf(result.fields, 'summary');
  assert.equal(String(summary.value).length, 300);
  assert.ok(result.limitations.some((l) => l.includes('Resumo truncado')));
});

test('identidade de auditoria do caminho determinístico', () => {
  assert.equal(PARSER_MODEL_ID, 'markdown-parser');
  assert.equal(PARSER_PROMPT_VERSION, 'md-parser-v1-2026-09-04');
});
