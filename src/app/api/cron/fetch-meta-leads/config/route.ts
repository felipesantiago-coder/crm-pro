import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';

// ============================================================
// GET/PUT /api/cron/fetch-meta-leads/config
//
// Gerencia a configuração do polling automático de leads.
// Requer autenticação de admin.
//
// GET  — retorna config atual + último resultado (resumido)
// PUT  — atualiza config (body: { enabled, formIds })
// ============================================================

const MAX_FORM_IDS = 20;
const FORM_ID_PATTERN = /^[0-9]+$/;

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const settings = await db.userSettings.findMany({
    where: { key: { in: ['meta_polling_enabled', 'meta_polling_form_ids', 'meta_polling_last_run', 'meta_polling_last_result'] } },
    select: { key: true, value: true },
  });

  const map: Record<string, string> = {};
  settings.forEach(s => { map[s.key] = s.value; });

  let formIds: string[] = [];
  try { formIds = JSON.parse(map['meta_polling_form_ids'] || '[]'); } catch {}

  // Parsear lastResult de forma segura — não retornar dados brutos
  let lastResult: { timestamp?: string; totalFetched?: number; totalImported?: number; errorCount?: number; elapsed?: number; forms?: number } | null = null;
  try {
    const raw = JSON.parse(map['meta_polling_last_result'] || 'null');
    if (raw && typeof raw === 'object') {
      lastResult = {
        timestamp: raw.timestamp,
        totalFetched: typeof raw.totalFetched === 'number' ? raw.totalFetched : undefined,
        totalImported: typeof raw.totalImported === 'number' ? raw.totalImported : undefined,
        errorCount: typeof raw.errorCount === 'number' ? raw.errorCount : (typeof raw.errors === 'number' ? raw.errors : undefined),
        elapsed: typeof raw.elapsed === 'number' ? raw.elapsed : undefined,
        forms: typeof raw.forms === 'number' ? raw.forms : undefined,
      };
    }
  } catch {}

  return NextResponse.json({
    enabled: map['meta_polling_enabled'] === 'true',
    formIds,
    lastRun: map['meta_polling_last_run'] || null,
    lastResult,
  });
}

export async function PUT(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const body = await request.json();
  const { enabled, formIds } = body as { enabled?: boolean; formIds?: string[] };

  if (typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled deve ser boolean (true/false)' }, { status: 400 });
  }
  if (!Array.isArray(formIds) || formIds.some(f => typeof f !== 'string' || !f.trim())) {
    return NextResponse.json({ error: 'formIds deve ser um array de strings não vazias' }, { status: 400 });
  }
  if (formIds.length > MAX_FORM_IDS) {
    return NextResponse.json({ error: `Máximo de ${MAX_FORM_IDS} formulários permitidos` }, { status: 400 });
  }
  if (formIds.some(id => !FORM_ID_PATTERN.test(id.trim()))) {
    return NextResponse.json({ error: 'Cada form ID deve conter apenas números' }, { status: 400 });
  }

  const sanitized = formIds.map(id => id.trim());

  // Salvar configurações
  await db.userSettings.upsert({
    where: { key: 'meta_polling_enabled' },
    update: { value: String(enabled) },
    create: { key: 'meta_polling_enabled', value: String(enabled) },
  });

  await db.userSettings.upsert({
    where: { key: 'meta_polling_form_ids' },
    update: { value: JSON.stringify(sanitized) },
    create: { key: 'meta_polling_form_ids', value: JSON.stringify(sanitized) },
  });

  console.log(`[Meta Polling Config] Atualizado: enabled=${enabled}, formIds=[${sanitized.join(', ')}]`);

  return NextResponse.json({ success: true, enabled, formIds: sanitized });
}
