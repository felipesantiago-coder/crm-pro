import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';
import { parseScoringMarkdown } from '@/lib/scoring-markdown-parser';
import { normalizeQuestionKey } from '@/lib/lead-temperature';
import { normalizeAnswerText } from '@/lib/meta-lead-utils';
import { getObservedQuestions } from '@/lib/lead-form-observed';

// ============================================================
// POST /api/meta-ads/temperature/import-md
// PREVIEW da importação de regras de lead scoring em markdown
// (um arquivo por formulário — preferência do admin).
//
// Recebe { content: string, formId?: string } e devolve:
//   - ok            — false quando o parse produziu ERROS (bloqueia)
//   - forms[]       — formulários extraídos, com status de match de nome
//   - targetIndex   — índice do formulário que corresponde ao formId
//                     selecionado (null = nenhum → importação bloqueada)
//   - issues[]      — erros/avisos com linha, para o preview
//   - review        — validação cruzada contra as perguntas/respostas
//                     OBSERVADAS nos leads reais do formulário
// Nada é salvo aqui — o apply é feito por /import-md/apply.
// ============================================================

export const maxDuration = 60;

/** Teto de defesa contra payload gigante (~300 KB de markdown). */
const MAX_CONTENT_LENGTH = 300_000;

type MatchStatus = 'target' | 'other' | 'not_found' | 'ambiguous';

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await request.json().catch(() => null);
    const content = typeof body?.content === 'string' ? body.content : '';
    const formId = typeof body?.formId === 'string' ? body.formId.trim() : '';

    if (!content.trim()) {
      return NextResponse.json({ error: 'Envie o conteúdo do arquivo markdown' }, { status: 400 });
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      return NextResponse.json(
        { error: `Arquivo muito grande (máximo ${MAX_CONTENT_LENGTH} caracteres)` },
        { status: 400 },
      );
    }

    const parsed = parseScoringMarkdown(content);
    const issues: typeof parsed.issues = [...parsed.issues];

    // ── Formulários conhecidos na seção (nomes → formId) ──
    // Mesma base do GET da seção: scoring salvo + mapeamentos aprendidos,
    // excluindo formulários removidos (LeadFormHidden).
    const hiddenRows = await db.leadFormHidden
      .findMany({ select: { formId: true } })
      .catch(() => [] as Array<{ formId: string }>);
    const hiddenSet = new Set(hiddenRows.map((row) => row.formId));

    const nameToForm = new Map<string, { formId: string; name: string }>();
    const duplicateNames = new Set<string>();
    const registerName = (name: string | null | undefined, candidateFormId: string) => {
      if (!name || !candidateFormId || hiddenSet.has(candidateFormId)) return;
      const key = name.trim().toLowerCase();
      if (!key) return;
      const existing = nameToForm.get(key);
      if (existing && existing.formId !== candidateFormId) duplicateNames.add(key);
      else if (!existing) nameToForm.set(key, { formId: candidateFormId, name });
    };
    const [scoringRows, mappingRows] = await Promise.all([
      db.leadFormScoring.findMany({ select: { formId: true, formName: true } }),
      db.leadFormMapping.findMany({ select: { formId: true, formName: true } }),
    ]);
    for (const row of scoringRows) registerName(row.formName, row.formId);
    for (const row of mappingRows) registerName(row.formName, row.formId);

    // ── Nome do formulário selecionado (para conferência) ──
    let targetName: string | null = null;
    if (formId) {
      if (hiddenSet.has(formId)) {
        return NextResponse.json(
          { error: 'Formulário removido da seção Temperatura — importe-o novamente antes de importar regras' },
          { status: 404 },
        );
      }
      const [scoring, mapping] = await Promise.all([
        db.leadFormScoring.findUnique({ where: { formId }, select: { formName: true } }),
        db.leadFormMapping.findFirst({
          where: { formId },
          select: { formName: true },
          orderBy: { lastSeenAt: 'desc' },
        }),
      ]);
      targetName = scoring?.formName || mapping?.formName || null;
      if (!targetName) {
        issues.push({
          severity: 'warning',
          message: 'O formulário selecionado ainda não tem nome conhecido — confira o arquivo antes de confirmar',
        });
      }
    }

    const matchForm = (formName: string): { status: MatchStatus; formId: string | null } => {
      const key = formName.trim().toLowerCase();
      if (duplicateNames.has(key)) return { status: 'ambiguous', formId: null };
      const hit = nameToForm.get(key);
      if (!hit) return { status: 'not_found', formId: null };
      if (formId && hit.formId === formId) return { status: 'target', formId: hit.formId };
      return { status: 'other', formId: hit.formId };
    };

    // ── Status de match por formulário extraído ──
    const forms = parsed.forms.map((form) => {
      // Conferência direta com o nome do formulário selecionado
      if (formId && targetName && form.formName.trim().toLowerCase() === targetName.trim().toLowerCase()) {
        return { ...form, match: { status: 'target' as MatchStatus, formId } };
      }
      return { ...form, match: matchForm(form.formName) };
    });

    // Avisos de contexto de nome/destino
    if (formId && parsed.forms.length > 1) {
      issues.push({
        severity: 'warning',
        message: `O arquivo contém ${parsed.forms.length} formulários — apenas o formulário selecionado será importado (padrão recomendado: um arquivo por formulário)`,
      });
    }
    if (formId && targetName) {
      const hasTarget = forms.some((form) => form.match.status === 'target');
      if (!hasTarget && parsed.forms.length > 0) {
        const firstName = parsed.forms[0].formName;
        issues.push({
          severity: 'error',
          message:
            firstName !== targetName
              ? `O arquivo descreve o formulário "${firstName}", mas você está importando para "${targetName}" — selecione o arquivo correto ou ajuste o cabeçalho "# Formulário:"`
              : `Nenhum formulário do arquivo corresponde ao formulário selecionado "${targetName}"`,
        });
      }
    }
    for (const form of forms) {
      if (form.match.status === 'other') {
        issues.push({
          severity: 'error',
          formName: form.formName,
          message: `O arquivo descreve o formulário "${form.formName}", que não é o formulário selecionado`,
        });
      } else if (form.match.status === 'not_found') {
        issues.push({
          severity: formId ? 'error' : 'warning',
          formName: form.formName,
          message: `Nenhum formulário na seção Temperatura tem o nome "${form.formName}" — confira o cabeçalho "# Formulário:"`,
        });
      } else if (form.match.status === 'ambiguous') {
        issues.push({
          severity: 'error',
          formName: form.formName,
          message: `Existem múltiplos formulários com o nome "${form.formName}" — resolva a duplicidade antes de importar`,
        });
      }
    }

    // ── Formulário alvo (o que será importado) ──
    let targetIndex: number | null = null;
    if (formId) {
      const idx = forms.findIndex((form) => form.match.status === 'target');
      targetIndex = idx === -1 ? null : idx;
    } else if (forms.length === 1 && forms[0].match.status !== 'ambiguous') {
      targetIndex = 0;
    }

    // ── Validação cruzada com as perguntas OBSERVADAS nos leads ──
    let review: {
      available: boolean;
      message: string | null;
      unknownQuestions: string[];
      unknownAnswers: Array<{ question: string; answers: string[] }>;
    } | null = null;

    if (formId && targetIndex !== null) {
      const targetForm = forms[targetIndex];
      const observed = await getObservedQuestions(formId);
      if (observed.length === 0) {
        review = {
          available: false,
          message:
            'Ainda não há perguntas observadas nos leads deste formulário — a conferência com as respostas reais será possível quando os próximos leads chegarem',
          unknownQuestions: [],
          unknownAnswers: [],
        };
      } else {
        const observedByNorm = new Map(observed.map((q) => [normalizeQuestionKey(q.key), q]));
        const unknownQuestions: string[] = [];
        const unknownAnswers: Array<{ question: string; answers: string[] }> = [];
        for (const question of targetForm.questions) {
          const observedQuestion = observedByNorm.get(normalizeQuestionKey(question.key));
          if (!observedQuestion) {
            unknownQuestions.push(question.key);
            continue;
          }
          // MESMA normalização do motor (normalizeAnswerText): o valor real
          // do field_data pode diferir do texto do markdown (snake_case,
          // acentos, pontuação) sem deixar de ser a mesma resposta
          const observedAnswers = new Set(observedQuestion.answers.map((a) => normalizeAnswerText(a.text)));
          const missing = question.answers
            .map((a) => a.text)
            .filter((text) => !observedAnswers.has(normalizeAnswerText(text)));
          if (missing.length > 0) unknownAnswers.push({ question: question.key, answers: missing });
        }
        review = { available: true, message: null, unknownQuestions, unknownAnswers };
      }
    }

    const errors = issues.filter((issue) => issue.severity === 'error').length;
    return NextResponse.json({
      ok: parsed.ok && errors === 0,
      forms,
      targetIndex,
      issues,
      review,
      stats: {
        errors,
        warnings: issues.length - errors,
        formsInFile: forms.length,
      },
    });
  } catch (err) {
    console.error('[Meta Ads Temperature][import-md][POST] Erro:', err);
    return NextResponse.json({ error: 'Erro ao analisar o arquivo de regras' }, { status: 500 });
  }
}
