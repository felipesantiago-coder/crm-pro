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
    const period = PERIOD_DAYS[searchParams.get('period') ?? '30d'] ?? 30;
    const siteId = searchParams.get('siteId') ?? null;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - period);
    startDate.setHours(0, 0, 0, 0);

    // Run all independent queries in parallel
    const [
      kpis,
      bouncedVisitors,
      chartData,
      funnelData,
      byCampaign,
      bySource,
      byContent,
      byEventType,
      topPages,
      metaPixelLeads,
      metaCrmLeads,
      metaMatched,
    ] = await Promise.all([
      // ── 1. Core KPIs ──
      db.$queryRaw<
        Array<{
          totalVisitors: bigint;
          totalPageviews: bigint;
          totalEvents: bigint;
          uniqueLeads: bigint;
        }>
      >(
        Prisma.sql`
          SELECT
            COUNT(DISTINCT e."visitorId")::bigint          AS "totalVisitors",
            COUNT(*) FILTER (WHERE e."eventType" = 'pageview')::bigint AS "totalPageviews",
            COUNT(*)::bigint                                 AS "totalEvents",
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN e."visitorId" END)::bigint AS "uniqueLeads"
          FROM tracking_events e
          LEFT JOIN tracking_visitors v ON v."visitorId" = e."visitorId"
          WHERE e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
        `,
      ),

      // ── 2. Bounced visitors (exactly 1 pageview, no other events) ──
      db.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`
          SELECT COUNT(*)::bigint AS count
          FROM (
            SELECT "visitorId"
            FROM tracking_events
            WHERE "createdAt" >= ${startDate}::timestamptz
              AND (${siteId}::text IS NULL OR "siteId" = ${siteId})
            GROUP BY "visitorId"
            HAVING COUNT(*) FILTER (WHERE "eventType" = 'pageview') = 1
               AND COUNT(*) = 1
          ) bounced
        `,
      ),

      // ── 3. Daily chart data ──
      db.$queryRaw<
        Array<{
          date: string;
          visitors: bigint;
          pageviews: bigint;
          leads: bigint;
          events: bigint;
        }>
      >(
        Prisma.sql`
          SELECT
            TO_CHAR(e."createdAt", 'YYYY-MM-DD')             AS date,
            COUNT(DISTINCT e."visitorId")::bigint             AS visitors,
            COUNT(*) FILTER (WHERE e."eventType" = 'pageview')::bigint AS pageviews,
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN e."visitorId" END)::bigint AS leads,
            COUNT(*)::bigint                                   AS events
          FROM tracking_events e
          LEFT JOIN tracking_visitors v ON v."visitorId" = e."visitorId"
          WHERE e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY TO_CHAR(e."createdAt", 'YYYY-MM-DD')
          ORDER BY date
        `,
      ),

      // ── 4. Funnel: pageview visitors → engaged (>1 event) → lead visitors ──
      db.$queryRaw<
        Array<{ stage: string; count: bigint }>
      >(
        Prisma.sql`
          WITH base AS (
            SELECT e."visitorId", v."leadId", COUNT(*) OVER (PARTITION BY e."visitorId") AS event_count
            FROM tracking_events e
            LEFT JOIN tracking_visitors v ON v."visitorId" = e."visitorId"
            WHERE e."createdAt" >= ${startDate}::timestamptz
              AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          ),
          pv_visitors AS (
            SELECT COUNT(DISTINCT "visitorId")::bigint AS cnt FROM base WHERE EXISTS (
              SELECT 1 FROM tracking_events e2 WHERE e2."visitorId" = base."visitorId" AND e2."eventType" = 'pageview'
            )
          ),
          engaged AS (
            SELECT COUNT(DISTINCT "visitorId")::bigint AS cnt FROM base WHERE event_count > 1
          ),
          leads AS (
            SELECT COUNT(DISTINCT "visitorId")::bigint AS cnt FROM base WHERE "leadId" IS NOT NULL
          )
          SELECT 'pageview' AS stage, (SELECT cnt FROM pv_visitors) AS count
          UNION ALL
          SELECT 'engagement' AS stage, (SELECT cnt FROM engaged) AS count
          UNION ALL
          SELECT 'lead' AS stage, (SELECT cnt FROM leads) AS count
        `,
      ),

      // ── 5. By campaign ──
      db.$queryRaw<
        Array<{
          campaign: string;
          visitors: bigint;
          leads: bigint;
        }>
      >(
        Prisma.sql`
          SELECT
            COALESCE(e."utmCampaign", '(none)') AS campaign,
            COUNT(DISTINCT e."visitorId")::bigint AS visitors,
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN e."visitorId" END)::bigint AS leads
          FROM tracking_events e
          LEFT JOIN tracking_visitors v ON v."visitorId" = e."visitorId"
          WHERE e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY COALESCE(e."utmCampaign", '(none)')
          ORDER BY visitors DESC
        `,
      ),

      // ── 6. By source ──
      db.$queryRaw<
        Array<{
          source: string;
          visitors: bigint;
          leads: bigint;
        }>
      >(
        Prisma.sql`
          SELECT
            COALESCE(e."utmSource", '(none)') AS source,
            COUNT(DISTINCT e."visitorId")::bigint AS visitors,
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN e."visitorId" END)::bigint AS leads
          FROM tracking_events e
          LEFT JOIN tracking_visitors v ON v."visitorId" = e."visitorId"
          WHERE e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY COALESCE(e."utmSource", '(none)')
          ORDER BY visitors DESC
        `,
      ),

      // ── 7. By UTM content (ad creative) ──
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
          WHERE e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY COALESCE(e."utmContent", '(none)')
          ORDER BY visitors DESC
        `,
      ),

      // ── 8. By event type ──
      db.$queryRaw<
        Array<{
          eventType: string;
          count: bigint;
        }>
      >(
        Prisma.sql`
          SELECT
            e."eventType",
            COUNT(*)::bigint AS count
          FROM tracking_events e
          WHERE e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY e."eventType"
          ORDER BY count DESC
        `,
      ),

      // ── 9. Top pages ──
      db.$queryRaw<
        Array<{
          url: string;
          views: bigint;
          leads: bigint;
        }>
      >(
        Prisma.sql`
          SELECT
            COALESCE(e."pageUrl", '(unknown)') AS url,
            COUNT(*)::bigint AS views,
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN e."visitorId" END)::bigint AS leads
          FROM tracking_events e
          LEFT JOIN tracking_visitors v ON v."visitorId" = e."visitorId"
          WHERE e."eventType" = 'pageview'
            AND e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY COALESCE(e."pageUrl", '(unknown)')
          ORDER BY views DESC
          LIMIT 20
        `,
      ),

      // ── 10a. Meta discrepancy: pixel-tracked leads ──
      db.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`
          SELECT COUNT(DISTINCT e."visitorId")::bigint AS count
          FROM tracking_events e
          WHERE e."createdAt" >= ${startDate}::timestamptz
            AND e."eventType" = 'lead'
            AND (LOWER(e."utmSource") LIKE '%meta%' OR LOWER(e."utmSource") LIKE '%facebook%')
        `,
      ),

      // ── 10b. Meta discrepancy: CRM leads tagged [Meta Ads] ──
      db.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`
          SELECT COUNT(*)::bigint AS count
          FROM clients
          WHERE "notes" LIKE '%[Meta Ads]%'
            AND "createdAt" >= ${startDate}::timestamptz
        `,
      ),

      // ── 10c. Meta discrepancy: matched (pixel lead visitors with CRM [Meta Ads] entry) ──
      db.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`
          SELECT COUNT(DISTINCT e."visitorId")::bigint AS count
          FROM tracking_events e
          JOIN tracking_visitors v ON v."visitorId" = e."visitorId"
          JOIN clients c ON c.id = v."leadId" AND c."notes" LIKE '%[Meta Ads]%'
          WHERE e."createdAt" >= ${startDate}::timestamptz
            AND e."eventType" = 'lead'
            AND (LOWER(e."utmSource") LIKE '%meta%' OR LOWER(e."utmSource") LIKE '%facebook%')
        `,
      ),
    ]);

    // ── Compute derived metrics ──
    const totalVisitors = Number(kpis[0]?.totalVisitors ?? 0);
    const totalPageviews = Number(kpis[0]?.totalPageviews ?? 0);
    const totalEvents = Number(kpis[0]?.totalEvents ?? 0);
    const uniqueLeads = Number(kpis[0]?.uniqueLeads ?? 0);
    const bounced = Number(bouncedVisitors[0]?.count ?? 0);

    const conversionRate = totalVisitors > 0 ? (uniqueLeads / totalVisitors) * 100 : 0;
    const avgEventsPerVisitor = totalVisitors > 0 ? totalEvents / totalVisitors : 0;
    const bounceRate = totalVisitors > 0 ? (bounced / totalVisitors) * 100 : 0;

    // ── Assemble funnel with rates ──
    const pageviewCount = Number(funnelData.find((f) => f.stage === 'pageview')?.count ?? 0);
    const engagementCount = Number(funnelData.find((f) => f.stage === 'engagement')?.count ?? 0);
    const leadCount = Number(funnelData.find((f) => f.stage === 'lead')?.count ?? 0);

    const funnel = [
      { stage: 'Pageview', count: pageviewCount, rate: 100 },
      {
        stage: 'Engagement',
        count: engagementCount,
        rate: pageviewCount > 0 ? (engagementCount / pageviewCount) * 100 : 0,
      },
      {
        stage: 'Lead',
        count: leadCount,
        rate: pageviewCount > 0 ? (leadCount / pageviewCount) * 100 : 0,
      },
    ];

    // ── Assemble byCampaign with conversionRate ──
    const campaignRows = byCampaign.map((r) => ({
      campaign: r.campaign,
      visitors: Number(r.visitors),
      leads: Number(r.leads),
      conversionRate: Number(r.visitors) > 0 ? (Number(r.leads) / Number(r.visitors)) * 100 : 0,
    }));

    // ── Assemble bySource ──
    const sourceRows = bySource.map((r) => ({
      source: r.source,
      visitors: Number(r.visitors),
      leads: Number(r.leads),
    }));

    // ── Assemble byContent with conversionRate ──
    const contentRows = byContent.map((r) => ({
      content: r.content,
      visitors: Number(r.visitors),
      leads: Number(r.leads),
      conversionRate: Number(r.visitors) > 0 ? (Number(r.leads) / Number(r.visitors)) * 100 : 0,
    }));

    // ── Assemble byEventType ──
    const eventTypeRows = byEventType.map((r) => ({
      eventType: r.eventType,
      count: Number(r.count),
    }));

    // ── Assemble topPages ──
    const pageRows = topPages.map((r) => ({
      url: r.url,
      views: Number(r.views),
      leads: Number(r.leads),
    }));

    // ── Meta discrepancy ──
    const pixelLeads = Number(metaPixelLeads[0]?.count ?? 0);
    const crmMetaLeads = Number(metaCrmLeads[0]?.count ?? 0);
    const matched = Number(metaMatched[0]?.count ?? 0);
    const matchRate = pixelLeads > 0 ? (matched / pixelLeads) * 100 : 0;

    return NextResponse.json({
      metrics: {
        totalVisitors,
        totalPageviews,
        totalEvents,
        uniqueLeads,
        conversionRate: round2(conversionRate),
        avgEventsPerVisitor: round2(avgEventsPerVisitor),
        bounceRate: round2(bounceRate),
      },
      chartData: chartData.map((r) => ({
        date: r.date,
        visitors: Number(r.visitors),
        pageviews: Number(r.pageviews),
        leads: Number(r.leads),
        events: Number(r.events),
      })),
      funnel,
      byCampaign: campaignRows,
      bySource: sourceRows,
      byContent: contentRows,
      byEventType: eventTypeRows,
      topPages: pageRows,
      metaDiscrepancy: {
        pixelLeads,
        crmMetaLeads,
        matchRate: round2(matchRate),
      },
    });
  } catch (err) {
    console.error('[Tracking Dashboard] Error:', err);
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