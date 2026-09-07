import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';
import {
  parseScoringConfig,
  reclassifyFormLeads,
  invalidateScoringCache,
  sanitizeScoringQuestions,
  type ReclassifyResult,
  type ScoringQuestion,
} from '@/lib/lead-temperature';

// ============================================================
// POST /api/meta-ads/temperature/import-md/apply
// CONFIRMA a importação das regras extraídas do markdown (preview
// aprovado pelo admin). Um arquivo por formulário: o payload contém
// o formId de destino e as perguntas já extraídas pelo parser.
//
// Defesas independentes do preview:
//   - admin obrigatório; formulário removido da seção → 404;
//   - perguntas re-sanitizadas com a MESMA função do PUT manual;
//   - limiares ausentes no arquivo (null) mantêm os valores já
//     configurados (ou 5/10 no primeiro salvamento);
//   - hot >= warm; nenhuma pergunta válida → 400.
// Depois de salvar: invalida o cache e reclassifica os leads já
// capturados quando solicitado (padrão: sim).
// ============================================================

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const { error, session } = await requireAdmin();
  if (error) return error;

  try {
    const body = await request.json().catch(() => null);
    const {
      formId,
      formName,
      enabled = false,
      warmMin = null,
      hotMin = null,
      questions,
      reclassify = true,
    } = body as {
      formId?: string;
      formName?: string;
      enabled?: boolean;
      warmMin?: number | null;
      hotMin?: number | null;
      questions?: ScoringQuestion[];
      reclassify?: boolean;
    };

    // ── Validações ──
    if (!formId || typeof formId !== 'string' || !formId.trim()) {
      return NextResponse.json({ error: 'formId é obrigatório' }, { status: 400 });
    }
    // Formulário removido da seção não é configurável (mesma regra do GET/PUT)
    const hiddenRow = await db.leadFormHidden.findUnique({ where: { formId } }).catch(() => null);
    if (hiddenRow) {
      return NextResponse.json(
        { error: 'Formulário removido da seção Temperatura — importe-o novamente para restaurar' },
        { status: 404 },
      );
    }
    if (!Array.isArray(questions)) {
      return NextResponse.json({ error: 'Envie as perguntas extraídas do arquivo' }, { status: 400 });
    }

    // Mesma sanitização do PUT manual — o parser NUNCA é a última barreira
    const sanitizedQuestions = sanitizeScoringQuestions(questions);
    if (sanitizedQuestions.length === 0) {
      return NextResponse.json(
        { error: 'O arquivo não contém perguntas válidas para importar' },
        { status: 400 },
      );
    }

    // Limiares: valor do arquivo (número) → valor já configurado → padrão 5/10
    const existing = await db.leadFormScoring.findUnique({ where: { formId } });
    const resolveThreshold = (value: number | null | undefined, fallback: number | undefined, def: number) => {
      if (value !== null && value !== undefined && Number.isFinite(Number(value))) return Math.trunc(Number(value));
      if (fallback !== undefined && fallback !== null && Number.isFinite(Number(fallback))) return Math.trunc(Number(fallback));
      return def;
    };
    const warm = resolveThreshold(warmMin, existing?.warmMin, 5);
    const hot = resolveThreshold(hotMin, existing?.hotMin, 10);
    if (hot < warm) {
      return NextResponse.json(
        { error: 'O limiar QUENTE do arquivo não pode ser menor que o limiar MORNO' },
        { status: 400 },
      );
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
        // formName existente é preservado no update (aprendida da Meta)
        enabled: !!enabled,
        warmMin: warm,
        hotMin: hot,
        config: JSON.stringify({ questions: sanitizedQuestions }),
        createdBy: session?.user?.id || null,
      },
    });

    // Cache invalidado: próximos leads já usam a config importada
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
    console.error('[Meta Ads Temperature][import-md/apply][POST] Erro:', err);
    return NextResponse.json({ error: 'Erro ao importar regras de temperatura' }, { status: 500 });
  }
}
