import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const STAGES = [
  'LEAD',
  'PROSPECT',
  'VISITA_AGENDADA',
  'VISITA_REALIZADA',
  'CARTA_PROPOSTA',
  'CONTRATO_GERADO',
  'FECHADO_GANHO',
  'FECHADO_PERDIDO',
] as const;

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const currentUser = await db.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true },
    });

    if (!currentUser) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    const isAdmin = currentUser.role === 'ADMIN';
    const accessFilter = isAdmin
      ? {}
      : {
          OR: [
            { createdBy: currentUser.id },
            { partners: { some: { userId: currentUser.id } } },
          ],
        };

    // 1. Contagem por estágio (funil)
    const stageCounts = await db.client.groupBy({
      by: ['stage'],
      where: accessFilter,
      _count: { stage: true },
    });

    const stageMap: Record<string, number> = {};
    for (const s of STAGES) {
      stageMap[s] = 0;
    }
    for (const sc of stageCounts) {
      if (sc.stage && STAGES.includes(sc.stage as typeof STAGES[number])) {
        stageMap[sc.stage] = sc._count.stage;
      }
    }

    const funnel = STAGES.map((stage) => ({
      stage,
      count: stageMap[stage] || 0,
    }));

    // 2. Total de clientes
    const totalClients = Object.values(stageMap).reduce((a, b) => a + b, 0);

    // 3. Conversão global: % de FECHADO_GANHO sobre LEAD
    const conversionRate =
      totalClients > 0
        ? Math.round(((stageMap['FECHADO_GANHO'] || 0) / totalClients) * 100)
        : 0;

    // 4. Agendamentos: pendentes, concluídos, cancelados, atrasados
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [pendingSchedules, completedSchedules, cancelledSchedules, overdueSchedules] =
      await Promise.all([
        db.schedule.count({
          where: {
            status: 'PENDING',
            scheduledDate: { gte: todayStart },
            ...accessFilter,
          },
        }),
        db.schedule.count({
          where: {
            status: 'COMPLETED',
            ...accessFilter,
          },
        }),
        db.schedule.count({
          where: {
            status: 'CANCELLED',
            ...accessFilter,
          },
        }),
        db.schedule.count({
          where: {
            status: 'PENDING',
            scheduledDate: { lt: todayStart },
            ...accessFilter,
          },
        }),
      ]);

    // 5. Taxa de conclusão de visitas
    const totalSchedules =
      pendingSchedules + completedSchedules + cancelledSchedules + overdueSchedules;
    const completionRate =
      totalSchedules > 0
        ? Math.round(((completedSchedules + overdueSchedules) / totalSchedules) * 100)
        : 0;

    // 6. Visitas este mês
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const visitsThisMonth = await db.schedule.count({
      where: {
        scheduledDate: { gte: monthStart, lt: monthEnd },
        ...accessFilter,
      },
    });

    // 7. Visitas realizadas este mês
    const completedThisMonth = await db.schedule.count({
      where: {
        status: 'COMPLETED',
        completedAt: { gte: monthStart, lt: monthEnd },
        ...accessFilter,
      },
    });

    // 8. Novos clientes este mês
    const newClientsThisMonth = await db.client.count({
      where: {
        createdAt: { gte: monthStart, lt: monthEnd },
        ...accessFilter,
      },
    });

    // 9. Clientes por região (top 5)
    const regionData = await db.client.groupBy({
      by: ['region'],
      where: {
        ...accessFilter,
        region: { not: null },
      },
      _count: { region: true },
      orderBy: { _count: { region: 'desc' } },
      take: 5,
    });

    // 10. Últimos 6 meses: novos clientes por mês (tendência)
    // FIX: Usar $queryRaw com Prisma.sql (parameterizado) ao invés de $queryRawUnsafe
    const monthlyClients = isAdmin
      ? await db.$queryRaw<Array<{ month: string; count: bigint }>>(
          Prisma.sql`
            SELECT
              TO_CHAR("created_at", 'YYYY-MM') as month,
              COUNT(*)::bigint as count
            FROM clients
            WHERE "created_at" >= NOW() - INTERVAL '6 months'
            GROUP BY TO_CHAR("created_at", 'YYYY-MM')
            ORDER BY month ASC
          `
        )
      : await db.$queryRaw<Array<{ month: string; count: bigint }>>(
          Prisma.sql`
            SELECT
              TO_CHAR("created_at", 'YYYY-MM') as month,
              COUNT(*)::bigint as count
            FROM clients
            WHERE "created_at" >= NOW() - INTERVAL '6 months'
              AND ("created_by" = ${currentUser.id} OR EXISTS (
                SELECT 1 FROM client_partners cp WHERE cp."client_id" = clients.id AND cp."user_id" = ${currentUser.id}
              ))
            GROUP BY TO_CHAR("created_at", 'YYYY-MM')
            ORDER BY month ASC
          `
        );

    // 11. Atividade semanal (interações)
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    // FIX: Usar $queryRaw com Prisma.sql (parameterizado)
    const [interactionsThisWeek] = isAdmin
      ? await db.$queryRaw<Array<{ count: bigint }>>(
          Prisma.sql`
            SELECT COUNT(*)::bigint as count
            FROM interactions i
            JOIN clients c ON i."client_id" = c.id
            WHERE i."created_at" >= ${weekStart.toISOString()}
          `
        )
      : await db.$queryRaw<Array<{ count: bigint }>>(
          Prisma.sql`
            SELECT COUNT(*)::bigint as count
            FROM interactions i
            JOIN clients c ON i."client_id" = c.id
            WHERE i."created_at" >= ${weekStart.toISOString()}
              AND (c."created_by" = ${currentUser.id} OR EXISTS (
                SELECT 1 FROM client_partners cp WHERE cp."client_id" = c.id AND cp."user_id" = ${currentUser.id}
              ))
          `
        );

    // 12. Ganhos vs Perdidos
    const wonCount = stageMap['FECHADO_GANHO'] || 0;
    const lostCount = stageMap['FECHADO_PERDIDO'] || 0;
    const winRate =
      wonCount + lostCount > 0
        ? Math.round((wonCount / (wonCount + lostCount)) * 100)
        : 0;

    return NextResponse.json({
      funnel,
      totalClients,
      conversionRate,
      schedules: {
        pending: pendingSchedules,
        completed: completedSchedules,
        cancelled: cancelledSchedules,
        overdue: overdueSchedules,
        completionRate,
      },
      thisMonth: {
        newClients: newClientsThisMonth,
        visitsScheduled: visitsThisMonth,
        visitsCompleted: completedThisMonth,
      },
      regions: regionData.map((r) => ({
        name: r.region || 'Sem região',
        count: r._count.region,
      })),
      monthlyClients: monthlyClients.map((m) => ({
        month: m.month,
        count: Number(m.count),
      })),
      interactionsThisWeek: Number(interactionsThisWeek?.count || 0),
      winRate,
      wonCount,
      lostCount,
    });
  } catch (error) {
    console.error('Erro ao buscar analytics:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}
