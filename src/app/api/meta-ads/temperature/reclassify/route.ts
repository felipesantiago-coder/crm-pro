import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { reclassifyFormLeads, getFormScoring } from '@/lib/lead-temperature';

// ============================================================
// POST /api/meta-ads/temperature/reclassify
// Reclassifica retroativamente TODOS os leads de um formulário
// com a config atual (Anúncios Meta > Temperatura > Reclassificar).
//
// Body: { formId: string }
// ============================================================

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await request.json();
    const { formId } = body as { formId?: string };

    if (!formId || typeof formId !== 'string' || !formId.trim()) {
      return NextResponse.json({ error: 'formId é obrigatório' }, { status: 400 });
    }

    const scoring = await getFormScoring(formId);
    if (!scoring) {
      return NextResponse.json(
        { error: 'Este formulário ainda não possui configuração de temperatura' },
        { status: 404 },
      );
    }
    if (!scoring.enabled) {
      return NextResponse.json(
        { error: 'A pontuação deste formulário está desativada. Ative-a antes de reclassificar.' },
        { status: 400 },
      );
    }

    const result = await reclassifyFormLeads(formId);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error('[Meta Ads Temperature][Reclassify] Erro:', err);
    return NextResponse.json({ error: 'Erro ao reclassificar leads' }, { status: 500 });
  }
}
