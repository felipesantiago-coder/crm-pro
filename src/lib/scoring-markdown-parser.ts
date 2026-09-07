/**
 * ============================================================
 * PARSER MARKDOWN → REGRAS DE LEAD SCORING (por formulário)
 * ============================================================
 * Tradutor determinístico (sem IA) do arquivo markdown de regras
 * para a config de temperatura do CRM. Contrato (prompt de geração,
 * seções 3–6):
 *
 *   §3.1  arquivo com uma ou mais seções de formulário;
 *   §3.2  "# Formulário: <nome>" (aceita "Formulario:", qualquer caixa);
 *   §3.3  "Limiar morno: <int>" / "Limiar quente: <int>" (ou warmMin/hotMin,
 *         com ou sem negrito, em qualquer ponto da seção); omitidos =
 *         manter os limiares já configurados;
 *   §3.4  "## <pergunta>" — caixa/espaço/hífen tolerados no casamento
 *         (normalizeQuestionKey); prefixo "Pergunta:"/"Questão:" opcional;
 *   §3.5  respostas em tabela (colunas Resposta/Opção/Alternativa ×
 *         Pontos/Score/Peso; colunas extras ignoradas com aviso);
 *   §3.6  respostas em lista "- <resposta>: <int>" (ou "*" / "=" / sufixo
 *         "pontos"); a nota é o ÚLTIMO inteiro da linha — respostas com
 *         números internos continuam funcionando;
 *   §3.7  dissertativas: "Nota da pergunta: <int>" (variações "Pontuação
 *         da pergunta:" / "Nota fixa:");
 *   §3.8  blockquotes e comentários HTML são ignorados; qualquer outra
 *         linha não reconhecada gera APENAS aviso (nunca quebra).
 *
 * §5 flexibilidade: níveis de título, ordem livre, linhas em branco.
 * §6 validação: notas inteiras (erro), hot >= warm (erro), textos exatos,
 * sem duplicatas de pergunta/resposta (erro — mesma chave de match do
 * motor, normalizeAnswerText), limites 100/300/500,
 * nunca incluir contato/rastreamento/{{...}} (aviso + descarte).
 *
 * Resultado: { ok, forms[], issues[] } — ok=false (há erros) BLOQUEIA a
 * importação; avisos seguem para o preview e o admin decide. O arquivo
 * NÃO é fonte de verdade sozinho: o apply revalida tudo com a mesma
 * sanitização do PUT (sanitizeScoringQuestions) antes de salvar.
 *
 * Usado por: /api/meta-ads/temperature/import-md (preview e apply).
 */

import { isMetaContactField, isMetaTrackingField, isUnresolvedMetaParam, normalizeAnswerText } from '@/lib/meta-lead-utils';
import {
  normalizeQuestionKey,
  sanitizeScoringQuestions,
  MAX_SCORING_QUESTIONS,
  type ScoringQuestion,
} from '@/lib/lead-temperature';

// ─────────────────────────────────────────────
// Tipos públicos
// ─────────────────────────────────────────────

export type ScoringMarkdownSeverity = 'error' | 'warning';

export interface ScoringMarkdownIssue {
  severity: ScoringMarkdownSeverity;
  /** Linha 1-based no arquivo original (quando aplicável). */
  line?: number;
  /** Formulário relacionado, quando conhecido. */
  formName?: string;
  message: string;
}

/** Um formulário extraído do arquivo markdown. */
export interface ParsedScoringForm {
  /** Nome após "# Formulário:" — exatamente como escrito no arquivo. */
  formName: string;
  /** null = arquivo omite o limiar → CRM mantém o valor já configurado. */
  warmMin: number | null;
  hotMin: number | null;
  /** Perguntas já no formato da config do CRM (ScoringQuestion). */
  questions: ScoringQuestion[];
  /** Linha 1-based do cabeçalho do formulário. */
  startLine: number;
}

export interface ScoringMarkdownResult {
  /** false quando existe pelo menos um ERRO — importação bloqueada. */
  ok: boolean;
  forms: ParsedScoringForm[];
  issues: ScoringMarkdownIssue[];
}

// ─────────────────────────────────────────────
// Padrões do contrato (§3)
// ─────────────────────────────────────────────

/** "# Formulário: X" — acento opcional no "formulario", qualquer caixa (\u00E1 = á). */
const FORM_HEADING_RE = /^formul[a\u00E1]rio\s*:\s*(.*)$/i;
/** Prefixo opcional da pergunta: "Pergunta: X" / "Questão: X" (\u00E3 = ã). */
const QUESTION_PREFIX_RE = /^(?:pergunta|quest[a\u00E3]o)\s*:\s*/i;
/** "Limiar morno: 5" / "warmMin: 5" / "Quente = 10" (com ou sem negrito). */
const THRESHOLD_RE = /^(?:limiar\s+)?(morno|quente|warm\s*min|hot\s*min)\s*[:=]\s*(.+)$/i;
/** "Nota da pergunta: 3" / "Pontuação da pergunta: 3" / "Nota fixa: 3" (\u00E7 = ç, \u00E3 = ã). */
const QUESTION_SCORE_RE =
  /^(?:nota\s*(?:fixa)?(?:\s*da\s*pergunta)?|pontua[c\u00E7][a\u00E3]o(?:\s*da\s*pergunta)?|question\s*score)\s*[:=]\s*(.+)$/i;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM_RE = /^\s*[-*+]\s+(.*)$/;
const TABLE_ROW_RE = /^\s*\|/;
/** Separador de colunas da tabela markdown (---, :---:, :-:). */
const TABLE_SEPARATOR_RE = /^:?-+:?$/;
/** Nota de resposta em lista: último inteiro da linha + sufixo opcional. */
const TRAILING_SCORE_RE = /(-?\d+)\s*(?:pontos?|pts)?\s*$/i;
/** Célula de nota da tabela: inteiro estrito. */
const INTEGER_RE = /^-?\d+$/;
/** Linha horizontal markdown — ignorada silenciosamente. */
const HORIZONTAL_RULE_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
/** Formatação proibida dentro de perguntas/respostas (§6.7). */
const EMPHASIS_RE = /\*\*|__|~~|`/;

/** Cabeçalhos de coluna reconhecidos nas tabelas (§3.5) — comparação sem acentos. */
const ANSWER_HEADER_RE = /^(?:resposta|opcao|alternativa)$/;
const POINTS_HEADER_RE = /^(?:pontos|score|peso)$/;

/** Remover acentos para comparação de SINÔNIMOS (cabeçalhos de coluna). */
function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Casamento de resposta (dedup §6.5): MESMA normalização do motor de
 *  pontuação (normalizeAnswerText em meta-lead-utils) — assim o parser
 *  nunca aceita como distintas duas respostas que o motor não saberia
 *  distinguir (caixa, acentos, underscores/espaços/hífens equivalentes). */
const normAnswerText = normalizeAnswerText;

function stripEmphasis(text: string): string {
  return text.replace(/\*\*|__/g, '').replace(/~~|`/g, '');
}

/** Recorta a mensagem para o preview sem estourar a UI. */
function snippet(text: string, max = 60): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Remove cercas de código (```markdown … ```) que a IA geradora pode deixar
 * na resposta — o admin frequentemente copia o bloco completo.
 */
function stripCodeFences(lines: string[]): string[] {
  const out = [...lines];
  const first = out.findIndex((l) => l.trim() !== '');
  if (first !== -1 && /^```/.test(out[first].trim())) out.splice(first, 1);
  for (let i = out.length - 1; i >= 0; i -= 1) {
    if (out[i].trim() === '') continue;
    if (/^```$/.test(out[i].trim())) out.splice(i, 1);
    break;
  }
  return out;
}

/**
 * Remove comentários HTML preservando a contagem de linhas (linhas
 * totalmente dentro de um comentário viram vazias; comentários inline
 * são recortados da linha).
 */
function stripHtmlComments(lines: string[]): string[] {
  const out: string[] = [];
  let inComment = false;
  for (const original of lines) {
    let line = original;
    if (inComment) {
      const end = line.indexOf('-->');
      if (end === -1) {
        out.push('');
        continue;
      }
      inComment = false;
      line = line.slice(end + 3);
    }
    for (;;) {
      const start = line.indexOf('<!--');
      if (start === -1) break;
      const end = line.indexOf('-->', start + 4);
      if (end === -1) {
        inComment = true;
        line = line.slice(0, start);
        break;
      }
      line = line.slice(0, start) + line.slice(end + 3);
    }
    out.push(line);
  }
  return out;
}

/** Divide uma linha de tabela em células (suporta \| escapado). */
function splitTableRow(text: string): string[] {
  let t = text.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  const ESC = '\u0000';
  return t
    .replace(/\\\|/g, ESC)
    .split('|')
    .map((cell) => cell.split(ESC).join('|').trim());
}

interface TableRow {
  line: number;
  text: string;
}

interface OpenQuestion {
  question: ScoringQuestion;
  headingLine: number;
  /** Textos normalizados já usados na pergunta (dedup §6.5). */
  usedAnswers: Map<string, true>;
}

interface OpenForm {
  form: ParsedScoringForm;
  /** Chaves normalizadas já usadas (dedup §6.5). */
  usedQuestionKeys: Set<string>;
}

/**
 * Faz o parse do arquivo markdown de regras (contrato §3–§6).
 * Puro — sem DB, sem rede, totalmente testável.
 */
export function parseScoringMarkdown(rawContent: unknown): ScoringMarkdownResult {
  const issues: ScoringMarkdownIssue[] = [];
  const forms: ParsedScoringForm[] = [];

  if (typeof rawContent !== 'string' || !rawContent.trim()) {
    return { ok: false, forms: [], issues: [{ severity: 'error', message: 'Arquivo vazio ou inválido' }] };
  }

  // Normaliza para NFC (canônico) — arquivos gerados em plataformas
  // diferentes podem usar decomposição unicode (NFD), o que quebraria
  // o casamento de textos com acentos contra as respostas reais do Meta
  let lines = rawContent.normalize('NFC').split(/\r?\n/);
  lines = stripCodeFences(lines);
  lines = stripHtmlComments(lines);

  let currentForm: OpenForm | null = null;
  let currentQuestion: OpenQuestion | null = null;
  let tableBuffer: TableRow[] = [];
  const seenFormNames = new Set<string>();

  const pushIssue = (severity: ScoringMarkdownSeverity, line: number | undefined, message: string, formName?: string) => {
    issues.push({ severity, ...(line !== undefined ? { line } : {}), ...(formName !== undefined ? { formName } : {}), message });
  };

  // ── Tabela acumulada (§3.5) ──
  const flushTable = (_eof = false) => {
    if (tableBuffer.length === 0) return;
    const block = tableBuffer;
    tableBuffer = [];
    if (block.length < 2) {
      // Linha de tabela solta (sem cabeçalho + separador) — nem no fim do arquivo
      pushIssue('warning', block[0].line, `Tabela incompleta — linhas de tabela soltas foram ignoradas: "${snippet(block[0].text)}"`, currentForm?.form.formName);
      return;
    }

    if (!currentQuestion) {
      pushIssue('warning', block[0].line, 'Tabela fora de uma pergunta — ignorada', currentForm?.form.formName);
      return;
    }

    const header = splitTableRow(block[0].text);
    let answerIdx = -1;
    let pointsIdx = -1;
    header.forEach((cell, idx) => {
      const normalized = stripAccents(cell.trim().toLowerCase());
      if (ANSWER_HEADER_RE.test(normalized) && answerIdx === -1) answerIdx = idx;
      else if (POINTS_HEADER_RE.test(normalized) && pointsIdx === -1) pointsIdx = idx;
    });

    if (answerIdx === -1 || pointsIdx === -1) {
      pushIssue(
        'warning',
        block[0].line,
        `Cabeçalho da tabela não reconhecido — use as colunas "Resposta" e "Pontos"`,
        currentForm?.form.formName,
      );
      return;
    }
    const extraCols = header.length - 2;
    if (extraCols > 0) {
      pushIssue('warning', block[0].line, `${extraCols} coluna(s) extra(s) na tabela foram ignoradas`, currentForm?.form.formName);
    }

    // Segunda linha deve ser o separador (---) de uma tabela markdown válida
    const separatorCells = splitTableRow(block[1].text);
    const isSeparator =
      separatorCells.length > 0 && separatorCells.every((cell) => TABLE_SEPARATOR_RE.test(cell));
    if (!isSeparator) {
      pushIssue('warning', block[1].line, 'Tabela markdown inválida — falta a linha separadora (|---|---|)', currentForm?.form.formName);
      return;
    }

    const question = currentQuestion.question;
    for (let i = 2; i < block.length; i += 1) {
      const row = block[i];
      const cells = splitTableRow(row.text);
      if (cells.length === 0 || cells.every((c) => c === '')) continue;
      if (cells.length <= answerIdx || cells.length <= pointsIdx) {
        pushIssue('error', row.line, `Linha da tabela com colunas faltando: "${snippet(row.text)}"`, currentForm?.form.formName);
        continue;
      }
      const answerText = cells[answerIdx];
      const rawScore = cells[pointsIdx];
      if (!answerText) {
        pushIssue('error', row.line, 'Célula de resposta vazia na tabela — toda resposta precisa de texto', currentForm?.form.formName);
        continue;
      }
      if (!INTEGER_RE.test(rawScore)) {
        pushIssue('error', row.line, `Nota inválida "${snippet(rawScore, 20)}" — use número inteiro (ex.: 5, 0 ou -2)`, currentForm?.form.formName);
        continue;
      }
      if (EMPHASIS_RE.test(answerText)) {
        pushIssue('warning', row.line, `Remova a formatação (negrito/itálico/código) do texto da resposta "${snippet(answerText, 40)}"`, currentForm?.form.formName);
      }
      if (isUnresolvedMetaParam(answerText)) {
        pushIssue('warning', row.line, `Valor dinâmico "${snippet(answerText, 40)}" não é uma resposta real — linha descartada`, currentForm?.form.formName);
        continue;
      }
      const key = normAnswerText(answerText);
      if (currentQuestion.usedAnswers.has(key)) {
        pushIssue('error', row.line, `Resposta duplicada "${snippet(answerText, 40)}" na pergunta "${snippet(question.key, 50)}"`, currentForm?.form.formName);
        continue;
      }
      currentQuestion.usedAnswers.set(key, true);
      question.answers.push({ text: answerText, score: Math.trunc(Number(rawScore)) });
    }
  };

  // ── Resposta em lista (§3.6) ──
  const parseListItem = (line: number, itemText: string) => {
    if (!currentQuestion) {
      pushIssue('warning', line, `Resposta fora de uma pergunta — ignorada: "${snippet(itemText)}"`, currentForm?.form.formName);
      return;
    }
    const match = TRAILING_SCORE_RE.exec(itemText);
    if (!match) {
      pushIssue('error', line, `Resposta sem nota — informe os pontos no fim da linha: "${snippet(itemText)}"`, currentForm?.form.formName);
      return;
    }
    // Guarda decimal: "4.5" termina em "5" — o caractere anterior denuncia
    const before = match.index > 0 ? itemText[match.index - 1] : '';
    if (before === '.' || before === ',' || /\d/.test(before)) {
      pushIssue('error', line, `Nota inválida em "${snippet(itemText)}" — use número inteiro`, currentForm?.form.formName);
      return;
    }
    const score = Math.trunc(Number(match[1]));
    let text = itemText.slice(0, match.index).trim();
    text = text.replace(/[:=–—-]+\s*$/, '').trim();
    if (!text) {
      pushIssue('error', line, `Resposta sem texto antes da nota: "${snippet(itemText)}"`, currentForm?.form.formName);
      return;
    }
    if (EMPHASIS_RE.test(text)) {
      pushIssue('warning', line, `Remova a formatação (negrito/itálico/código) do texto da resposta "${snippet(text, 40)}"`, currentForm?.form.formName);
    }
    if (isUnresolvedMetaParam(text)) {
      pushIssue('warning', line, `Valor dinâmico "${snippet(text, 40)}" não é uma resposta real — linha descartada`, currentForm?.form.formName);
      return;
    }
    const key = normAnswerText(text);
    if (currentQuestion.usedAnswers.has(key)) {
      pushIssue('error', line, `Resposta duplicada "${snippet(text, 40)}" na pergunta "${snippet(currentQuestion.question.key, 50)}"`, currentForm?.form.formName);
      return;
    }
    currentQuestion.usedAnswers.set(key, true);
    currentQuestion.question.answers.push({ text, score });
  };

  // ── Limiar (§3.3) — aceita marcador de lista/negrito por tolerância ──
  const parseThreshold = (line: number, rawText: string) => {
    const candidate = stripEmphasis(rawText.replace(LIST_ITEM_RE, '$1'));
    const match = THRESHOLD_RE.exec(candidate);
    if (!match) return false;
    const which = match[1].toLowerCase().replace(/\s+/g, '');
    const rawValue = match[2].trim();
    if (!currentForm) {
      pushIssue('warning', line, `Limiar fora de uma seção "# Formulário:" — ignorado: "${snippet(rawText)}"`);
      return true;
    }
    if (!INTEGER_RE.test(rawValue)) {
      pushIssue('error', line, `Limiar inválido "${snippet(rawValue, 20)}" — use número inteiro`, currentForm.form.formName);
      return true;
    }
    const value = Math.trunc(Number(rawValue));
    const form = currentForm.form;
    const isWarm = which === 'morno' || which === 'warmmin';
    const previous = isWarm ? form.warmMin : form.hotMin;
    if (previous !== null && previous !== value) {
      pushIssue('warning', line, `Limiar ${isWarm ? 'MORNO' : 'QUENTE'} definido novamente — o último valor (${value}) prevalece`, form.formName);
    }
    if (isWarm) form.warmMin = value;
    else form.hotMin = value;
    return true;
  };

  // ── Nota fixa da pergunta (§3.7) ──
  const parseQuestionScore = (line: number, rawText: string) => {
    const candidate = stripEmphasis(rawText.replace(LIST_ITEM_RE, '$1'));
    const match = QUESTION_SCORE_RE.exec(candidate);
    if (!match) return false;
    const rawValue = match[1].trim();
    if (!currentQuestion) {
      pushIssue('warning', line, `Nota fixa fora de uma pergunta — ignorada: "${snippet(rawText)}"`, currentForm?.form.formName);
      return true;
    }
    if (!INTEGER_RE.test(rawValue)) {
      pushIssue('error', line, `Nota fixa inválida "${snippet(rawValue, 20)}" — use número inteiro`, currentForm?.form.formName);
      return true;
    }
    const value = Math.trunc(Number(rawValue));
    const question = currentQuestion.question;
    if (question.questionScore !== undefined && question.questionScore !== value) {
      pushIssue('warning', line, `Nota fixa da pergunta definida novamente — o último valor (${value}) prevalece`, currentForm?.form.formName);
    }
    question.questionScore = value;
    return true;
  };

  // ── Varredura linha a linha ──
  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (trimmed === '') {
      flushTable();
      continue;
    }
    if (HORIZONTAL_RULE_RE.test(trimmed)) {
      flushTable();
      continue;
    }
    // Blockquote = nota descritiva (§3.8) — ignorado
    if (trimmed.startsWith('>')) {
      flushTable();
      continue;
    }
    // Linha de tabela — acumula (bloco resolvido quando a sequência termina)
    if (TABLE_ROW_RE.test(rawLine)) {
      tableBuffer.push({ line: lineNo, text: rawLine });
      continue;
    }
    flushTable();

    // Cabeçalhos (§3.2/§3.4)
    const headingMatch = HEADING_RE.exec(trimmed);
    if (headingMatch) {
      const headingText = stripEmphasis(headingMatch[2]).trim();
      const formMatch = FORM_HEADING_RE.exec(headingText);
      if (formMatch) {
        flushTable();
        const formName = formMatch[1].trim();
        const normalized = formName.toLowerCase();
        if (seenFormNames.has(normalized)) {
          pushIssue('error', lineNo, `Formulário "${snippet(formName, 50)}" aparece em mais de uma seção — use uma seção única por formulário`, formName || undefined);
        }
        seenFormNames.add(normalized);
        currentForm = {
          form: { formName, warmMin: null, hotMin: null, questions: [], startLine: lineNo },
          usedQuestionKeys: new Set(),
        };
        forms.push(currentForm.form);
        currentQuestion = null;
        if (!formName) {
          pushIssue('error', lineNo, 'Cabeçalho de formulário sem nome — use "# Formulário: <nome>"');
        }
        continue;
      }

      // Cabeçalho de pergunta — precisa estar dentro de um formulário
      if (!currentForm) {
        pushIssue('warning', lineNo, `Conteúdo antes do primeiro "# Formulário:" foi ignorado: "${snippet(headingText)}"`);
        continue;
      }
      currentQuestion = {
        question: { key: headingText.replace(QUESTION_PREFIX_RE, '').trim(), answers: [] },
        headingLine: lineNo,
        usedAnswers: new Map(),
      };
      if (!currentQuestion.question.key) {
        pushIssue('error', lineNo, 'Cabeçalho de pergunta sem texto', currentForm.form.formName);
      }
      // Dedup de pergunta por chave normalizada (§6.5) — igual ao motor
      const normKey = normalizeQuestionKey(currentQuestion.question.key);
      if (normKey && currentForm.usedQuestionKeys.has(normKey)) {
        pushIssue('error', lineNo, `Pergunta duplicada "${snippet(currentQuestion.question.key, 50)}" no formulário "${snippet(currentForm.form.formName, 50)}"`, currentForm.form.formName);
      }
      currentForm.usedQuestionKeys.add(normKey);
      currentForm.form.questions.push(currentQuestion.question);
      continue;
    }

    // Linhas de conteúdo — ordem: limiar → nota fixa → lista
    if (parseThreshold(lineNo, rawLine)) continue;
    if (parseQuestionScore(lineNo, rawLine)) continue;
    const listItemMatch = LIST_ITEM_RE.exec(rawLine);
    if (listItemMatch) {
      parseListItem(lineNo, listItemMatch[1].trim());
      continue;
    }

    // Qualquer outra linha: aviso (§3.8), nunca quebra a importação
    pushIssue('warning', lineNo, `Linha não reconhecida — ignorada: "${snippet(rawLine)}"`, currentForm?.form.formName);
  }
  flushTable(true);

  // ── Pós-processamento por formulário (§6) ──
  for (const form of forms) {
    // §6.3: quente >= morno — erro cedo no preview (o apply também bloqueia)
    if (form.warmMin !== null && form.hotMin !== null && form.hotMin < form.warmMin) {
      issues.push({
        severity: 'error',
        formName: form.formName,
        message: `Limiar QUENTE (${form.hotMin}) não pode ser menor que o limiar MORNO (${form.warmMin})`,
      });
    }
    // Contato/rastreamento nunca são perguntas (§7) — mesmos filtros do PUT
    form.questions = form.questions.filter((q) => {
      if (!q.key) return false;
      if (isMetaContactField(q.key) || isMetaTrackingField(q.key)) {
        issues.push({
          severity: 'warning',
          line: form.startLine,
          formName: form.formName,
          message: `Pergunta "${snippet(q.key, 50)}" é dado de contato/rastreamento e nunca pontua — removida`,
        });
        return false;
      }
      return true;
    });

    // Limites (§6.6) — contagens excedentes bloqueiam; texto longo é truncado
    if (form.questions.length > MAX_SCORING_QUESTIONS) {
      form.questions = form.questions.slice(0, MAX_SCORING_QUESTIONS);
      issues.push({
        severity: 'error',
        formName: form.formName,
        message: `Formulário excede ${MAX_SCORING_QUESTIONS} perguntas — importação bloqueada`,
      });
    }
    for (const q of form.questions) {
      if (q.key.length > 500) {
        issues.push({
          severity: 'warning',
          formName: form.formName,
          message: `Texto da pergunta "${snippet(q.key, 40)}" excede 500 caracteres e será truncado`,
        });
      }
      if (q.answers.length > 300) {
        q.answers = q.answers.slice(0, 300);
        issues.push({
          severity: 'error',
          formName: form.formName,
          message: `Pergunta "${snippet(q.key, 50)}" excede 300 respostas — importação bloqueada`,
        });
      }
      if (q.questionScore === undefined && q.answers.length === 0) {
        issues.push({
          severity: 'warning',
          formName: form.formName,
          message: `Pergunta "${snippet(q.key, 50)}" está sem respostas e sem nota fixa — não pontuará`,
        });
      }
    }
  }

  // Revalida com a MESMA sanitização do PUT — o parser nunca é a última barreira
  for (const form of forms) {
    form.questions = sanitizeScoringQuestions(form.questions);
  }

  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    forms,
    issues,
  };
}
