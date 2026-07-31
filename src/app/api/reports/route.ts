import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const currentUser = await db.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true, name: true },
    });

    if (!currentUser) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || 'monthly';
    const customFrom = searchParams.get('from') || '';
    const customTo = searchParams.get('to') || '';

    // Calculate date range
    const now = new Date();
    let startDate: Date;
    let endDate: Date;
    let periodLabel: string;

    if (customFrom && customTo) {
      startDate = new Date(customFrom);
      endDate = new Date(customTo);
      endDate.setHours(23, 59, 59, 999);
      periodLabel = `${startDate.toLocaleDateString('pt-BR')} a ${endDate.toLocaleDateString('pt-BR')}`;
    } else {
      switch (period) {
        case 'weekly': {
          const dayOfWeek = now.getDay();
          startDate = new Date(now);
          startDate.setDate(now.getDate() - dayOfWeek);
          startDate.setHours(0, 0, 0, 0);
          endDate = new Date(startDate);
          endDate.setDate(startDate.getDate() + 6);
          endDate.setHours(23, 59, 59, 999);
          periodLabel = `Semana de ${startDate.toLocaleDateString('pt-BR')}`;
          break;
        }
        case 'monthly': {
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
          const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
          periodLabel = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
          break;
        }
        case 'quarterly': {
          const quarter = Math.floor(now.getMonth() / 3);
          startDate = new Date(now.getFullYear(), quarter * 3, 1);
          endDate = new Date(now.getFullYear(), quarter * 3 + 3, 0, 23, 59, 59, 999);
          periodLabel = `${quarter + 1}º Trimestre ${now.getFullYear()}`;
          break;
        }
        case 'semiannual': {
          const half = now.getMonth() < 6 ? 1 : 2;
          startDate = new Date(now.getFullYear(), half === 1 ? 0 : 6, 1);
          endDate = new Date(now.getFullYear(), half === 1 ? 5 : 11, 30, 23, 59, 59, 999);
          periodLabel = `${half}º Semestre ${now.getFullYear()}`;
          break;
        }
        case 'annual': {
          startDate = new Date(now.getFullYear(), 0, 1);
          endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
          periodLabel = `${now.getFullYear()}`;
          break;
        }
        default: {
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
          periodLabel = `Mês atual`;
        }
      }
    }

    const isAdmin = currentUser.role === 'ADMIN';
    const userId = currentUser.id;

    // Access filter for raw SQL
    const accessClause = isAdmin
      ? Prisma.sql`1=1`
      : Prisma.sql`(c."created_by" = ${userId} OR EXISTS (
        SELECT 1 FROM client_partners cp WHERE cp."client_id" = c.id AND cp."user_id" = ${userId}
      ))`;

    // Run all queries in parallel
    const [
      clientsCreatedRaw,
      interactionsRaw,
      schedulesRaw,
      remindersRaw,
      stageChangesRaw,
      dailyActivityRaw,
    ] = await Promise.all([
      // 1. New clients in period
      db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint as count FROM clients c
        WHERE c."created_at" >= ${startDate} AND c."created_at" <= ${endDate}
          AND ${accessClause}
      `),

      // 2. Interactions in period
      db.$queryRaw<Array<{ count: bigint; clientId: string; clientName: string; description: string; createdAt: string }[]>>(Prisma.sql`
        SELECT i."client_id" as "clientId", c.name as "clientName", 
               LEFT(i.description, 80) as description, 
               i."created_at" as "createdAt"
        FROM interactions i
        JOIN clients c ON i."client_id" = c.id
        WHERE i."created_at" >= ${startDate} AND i."created_at" <= ${endDate}
          AND ${accessClause}
        ORDER BY i."created_at" DESC
        LIMIT 50
      `),

      // 3. Schedules in period
      db.$queryRaw<Array<{ total: bigint; completed: bigint; pending: bigint; cancelled: bigint }>>(Prisma.sql`
        SELECT 
          COUNT(*)::bigint as total,
          COUNT(*) FILTER (WHERE s.status = 'COMPLETED')::bigint as completed,
          COUNT(*) FILTER (WHERE s.status = 'PENDING')::bigint as pending,
          COUNT(*) FILTER (WHERE s.status = 'CANCELLED')::bigint as cancelled
        FROM schedules s
        JOIN clients c ON s."client_id" = c.id
        WHERE s."created_at" >= ${startDate} AND s."created_at" <= ${endDate}
          AND ${accessClause}
      `),

      // 4. Reminders in period
      db.$queryRaw<Array<{ total: bigint; completed: bigint; pending: bigint }>>(Prisma.sql`
        SELECT 
          COUNT(*)::bigint as total,
          COUNT(*) FILTER (WHERE r.notified = true)::bigint as completed,
          COUNT(*) FILTER (WHERE r.notified = false)::bigint as pending
        FROM reminders r
        JOIN clients c ON r."client_id" = c.id
        WHERE r."created_at" >= ${startDate} AND r."created_at" <= ${endDate}
          AND ${accessClause}
      `),

      // 5. Stage distribution at end of period
      db.$queryRaw<Array<{ stage: string; count: bigint }>>(Prisma.sql`
        SELECT c.stage, COUNT(*)::bigint as count 
        FROM clients c
        WHERE ${accessClause}
        GROUP BY c.stage
        ORDER BY count DESC
      `),

      // 6. Daily activity breakdown
      db.$queryRaw<Array<{ date: string; newClients: bigint; interactions: bigint; schedules: bigint; reminders: bigint }>>(Prisma.sql`
        SELECT 
          d.date,
          COALESCE(cc.count, 0)::bigint as "newClients",
          COALESCE(ic.count, 0)::bigint as interactions,
          COALESCE(sc.count, 0)::bigint as schedules,
          COALESCE(rc.count, 0)::bigint as reminders
        FROM (
          SELECT generate_series(
            ${startDate}::date,
            ${endDate}::date,
            '1 day'::interval
          )::date as date
        ) d
        LEFT JOIN (
          SELECT "created_at"::date as date, COUNT(*) as count 
          FROM clients WHERE "created_at" >= ${startDate} AND "created_at" <= ${endDate}
            AND ${accessClause}
          GROUP BY 1
        ) cc ON cc.date = d.date
        LEFT JOIN (
          SELECT i."created_at"::date as date, COUNT(*) as count 
          FROM interactions i JOIN clients c ON i."client_id" = c.id
          WHERE i."created_at" >= ${startDate} AND i."created_at" <= ${endDate}
            AND ${accessClause}
          GROUP BY 1
        ) ic ON ic.date = d.date
        LEFT JOIN (
          SELECT s."created_at"::date as date, COUNT(*) as count 
          FROM schedules s JOIN clients c ON s."client_id" = c.id
          WHERE s."created_at" >= ${startDate} AND s."created_at" <= ${endDate}
            AND ${accessClause}
          GROUP BY 1
        ) sc ON sc.date = d.date
        LEFT JOIN (
          SELECT r."created_at"::date as date, COUNT(*) as count 
          FROM reminders r JOIN clients c ON r."client_id" = c.id
          WHERE r."created_at" >= ${startDate} AND r."created_at" <= ${endDate}
            AND ${accessClause}
          GROUP BY 1
        ) rc ON rc.date = d.date
        ORDER BY d.date ASC
      `),
    ]);

    // Count total interactions (not just the 50 sampled)
    const interactionsCountRaw = await db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint as count
      FROM interactions i
      JOIN clients c ON i."client_id" = c.id
      WHERE i."created_at" >= ${startDate} AND i."created_at" <= ${endDate}
        AND ${accessClause}
    `);

    const totalInteractions = Number(interactionsCountRaw[0]?.count || 0);

    // Clients who had stage changes in period (closed won / lost)
    const closedResults = await db.$queryRaw<Array<{ stage: string; count: bigint }>>(Prisma.sql`
      SELECT c.stage, COUNT(*)::bigint as count 
      FROM clients c
      WHERE c."updated_at" >= ${startDate} AND c."updated_at" <= ${endDate}
        AND c.stage IN ('FECHADO_GANHO', 'FECHADO_PERDIDO')
        AND ${accessClause}
      GROUP BY c.stage
    `);

    const wonInPeriod = Number(closedResults.find(r => r.stage === 'FECHADO_GANHO')?.count || 0);
    const lostInPeriod = Number(closedResults.find(r => r.stage === 'FECHADO_PERDIDO')?.count || 0);

    // Top interacted clients
    const topClientsRaw = await db.$queryRaw<Array<{ clientName: string; interactionCount: bigint; lastInteraction: string }>>(Prisma.sql`
      SELECT c.name as "clientName", COUNT(i.id)::bigint as "interactionCount", 
             MAX(i."created_at") as "lastInteraction"
      FROM interactions i
      JOIN clients c ON i."client_id" = c.id
      WHERE i."created_at" >= ${startDate} AND i."created_at" <= ${endDate}
        AND ${accessClause}
      GROUP BY c.name
      ORDER BY "interactionCount" DESC
      LIMIT 10
    `);

    return NextResponse.json({
      period: periodLabel,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      summary: {
        newClients: Number(clientsCreatedRaw[0]?.count || 0),
        totalInteractions,
        schedulesCreated: Number(schedulesRaw[0]?.total || 0),
        schedulesCompleted: Number(schedulesRaw[0]?.completed || 0),
        schedulesPending: Number(schedulesRaw[0]?.pending || 0),
        schedulesCancelled: Number(schedulesRaw[0]?.cancelled || 0),
        remindersCreated: Number(remindersRaw[0]?.total || 0),
        remindersCompleted: Number(remindersRaw[0]?.completed || 0),
        remindersPending: Number(remindersRaw[0]?.pending || 0),
        wonDeals: wonInPeriod,
        lostDeals: lostInPeriod,
      },
      stageDistribution: stageChangesRaw.map(r => ({
        stage: r.stage,
        count: Number(r.count),
      })),
      dailyActivity: dailyActivityRaw.map(r => ({
        date: r.date,
        newClients: Number(r.newClients),
        interactions: Number(r.interactions),
        schedules: Number(r.schedules),
        reminders: Number(r.reminders),
      })),
      recentInteractions: interactionsRaw.map(r => ({
        clientName: r.clientName,
        description: r.description,
        createdAt: r.createdAt,
      })),
      topClients: topClientsRaw.map(r => ({
        clientName: r.clientName,
        interactionCount: Number(r.interactionCount),
        lastInteraction: r.lastInteraction,
      })),
    });
  } catch (error) {
    console.error('[REPORTS] Erro:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
