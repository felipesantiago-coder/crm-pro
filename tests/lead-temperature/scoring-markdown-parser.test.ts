/**
 * Testes do parser markdown → regras de lead scoring
 * (src/lib/scoring-markdown-parser.ts) — contrato do prompt de
 * geração, seções 3–6:
 *   §3 estrutura (formulário, limiares, perguntas, tabela/lista,
 *      nota fixa, comentários);
 *   §5 flexibilidade (variações aceitas);
 *   §6 validação (erros bloqueiam; avisos passam pelo preview).
 *
 * Rodar: npm test (ou: node --test --import ./tests/ai/register.mjs tests/lead-temperature/scoring-markdown-parser.test.ts)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseScoringMarkdown } from '@/lib/scoring-markdown-parser';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Arquivo padrão-ouro do prompt (seção 4) — dois formulários. */
const GOLD_FILE = `# Formulário: Consultoria Empresarial — Qualificação

Limiar morno: 5
Limiar quente: 12

## Qual é o seu faturamento mensal?

| Resposta | Pontos |
|---|---|
| Até R$ 10 mil | 2 |
| De R$ 10 mil a R$ 50 mil | 5 |
| Acima de R$ 50 mil | 10 |
| Não sei informar | 0 |

## Quantos funcionários a empresa possui?

- Somente eu: 2
- De 2 a 10: 4
- Mais de 10: 6

## Quando pretende iniciar o projeto?

- Imediatamente: 8
- Em até 3 meses: 4
- Ainda estou pesquisando: 0

## Descreva brevemente seu principal desafio

> Pergunta dissertativa — qualquer resposta recebe a nota fixa abaixo.

Nota da pergunta: 3

# Formulário: Mentoria Individual

Limiar morno: 4
Limiar quente: 9

## Qual sua área de atuação?

| Resposta | Pontos |
|---|---|
| Marketing | 3 |
| Tecnologia | 3 |
| Outra | 1 |

## Já investiu em mentoria antes?

- Sim: 5
- Não: 0
`;

function errorsOf(result: ReturnType<typeof parseScoringMarkdown>) {
  return result.issues.filter((i) => i.severity === 'error');
}
function warningsOf(result: ReturnType<typeof parseScoringMarkdown>) {
  return result.issues.filter((i) => i.severity === 'warning');
}

// ─────────────────────────────────────────────
// §4 Exemplo padrão-ouro (estrutura completa)
// ─────────────────────────────────────────────

describe('exemplo padrão-ouro (2 formulários)', () => {
  const result = parseScoringMarkdown(GOLD_FILE);

  test('arquivo válido, sem erros', () => {
    assert.equal(result.ok, true);
    assert.deepEqual(errorsOf(result), []);
  });

  test('extrai os dois formulários com nomes exatos', () => {
    assert.equal(result.forms.length, 2);
    assert.equal(result.forms[0].formName, 'Consultoria Empresarial — Qualificação');
    assert.equal(result.forms[1].formName, 'Mentoria Individual');
  });

  test('limiares do primeiro formulário', () => {
    assert.equal(result.forms[0].warmMin, 5);
    assert.equal(result.forms[0].hotMin, 12);
  });

  test('respostas em tabela (primeira pergunta)', () => {
    const q = result.forms[0].questions[0];
    assert.equal(q.key, 'Qual é o seu faturamento mensal?');
    assert.equal(q.answers.length, 4);
    assert.deepEqual(q.answers[0], { text: 'Até R$ 10 mil', score: 2 });
    assert.deepEqual(q.answers[2], { text: 'Acima de R$ 50 mil', score: 10 });
    assert.deepEqual(q.answers[3], { text: 'Não sei informar', score: 0 });
  });

  test('respostas em lista (segunda pergunta)', () => {
    const q = result.forms[0].questions[1];
    assert.deepEqual(q.answers[0], { text: 'Somente eu', score: 2 });
    assert.deepEqual(q.answers[2], { text: 'Mais de 10', score: 6 });
  });

  test('nota fixa da pergunta dissertativa (§3.7)', () => {
    const q = result.forms[0].questions[3];
    assert.equal(q.key, 'Descreva brevemente seu principal desafio');
    assert.equal(q.questionScore, 3);
    assert.equal(q.answers.length, 0);
  });

  test('blockquote vira nota e não gera aviso', () => {
    assert.equal(warningsOf(result).length, 0);
  });
});

// ─────────────────────────────────────────────
// §5 Flexibilidade — variações aceitas
// ─────────────────────────────────────────────

describe('flexibilidade (§5)', () => {
  test('aceita fence de código que a IA geradora deixa na resposta', () => {
    const wrapped = '```markdown\n' + GOLD_FILE + '\n```';
    const result = parseScoringMarkdown(wrapped);
    assert.equal(result.ok, true);
    assert.equal(result.forms.length, 2);
  });

  test('"Formulario:" sem acento e títulos de nível misto', () => {
    const result = parseScoringMarkdown(
      [
        '## Formulario: Imobiliária Central',
        '',
        '### Qual o bairro de interesse?',
        '',
        '| Opção | Peso |',
        '|---|---|',
        '| Centro | 5 |',
        '| Zona sul | 2 |',
        '',
        '### Possui financiamento aprovado?',
        '',
        '* Sim: 7',
        '* Não: 0',
      ].join('\n'),
    );
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.equal(result.forms[0].formName, 'Imobiliária Central');
    assert.equal(result.forms[0].questions[0].key, 'Qual o bairro de interesse?');
    assert.deepEqual(result.forms[0].questions[0].answers[0], { text: 'Centro', score: 5 });
    assert.deepEqual(result.forms[0].questions[1].answers[0], { text: 'Sim', score: 7 });
  });

  test('limiares com negrito e sinônimos warmMin/hotMin em qualquer posição', () => {
    const result = parseScoringMarkdown(
      [
        '# Formulário: Teste Limiares',
        '',
        '## Pergunta um?',
        '',
        '- a: 1',
        '',
        '**Limiar morno:** 3',
        '',
        'hotMin: 8',
      ].join('\n'),
    );
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.equal(result.forms[0].warmMin, 3);
    assert.equal(result.forms[0].hotMin, 8);
  });

  test('prefixo "Pergunta:" e separador "=" nos itens', () => {
    const result = parseScoringMarkdown(
      [
        '# Formulário: T',
        '',
        '## Pergunta: Nível de interesse?',
        '',
        '- Alto = 10',
        '- Baixo = 1',
      ].join('\n'),
    );
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.equal(result.forms[0].questions[0].key, 'Nível de interesse?');
    assert.deepEqual(result.forms[0].questions[0].answers[0], { text: 'Alto', score: 10 });
  });

  test('resposta com número interno não quebra (último inteiro é a nota)', () => {
    const result = parseScoringMarkdown(
      ['# Formulário: T', '', '## Unidade?', '', '- Apartamento 2: 10', '- Torre 15, unidade 40: 3'].join('\n'),
    );
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.deepEqual(result.forms[0].questions[0].answers[0], { text: 'Apartamento 2', score: 10 });
    assert.deepEqual(result.forms[0].questions[0].answers[1], { text: 'Torre 15, unidade 40', score: 3 });
  });

  test('sufixo "pontos" aceito na lista', () => {
    const result = parseScoringMarkdown(['# Formulário: T', '', '## Q?', '', '- Sim: 5 pontos'].join('\n'));
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.deepEqual(result.forms[0].questions[0].answers[0], { text: 'Sim', score: 5 });
  });

  test('notas negativas e zero', () => {
    const result = parseScoringMarkdown(
      ['# Formulário: T', '', '## Q?', '', '- Desistiu: -5', '- Talvez: 0', '- Vai: 9'].join('\n'),
    );
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.deepEqual(result.forms[0].questions[0].answers[0], { text: 'Desistiu', score: -5 });
    assert.deepEqual(result.forms[0].questions[0].answers[1], { text: 'Talvez', score: 0 });
  });

  test('variações da nota fixa: "Pontuação da pergunta:" e "Nota fixa:"', () => {
    const result = parseScoringMarkdown(
      [
        '# Formulário: T',
        '',
        '## Dissertativa um?',
        'Pontuação da pergunta: 2',
        '',
        '## Dissertativa dois?',
        'Nota fixa: 4',
      ].join('\n'),
    );
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.equal(result.forms[0].questions[0].questionScore, 2);
    assert.equal(result.forms[0].questions[1].questionScore, 4);
  });

  test('comentários HTML e linhas em branco são ignorados', () => {
    const result = parseScoringMarkdown(
      ['<!-- arquivo: regras.md -->', '# Formulário: T', '', '<!-- seção 1 -->', '## Q?', '', '- Sim: 1', '', '---'].join('\n'),
    );
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.equal(result.forms[0].questions[0].answers.length, 1);
    assert.equal(warningsOf(result).length, 0);
  });

  test('pipe escapado na tabela vira texto literal da resposta', () => {
    const result = parseScoringMarkdown(
      ['# Formulário: T', '', '## Q?', '', '| Resposta | Pontos |', '|---|---|', '| A \\| B | 4 |'].join('\n'),
    );
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.deepEqual(result.forms[0].questions[0].answers[0], { text: 'A | B', score: 4 });
  });

  test('colunas em qualquer ordem (Pontos antes de Resposta)', () => {
    const result = parseScoringMarkdown(
      ['# Formulário: T', '', '## Q?', '', '| Pontos | Resposta |', '|---|---|', '| 7 | Ouro |'].join('\n'),
    );
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.deepEqual(result.forms[0].questions[0].answers[0], { text: 'Ouro', score: 7 });
  });
});

// ─────────────────────────────────────────────
// §6 Validação — erros bloqueiam a importação
// ─────────────────────────────────────────────

describe('erros bloqueantes (§6)', () => {
  test('pergunta duplicada (mesmo texto, caixa diferente)', () => {
    const result = parseScoringMarkdown(
      ['# Formulário: T', '', '## Qual seu orçamento?', '', '- a: 1', '', '## QUAL SEU ORÇAMENTO?', '', '- b: 2'].join('\n'),
    );
    assert.equal(result.ok, false);
    assert.match(errorsOf(result)[0].message, /Pergunta duplicada/i);
  });

  test('resposta duplicada na mesma pergunta (caixa/espaço diferentes)', () => {
    const result = parseScoringMarkdown(
      ['# Formulário: T', '', '## Q?', '', '- Sim: 5', '- SIM : 9'].join('\n'),
    );
    assert.equal(result.ok, false);
    assert.match(errorsOf(result)[0].message, /Resposta duplicada/i);
  });

  test('limiar quente menor que morno', () => {
    const result = parseScoringMarkdown(
      ['# Formulário: T', '', 'Limiar morno: 10', 'Limiar quente: 5', '', '## Q?', '', '- a: 1'].join('\n'),
    );
    assert.equal(result.ok, false);
    // Erro é reportado no preview/apply (aqui o parse mantém os valores)
    assert.equal(result.forms[0].warmMin, 10);
    assert.equal(result.forms[0].hotMin, 5);
    const applyLike = result.forms[0];
    assert.ok(applyLike.hotMin < applyLike.warmMin);
  });

  test('nota decimal na tabela é erro', () => {
    const result = parseScoringMarkdown(
      ['# Formulário: T', '', '## Q?', '', '| Resposta | Pontos |', '|---|---|', '| a | 4.5 |'].join('\n'),
    );
    assert.equal(result.ok, false);
    assert.match(errorsOf(result)[0].message, /Nota inválida/i);
  });

  test('nota decimal na lista é erro (não confunde com o último dígito)', () => {
    const result = parseScoringMarkdown(['# Formulário: T', '', '## Q?', '- nota 4.5'].join('\n'));
    assert.equal(result.ok, false);
    assert.match(errorsOf(result)[0].message, /número inteiro/i);
  });

  test('resposta de lista sem nota é erro', () => {
    const result = parseScoringMarkdown(['# Formulário: T', '', '## Q?', '- Sem nota'].join('\n'));
    assert.equal(result.ok, false);
    assert.match(errorsOf(result)[0].message, /sem nota/i);
  });

  test('célula de resposta vazia na tabela é erro', () => {
    const result = parseScoringMarkdown(
      ['# Formulário: T', '', '## Q?', '', '| Resposta | Pontos |', '|---|---|', '|  | 5 |'].join('\n'),
    );
    assert.equal(result.ok, false);
    assert.match(errorsOf(result)[0].message, /vazia/i);
  });

  test('mesmo formulário em duas seções é erro', () => {
    const result = parseScoringMarkdown(
      ['# Formulário: T', '', '## Q?', '- a: 1', '', '# Formulário: T', '', '## R?', '- b: 2'].join('\n'),
    );
    assert.equal(result.ok, false);
    assert.ok(errorsOf(result).some((e) => /mais de uma seção/i.test(e.message)));
  });

  test('excesso de perguntas bloqueia (limite de 100)', () => {
    const lines = ['# Formulário: T', ''];
    for (let i = 1; i <= 101; i += 1) {
      lines.push(`## Pergunta ${i}?`, '', `- r: ${i}`, '');
    }
    const result = parseScoringMarkdown(lines.join('\n'));
    assert.equal(result.ok, false);
    assert.ok(errorsOf(result).some((e) => /excede 100 perguntas/i.test(e.message)));
    assert.equal(result.forms[0].questions.length, 100);
  });

  test('arquivo vazio é erro', () => {
    assert.equal(parseScoringMarkdown('').ok, false);
    assert.equal(parseScoringMarkdown('   \n  \n').ok, false);
    assert.equal(parseScoringMarkdown(null).ok, false);
    assert.equal(parseScoringMarkdown(42).ok, false);
  });

  test('formulário sem nome é erro', () => {
    const result = parseScoringMarkdown(['# Formulário:', '', '## Q?', '- a: 1'].join('\n'));
    assert.equal(result.ok, false);
    assert.ok(errorsOf(result).some((e) => /sem nome/i.test(e.message)));
  });
});

// ─────────────────────────────────────────────
// §6 Validação — avisos passam pelo preview
// ─────────────────────────────────────────────

describe('avisos não bloqueantes (§3.8/§6/§7)', () => {
  test('conteúdo não reconhecido gera aviso com a linha, sem quebrar', () => {
    const result = parseScoringMarkdown(
      ['# Formulário: T', '', 'Texto solto qualquer.', '', '## Q?', '- a: 1'].join('\n'),
    );
    assert.equal(result.ok, true);
    const warn = warningsOf(result).find((w) => /Linha não reconhecida/i.test(w.message));
    assert.ok(warn);
    assert.equal(warn?.line, 3);
  });

  test('conteúdo antes do primeiro "# Formulário:" é ignorado com aviso', () => {
    const result = parseScoringMarkdown(['## Pergunta órfã?', '', '# Formulário: T', '', '## Q?', '- a: 1'].join('\n'));
    assert.equal(result.ok, true);
    assert.equal(result.forms.length, 1);
    assert.equal(result.forms[0].questions.length, 1);
    assert.ok(warningsOf(result).some((w) => /antes do primeiro/i.test(w.message)));
  });

  test('resposta com {{campaign.name}} é descartada com aviso (§7)', () => {
    const result = parseScoringMarkdown(
      ['# Formulário: T', '', '## Q?', '', '| Resposta | Pontos |', '|---|---|', '| {{campaign.name}} | 5 |', '| real | 3 |'].join('\n'),
    );
    assert.equal(result.ok, true);
    assert.equal(result.forms[0].questions[0].answers.length, 1);
    assert.deepEqual(result.forms[0].questions[0].answers[0], { text: 'real', score: 3 });
    assert.ok(warningsOf(result).some((w) => /Valor dinâmico/i.test(w.message)));
  });

  test('pergunta de contato é removida com aviso (§7) — igual ao filtro do PUT', () => {
    const result = parseScoringMarkdown(
      ['# Formulário: T', '', '## email', '- x: 1', '', '## Qual seu bairro?', '- Centro: 5'].join('\n'),
    );
    assert.equal(result.ok, true);
    assert.equal(result.forms[0].questions.length, 1);
    assert.equal(result.forms[0].questions[0].key, 'Qual seu bairro?');
    assert.ok(warningsOf(result).some((w) => /dado de contato\/rastreamento/i.test(w.message)));
  });

  test('formatação dentro da resposta gera aviso e mantém o texto', () => {
    const result = parseScoringMarkdown(['# Formulário: T', '', '## Q?', '- **Sim**: 5'].join('\n'));
    assert.equal(result.ok, true);
    assert.deepEqual(result.forms[0].questions[0].answers[0], { text: '**Sim**', score: 5 });
    assert.ok(warningsOf(result).some((w) => /formatação/i.test(w.message)));
  });

  test('pergunta sem respostas e sem nota fixa avisa que não pontuará', () => {
    const result = parseScoringMarkdown(['# Formulário: T', '', '## Q vazia?', '', '## Q ok?', '- a: 1'].join('\n'));
    assert.equal(result.ok, true);
    assert.ok(warningsOf(result).some((w) => /não pontuará/i.test(w.message)));
  });

  test('tabela com coluna extra é aceita com aviso (coluna ignorada)', () => {
    const result = parseScoringMarkdown(
      [
        '# Formulário: T',
        '',
        '## Q?',
        '',
        '| Resposta | Pontos | Observação |',
        '|---|---|---|',
        '| a | 2 | urgente |',
      ].join('\n'),
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.forms[0].questions[0].answers[0], { text: 'a', score: 2 });
    assert.ok(warningsOf(result).some((w) => /coluna\(s\) extra/i.test(w.message)));
  });

  test('tabela sem cabeçalho reconhecido avisa e ignora', () => {
    const result = parseScoringMarkdown(
      ['# Formulário: T', '', '## Q?', '', '| A | B |', '|---|---|', '| a | 2 |'].join('\n'),
    );
    assert.equal(result.ok, true);
    assert.equal(result.forms[0].questions[0].answers.length, 0);
    assert.ok(warningsOf(result).some((w) => /Cabeçalho da tabela não reconhecido/i.test(w.message)));
  });

  test('limiar duplicado com valor diferente: último prevalece com aviso', () => {
    const result = parseScoringMarkdown(
      ['# Formulário: T', '', 'Limiar morno: 5', 'Limiar morno: 7', '', '## Q?', '- a: 1'].join('\n'),
    );
    assert.equal(result.ok, true);
    assert.equal(result.forms[0].warmMin, 7);
    assert.ok(warningsOf(result).some((w) => /prevalece/i.test(w.message)));
  });

  test('texto de pergunta acima de 500 caracteres é truncado com aviso', () => {
    const longKey = 'P'.repeat(600);
    const result = parseScoringMarkdown(['# Formulário: T', '', `## ${longKey}`, '- a: 1'].join('\n'));
    assert.equal(result.ok, true);
    assert.equal(result.forms[0].questions[0].key.length, 500);
    assert.ok(warningsOf(result).some((w) => /500 caracteres/i.test(w.message)));
  });

  test('limiares e perguntas fora de formulário avisam e são ignorados', () => {
    const result = parseScoringMarkdown(['Limiar morno: 5', 'Nota da pergunta: 3', '- resposta solta: 2'].join('\n'));
    assert.equal(result.ok, true);
    assert.equal(result.forms.length, 0);
    assert.equal(warningsOf(result).length, 3);
  });
});

// ─────────────────────────────────────────────
// Integração com o motor (config → parseScoringConfig)
// ─────────────────────────────────────────────

describe('saída compatível com a config do CRM', () => {
  test('forms extraídos passam limpos pela sanitização do PUT', async () => {
    const { sanitizeScoringQuestions, parseScoringConfig } = await import('@/lib/lead-temperature');
    const result = parseScoringMarkdown(GOLD_FILE);
    for (const form of result.forms) {
      const sanitized = sanitizeScoringQuestions(form.questions);
      assert.equal(sanitized.length, form.questions.length);
      const reparsed = parseScoringConfig(JSON.stringify({ questions: sanitized }));
      assert.ok(reparsed);
      assert.equal(reparsed.questions.length, form.questions.length);
      // Notas sobrevivem ao round-trip exatamente iguais
      assert.deepEqual(
        reparsed.questions.flatMap((q) => q.answers.map((a) => a.score)),
        form.questions.flatMap((q) => q.answers.map((a) => a.score)),
      );
    }
  });
});
