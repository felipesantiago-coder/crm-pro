import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';

// ============================================================
// GET/PUT /api/cron/fetch-meta-leads/config
//
// Gerencia a configuração do polling automático de leads.
// Requer autenticação de admin.
//
// GET  — retorna config atual + último resultado
// PUT  — atualiza config (body: { enabled, formIds })
// ============================================================

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const settings = await db.userSettings.findMany({
    where: { key: { in: ['meta_polling_enabled', 'meta_polling_form_ids', 'meta_polling_last_run', 'meta_polling_last_result'] } },
  });

  const map: Record<string, string> = {};
  settings.forEach(s => { map[s.key] = s.value; });

  let formIds: string[] = [];
  try { formIds = JSON.parse(map['meta_polling_form_ids'] || '[]'); } catch {}

  let lastResult: any = null;
  try { lastResult = JSON.parse(map['meta_polling_last_result'] || 'null'); } catch {}

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

  // Salvar configurações
  await db.userSettings.upsert({
    where: { key: 'meta_polling_enabled' },
    update: { value: String(enabled) },
    create: { key: 'meta_polling_enabled', value: String(enabled) },
  });

  await db.userSettings.upsert({
    where: { key: 'meta_polling_form_ids' },
    update: { value: JSON.stringify(formIds) },
    create: { key: 'meta_polling_form_ids', value: JSON.stringify(formIds) },
  });

  console.log(`[Meta Polling Config] Atualizado: enabled=${enabled}, formIds=[${formIds.join(', ')}]`);

  return NextResponse.json({ success: true, enabled, formIds });
}
