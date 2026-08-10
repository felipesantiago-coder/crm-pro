import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';
import { Prisma } from '@prisma/client';

// Wrapper: individual query failure won't kill the entire dashboard
const safe = <T,>(p: Promise<T>): Promise<T | []> =>
  p.catch((err: unknown) => {
    console.warn('[Tracking Dashboard] Query failed:', (err as Error)?.message || err);
    return [] as unknown as T;
  });

// Negative = hours from now; Positive = calendar days from midnight
const PERIOD_DAYS: Record<string, number> = {
  '24h': -24,
  '48h': -48,
  '7d': 7,
  '15d': 15,
  '30d': 30,
};

export async function GET(request: Request) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const { searchParams } = new URL(request.url);
    const period = PERIOD_DAYS[searchParams.get('period') ?? '30d'] ?? 30;
    const siteId = searchParams.get('siteId') ?? null;

    const startDate = new Date();
    if (period < 0) {
      // Hour-based filter: subtract hours from now
      startDate.setHours(startDate.getHours() + period);
    } else {
      // Day-based filter: subtract calendar days, start at midnight
      startDate.setDate(startDate.getDate() - period);
      startDate.setHours(0, 0, 0, 0);
    }

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
      topCountries,
      topCities,
      deviceBreakdown,
      hourlyData,
      recentLeads,
      referrerBreakdown,
      metaPixelLeads,
      metaCrmLeads,
      metaMatched,
      whatsappClicks,
    ] = await Promise.all([
      // ── 1. Core KPIs ──
      safe(db.$queryRaw<
        Array<{
          totalVisitors: bigint;
          totalPageviews: bigint;
          totalEvents: bigint;
          uniqueLeads: bigint;
          uniqueSessions: bigint;
        }>
      >(
        Prisma.sql`
          SELECT
            COUNT(DISTINCT e."visitorId")::bigint          AS "totalVisitors",
            COUNT(*) FILTER (WHERE e."eventType" = 'pageview')::bigint AS "totalPageviews",
            COUNT(*)::bigint                                 AS "totalEvents",
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN e."visitorId" END)::bigint AS "uniqueLeads",
            COUNT(DISTINCT e."sessionId")::bigint             AS "uniqueSessions"
          FROM tracking_events e
          LEFT JOIN tracking_visitors v ON v."visitorId" = e."visitorId"
          WHERE e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
        `,
      )),

      // ── 2. Bounced visitors ──
      safe(db.$queryRaw<Array<{ count: bigint }>>(
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
      )),

      // ── 3. Daily chart data ──
      safe(db.$queryRaw<
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
      )),

      // ── 4. Funnel ──
      safe(db.$queryRaw<
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
      )),

      // ── 5. By campaign ──
      safe(db.$queryRaw<
        Array<{ campaign: string; visitors: bigint; leads: bigint }>
      >(
        Prisma.sql`
          SELECT
            COALESCE(e."utmCampaign", '(sem campanha)') AS campaign,
            COUNT(DISTINCT e."visitorId")::bigint AS visitors,
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN e."visitorId" END)::bigint AS leads
          FROM tracking_events e
          LEFT JOIN tracking_visitors v ON v."visitorId" = e."visitorId"
          WHERE e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY COALESCE(e."utmCampaign", '(sem campanha)')
          ORDER BY visitors DESC
        `,
      )),

      // ── 6. By source ──
      safe(db.$queryRaw<
        Array<{ source: string; visitors: bigint; leads: bigint }>
      >(
        Prisma.sql`
          SELECT
            COALESCE(e."utmSource", '(orgânico/direto)') AS source,
            COUNT(DISTINCT e."visitorId")::bigint AS visitors,
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN e."visitorId" END)::bigint AS leads
          FROM tracking_events e
          LEFT JOIN tracking_visitors v ON v."visitorId" = e."visitorId"
          WHERE e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY COALESCE(e."utmSource", '(orgânico/direto)')
          ORDER BY visitors DESC
        `,
      )),

      // ── 7. By UTM content (ad creative) ──
      safe(db.$queryRaw<
        Array<{ content: string; visitors: bigint; leads: bigint }>
      >(
        Prisma.sql`
          SELECT
            COALESCE(e."utmContent", '(sem conteúdo)') AS content,
            COUNT(DISTINCT e."visitorId")::bigint AS visitors,
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN e."visitorId" END)::bigint AS leads
          FROM tracking_events e
          LEFT JOIN tracking_visitors v ON v."visitorId" = e."visitorId"
          WHERE e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY COALESCE(e."utmContent", '(sem conteúdo)')
          ORDER BY visitors DESC
        `,
      )),

      // ── 8. By event type ──
      safe(db.$queryRaw<
        Array<{ eventType: string; count: bigint }>
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
      )),

      // ── 9. Top pages ──
      safe(db.$queryRaw<
        Array<{ url: string; views: bigint; leads: bigint }>
      >(
        Prisma.sql`
          SELECT
            COALESCE(e."pageUrl", '(desconhecida)') AS url,
            COUNT(*)::bigint AS views,
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN e."visitorId" END)::bigint AS leads
          FROM tracking_events e
          LEFT JOIN tracking_visitors v ON v."visitorId" = e."visitorId"
          WHERE e."eventType" = 'pageview'
            AND e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY COALESCE(e."pageUrl", '(desconhecida)')
          ORDER BY views DESC
          LIMIT 20
        `,
      )),

      // ── 10. Top countries ──
      safe(db.$queryRaw<
        Array<{ country: string; visitors: bigint; leads: bigint }>
      >(
        Prisma.sql`
          SELECT
            COALESCE(v."country", '(desconhecido)') AS country,
            COUNT(DISTINCT v."visitorId")::bigint AS visitors,
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN v."visitorId" END)::bigint AS leads
          FROM tracking_visitors v
          WHERE v."lastSeenAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR v."siteId" = ${siteId})
          GROUP BY COALESCE(v."country", '(desconhecido)')
          ORDER BY visitors DESC
          LIMIT 10
        `,
      )),

      // ── 11. Top cities ──
      safe(db.$queryRaw<
        Array<{ city: string; country: string; visitors: bigint; leads: bigint }>
      >(
        Prisma.sql`
          SELECT
            COALESCE(v."city", '(desconhecido)') AS city,
            COALESCE(v."country", '') AS country,
            COUNT(DISTINCT v."visitorId")::bigint AS visitors,
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN v."visitorId" END)::bigint AS leads
          FROM tracking_visitors v
          WHERE v."lastSeenAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR v."siteId" = ${siteId})
          GROUP BY COALESCE(v."city", '(desconhecido)'), COALESCE(v."country", '')
          ORDER BY visitors DESC
          LIMIT 10
        `,
      )),

      // ── 12. Device breakdown ──
      safe(db.$queryRaw<
        Array<{ device: string; visitors: bigint; leads: bigint }>
      >(
        Prisma.sql`
          SELECT
            CASE
              WHEN v."userAgent" IS NULL THEN 'Outro'
              WHEN v."userAgent" ~* 'Mobile|Android.*Mobile|iPhone|iPod' THEN 'Mobile'
              WHEN v."userAgent" ~* 'iPad|Android(?!.*Mobile)|Tablet' THEN 'Tablet'
              ELSE 'Desktop'
            END AS device,
            COUNT(DISTINCT v."visitorId")::bigint AS visitors,
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN v."visitorId" END)::bigint AS leads
          FROM tracking_visitors v
          WHERE v."lastSeenAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR v."siteId" = ${siteId})
          GROUP BY CASE
            WHEN v."userAgent" IS NULL THEN 'Outro'
            WHEN v."userAgent" ~* 'Mobile|Android.*Mobile|iPhone|iPod' THEN 'Mobile'
            WHEN v."userAgent" ~* 'iPad|Android(?!.*Mobile)|Tablet' THEN 'Tablet'
            ELSE 'Desktop'
          END
          ORDER BY visitors DESC
        `,
      )),

      // ── 13. Hourly distribution ──
      safe(db.$queryRaw<
        Array<{ hour: number; visitors: bigint; events: bigint; leads: bigint }>
      >(
        Prisma.sql`
          SELECT
            EXTRACT(HOUR FROM e."createdAt")::int AS hour,
            COUNT(DISTINCT e."visitorId")::bigint AS visitors,
            COUNT(*)::bigint AS events,
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN e."visitorId" END)::bigint AS leads
          FROM tracking_events e
          LEFT JOIN tracking_visitors v ON v."visitorId" = e."visitorId"
          WHERE e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY EXTRACT(HOUR FROM e."createdAt")
          ORDER BY hour
        `,
      )),

      // ── 14. Recent converted leads (last 20) ──
      safe(db.$queryRaw<
        Array<{
          visitorId: string;
          leadId: string;
          country: string | null;
          city: string | null;
          utmSource: string | null;
          utmCampaign: string | null;
          utmContent: string | null;
          pageUrl: string | null;
          convertedAt: string;
          clientName: string | null;
        }>
      >(
        Prisma.sql`
          SELECT DISTINCT ON (v."visitorId")
            v."visitorId",
            v."leadId",
            v."country",
            v."city",
            e."utmSource",
            e."utmCampaign",
            e."utmContent",
            e."pageUrl",
            e."createdAt" AS "convertedAt",
            c.name AS "clientName"
          FROM tracking_visitors v
          JOIN tracking_events e ON e."visitorId" = v."visitorId"
          LEFT JOIN clients c ON c.id = v."leadId"
          WHERE v."leadId" IS NOT NULL
            AND e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          ORDER BY v."visitorId", e."createdAt" DESC
          LIMIT 20
        `,
      )),

      // ── 15. Referrer breakdown ──
      safe(db.$queryRaw<
        Array<{ referrer: string; visitors: bigint; leads: bigint }>
      >(
        Prisma.sql`
          SELECT
            CASE
              WHEN e."referrer" IS NULL OR e."referrer" = '' THEN '(direto)'
              WHEN e."referrer" ~* 'facebook\.com|fb\.com' THEN 'Facebook'
              WHEN e."referrer" ~* 'instagram\.com' THEN 'Instagram'
              WHEN e."referrer" ~* 'google\.com' THEN 'Google'
              WHEN e."referrer" ~* 'whatsapp\.com|wa\.me' THEN 'WhatsApp'
              WHEN e."referrer" ~* 'linkedin\.com' THEN 'LinkedIn'
              WHEN e."referrer" ~* 'tiktok\.com' THEN 'TikTok'
              WHEN e."referrer" ~* 'youtube\.com' THEN 'YouTube'
              ELSE SUBSTRING(e."referrer" FROM 'https?://([^/]+)')
            END AS referrer,
            COUNT(DISTINCT e."visitorId")::bigint AS visitors,
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN e."visitorId" END)::bigint AS leads
          FROM tracking_events e
          LEFT JOIN tracking_visitors v ON v."visitorId" = e."visitorId"
          WHERE e."eventType" = 'pageview'
            AND e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY CASE
            WHEN e."referrer" IS NULL OR e."referrer" = '' THEN '(direto)'
            WHEN e."referrer" ~* 'facebook\.com|fb\.com' THEN 'Facebook'
            WHEN e."referrer" ~* 'instagram\.com' THEN 'Instagram'
            WHEN e."referrer" ~* 'google\.com' THEN 'Google'
            WHEN e."referrer" ~* 'whatsapp\.com|wa\.me' THEN 'WhatsApp'
            WHEN e."referrer" ~* 'linkedin\.com' THEN 'LinkedIn'
            WHEN e."referrer" ~* 'tiktok\.com' THEN 'TikTok'
            WHEN e."referrer" ~* 'youtube\.com' THEN 'YouTube'
            ELSE SUBSTRING(e."referrer" FROM 'https?://([^/]+)')
          END
          ORDER BY visitors DESC
          LIMIT 10
        `,
      )),

      // ── 16a. Meta discrepancy: pixel-tracked leads ──
      safe(db.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`
          SELECT COUNT(DISTINCT e."visitorId")::bigint AS count
          FROM tracking_events e
          WHERE e."createdAt" >= ${startDate}::timestamptz
            AND (e."eventType" = 'lead' OR e."eventType" = 'form_submit')
            AND (LOWER(e."utmSource") LIKE '%meta%' OR LOWER(e."utmSource") LIKE '%facebook%' OR LOWER(e."utmSource") LIKE '%ig%' OR LOWER(e."utmSource") LIKE '%instagram%' OR LOWER(e."utmSource") LIKE '%fb%')
        `,
      )),

      // ── 16b. Meta discrepancy: CRM leads tagged [Meta Ads] ──
      safe(db.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`
          SELECT COUNT(*)::bigint AS count
          FROM clients
          WHERE "notes" LIKE '%[Meta Ads]%'
            AND "createdAt" >= ${startDate}::timestamptz
        `,
      )),

      // ── 16c. Meta discrepancy: matched ──
      safe(db.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`
          SELECT COUNT(DISTINCT e."visitorId")::bigint AS count
          FROM tracking_events e
          JOIN tracking_visitors v ON v."visitorId" = e."visitorId"
          JOIN clients c ON c.id = v."leadId" AND c."notes" LIKE '%[Meta Ads]%'
          WHERE e."createdAt" >= ${startDate}::timestamptz
            AND (e."eventType" = 'lead' OR e."eventType" = 'form_submit')
            AND (LOWER(e."utmSource") LIKE '%meta%' OR LOWER(e."utmSource") LIKE '%facebook%' OR LOWER(e."utmSource") LIKE '%ig%' OR LOWER(e."utmSource") LIKE '%instagram%' OR LOWER(e."utmSource") LIKE '%fb%')
        `,
      )),

      // ── 17. WhatsApp clicks (unique visitors who clicked WhatsApp) ──
      safe(db.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`
          SELECT COUNT(DISTINCT e."visitorId")::bigint AS count
          FROM tracking_events e
          WHERE e."eventType" = 'whatsapp_click'
            AND e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
        `,
      )),
    ]);

    // ── Compute derived metrics ──
    const totalVisitors = Number(kpis[0]?.totalVisitors ?? 0);
    const totalPageviews = Number(kpis[0]?.totalPageviews ?? 0);
    const totalEvents = Number(kpis[0]?.totalEvents ?? 0);
    const uniqueLeads = Number(kpis[0]?.uniqueLeads ?? 0);
    const uniqueSessions = Number(kpis[0]?.uniqueSessions ?? 0);
    const bounced = Number(bouncedVisitors[0]?.count ?? 0);

    const conversionRate = totalVisitors > 0 ? (uniqueLeads / totalVisitors) * 100 : 0;
    const avgEventsPerVisitor = totalVisitors > 0 ? totalEvents / totalVisitors : 0;
    const bounceRate = totalVisitors > 0 ? (bounced / totalVisitors) * 100 : 0;
    const pageviewsPerSession = uniqueSessions > 0 ? totalPageviews / uniqueSessions : 0;
    const whatsappClicksCount = Number(whatsappClicks[0]?.count ?? 0);
    const totalConversions = uniqueLeads + whatsappClicksCount;
    const realConversionRate = totalVisitors > 0 ? (totalConversions / totalVisitors) * 100 : 0;

    // ── Funnel ──
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
        stage: 'WhatsApp',
        count: whatsappClicksCount,
        rate: pageviewCount > 0 ? (whatsappClicksCount / pageviewCount) * 100 : 0,
      },
      {
        stage: 'Lead',
        count: leadCount,
        rate: pageviewCount > 0 ? (leadCount / pageviewCount) * 100 : 0,
      },
    ];

    // ── By campaign ──
    const campaignRows = byCampaign.map((r) => ({
      campaign: r.campaign,
      visitors: Number(r.visitors),
      leads: Number(r.leads),
      conversionRate: Number(r.visitors) > 0 ? (Number(r.leads) / Number(r.visitors)) * 100 : 0,
    }));

    // ── By source ──
    const sourceRows = bySource.map((r) => ({
      source: r.source,
      visitors: Number(r.visitors),
      leads: Number(r.leads),
      conversionRate: Number(r.visitors) > 0 ? (Number(r.leads) / Number(r.visitors)) * 100 : 0,
    }));

    // ── By content ──
    const contentRows = byContent.map((r) => ({
      content: r.content,
      visitors: Number(r.visitors),
      leads: Number(r.leads),
      conversionRate: Number(r.visitors) > 0 ? (Number(r.leads) / Number(r.visitors)) * 100 : 0,
    }));

    // ── By event type ──
    const eventTypeRows = byEventType.map((r) => ({
      eventType: r.eventType,
      count: Number(r.count),
    }));

    // ── Top pages ──
    const pageRows = topPages.map((r) => ({
      url: r.url,
      views: Number(r.views),
      leads: Number(r.leads),
      conversionRate: Number(r.views) > 0 ? (Number(r.leads) / Number(r.views)) * 100 : 0,
    }));

    // ── Top countries ──
    const countryRows = topCountries.map((r) => ({
      country: r.country,
      visitors: Number(r.visitors),
      leads: Number(r.leads),
    }));

    // ── Top cities ──
    const cityRows = topCities.map((r) => ({
      city: r.city,
      country: r.country,
      visitors: Number(r.visitors),
      leads: Number(r.leads),
    }));

    // ── Device breakdown ──
    const deviceRows = deviceBreakdown.map((r) => ({
      device: r.device,
      visitors: Number(r.visitors),
      leads: Number(r.leads),
    }));

    // ── Hourly data ──
    const hourlyRows = hourlyData.map((r) => ({
      hour: Number(r.hour),
      visitors: Number(r.visitors),
      events: Number(r.events),
      leads: Number(r.leads),
    }));

    // ── Recent leads ──
    const leadRows = recentLeads.map((r) => ({
      visitorId: r.visitorId,
      leadId: r.leadId,
      country: r.country,
      city: r.city,
      utmSource: r.utmSource,
      utmCampaign: r.utmCampaign,
      utmContent: r.utmContent,
      pageUrl: r.pageUrl,
      convertedAt: r.convertedAt,
      clientName: r.clientName,
    }));

    // ── Referrer breakdown ──
    const referrerRows = referrerBreakdown.map((r) => ({
      referrer: r.referrer,
      visitors: Number(r.visitors),
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
        whatsappClicks: whatsappClicksCount,
        totalConversions,
        uniqueSessions,
        conversionRate: round2(conversionRate),
        realConversionRate: round2(realConversionRate),
        avgEventsPerVisitor: round2(avgEventsPerVisitor),
        bounceRate: round2(bounceRate),
        pageviewsPerSession: round2(pageviewsPerSession),
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
      topCountries: countryRows,
      topCities: cityRows,
      deviceBreakdown: deviceRows,
      hourlyData: hourlyRows,
      recentLeads: leadRows,
      referrerBreakdown: referrerRows,
      metaDiscrepancy: {
        pixelLeads,
        crmMetaLeads,
        matchRate: round2(matchRate),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('[Tracking Dashboard] Error:', message, stack);
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
