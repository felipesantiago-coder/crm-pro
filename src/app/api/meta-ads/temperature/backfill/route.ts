import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import {
  discoverLegacyForms,
  backfillFormLeads,
  type DiscoveryResult,
  type BackfillResult,
} from '@/lib/lead-temperature-backfill';

// ============================================================
// GET/POST /api/meta-ads/temperature/backfill
// Recupera perguntas/respostas de FORMULÁRIOS IMPORTADOS ANTES
// do recurso de temperatura — sem aguardar novos leads e sem
// chamadas ao Meta, usando apenas o que já foi recebido:
//   GET  — descobre formulários citados nas notes de leads antigos
//          (somente leitura; agrupa por formId)
//   POST — vincula os leads antigos de UM formulário (formId no
//          body) e reconstrói metaFormData a partir das notes;
//          depois disso as perguntas aparecem no painel para o
//          admin atribuir as notas, e a reclassificação retroativa
//          passa a cobrir esses leads
// ============================================================

export const maxDuration = 60;

// ─────────────────────────────────────────────
// GET — descoberta de formulários em leads antigos
// ─────────────────────────────────────────────

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const discovery: DiscoveryResult = await discoverLegacyForms();
    return NextResponse.json(discovery);
  } catch (err) {
    console.error('[Meta Ads Temperature][Backfill][GET] Erro:', err);
    return NextResponse.json({ error: 'Erro ao buscar formulários em leads antigos' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────
// POST — vincular leads antigos de um formulário
// ─────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const body = await request.json().catch(() => ({}));
    const formId = (body as { formId?: string })?.formId;
    if (!formId || typeof formId !== 'string' || !formId.trim()) {
      return NextResponse.json({ error: 'formId é obrigatório' }, { status: 400 });
    }

    const result: BackfillResult = await backfillFormLeads(formId.trim());
    return NextResponse.json({ ok: true, formId, result });
  } catch (err) {
    console.error('[Meta Ads Temperature][Backfill][POST] Erro:', err);
    return NextResponse.json({ error: 'Erro ao vincular leads antigos do formulário' }, { status: 500 });
  }
}
