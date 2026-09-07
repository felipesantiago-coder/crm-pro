import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';
import {
  parseScoringConfig,
  reclassifyFormLeads,
  invalidateScoringCache,
  type ReclassifyResult,
  type ScoringQuestion,
} from '@/lib/lead-temperature';
import { isMetaContactField } from '@/lib/meta-lead-utils';

// ============================================================
// GET/PUT/DELETE /api/meta-ads/temperature
// Temperatura do lead POR FORMULÁRIO (Anúncios Meta > Temperatura).
//
// GET            — lista formulários conhecidos + configs + distribuição
// GET ?formId=   — detalhe de um formulário (config + perguntas/respostas
//                  observadas nos leads + estatísticas de score)
// PUT            — salva a config do formulário (notas inteiras por
//                  resposta + limiares) e, opcionalmente, reclassifica
//                  os leads já capturados
// DELETE ?formId=— remove a config (classificações existentes são mantidas)
// ============================================================

export const maxDuration = 60;

/** Limite de perguntas/respostas aceitas na config (defesa contra payload gigante). */
const MAX_QUESTIONS = 100;
const MAX_ANSWERS_PER_QUESTION = 300;
const MAX_TEXT_LENGTH = 500;
/** Quantidade de respostas distintas devolvida por pergunta no GET (top mais comuns). */
const MAX_OBSERVED_ANSWERS = 60;
/** Leads examinados por formulário ao agregar perguntas/respostas observadas. */
const MAX_OBSERVED_LEADS = 2000;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

interface TemperatureCounts {
  QUENTE: number;
  MORNO: number;
  FRIO: number;
  NONE: number;
}

async function getTemperatureCounts(formId: string): Promise<TemperatureCounts> {
  const groups = await db.client.groupBy({
    by: ['metaTemperature'],
    where: { metaFormId: formId },
    _count: true,
  });
  const counts: TemperatureCounts = { QUENTE: 0, MORNO: 0, FRIO: 0, NONE: 0 };
  for (const g of groups) {
    const key = (g.metaTemperature || 'NONE') as keyof TemperatureCounts;
    if (key in counts) counts[key] = g._count;
  }
  return counts;
}

/**
 * Agrega PERGUNTAS/respostas observadas nos leads do formulário
 * (a partir de Client.metaFormData) para o admin pontuar com base
 * no que o formulário realmente pergunta. Dados de contato do Meta
 * (nome, e-mail, telefone, CEP...) gravados por versões anteriores
 * não aparecem — apenas perguntas são configuráveis.
 */
async function getObservedQuestions(formId: string) {
  const clients = await db.client.findMany({
    where: { metaFormId: formId, metaFormData: { not: null } },
    select: { metaFormData: true },
    orderBy: { createdAt: 'desc' },
    take: MAX_OBSERVED_LEADS,
  });

  interface ObservedAnswer { text: string; count: number }
  interface ObservedQuestion { key: string; count: number; answers: Map<string, ObservedAnswer> }
  const questions = new Map<string, ObservedQuestion>();

  for (const client of clients) {
    if (!client.metaFormData) continue;
    let parsed: Array<{ key?: string; values?: string[] }>;
    try {
      parsed = JSON.parse(client.metaFormData);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;

    for (const answer of parsed) {
      // Dados de contato (nome, e-mail, telefone, CEP...) não são perguntas —
      // leads gravados antes do filtro podem tê-los no metaFormData
      if (!answer?.key || isMetaContactField(answer.key)) continue;
      let question = questions.get(answer.key);
      if (!question) {
        question = { key: answer.key, count: 0, answers: new Map() };
        questions.set(answer.key, question);
      }
      question.count += 1;
      for (const value of answer.values || []) {
        const text = String(value);
        if (!text) continue;
        const existing = question.answers.get(text);
        if (existing) existing.count += 1;
        else question.answers.set(text, { text, count: 1 });
      }
    }
  }

  return Array.from(questions.values()).map((question) => {
    const answers = Array.from(question.answers.values()).sort((a, b) => b.count - a.count);
    const top = answers.slice(0, MAX_OBSERVED_ANSWERS);
    const othersCount = answers.slice(MAX_OBSERVED_ANSWERS).reduce((acc, a) => acc + a.count, 0);
    return {
      key: question.key,
      count: question.count,
      answers: top,
      othersCount,
    };
  });
}

// ─────────────────────────────────────────────
// GET — formulários + configs + estatísticas
// ─────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const { searchParams } = new URL(request.url);
    const formId = searchParams.get('formId');

    // ── Detalhe de um formulário ──
    if (formId) {
      const [scoring, mappings, observed, temperatureCounts, scoreGroups, formCount] = await Promise.all([
        db.leadFormScoring.findUnique({ where: { formId } }),
        db.leadFormMapping.findMany({ where: { formId }, orderBy: { lastSeenAt: 'desc' }, take: 1 }),
        getObservedQuestions(formId),
        getTemperatureCounts(formId),
        db.client.groupBy({
          by: ['metaScore'],
          where: { metaFormId: formId, metaScore: { not: null } },
          _count: true,
        }),
        db.client.count({ where: { metaFormId: formId } }),
      ]);

      // Estatísticas de score (apoiam a escolha dos limiares)
      let scoreStats: { min: number; max: number; avg: number | null } | null = null;
      if (scoreGroups.length > 0) {
        const scores = scoreGroups.flatMap((g) =>
          g.metaScore !== null ? Array<number>(g._count).fill(g.metaScore) : [],
        );
        if (scores.length > 0) {
          const min = Math.min(...scores);
          const max = Math.max(...scores);
          const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
          scoreStats = { min, max, avg: Math.round(avg * 10) / 10 };
        }
      }

      return NextResponse.json({
        form: {
          formId,
          formName: scoring?.formName || mappings[0]?.formName || mappings[0]?.campaignName || null,
          leadCount: formCount,
          lastSeenAt: mappings[0]?.lastSeenAt || null,
        },
        scoring: scoring
          ? {
              enabled: scoring.enabled,
              warmMin: scoring.warmMin,
              hotMin: scoring.hotMin,
              reclassifiedAt: scoring.reclassifiedAt,
              updatedAt: scoring.updatedAt,
              questions: parseScoringConfig(scoring.config)?.questions || [],
            }
          : null,
        observed: { questions: observed },
        temperatureCounts,
        scoreStats,
      });
    }

    // ── Lista de todos os formulários conhecidos ──
    // Formulários aprendidos pelo webhook/polling (LeadFormMapping)
    const mappings = await db.leadFormMapping.groupBy({
      by: ['formId'],
      _count: true,
      _max: { lastSeenAt: true },
    });
    // Formulários com leads armazenados (metaFormId) — cobre dados antigos
    const clientForms = await db.client.groupBy({
      by: ['metaFormId'],
      where: { metaFormId: { not: null } },
      _count: true,
    });

    const formMap = new Map<string, { formId: string; formName: string | null; leadCount: number; lastSeenAt: Date | null }>();
    for (const m of mappings) {
      formMap.set(m.formId, { formId: m.formId, formName: null, leadCount: 0, lastSeenAt: m._max.lastSeenAt || null });
    }
    for (const c of clientForms) {
      if (!c.metaFormId) continue;
      const existing = formMap.get(c.metaFormId);
      if (existing) {
        existing.leadCount += c._count;
      } else {
        formMap.set(c.metaFormId, { formId: c.metaFormId, formName: null, leadCount: c._count, lastSeenAt: null });
      }
    }

    // Nomes de formulário (espelho do mapping) + última atividade
    const mappingRows = await db.leadFormMapping.findMany({
      select: { formId: true, formName: true, lastSeenAt: true },
      orderBy: { lastSeenAt: 'desc' },
    });
    for (const row of mappingRows) {
      const entry = formMap.get(row.formId);
      if (entry && !entry.formName && row.formName) entry.formName = row.formName;
      if (entry && !entry.lastSeenAt) entry.lastSeenAt = row.lastSeenAt;
    }

    const formIds = Array.from(formMap.keys());
    const [scorings, temperatureByForm] = await Promise.all([
      db.leadFormScoring.findMany({ where: { formId: { in: formIds } } }),
      db.client.groupBy({
        by: ['metaFormId', 'metaTemperature'],
        where: { metaFormId: { in: formIds } },
        _count: true,
      }),
    ]);
    const scoringByForm = new Map(scorings.map((s) => [s.formId, s]));
    const tempMap = new Map<string, TemperatureCounts>();
    for (const g of temperatureByForm) {
      if (!g.metaFormId) continue;
      const counts = tempMap.get(g.metaFormId) || { QUENTE: 0, MORNO: 0, FRIO: 0, NONE: 0 };
      const key = (g.metaTemperature || 'NONE') as keyof TemperatureCounts;
      if (key in counts) counts[key] = g._count;
      tempMap.set(g.metaFormId, counts);
    }

    const forms = Array.from(formMap.values())
      .map((form) => {
        const scoring = scoringByForm.get(form.formId);
        return {
          ...form,
          scoring: scoring
            ? {
                enabled: scoring.enabled,
                warmMin: scoring.warmMin,
                hotMin: scoring.hotMin,
                updatedAt: scoring.updatedAt,
              }
            : null,
          temperatureCounts: tempMap.get(form.formId) || { QUENTE: 0, MORNO: 0, FRIO: 0, NONE: 0 },
        };
      })
      .sort((a, b) => {
        // Configurados primeiro; depois por volume de leads
        const aCfg = a.scoring ? 1 : 0;
        const bCfg = b.scoring ? 1 : 0;
        if (aCfg !== bCfg) return bCfg - aCfg;
        return b.leadCount - a.leadCount;
      });

    return NextResponse.json({
      forms,
      summary: {
        formsTotal: forms.length,
        configured: forms.filter((f) => f.scoring).length,
        active: forms.filter((f) => f.scoring?.enabled).length,
      },
    });
  } catch (err) {
    console.error('[Meta Ads Temperature][GET] Erro:', err);
    return NextResponse.json({ error: 'Erro ao carregar configurações de temperatura' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────
// PUT — salvar config do formulário
// ─────────────────────────────────────────────

export async function PUT(request: NextRequest) {
  const { error, session } = await requireAdmin();
  if (error) return error;

  try {
    const body = await request.json();
    const {
      formId,
      formName,
      enabled = false,
      warmMin = 5,
      hotMin = 10,
      questions = [],
      reclassify = false,
    } = body as {
      formId?: string;
      formName?: string;
      enabled?: boolean;
      warmMin?: number;
      hotMin?: number;
      questions?: ScoringQuestion[];
      reclassify?: boolean;
    };

    // ── Validações ──
    if (!formId || typeof formId !== 'string' || !formId.trim()) {
      return NextResponse.json({ error: 'formId é obrigatório' }, { status: 400 });
    }
    if (!Number.isInteger(Number(warmMin)) || !Number.isInteger(Number(hotMin))) {
      return NextResponse.json({ error: 'Os limiares devem ser números inteiros' }, { status: 400 });
    }
    const warm = Math.trunc(Number(warmMin));
    const hot = Math.trunc(Number(hotMin));
    if (hot < warm) {
      return NextResponse.json(
        { error: 'O limiar QUENTE não pode ser menor que o limiar MORNO' },
        { status: 400 },
      );
    }
    if (!Array.isArray(questions) || questions.length > MAX_QUESTIONS) {
      return NextResponse.json({ error: `Envie no máximo ${MAX_QUESTIONS} perguntas` }, { status: 400 });
    }

    // Sanitização das perguntas/respostas — notas SEMPRE inteiras
    const sanitizedQuestions: ScoringQuestion[] = [];
    for (const question of questions) {
      if (!question?.key || typeof question.key !== 'string' || !question.key.trim()) continue;
      // Dados de contato do Meta nunca são perguntas — não são salvos na config
      if (isMetaContactField(question.key)) continue;
      const answers = Array.isArray(question.answers)
        ? question.answers
            .filter((a) => a && typeof a.text === 'string' && a.text.trim())
            .slice(0, MAX_ANSWERS_PER_QUESTION)
            .map((a) => ({
              text: a.text.slice(0, MAX_TEXT_LENGTH),
              score: Math.trunc(Number(a.score) || 0),
            }))
        : [];
      const hasQuestionScore =
        question.questionScore !== undefined && question.questionScore !== null && Number.isFinite(Number(question.questionScore));
      sanitizedQuestions.push({
        key: question.key.slice(0, MAX_TEXT_LENGTH),
        ...(typeof question.label === 'string' && question.label.trim()
          ? { label: question.label.slice(0, MAX_TEXT_LENGTH) }
          : {}),
        ...(hasQuestionScore ? { questionScore: Math.trunc(Number(question.questionScore)) } : {}),
        answers,
      });
    }

    const saved = await db.leadFormScoring.upsert({
      where: { formId },
      create: {
        formId,
        formName: formName || null,
        enabled: !!enabled,
        warmMin: warm,
        hotMin: hot,
        config: JSON.stringify({ questions: sanitizedQuestions }),
        createdBy: session?.user?.id || null,
      },
      update: {
        ...(formName !== undefined ? { formName: formName || null } : {}),
        enabled: !!enabled,
        warmMin: warm,
        hotMin: hot,
        config: JSON.stringify({ questions: sanitizedQuestions }),
        createdBy: session?.user?.id || null,
      },
    });

    // Cache invalidado: próximos leads já usam a config nova
    invalidateScoringCache(formId);

    let reclassifyResult: ReclassifyResult | null = null;
    if (reclassify && enabled) {
      reclassifyResult = await reclassifyFormLeads(formId);
    }

    return NextResponse.json({
      ok: true,
      scoring: {
        formId: saved.formId,
        formName: saved.formName,
        enabled: saved.enabled,
        warmMin: saved.warmMin,
        hotMin: saved.hotMin,
        updatedAt: saved.updatedAt,
        questions: parseScoringConfig(saved.config)?.questions || [],
      },
      reclassifyResult,
    });
  } catch (err) {
    console.error('[Meta Ads Temperature][PUT] Erro:', err);
    return NextResponse.json({ error: 'Erro ao salvar configuração de temperatura' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────
// DELETE — remover config do formulário
// ─────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const { searchParams } = new URL(request.url);
    const formId = searchParams.get('formId');
    if (!formId) {
      return NextResponse.json({ error: 'formId é obrigatório' }, { status: 400 });
    }

    await db.leadFormScoring.deleteMany({ where: { formId } });
    invalidateScoringCache(formId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Meta Ads Temperature][DELETE] Erro:', err);
    return NextResponse.json({ error: 'Erro ao remover configuração' }, { status: 500 });
  }
}
