import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';

// ============================================================
// GET/PUT /api/cron/fetch-meta-leads/config
//
// CONFIGURAÇÃO EXCLUSIVAMENTE POR CONTA: o polling global (toggle +
// form IDs globais) NÃO existe mais. Cada conta de anúncios tem o
// próprio toggle (pollingEnabled) e os próprios formIds — configurados
// no card da conta (Anúncios Meta > Contas de Anúncio > aba Polling).
//
// GET  — observabilidade: último run/resultado + resumo das contas
// PUT  — removido (retorna 400 explicando o novo modelo por conta)
// ============================================================

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const settings = await db.userSettings.findMany({
    where: { key: { in: ['meta_polling_last_run', 'meta_polling_last_result'] } },
    select: { key: true, value: true },
  });

  const map: Record<string, string> = {};
  settings.forEach(s => { map[s.key] = s.value; });

  // Parsear lastResult de forma segura — não retornar dados brutos
  let lastResult: { timestamp?: string; totalFetched?: number; totalImported?: number; errorCount?: number; elapsed?: number; forms?: number; accounts?: number } | null = null;
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
        accounts: typeof raw.accounts === 'number' ? raw.accounts : undefined,
      };
    }
  } catch {}

  // Resumo das contas (fonte da configuração de polling)
  let accounts = { total: 0, enabled: 0, pollingEnabled: 0, withForms: 0 };
  try {
    const rows = await db.metaAdAccount.findMany({
      select: { enabled: true, pollingEnabled: true, formIds: true },
    });
    accounts = {
      total: rows.length,
      enabled: rows.filter(r => r.enabled).length,
      pollingEnabled: rows.filter(r => r.enabled && r.pollingEnabled !== false).length,
      withForms: rows.filter(r => r.enabled && r.pollingEnabled !== false && (r.formIds || '').length > 2).length,
    };
  } catch { /* migration pendente — mantém zeros */ }

  return NextResponse.json({
    lastRun: map['meta_polling_last_run'] || null,
    lastResult,
    accounts,
  });
}

export async function PUT(request: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  return NextResponse.json(
    {
      error:
        'A configuração global de polling foi removida. O polling é configurado POR CONTA: Anúncios Meta > Contas de Anúncio > card da conta > aba Polling (toggle + Sync Forms).',
    },
    { status: 400 },
  );
}
