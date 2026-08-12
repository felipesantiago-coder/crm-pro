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
      byMedium,
      byTerm,
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
      scrollDepthData,
      formInteractionData,
      exitIntentCount,
      topEntryPages,
      avgSessionDuration,
      returningVisitors,
      engagementByDayOfWeek,
      whatsappClicks,
      webVitalsData,
      engagedTimeData,
      jsErrorsData,
      sectionViewsData,
      ctaClicksData,
      formFunnelData,
      visitorContextData,
      contentEngagementData,
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

      // ── 8. By UTM medium ──
      safe(db.$queryRaw<
        Array<{ medium: string; visitors: bigint; leads: bigint }>
      >(
        Prisma.sql`
          SELECT
            COALESCE(e."utmMedium", '(não definido)') AS medium,
            COUNT(DISTINCT e."visitorId")::bigint AS visitors,
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN e."visitorId" END)::bigint AS leads
          FROM tracking_events e
          LEFT JOIN tracking_visitors v ON v."visitorId" = e."visitorId"
          WHERE e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY COALESCE(e."utmMedium", '(não definido)')
          ORDER BY visitors DESC
        `,
      )),

      // ── 9. By UTM term ──
      safe(db.$queryRaw<
        Array<{ term: string; visitors: bigint; leads: bigint }>
      >(
        Prisma.sql`
          SELECT
            COALESCE(e."utmTerm", '(não definido)') AS term,
            COUNT(DISTINCT e."visitorId")::bigint AS visitors,
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN e."visitorId" END)::bigint AS leads
          FROM tracking_events e
          LEFT JOIN tracking_visitors v ON v."visitorId" = e."visitorId"
          WHERE e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY COALESCE(e."utmTerm", '(não definido)')
          ORDER BY visitors DESC
        `,
      )),

      // ── 10. By event type ──
      safe(db.$queryRaw<
        Array<{ eventType: string; count: bigint }>
      >(
        Prisma.sql`
          SELECT
            COALESCE(e."eventType", 'desconhecido') AS "eventType",
            COUNT(*)::bigint AS count
          FROM tracking_events e
          WHERE e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY COALESCE(e."eventType", 'desconhecido')
          ORDER BY count DESC
        `,
      )),

      // ── 11. Top pages ──
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

      // ── 12. Top countries ──
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

      // ── 13. Top cities ──
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

      // ── 14. Device breakdown ──
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

      // ── 15. Hourly distribution ──
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

      // ── 16. Recent converted leads (last 20) ──
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

      // ── 17. Referrer breakdown ──
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

      // ── 18a. Meta discrepancy: pixel-tracked leads ──
      safe(db.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`
          SELECT COUNT(DISTINCT e."visitorId")::bigint AS count
          FROM tracking_events e
          WHERE e."createdAt" >= ${startDate}::timestamptz
            AND (e."eventType" = 'lead' OR e."eventType" = 'form_submit')
            AND (LOWER(e."utmSource") LIKE '%meta%' OR LOWER(e."utmSource") LIKE '%facebook%' OR LOWER(e."utmSource") LIKE '%ig%' OR LOWER(e."utmSource") LIKE '%instagram%' OR LOWER(e."utmSource") LIKE '%fb%')
        `,
      )),

      // ── 18b. Meta discrepancy: CRM leads tagged [Meta Ads] ──
      safe(db.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`
          SELECT COUNT(*)::bigint AS count
          FROM clients
          WHERE "notes" LIKE '%[Meta Ads]%'
            AND "createdAt" >= ${startDate}::timestamptz
        `,
      )),

      // ── 18c. Meta discrepancy: matched ──
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

      // ── 19. Scroll depth distribution ──
      // Uses metadata->>'depth' for new events, falls back to eventName
      safe(db.$queryRaw<
        Array<{ depth_label: string; count: bigint }>
      >(
        Prisma.sql`
          SELECT COALESCE(
            'scroll_' || (e."metadata"->>'depth'),
            e."eventName",
            'scroll_unknown'
          ) AS depth_label,
          COUNT(*)::bigint AS count
          FROM tracking_events e
          WHERE e."eventType" = 'scroll_depth'
            AND e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY COALESCE(
            'scroll_' || (e."metadata"->>'depth'),
            e."eventName",
            'scroll_unknown'
          )
          ORDER BY count DESC
        `,
      )),

      // ── 20. Form interaction events ──
      safe(db.$queryRaw<
        Array<{ eventType: string; eventName: string | null; count: bigint }>
      >(
        Prisma.sql`
          SELECT e."eventType", e."eventName", COUNT(*)::bigint AS count
          FROM tracking_events e
          WHERE e."eventType" IN ('form_focus', 'form_blur', 'form_abandon')
            AND e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY e."eventType", e."eventName"
          ORDER BY count DESC
        `,
      )),

      // ── 21. Exit intent count ──
      safe(db.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`
          SELECT COUNT(*)::bigint AS count
          FROM tracking_events e
          WHERE e."eventType" = 'exit_intent'
            AND e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
        `,
      )),

      // ── 22. Top entry pages ──
      safe(db.$queryRaw<
        Array<{ url: string; count: bigint }>
      >(
        Prisma.sql`
          SELECT COALESCE(e."pageUrl", '(desconhecida)') AS url, COUNT(*)::bigint AS count
          FROM tracking_events e
          WHERE e."eventType" = 'pageview'
            AND e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
            AND e."visitorId" IN (
              SELECT MIN(e2.id)::text
              FROM tracking_events e2
              WHERE e2."eventType" = 'pageview'
                AND e2."createdAt" >= ${startDate}::timestamptz
                AND (${siteId}::text IS NULL OR e2."siteId" = ${siteId})
              GROUP BY e2."visitorId"
            )
          GROUP BY COALESCE(e."pageUrl", '(desconhecida)')
          ORDER BY count DESC
          LIMIT 10
        `,
      )),

      // ── 23. Average session duration (approx) ──
      safe(db.$queryRaw<Array<{ avg_seconds: number }>>(
        Prisma.sql`
          SELECT
            AVG(
              EXTRACT(EPOCH FROM (max_ev - min_ev))
            )::numeric(10,1) AS avg_seconds
          FROM (
            SELECT
              e."sessionId",
              MIN(e."createdAt") AS min_ev,
              MAX(e."createdAt") AS max_ev
            FROM tracking_events e
            WHERE e."createdAt" >= ${startDate}::timestamptz
              AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
            GROUP BY e."sessionId"
          ) sessions
        `,
      )),

      // ── 24. Returning visitors (visitors with events on 2+ different days) ──
      safe(db.$queryRaw<
        Array<{ returning: bigint; new: bigint }>
      >(
        Prisma.sql`
          SELECT
            COUNT(DISTINCT CASE WHEN day_count > 1 THEN "visitorId" END)::bigint AS returning,
            COUNT(DISTINCT "visitorId")::bigint AS new
          FROM (
            SELECT
              e."visitorId",
              COUNT(DISTINCT TO_CHAR(e."createdAt", 'YYYY-MM-DD')) AS day_count
            FROM tracking_events e
            WHERE e."createdAt" >= ${startDate}::timestamptz
              AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
            GROUP BY e."visitorId"
          ) visitor_days
        `,
      )),

      // ── 25. Engagement by day of week ──
      safe(db.$queryRaw<
        Array<{ dow: number; dow_name: string; visitors: bigint; leads: bigint }>
      >(
        Prisma.sql`
          SELECT
            EXTRACT(DOW FROM e."createdAt")::int AS dow,
            TO_CHAR(e."createdAt", 'TMDay') AS dow_name,
            COUNT(DISTINCT e."visitorId")::bigint AS visitors,
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN e."visitorId" END)::bigint AS leads
          FROM tracking_events e
          LEFT JOIN tracking_visitors v ON v."visitorId" = e."visitorId"
          WHERE e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY EXTRACT(DOW FROM e."createdAt"), TO_CHAR(e."createdAt", 'TMDay')
          ORDER BY dow
        `,
      )),

      // ── 26. WhatsApp clicks (unique visitors who clicked WhatsApp) ──
      safe(db.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`
          SELECT COUNT(DISTINCT e."visitorId")::bigint AS count
          FROM tracking_events e
          WHERE e."eventType" = 'whatsapp_click'
            AND e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
        `,
      )),

      // ── 27. Web Vitals summary (avg per metric) ──
      safe(db.$queryRaw<
        Array<{ metric: string; avg_value: number; p75: number; count: bigint }>
      >(
        Prisma.sql`
          SELECT
            COALESCE(e."metadata"->>'metric', e."eventName", 'unknown') AS metric,
            ROUND(AVG((e."metadata"->>'value')::numeric))::float AS avg_value,
            ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY (e."metadata"->>'value')::numeric))::float AS p75,
            COUNT(*)::bigint AS count
          FROM tracking_events e
          WHERE e."eventType" = 'web_vital'
            AND e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY COALESCE(e."metadata"->>'metric', e."eventName", 'unknown')
          ORDER BY count DESC
        `,
      )),

      // ── 28. Engaged time distribution ──
      safe(db.$queryRaw<
        Array<{ seconds: number; count: bigint }>
      >(
        Prisma.sql`
          SELECT
            (e."metadata"->>'seconds')::int AS seconds,
            COUNT(*)::bigint AS count
          FROM tracking_events e
          WHERE e."eventType" = 'engaged_time'
            AND e."metadata"->>'seconds' IS NOT NULL
            AND e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY (e."metadata"->>'seconds')::int
          ORDER BY seconds ASC
        `,
      )),

      // ── 29. JS Errors (count + top messages) ──
      safe(db.$queryRaw<
        Array<{ error_message: string; count: bigint; latest: string }>
      >(
        Prisma.sql`
          SELECT
            COALESCE(e."metadata"->>'message', e."eventName", 'Erro desconhecido') AS error_message,
            COUNT(*)::bigint AS count,
            MAX(e."createdAt")::text AS latest
          FROM tracking_events e
          WHERE e."eventType" = 'js_error'
            AND e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY COALESCE(e."metadata"->>'message', e."eventName", 'Erro desconhecido')
          ORDER BY count DESC
          LIMIT 10
        `,
      )),

      // ── 30. Section views ──
      safe(db.$queryRaw<
        Array<{ section: string; views: bigint; unique_visitors: bigint }>
      >(
        Prisma.sql`
          SELECT
            COALESCE(e."eventName", e."metadata"->>'section', '(sem nome)') AS section,
            COUNT(*)::bigint AS views,
            COUNT(DISTINCT e."visitorId")::bigint AS unique_visitors
          FROM tracking_events e
          WHERE e."eventType" = 'section_view'
            AND e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY COALESCE(e."eventName", e."metadata"->>'section', '(sem nome)')
          ORDER BY views DESC
          LIMIT 15
        `,
      )),

      // ── 31. CTA clicks ──
      safe(db.$queryRaw<
        Array<{ cta_text: string; section: string; clicks: bigint; unique_visitors: bigint }>
      >(
        Prisma.sql`
          SELECT
            COALESCE(e."metadata"->>'cta_text', e."eventName", '(sem texto)') AS cta_text,
            COALESCE(e."metadata"->>'section', '(não definida)') AS section,
            COUNT(*)::bigint AS clicks,
            COUNT(DISTINCT e."visitorId")::bigint AS unique_visitors
          FROM tracking_events e
          WHERE e."eventType" = 'cta_click'
            AND e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY COALESCE(e."metadata"->>'cta_text', e."eventName", '(sem texto)'), COALESCE(e."metadata"->>'section', '(não definida)')
          ORDER BY clicks DESC
          LIMIT 10
        `,
      )),

      // ── 32. Form funnel (view → focus → attempt → submit → error) ──
      safe(db.$queryRaw<
        Array<{ stage: string; count: bigint }>
      >(
        Prisma.sql`
          SELECT stage, COUNT(*)::bigint AS count FROM (
            SELECT 'form_view' AS stage FROM tracking_events WHERE "eventType" = 'form_view' AND "createdAt" >= ${startDate}::timestamptz AND (${siteId}::text IS NULL OR "siteId" = ${siteId})
            UNION ALL
            SELECT 'form_focus' AS stage FROM tracking_events WHERE "eventType" = 'form_focus' AND "createdAt" >= ${startDate}::timestamptz AND (${siteId}::text IS NULL OR "siteId" = ${siteId})
            UNION ALL
            SELECT 'form_submit_attempt' AS stage FROM tracking_events WHERE "eventType" = 'form_submit_attempt' AND "createdAt" >= ${startDate}::timestamptz AND (${siteId}::text IS NULL OR "siteId" = ${siteId})
            UNION ALL
            SELECT 'form_submit' AS stage FROM tracking_events WHERE "eventType" = 'form_submit' AND "createdAt" >= ${startDate}::timestamptz AND (${siteId}::text IS NULL OR "siteId" = ${siteId})
            UNION ALL
            SELECT 'form_submit_error' AS stage FROM tracking_events WHERE "eventType" = 'form_submit_error' AND "createdAt" >= ${startDate}::timestamptz AND (${siteId}::text IS NULL OR "siteId" = ${siteId})
          ) all_stages
          GROUP BY stage
          ORDER BY count DESC
        `,
      )),

      // ── 33. Visitor context (language + connection) ──
      safe(db.$queryRaw<
        Array<{ context_type: string; context_value: string; visitors: bigint }>
      >(
        Prisma.sql`
          SELECT context_type, context_value, COUNT(DISTINCT "visitorId")::bigint AS visitors FROM (
            SELECT 'language' AS context_type, COALESCE(e."metadata"->>'language', '(desconhecido)') AS context_value, e."visitorId"
            FROM tracking_events e
            WHERE e."metadata"->>'language' IS NOT NULL AND e."createdAt" >= ${startDate}::timestamptz AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
            UNION ALL
            SELECT 'connection' AS context_type, COALESCE(e."metadata"->>'connection', '(desconhecido)') AS context_value, e."visitorId"
            FROM tracking_events e
            WHERE e."metadata"->>'connection' IS NOT NULL AND e."createdAt" >= ${startDate}::timestamptz AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          ) ctx
          GROUP BY context_type, context_value
          ORDER BY context_type, visitors DESC
        `,
      )),

      // ── 34. Gallery clicks + FAQ opens ──
      safe(db.$queryRaw<
        Array<{ event_type: string; label: string; count: bigint }>
      >(
        Prisma.sql`
          SELECT event_type, label, COUNT(*)::bigint AS count FROM (
            SELECT 'gallery_click' AS event_type, COALESCE(e."eventName", 'Galeria') AS label
            FROM tracking_events e
            WHERE e."eventType" = 'gallery_click' AND e."createdAt" >= ${startDate}::timestamptz AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
            UNION ALL
            SELECT 'faq_open' AS event_type, COALESCE(e."metadata"->>'question', e."eventName", 'FAQ') AS label
            FROM tracking_events e
            WHERE e."eventType" = 'faq_open' AND e."createdAt" >= ${startDate}::timestamptz AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          ) content_events
          GROUP BY event_type, label
          ORDER BY event_type, count DESC
          LIMIT 20
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

    // New derived metrics
    const avgSessionSeconds = Number(avgSessionDuration[0]?.avg_seconds ?? 0);
    const returnVisitorsCount = Number(returningVisitors[0]?.returning ?? 0);
    const newVisitorsCount = Number(returningVisitors[0]?.new ?? 0);
    const returningRate = totalVisitors > 0 ? (returnVisitorsCount / totalVisitors) * 100 : 0;
    const exitIntents = Number(exitIntentCount[0]?.count ?? 0);
    const exitIntentRate = totalVisitors > 0 ? (exitIntents / totalVisitors) * 100 : 0;

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

    // ── By medium ──
    const mediumRows = byMedium.map((r) => ({
      medium: r.medium,
      visitors: Number(r.visitors),
      leads: Number(r.leads),
      conversionRate: Number(r.visitors) > 0 ? (Number(r.leads) / Number(r.visitors)) * 100 : 0,
    }));

    // ── By term ──
    const termRows = byTerm.map((r) => ({
      term: r.term,
      visitors: Number(r.visitors),
      leads: Number(r.leads),
      conversionRate: Number(r.visitors) > 0 ? (Number(r.leads) / Number(r.visitors)) * 100 : 0,
    }));

    // ── By event type ──
    const eventTypeRows = byEventType
      .filter((r) => r.eventType != null)
      .map((r) => ({
        eventType: r.eventType!,
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

    // ── Scroll depth ──
    const scrollDepthRows = scrollDepthData
      .map((r: any) => ({
        depth: r.depth_label ?? r.eventName ?? 'scroll_unknown',
        count: Number(r.count),
      }));

    // ── Form interactions ──
    const formInteractionRows = formInteractionData.map((r) => ({
      eventType: r.eventType,
      eventName: r.eventName,
      count: Number(r.count),
    }));

    // ── Top entry pages ──
    const entryPageRows = topEntryPages.map((r) => ({
      url: r.url,
      count: Number(r.count),
    }));

    // ── Engagement by day of week ──
    const engagementDowRows = engagementByDayOfWeek.map((r) => ({
      dow: Number(r.dow),
      dowName: r.dow_name,
      visitors: Number(r.visitors),
      leads: Number(r.leads),
      conversionRate: Number(r.visitors) > 0 ? (Number(r.leads) / Number(r.visitors)) * 100 : 0,
    }));

    // ── Web Vitals ──
    const webVitalsRows = (webVitalsData as Array<{ metric: string; avg_value: number; p75: number; count: bigint }>).map((r) => ({
      metric: r.metric,
      avgValue: Math.round(r.avg_value * 10) / 10,
      p75: Math.round(r.p75 * 10) / 10,
      count: Number(r.count),
    }));

    // ── Engaged Time ──
    const engagedTimeRows = (engagedTimeData as Array<{ seconds: number; count: bigint }>).map((r) => ({
      seconds: r.seconds,
      count: Number(r.count),
    }));

    // ── JS Errors ──
    const jsErrorRows = (jsErrorsData as Array<{ error_message: string; count: bigint; latest: string }>).map((r) => ({
      message: r.error_message,
      count: Number(r.count),
      latest: r.latest,
    }));

    // ── Section Views ──
    const sectionViewRows = (sectionViewsData as Array<{ section: string; views: bigint; unique_visitors: bigint }>).map((r) => ({
      section: r.section,
      views: Number(r.views),
      uniqueVisitors: Number(r.unique_visitors),
    }));

    // ── CTA Clicks ──
    const ctaClickRows = (ctaClicksData as Array<{ cta_text: string; section: string; clicks: bigint; unique_visitors: bigint }>).map((r) => ({
      ctaText: r.cta_text,
      section: r.section,
      clicks: Number(r.clicks),
      uniqueVisitors: Number(r.unique_visitors),
    }));

    // ── Form Funnel ──
    const formFunnelRows = (formFunnelData as Array<{ stage: string; count: bigint }>).map((r) => ({
      stage: r.stage,
      count: Number(r.count),
    }));

    // ── Visitor Context ──
    const visitorContextRows = (visitorContextData as Array<{ context_type: string; context_value: string; visitors: bigint }>).map((r) => ({
      contextType: r.context_type,
      contextValue: r.context_value,
      visitors: Number(r.visitors),
    }));

    // ── Content Engagement (gallery + FAQ) ──
    const contentEngagementRows = (contentEngagementData as Array<{ event_type: string; label: string; count: bigint }>).map((r) => ({
      eventType: r.event_type,
      label: r.label,
      count: Number(r.count),
    }));

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
        avgSessionDuration: Math.round(avgSessionSeconds * 10) / 10,
        returningVisitors: returnVisitorsCount,
        newVisitors: newVisitorsCount,
        returningRate: round2(returningRate),
        exitIntents,
        exitIntentRate: round2(exitIntentRate),
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
      byMedium: mediumRows,
      byTerm: termRows,
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
      scrollDepth: scrollDepthRows,
      formInteractions: formInteractionRows,
      topEntryPages: entryPageRows,
      engagementByDayOfWeek: engagementDowRows,
      webVitals: webVitalsRows,
      engagedTime: engagedTimeRows,
      jsErrors: jsErrorRows,
      sectionViews: sectionViewRows,
      ctaClicks: ctaClickRows,
      formFunnel: formFunnelRows,
      visitorContext: visitorContextRows,
      contentEngagement: contentEngagementRows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('[Tracking Dashboard] FULL Error:', message, '\nStack:', stack);
    return NextResponse.json(
      { error: 'Erro interno do servidor', details: message, stack: stack },
      { status: 500 },
    );
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
