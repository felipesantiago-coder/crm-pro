import { NextResponse } from 'next/server';
import { checkAndNotifyUpcomingSchedules, checkAndNotifyDueReminders } from '@/lib/notifications';

/**
 * GET /api/notifications/cron
 *
 * Endpoint invocado pelo Vercel Cron (ou manualmente) para verificar:
 * 1. Agendamentos de visitas próximos (próximas 24h)
 * 2. Lembretes vencidos (não notificados ainda)
 *
 * Protegido por CRON_SECRET para evitar acesso não autorizado.
 */
export async function GET(request: Request) {
  try {
    // Validação de segurança — apenas Vercel Cron ou chave válida
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    // Executar verificações em paralelo
    const [schedulesResult, remindersResult] = await Promise.all([
      checkAndNotifyUpcomingSchedules(),
      checkAndNotifyDueReminders(),
    ]);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      schedules: {
        checked: schedulesResult.length,
        notified: schedulesResult.reduce((sum, r) => sum + r.notified, 0),
        details: schedulesResult,
      },
      reminders: {
        checked: remindersResult.length,
        notified: remindersResult.reduce((sum, r) => sum + r.notified, 0),
        details: remindersResult,
      },
    });
  } catch (error) {
    console.error('[CRON] Erro geral:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor', details: String(error) },
      { status: 500 }
    );
  }
}
