import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';
import { Prisma } from '@prisma/client';

const PERIOD_DAYS: Record<string, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export async function GET(request: Request) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const { searchParams } = new URL(request.url);
    const campaign = searchParams.get('campaign');
    if (!campaign) {
      return NextResponse.json(
        { error: 'Missing required query param: campaign' },
        { status: 400 },
      );
    }

    const period = PERIOD_DAYS[searchParams.get('period') ?? '30d'] ?? 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - period);
    startDate.setHours(0, 0, 0, 0);

    // Run independent queries in parallel
    const [metrics, dailyTrend, creatives, leadVisitorIds] = await Promise.all([
      // ── 1. Campaign metrics + avg time to conversion ──
      db.$queryRaw<
        Array<{
          visitors: bigint;
          pageviews: bigint;
          leads: bigint;
          avgMinutes: number | null;
        }>
      >(
        Prisma.sql`
          SELECT
            COUNT(DISTINCT e."visitorId")::bigint AS visitors,
            COUNT(*) FILTER (WHERE e."eventType" = 'pageview')::bigint AS pageviews,
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN e."visitorId" END)::bigint AS leads,
            (
              SELECT AVG(EXTRACT(EPOCH FROM (first_lead - first_pv)) / 60)
              FROM (
                SELECT
                  "visitorId",
                  MIN("createdAt") FILTER (WHERE "eventType" = 'pageview') AS first_pv,
                  MIN("createdAt") FILTER (WHERE "eventType" = 'lead')    AS first_lead
                FROM tracking_events
                WHERE "utmCampaign" = ${campaign}
                  AND "createdAt" >= ${startDate}::timestamptz
                GROUP BY "visitorId"
                HAVING COUNT(*) FILTER (WHERE "eventType" = 'pageview') > 0
                   AND COUNT(*) FILTER (WHERE "eventType" = 'lead') > 0
              ) t
            ) AS "avgMinutes"
          FROM tracking_events e
          LEFT JOIN tracking_visitors v ON v."visitorId" = e."visitorId"
          WHERE e."utmCampaign" = ${campaign}
            AND e."createdAt" >= ${startDate}::timestamptz
        `,
      ),

      // ── 2. Daily trend ──
      db.$queryRaw<
        Array<{
          date: string;
          visitors: bigint;
          leads: bigint;
        }>
      >(
        Prisma.sql`
          SELECT
            TO_CHAR(e."createdAt", 'YYYY-MM-DD') AS date,
            COUNT(DISTINCT e."visitorId")::bigint AS visitors,
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN e."visitorId" END)::bigint AS leads
          FROM tracking_events e
          LEFT JOIN tracking_visitors v ON v."visitorId" = e."visitorId"
          WHERE e."utmCampaign" = ${campaign}
            AND e."createdAt" >= ${startDate}::timestamptz
          GROUP BY TO_CHAR(e."createdAt", 'YYYY-MM-DD')
          ORDER BY date
        `,
      ),

      // ── 3. Creative (UTM content) breakdown ──
      db.$queryRaw<
        Array<{
          content: string;
          visitors: bigint;
          leads: bigint;
        }>
      >(
        Prisma.sql`
          SELECT
            COALESCE(e."utmContent", '(none)') AS content,
            COUNT(DISTINCT e."visitorId")::bigint AS visitors,
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN e."visitorId" END)::bigint AS leads
          FROM tracking_events e
          LEFT JOIN tracking_visitors v ON v."visitorId" = e."visitorId"
          WHERE e."utmCampaign" = ${campaign}
            AND e."createdAt" >= ${startDate}::timestamptz
          GROUP BY COALESCE(e."utmContent", '(none)')
          ORDER BY visitors DESC
        `,
      ),

      // ── 4. Visitor IDs that have a lead event in this campaign (for journeys) ──
      db.$queryRaw<Array<{ visitorId: string }>>(
        Prisma.sql`
          SELECT DISTINCT e."visitorId"
          FROM tracking_events e
          LEFT JOIN tracking_visitors v ON v."visitorId" = e."visitorId"
          WHERE e."utmCampaign" = ${campaign}
            AND e."createdAt" >= ${startDate}::timestamptz
            AND v."leadId" IS NOT NULL
          ORDER BY "visitorId"
          LIMIT 50
        `,
      ),
    ]);

    // ── 5. Fetch full event journeys for lead visitors ──
    let leadJourneys: Array<{
      visitorId: string;
      leadId: string | null;
      events: Array<{ eventType: string; pageUrl: string | null; createdAt: string }>;
    }> = [];

    if (leadVisitorIds.length > 0) {
      const ids = leadVisitorIds.map((r) => r.visitorId);
      const journeyEvents = await db.$queryRaw<
        Array<{
          visitorId: string;
          leadId: string | null;
          eventType: string;
          pageUrl: string | null;
          createdAt: Date;
        }>
      >(
        Prisma.sql`
          SELECT
            v."visitorId",
            v."leadId",
            e."eventType",
            e."pageUrl",
            e."createdAt"
          FROM tracking_events e
          JOIN tracking_visitors v ON v."visitorId" = e."visitorId"
          WHERE e."visitorId" IN (${Prisma.join(ids)})
          ORDER BY v."visitorId", e."createdAt" ASC
        `,
      );

      // Group by visitor
      const grouped = new Map<string, typeof journeyEvents>();
      for (const row of journeyEvents) {
        const existing = grouped.get(row.visitorId) ?? [];
        existing.push(row);
        grouped.set(row.visitorId, existing);
      }

      leadJourneys = Array.from(grouped.entries()).map(([vid, events]) => ({
        visitorId: vid,
        leadId: events[0]?.leadId ?? null,
        events: events.map((e) => ({
          eventType: e.eventType,
          pageUrl: e.pageUrl,
          createdAt: e.createdAt.toISOString(),
        })),
      }));
    }

    // ── Assemble response ──
    const m = metrics[0]!;
    const visitorCount = Number(m.visitors);
    const leadCount = Number(m.leads);

    return NextResponse.json({
      campaign,
      metrics: {
        visitors: visitorCount,
        pageviews: Number(m.pageviews),
        leads: leadCount,
        conversionRate: visitorCount > 0 ? round2((leadCount / visitorCount) * 100) : 0,
        avgTimeToConversion: m.avgMinutes !== null ? round2(m.avgMinutes) : 0,
      },
      dailyTrend: dailyTrend.map((r) => ({
        date: r.date,
        visitors: Number(r.visitors),
        leads: Number(r.leads),
      })),
      creatives: creatives.map((r) => {
        const v = Number(r.visitors);
        const l = Number(r.leads);
        return {
          content: r.content,
          visitors: v,
          leads: l,
          conversionRate: v > 0 ? round2((l / v) * 100) : 0,
        };
      }),
      leadJourneys,
    });
  } catch (err) {
    console.error('[Tracking Campaigns] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

/** Round to 2 decimal places */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}