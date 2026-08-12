import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';
import { Prisma } from '@prisma/client';

// Wrapper: individual query failure won't kill the entire report
const safe = <T,>(p: Promise<T>): Promise<T | []> =>
  p.catch((err: unknown) => {
    console.warn('[Tracking Report] Query failed:', (err as Error)?.message || err);
    return [] as unknown as T;
  });

// Format a date value (string or Date) to 'YYYY-MM-DD HH:mm:ss'
const fmtTs = (v: string | Date | null | undefined): string => {
  if (!v) return '—';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return s.replace('T', ' ').replace('Z', '').slice(0, 19);
};

// Negative = hours from now; Positive = calendar days from midnight
const PERIOD_DAYS: Record<string, number> = {
  '24h': -24,
  '48h': -48,
  '7d': 7,
  '15d': 15,
  '30d': 30,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmt(n: number): string {
  return new Intl.NumberFormat('pt-BR').format(n);
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

export async function GET(request: Request) {
  try {
    console.log('[Tracking Report] Starting report generation');
    const { error } = await requireAdmin();
    if (error) return error;

    const { searchParams } = new URL(request.url);
    const period = PERIOD_DAYS[searchParams.get('period') ?? '30d'] ?? 30;
    const siteId = searchParams.get('siteId') ?? null;
    console.log(`[Tracking Report] period=${period}, siteId=${siteId}`);

    const startDate = new Date();
    if (period < 0) {
      // Hour-based filter: subtract hours from now
      startDate.setHours(startDate.getHours() + period);
    } else {
      // Day-based filter: subtract calendar days, start at midnight
      startDate.setDate(startDate.getDate() - period);
      startDate.setHours(0, 0, 0, 0);
    }

    const periodLabel =
      period < 0 ? `Últimas ${Math.abs(period)} horas` : `Últimos ${period} dias`;
    const generatedAt = new Date().toISOString();

    console.log(`[Tracking Report] Fetching data since ${startDate.toISOString()}...`);
    // ── Fetch ALL data in parallel ──
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
      allLeadsWithJourney,
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
      // 1. Core KPIs
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

      // 2. Bounced visitors
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

      // 3. Daily chart
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

      // 4. Funnel
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

      // 5. By campaign
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

      // 6. By source
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

      // 7. By UTM content
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

      // 8. By UTM medium (extra for report)
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

      // 9. By UTM term (extra for report)
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

      // 10. By event type
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

      // 11. Top pages
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

      // 12. Top countries
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

      // 13. Top cities
      safe(db.$queryRaw<
        Array<{
          city: string;
          country: string;
          visitors: bigint;
          leads: bigint;
        }>
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

      // 14. Device breakdown
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

      // 15. Hourly distribution
      safe(db.$queryRaw<
        Array<{
          hour: number;
          visitors: bigint;
          events: bigint;
          leads: bigint;
        }>
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

      // 16. All converted leads (no limit)
      safe(db.$queryRaw<
        Array<{
          visitorId: string;
          leadId: string;
          country: string | null;
          city: string | null;
          utmSource: string | null;
          utmCampaign: string | null;
          utmContent: string | null;
          utmMedium: string | null;
          utmTerm: string | null;
          pageUrl: string | null;
          convertedAt: string;
          clientName: string | null;
          firstSeenAt: string | null;
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
            e."utmMedium",
            e."utmTerm",
            e."pageUrl",
            e."createdAt" AS "convertedAt",
            c.name AS "clientName",
            v."firstSeenAt"
          FROM tracking_visitors v
          JOIN tracking_events e ON e."visitorId" = v."visitorId"
          LEFT JOIN clients c ON c.id = v."leadId"
          WHERE v."leadId" IS NOT NULL
            AND e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          ORDER BY v."visitorId", e."createdAt" DESC
        `,
      )),

      // 17. All leads with full event journey
      safe(db.$queryRaw<
        Array<{
          visitorId: string;
          sessionId: string;
          eventType: string;
          eventName: string | null;
          pageUrl: string | null;
          createdAt: string;
          metadata: unknown;
        }>
      >(
        Prisma.sql`
          SELECT
            e."visitorId",
            e."sessionId",
            e."eventType",
            e."eventName",
            e."pageUrl",
            e."createdAt",
            e."metadata"
          FROM tracking_events e
          WHERE e."visitorId" IN (
            SELECT DISTINCT v."visitorId"
            FROM tracking_visitors v
            WHERE v."leadId" IS NOT NULL
              AND v."lastSeenAt" >= ${startDate}::timestamptz
              AND (${siteId}::text IS NULL OR v."siteId" = ${siteId})
          )
          AND e."createdAt" >= ${startDate}::timestamptz
          ORDER BY e."visitorId", e."createdAt" ASC
        `,
      )),

      // 18. Referrer breakdown
      safe(db.$queryRaw<
        Array<{ referrer: string; visitors: bigint; leads: bigint }>
      >(
        Prisma.sql`
          SELECT
            CASE
              WHEN e."referrer" IS NULL OR e."referrer" = '' THEN '(direto)'
              WHEN e."referrer" ~* 'facebook\\.com|fb\\.com' THEN 'Facebook'
              WHEN e."referrer" ~* 'instagram\\.com' THEN 'Instagram'
              WHEN e."referrer" ~* 'google\\.com' THEN 'Google'
              WHEN e."referrer" ~* 'whatsapp\\.com|wa\\.me' THEN 'WhatsApp'
              WHEN e."referrer" ~* 'linkedin\\.com' THEN 'LinkedIn'
              WHEN e."referrer" ~* 'tiktok\\.com' THEN 'TikTok'
              WHEN e."referrer" ~* 'youtube\\.com' THEN 'YouTube'
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
            WHEN e."referrer" ~* 'facebook\\.com|fb\\.com' THEN 'Facebook'
            WHEN e."referrer" ~* 'instagram\\.com' THEN 'Instagram'
            WHEN e."referrer" ~* 'google\\.com' THEN 'Google'
            WHEN e."referrer" ~* 'whatsapp\\.com|wa\\.me' THEN 'WhatsApp'
            WHEN e."referrer" ~* 'linkedin\\.com' THEN 'LinkedIn'
            WHEN e."referrer" ~* 'tiktok\\.com' THEN 'TikTok'
            WHEN e."referrer" ~* 'youtube\\.com' THEN 'YouTube'
            ELSE SUBSTRING(e."referrer" FROM 'https?://([^/]+)')
          END
          ORDER BY visitors DESC
          LIMIT 10
        `,
      )),

      // 19. Meta pixel leads
      safe(db.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`
          SELECT COUNT(DISTINCT e."visitorId")::bigint AS count
          FROM tracking_events e
          WHERE e."createdAt" >= ${startDate}::timestamptz
            AND (e."eventType" = 'lead' OR e."eventType" = 'form_submit')
            AND (LOWER(e."utmSource") LIKE '%meta%' OR LOWER(e."utmSource") LIKE '%facebook%' OR LOWER(e."utmSource") LIKE '%ig%' OR LOWER(e."utmSource") LIKE '%instagram%' OR LOWER(e."utmSource") LIKE '%fb%')
        `,
      )),

      // 20. CRM Meta leads
      safe(db.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`
          SELECT COUNT(*)::bigint AS count
          FROM clients
          WHERE "notes" LIKE '%[Meta Ads]%'
            AND "createdAt" >= ${startDate}::timestamptz
        `,
      )),

      // 21. Meta matched
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

      // 22. Scroll depth distribution
      safe(db.$queryRaw<
        Array<{ eventName: string; count: bigint }>
      >(
        Prisma.sql`
          SELECT e."eventName", COUNT(*)::bigint AS count
          FROM tracking_events e
          WHERE e."eventType" = 'scroll_depth'
            AND e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY e."eventName"
          ORDER BY count DESC
        `,
      )),

      // 23. Form interaction events
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

      // 24. Exit intent count
      safe(db.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`
          SELECT COUNT(*)::bigint AS count
          FROM tracking_events e
          WHERE e."eventType" = 'exit_intent'
            AND e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
        `,
      )),

      // 25. Top entry pages
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

      // 26. Average session duration (approx)
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

      // 27. Returning visitors (visitors with events on 2+ different days)
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

      // 28. Engagement by day of week
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

      // 29. WhatsApp clicks (unique visitors)
      safe(db.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`
          SELECT COUNT(DISTINCT e."visitorId")::bigint AS count
          FROM tracking_events e
          WHERE e."eventType" = 'whatsapp_click'
            AND e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
        `,
      )),
      // Web Vitals summary
      safe(db.$queryRaw<
        Array<{ metric: string; avg_value: number; p75: number; count: bigint }>
      >(
        Prisma.sql`
          SELECT
            e."eventName" AS metric,
            ROUND(AVG((e."metadata"->>'value')::numeric))::float AS avg_value,
            ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY (e."metadata"->>'value')::numeric))::float AS p75,
            COUNT(*)::bigint AS count
          FROM tracking_events e
          WHERE e."eventType" = 'web_vital'
            AND e."eventName" IS NOT NULL
            AND e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY e."eventName"
          ORDER BY count DESC
        `,
      )),
      // Engaged time distribution
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
      // JS Errors
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
      // Section views
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
      // CTA clicks
      safe(db.$queryRaw<
        Array<{ cta_text: string; section: string; clicks: bigint; unique_visitors: bigint }>
      >(
        Prisma.sql`
          SELECT
            COALESCE(e."metadata"->>'cta_text', e."eventName", '(sem texto)') AS cta_text,
            COALESCE(e."metadata"->>'section', '(nao definida)') AS section,
            COUNT(*)::bigint AS clicks,
            COUNT(DISTINCT e."visitorId")::bigint AS unique_visitors
          FROM tracking_events e
          WHERE e."eventType" = 'cta_click'
            AND e."createdAt" >= ${startDate}::timestamptz
            AND (${siteId}::text IS NULL OR e."siteId" = ${siteId})
          GROUP BY COALESCE(e."metadata"->>'cta_text', e."eventName", '(sem texto)'), COALESCE(e."metadata"->>'section', '(nao definida)')
          ORDER BY clicks DESC
          LIMIT 10
        `,
      )),
      // Form funnel
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
      // Visitor context (language + connection)
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
      // Content engagement (gallery + FAQ)
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

    console.log('[Tracking Report] Queries completed, building markdown...');

    // ── Compute derived metrics ──
    const totalVisitors = Number(kpis[0]?.totalVisitors ?? 0);
    const totalPageviews = Number(kpis[0]?.totalPageviews ?? 0);
    const totalEvents = Number(kpis[0]?.totalEvents ?? 0);
    const uniqueLeads = Number(kpis[0]?.uniqueLeads ?? 0);
    const uniqueSessions = Number(kpis[0]?.uniqueSessions ?? 0);
    const bounced = Number(bouncedVisitors[0]?.count ?? 0);

    const conversionRate =
      totalVisitors > 0 ? (uniqueLeads / totalVisitors) * 100 : 0;
    const avgEventsPerVisitor =
      totalVisitors > 0 ? totalEvents / totalVisitors : 0;
    const bounceRate =
      totalVisitors > 0 ? (bounced / totalVisitors) * 100 : 0;
    const pageviewsPerSession =
      uniqueSessions > 0 ? totalPageviews / uniqueSessions : 0;
    const avgSessionSeconds = Number(
      avgSessionDuration[0]?.avg_seconds ?? 0,
    );
    const returnVisitors = Number(returningVisitors[0]?.returning ?? 0);
    const newVisitors = Number(returningVisitors[0]?.new ?? 0);
    const exitIntents = Number(exitIntentCount[0]?.count ?? 0);
    const whatsappClicksCount = Number(whatsappClicks[0]?.count ?? 0);
    const totalConversions = uniqueLeads + whatsappClicksCount;
    const realConversionRate =
      totalVisitors > 0 ? (totalConversions / totalVisitors) * 100 : 0;

    const pixelLeads = Number(metaPixelLeads[0]?.count ?? 0);
    const crmMetaLeads = Number(metaCrmLeads[0]?.count ?? 0);
    const matched = Number(metaMatched[0]?.count ?? 0);
    const matchRate = pixelLeads > 0 ? (matched / pixelLeads) * 100 : 0;

    // Funnel
    const pageviewCount = Number(
      funnelData.find((f) => f.stage === 'pageview')?.count ?? 0,
    );
    const engagementCount = Number(
      funnelData.find((f) => f.stage === 'engagement')?.count ?? 0,
    );
    const leadCount = Number(
      funnelData.find((f) => f.stage === 'lead')?.count ?? 0,
    );

    // ── Build markdown ──
    const md: string[] = [];

    const line = (s: string = '') => md.push(s);
    const h1 = (s: string) => { line(`# ${s}`); line(); };
    const h2 = (s: string) => { line(`## ${s}`); line(); };
    const h3 = (s: string) => { line(`### ${s}`); line(); };
    const p = (s: string) => { line(s); line(); };
    const bullet = (s: string) => line(`- ${s}`);
    const bulletNum = (n: number, s: string) => line(`${n}. ${s}`);
    const table = (headers: string[], rows: string[][]) => {
      line('| ' + headers.join(' | ') + ' |');
      line('|' + headers.map(() => '---').join('|') + '|');
      for (const row of rows) { line('| ' + row.join(' | ') + ' |'); }
      line();
    };

    // ──────────────────────────────────────────
    // HEADER
    // ──────────────────────────────────────────
    h1('Relatório de Tracking de Visitantes');
    p(`**Período:** ${periodLabel} (${startDate.toISOString().split('T')[0]} a ${new Date().toISOString().split('T')[0]})`);
    p(`**Gerado em:** ${generatedAt}`);
    if (siteId) p(`**Site ID:** ${siteId}`);
    line('---');
    line();

    // ──────────────────────────────────────────
    // 1. RESUMO EXECUTIVO
    // ──────────────────────────────────────────
    h2('1. Resumo Executivo');
    p(
      `No período analisado, a landing page registrou **${fmt(totalVisitors)} visitantes únicos** que geraram **${fmt(totalPageviews)} visualizações de página** e **${fmt(totalEvents)} eventos de tracking**. Foram capturados **${fmt(uniqueLeads)} leads** rastreados e **${fmt(whatsappClicksCount)} cliques em WhatsApp**, totalizando **${fmt(totalConversions)} conversões** (taxa real: **${pct(round2(realConversionRate))}**). A taxa de conversão por formulário é de **${pct(round2(conversionRate))}**. A taxa de rejeição ficou em **${pct(round2(bounceRate))}** e os visitantes interagiram com uma média de **${round2(avgEventsPerVisitor)} eventos cada**.`,
    );
    if (totalConversions > 0) {
      p(
        `O funil de conversão mostra que de ${fmt(pageviewCount)} visitantes que visualizaram a página, ${fmt(engagementCount)} engajaram (>1 evento), ${fmt(whatsappClicksCount)} clicaram em WhatsApp e ${fmt(leadCount)} preencheram o formulário. A taxa de engajamento é de ${pct(round2(pageviewCount > 0 ? (engagementCount / pageviewCount) * 100 : 0))}.`,
      );
    }

    // ──────────────────────────────────────────
    // 2. KPIs DETALHADOS
    // ──────────────────────────────────────────
    h2('2. Indicadores-Chave (KPIs)');
    line('| Indicador | Valor |');
    line('|-----------|-------|');
    line(`| Visitantes Únicos | ${fmt(totalVisitors)} |`);
    line(`| Pageviews Totais | ${fmt(totalPageviews)} |`);
    line(`| Eventos Totais | ${fmt(totalEvents)} |`);
    line(`| Leads Rastreados | ${fmt(uniqueLeads)} |`);
    line(`| Cliques em WhatsApp | ${fmt(whatsappClicksCount)} |`);
    line(`| Total de Conversões (leads + WhatsApp) | ${fmt(totalConversions)} |`);
    line(`| Sessões Únicas | ${fmt(uniqueSessions)} |`);
    line(`| Taxa de Conversão Real (visitante → qualquer conversão) | ${pct(round2(realConversionRate))} |`);
    line(`| Taxa de Conversão por Formulário (visitante → lead) | ${pct(round2(conversionRate))} |`);
    line(`| Taxa de Rejeição | ${pct(round2(bounceRate))} |`);
    line(`| Eventos por Visitante | ${round2(avgEventsPerVisitor)} |`);
    line(`| Pageviews por Sessão | ${round2(pageviewsPerSession)} |`);
    line(`| Duração Média da Sessão | ${avgSessionSeconds > 0 ? `${Math.round(avgSessionSeconds)}s (~${Math.round(avgSessionSeconds / 60)}min)` : 'N/A'} |`);
    line(`| Visitantes Novos | ${fmt(newVisitors)} |`);
    line(`| Visitantes Recorrentes | ${fmt(returnVisitors)} |`);
    line(`| Taxa de Retorno | ${newVisitors > 0 ? pct(round2((returnVisitors / (newVisitors + returnVisitors)) * 100)) : 'N/A'} |`);
    line(`| Intenções de Saída (exit_intent) | ${fmt(exitIntents)} |`);
    line();

    // ──────────────────────────────────────────
    // 3. FUNIL DE CONVERSÃO
    // ──────────────────────────────────────────
    h2('3. Funil de Conversão');
    line('| Etapa | Quantidade | Taxa | Drop-off |');
    line('|-------|-----------|------|----------|');
    line(
      `| Visualização de Página | ${fmt(pageviewCount)} | 100% | — |`,
    );
    const engRate =
      pageviewCount > 0
        ? round2((engagementCount / pageviewCount) * 100)
        : 0;
    const engDrop =
      pageviewCount > 0
        ? round2(((pageviewCount - engagementCount) / pageviewCount) * 100)
        : 0;
    line(
      `| Engajamento | ${fmt(engagementCount)} | ${pct(engRate)} | -${pct(engDrop)} |`,
    );
    const waRate =
      pageviewCount > 0
        ? round2((whatsappClicksCount / pageviewCount) * 100)
        : 0;
    const waDrop =
      engagementCount > 0
        ? round2(((engagementCount - whatsappClicksCount) / engagementCount) * 100)
        : 0;
    line(
      `| Clique em WhatsApp | ${fmt(whatsappClicksCount)} | ${pct(waRate)} | -${pct(waDrop)} |`,
    );
    const leadRate =
      pageviewCount > 0
        ? round2((leadCount / pageviewCount) * 100)
        : 0;
    const leadDrop =
      whatsappClicksCount > 0
        ? round2(((whatsappClicksCount - leadCount) / whatsappClicksCount) * 100)
        : 0;
    line(
      `| Lead Capturado | ${fmt(leadCount)} | ${pct(leadRate)} | -${pct(leadDrop)} |`,
    );
    line();

    // ──────────────────────────────────────────
    // 4. TENDÊNCIA DIÁRIA
    // ──────────────────────────────────────────
    h2('4. Tendência Diária');
    line('| Data | Visitantes | Pageviews | Leads | Eventos | Conversão |');
    line('|------|-----------|-----------|-------|--------|----------|');
    for (const d of chartData) {
      const v = Number(d.visitors);
      const cv = round2(v > 0 ? (Number(d.leads) / v) * 100 : 0);
      line(
        `| ${d.date} | ${fmt(v)} | ${fmt(Number(d.pageviews))} | ${fmt(Number(d.leads))} | ${fmt(Number(d.events))} | ${pct(cv)} |`,
      );
    }
    line();

    // ──────────────────────────────────────────
    // 5. DISTRIBUIÇÃO HORÁRIA
    // ──────────────────────────────────────────
    h2('5. Distribuição Horária de Atividade');
    line('| Hora | Visitantes | Eventos | Leads |');
    line('|------|-----------|---------|-------|');
    for (const h of hourlyData) {
      line(
        `| ${String(h.hour).padStart(2, '0')}:00 | ${fmt(Number(h.visitors))} | ${fmt(Number(h.events))} | ${fmt(Number(h.leads))} |`,
      );
    }
    line();

    // ──────────────────────────────────────────
    // 6. DIA DA SEMANA
    // ──────────────────────────────────────────
    h2('6. Engajamento por Dia da Semana');
    line('| Dia | Visitantes | Leads | Conversão |');
    line('|-----|-----------|-------|----------|');
    for (const d of engagementByDayOfWeek) {
      const v = Number(d.visitors);
      const cv = round2(v > 0 ? (Number(d.leads) / v) * 100 : 0);
      line(
        `| ${d.dow_name.trim()} | ${fmt(v)} | ${fmt(Number(d.leads))} | ${pct(cv)} |`,
      );
    }
    line();

    // ──────────────────────────────────────────
    // 7. FONTES DE TRÁFEGO (UTM)
    // ──────────────────────────────────────────
    h2('7. Análise de Fontes de Tráfego (UTM)');

    h3('7.1. Por utm_source');
    line('| Fonte | Visitantes | Leads | Conversão |');
    line('|-------|-----------|-------|----------|');
    for (const r of bySource) {
      const v = Number(r.visitors);
      line(
        `| ${r.source} | ${fmt(v)} | ${fmt(Number(r.leads))} | ${pct(round2(v > 0 ? (Number(r.leads) / v) * 100 : 0))} |`,
      );
    }
    line();

    h3('7.2. Por utm_medium');
    line('| Medium | Visitantes | Leads | Conversão |');
    line('|--------|-----------|-------|----------|');
    for (const r of byMedium) {
      const v = Number(r.visitors);
      line(
        `| ${r.medium} | ${fmt(v)} | ${fmt(Number(r.leads))} | ${pct(round2(v > 0 ? (Number(r.leads) / v) * 100 : 0))} |`,
      );
    }
    line();

    h3('7.3. Por utm_campaign');
    line('| Campanha | Visitantes | Leads | Conversão |');
    line('|----------|-----------|-------|----------|');
    for (const r of byCampaign) {
      const v = Number(r.visitors);
      line(
        `| ${r.campaign} | ${fmt(v)} | ${fmt(Number(r.leads))} | ${pct(round2(v > 0 ? (Number(r.leads) / v) * 100 : 0))} |`,
      );
    }
    line();

    h3('7.4. Por utm_content (Criativo)');
    line('| Criativo | Visitantes | Leads | Conversão |');
    line('|----------|-----------|-------|----------|');
    for (const r of byContent) {
      const v = Number(r.visitors);
      line(
        `| ${r.content} | ${fmt(v)} | ${fmt(Number(r.leads))} | ${pct(round2(v > 0 ? (Number(r.leads) / v) * 100 : 0))} |`,
      );
    }
    line();

    h3('7.5. Por utm_term');
    line('| Termo | Visitantes | Leads | Conversão |');
    line('|-------|-----------|-------|----------|');
    for (const r of byTerm) {
      const v = Number(r.visitors);
      line(
        `| ${r.term} | ${fmt(v)} | ${fmt(Number(r.leads))} | ${pct(round2(v > 0 ? (Number(r.leads) / v) * 100 : 0))} |`,
      );
    }
    line();

    // ──────────────────────────────────────────
    // 8. REFERRERS
    // ──────────────────────────────────────────
    h2('8. Referrers (Origem do Tráfego)');
    line('| Referrer | Visitantes | Leads | Conversão |');
    line('|---------|-----------|-------|----------|');
    for (const r of referrerBreakdown) {
      const v = Number(r.visitors);
      line(
        `| ${r.referrer} | ${fmt(v)} | ${fmt(Number(r.leads))} | ${pct(round2(v > 0 ? (Number(r.leads) / v) * 100 : 0))} |`,
      );
    }
    line();

    // ──────────────────────────────────────────
    // 9. PÁGINAS
    // ──────────────────────────────────────────
    h2('9. Páginas');

    h3('9.1. Páginas Mais Visitadas');
    line('| URL | Pageviews | Leads | Conversão |');
    line('|-----|-----------|-------|----------|');
    for (const r of topPages) {
      const v = Number(r.views);
      line(
        `| ${r.url} | ${fmt(v)} | ${fmt(Number(r.leads))} | ${pct(round2(v > 0 ? (Number(r.leads) / v) * 100 : 0))} |`,
      );
    }
    line();

    if (topEntryPages.length > 0) {
      h3('9.2. Páginas de Entrada (top 10)');
      line('| URL | Visitantes que Entraram |');
      line('|-----|----------------------|');
      for (const r of topEntryPages) {
        line(`| ${r.url} | ${fmt(Number(r.count))} |`);
      }
      line();
    }

    // ──────────────────────────────────────────
    // 10. DISPOSITIVOS
    // ──────────────────────────────────────────
    h2('10. Dispositivos');
    const totalDev = deviceBreakdown.reduce(
      (s, d) => s + Number(d.visitors),
      0,
    );
    line('| Dispositivo | Visitantes | Share | Leads |');
    line('|------------|-----------|-------|-------|');
    for (const r of deviceBreakdown) {
      const v = Number(r.visitors);
      const share = totalDev > 0 ? (v / totalDev) * 100 : 0;
      line(
        `| ${r.device} | ${fmt(v)} | ${pct(round2(share))} | ${fmt(Number(r.leads))} |`,
      );
    }
    line();

    // ──────────────────────────────────────────
    // 11. GEOGRAFIA
    // ──────────────────────────────────────────
    h2('11. Geografia');

    h3('11.1. Países');
    line('| País | Visitantes | Leads |');
    line('|------|-----------|-------|');
    for (const r of topCountries) {
      line(
        `| ${r.country} | ${fmt(Number(r.visitors))} | ${fmt(Number(r.leads))} |`,
      );
    }
    line();

    h3('11.2. Cidades');
    line('| Cidade | País | Visitantes | Leads |');
    line('|--------|------|-----------|-------|');
    for (const r of topCities) {
      line(
        `| ${r.city} | ${r.country || '—'} | ${fmt(Number(r.visitors))} | ${fmt(Number(r.leads))} |`,
      );
    }
    line();

    // ──────────────────────────────────────────
    // 12. DISTRIBUIÇÃO DE EVENTOS
    // ──────────────────────────────────────────
    h2('12. Distribuição de Eventos por Tipo');
    const totalEvts = byEventType.reduce(
      (s, e) => s + Number(e.count),
      0,
    );
    line('| Tipo de Evento | Quantidade | Share |');
    line('|---------------|-----------|-------|');
    for (const r of byEventType) {
      const c = Number(r.count);
      const share = totalEvts > 0 ? (c / totalEvts) * 100 : 0;
      line(
        `| ${r.eventType.replace(/_/g, ' ')} | ${fmt(c)} | ${pct(round2(share))} |`,
      );
    }
    line();

    // ──────────────────────────────────────────
    // 13. COMPORTAMENTO DE CONTEÚDO
    // ──────────────────────────────────────────
    h2('13. Comportamento de Consumo de Conteúdo');

    if (scrollDepthData.length > 0) {
      h3('13.1. Profundidade de Scroll');
      line('| Limite | Eventos Registrados |');
      line('|--------|-------------------|');
      for (const r of scrollDepthData) {
        line(`| ${r.eventName} | ${fmt(Number(r.count))} |`);
      }
      line();
    }

    if (formInteractionData.length > 0) {
      h3('13.2. Interações com Formulário');
      line('| Tipo | Campo/Evento | Quantidade |');
      line('|------|-------------|-----------|');
      for (const r of formInteractionData) {
        line(
          `| ${r.eventType} | ${r.eventName ?? '—'} | ${fmt(Number(r.count))} |`,
        );
      }
      line();
    }

    if (exitIntents > 0) {
      h3('13.3. Intenções de Saída (Exit Intent)');
      p(
        `Foram registradas **${fmt(exitIntents)}** intenções de saída (mouse leaving viewport). Isso representa ${totalVisitors > 0 ? pct(round2((exitIntents / totalVisitors) * 100)) : 'N/A'} dos visitantes.`,
      );
    }

    // ──────────────────────────────────────────
    // 14. TODOS OS LEADS DO PERÍODO
    // ──────────────────────────────────────────
    h2('14. Todos os Leads Capturados no Período');
    if (recentLeads.length === 0) {
      p('Nenhum lead rastreado no período.');
    } else {
      p(`Total: **${recentLeads.length}** leads`);
      line();
      line(
        '| # | Nome | Fonte | Campanha | Medium | Conteúdo | Cidade | País | Página | Primeira Visita | Conversão |',
      );
      line(
        '|---|------|-------|----------|--------|----------|--------|------|--------|---------------|----------|',
      );
      recentLeads.forEach((lead, idx) => {
        line(
          `| ${idx + 1} | ${lead.clientName ?? '—'} | ${lead.utmSource ?? '—'} | ${lead.utmCampaign ?? '—'} | ${lead.utmMedium ?? '—'} | ${lead.utmContent ?? '—'} | ${lead.city ?? '—'} | ${lead.country ?? '—'} | ${lead.pageUrl ?? '—'} | ${fmtTs(lead.firstSeenAt)} | ${fmtTs(lead.convertedAt)} |`,
        );
      });
      line();
    }

    // ──────────────────────────────────────────
    // 15. JORNADA COMPLETA DOS LEADS
    // ──────────────────────────────────────────
    h2('15. Jornada Completa dos Leads (Eventos Individuais)');
    if (allLeadsWithJourney.length === 0) {
      p('Sem dados de jornada.');
    } else {
      p(
        'Abaixo, cada lead e sua sequência completa de eventos no período:',
      );
      line();

      // Group by visitor
      const grouped = new Map<
        string,
        (typeof allLeadsWithJourney)[number][]
      >();
      for (const ev of allLeadsWithJourney) {
        const list = grouped.get(ev.visitorId) ?? [];
        list.push(ev);
        grouped.set(ev.visitorId, list);
      }

      let leadNum = 0;
      for (const [visitorId, events] of grouped) {
        const leadInfo = recentLeads.find(
          (l) => l.visitorId === visitorId,
        );
        leadNum++;
        h3(`Lead ${leadNum}: ${leadInfo?.clientName ?? 'Sem nome'}`);
        if (leadInfo) {
          bullet(`**Fonte:** ${leadInfo.utmSource ?? '—'}`);
          bullet(`**Campanha:** ${leadInfo.utmCampaign ?? '—'}`);
          bullet(`**Cidade/País:** ${[leadInfo.city, leadInfo.country].filter(Boolean).join(', ') || '—'}`);
          bullet(`**Página:** ${leadInfo.pageUrl ?? '—'}`);
          line();
        }
        line('| # | Timestamp | Tipo | Nome | Página |');
        line('|---|-----------|------|------|--------|');
        events.forEach((ev, i) => {
          const ts = fmtTs(ev.createdAt);
          line(
            `| ${i + 1} | ${ts} | ${ev.eventType} | ${ev.eventName ?? '—'} | ${ev.pageUrl ?? '—'} |`,
          );
        });
        line();
      }
    }

    // ──────────────────────────────────────────
    // 16. DISCREPÂNCIA META PIXEL vs CRM
    // ──────────────────────────────────────────
    h2('16. Discrepância Meta Pixel vs CRM');
    line('| Métrica | Quantidade |');
    line('|---------|-----------|');
    line(`| Leads detectados pelo Pixel (utm_source meta/facebook + evento lead/form_submit) | ${fmt(pixelLeads)} |`);
    line(`| Leads registrados no CRM com tag [Meta Ads] | ${fmt(crmMetaLeads)} |`);
    line(`| Leads com match (pixel E CRM) | ${fmt(matched)} |`);
    line(`| **Match Rate** | **${pct(round2(matchRate))}** |`);
    line();
    if (matchRate < 50) {
      p(
        '**⚠️ Atenção:** A taxa de match é baixa. Possíveis causas: UTM params ausentes nos anúncios, falha na vinculação do visitor ao lead no CRM, ou leads capturados por outros canais sendo contabilizados no CRM mas não no pixel.',
      );
    } else if (matchRate < 80) {
      p(
        '**Atenção:** A taxa de match é parcial. Verifique se os parâmetros UTM estão configurados corretamente em todos os anúncios e se o pixel está sendo carregado em todas as landing pages.',
      );
    } else {
      p('A concordância entre pixel e CRM é boa.');
    }
    line();

    // ──────────────────────────────────────────
    // 17. INSIGHTS PARA OTIMIZAÇÃO DE CAMPANHA
    // ──────────────────────────────────────────
    h2('17. Insights e Recomendações para Otimização de Campanha');
    p(
      'Esta seção contém dados brutos e observações extraídas automaticamente para serem usados como contexto por uma IA de otimização de campanhas:',
    );
    line();

    // Best converting campaigns
    const campaignsSorted = [...byCampaign]
      .map((r) => ({
        campaign: r.campaign,
        visitors: Number(r.visitors),
        leads: Number(r.leads),
        cr: Number(r.visitors) > 0
          ? round2((Number(r.leads) / Number(r.visitors)) * 100)
          : 0,
      }))
      .filter((c) => c.campaign !== '(sem campanha)')
      .sort((a, b) => b.cr - a.cr);

    if (campaignsSorted.length > 0) {
      h3('17.1. Campanhas por Taxa de Conversão (ranking)');
      for (const c of campaignsSorted) {
        bullet(
          `**${c.campaign}** → ${fmt(c.visitors)} visitantes, ${fmt(c.leads)} leads, CR=${pct(c.cr)}`,
        );
      }
      line();
    }

    // Best converting sources
    const sourcesSorted = [...bySource]
      .map((r) => ({
        source: r.source,
        visitors: Number(r.visitors),
        leads: Number(r.leads),
        cr: Number(r.visitors) > 0
          ? round2((Number(r.leads) / Number(r.visitors)) * 100)
          : 0,
      }))
      .sort((a, b) => b.cr - a.cr);

    if (sourcesSorted.length > 0) {
      h3('17.2. Fontes por Taxa de Conversão (ranking)');
      for (const s of sourcesSorted) {
        bullet(
          `**${s.source}** → ${fmt(s.visitors)} visitantes, ${fmt(s.leads)} leads, CR=${pct(s.cr)}`,
        );
      }
      line();
    }

    // Best converting creatives
    const creativesSorted = [...byContent]
      .map((r) => ({
        content: r.content,
        visitors: Number(r.visitors),
        leads: Number(r.leads),
        cr: Number(r.visitors) > 0
          ? round2((Number(r.leads) / Number(r.visitors)) * 100)
          : 0,
      }))
      .filter((c) => c.content !== '(sem conteúdo)')
      .sort((a, b) => b.cr - a.cr);

    if (creativesSorted.length > 0) {
      h3('17.3. Criativos por Taxa de Conversão (ranking)');
      for (const c of creativesSorted) {
        bullet(
          `**${c.content}** → ${fmt(c.visitors)} visitantes, ${fmt(c.leads)} leads, CR=${pct(c.cr)}`,
        );
      }
      line();
    }

    // Peak hours
    if (hourlyData.length > 0) {
      const peakHours = [...hourlyData]
        .sort(
          (a, b) =>
            Number(b.visitors) - Number(a.visitors),
        )
        .slice(0, 5);
      h3('17.4. Horários de Pico (top 5 por visitantes)');
      for (const h of peakHours) {
        bullet(
          `**${String(h.hour).padStart(2, '0')}:00** → ${fmt(Number(h.visitors))} visitantes, ${fmt(Number(h.leads))} leads`,
        );
      }
      line();
    }

    // Best days
    if (engagementByDayOfWeek.length > 0) {
      const bestDays = [...engagementByDayOfWeek]
        .map((d) => ({
          day: d.dow_name.trim(),
          visitors: Number(d.visitors),
          leads: Number(d.leads),
          cr:
            Number(d.visitors) > 0
              ? round2(
                  (Number(d.leads) / Number(d.visitors)) *
                    100,
                )
              : 0,
        }))
        .sort((a, b) => b.leads - a.leads);
      h3('17.5. Melhores Dias da Semana (por leads)');
      for (const d of bestDays) {
        bullet(
          `**${d.day}** → ${fmt(d.visitors)} visitantes, ${fmt(d.leads)} leads, CR=${pct(d.cr)}`,
        );
      }
      line();
    }

    // Device insights
    if (deviceBreakdown.length > 0) {
      h3('17.6. Conversão por Dispositivo');
      for (const d of deviceBreakdown) {
        const v = Number(d.visitors);
        const cr = round2(
          v > 0 ? (Number(d.leads) / v) * 100 : 0,
        );
        bullet(
          `**${d.device}** → ${fmt(v)} visitantes (${totalDev > 0 ? pct(round2((v / totalDev) * 100)) : '0%'}), ${fmt(Number(d.leads))} leads, CR=${pct(cr)}`,
        );
      }
      line();
    }

    // Form abandonment analysis
    if (formInteractionData.length > 0) {
      const abandons = formInteractionData.filter(
        (f) => f.eventType === 'form_abandon',
      );
      const submits = formInteractionData.filter(
        (f) => f.eventType === 'form_submit',
      );
      const totalAbandon = abandons.reduce(
        (s, a) => s + Number(a.count),
        0,
      );
      const totalSubmit = submits.reduce(
        (s, a) => s + Number(a.count),
        0,
      );
      h3('17.7. Análise de Abandono de Formulário');
      p(
        `Formulários abandonados: **${fmt(totalAbandon)}** | Submetidos: **${fmt(totalSubmit)}** | Taxa de abandono: ${totalAbandon + totalSubmit > 0 ? pct(round2((totalAbandon / (totalAbandon + totalSubmit)) * 100)) : 'N/A'}`,
      );
      if (abandons.length > 0) {
        p('Campos com maior incidência de abandono:');
        for (const a of abandons.slice(0, 10)) {
          bullet(
            `**${a.eventName ?? 'campo desconhecido'}**: ${fmt(Number(a.count))} abandonos`,
          );
        }
      }
      line();
    }

    // Page-level conversion analysis
    if (topPages.length > 0) {
      h3('17.8. Páginas por Taxa de Conversão (ranking)');
      const pagesSorted = [...topPages]
        .map((r) => ({
          url: r.url,
          views: Number(r.views),
          leads: Number(r.leads),
          cr: Number(r.views) > 0
            ? round2((Number(r.leads) / Number(r.views)) * 100)
            : 0,
        }))
        .sort((a, b) => b.cr - a.cr);
      for (const pg of pagesSorted) {
        bullet(
          `**${pg.url}** → ${fmt(pg.views)} views, ${fmt(pg.leads)} leads, CR=${pct(pg.cr)}`,
        );
      }
      line();
    }

    // ──────────────────────────────────────────
    // 18. METADATA
    // ──────────────────────────────────────────
    h2('18. Metadados do Relatório');
    line('| Campo | Valor |');
    line('|-------|-------|');
    line(`| Período | ${periodLabel} |`);
    line(
      `| Data Início | ${startDate.toISOString().split('T')[0]} |`,
    );
    line(
      `| Data Fim | ${new Date().toISOString().split('T')[0]} |`,
    );
    line(`| Gerado em | ${generatedAt} |`);
    line(
      `| Total de Registros Processados | ${fmt(totalEvents)} eventos, ${fmt(totalVisitors)} visitantes |`,
    );
    line(`| Site ID | ${siteId ?? 'todos'} |`);
    line();

    // ──────────────────────────────────────────
    // 19. JORNADA COMPLETA DOS LEADS (TABELA RESUMIDA)
    // ──────────────────────────────────────────
    h2('19. Jornada Completa dos Leads (Visão Consolidada)');
    p('Esta seção apresenta uma visão consolidada da jornada de cada lead, com métricas de engajamento e tempo até conversão. Para o detalhamento evento a evento, consulte a Seção 15.');
    line();
    if (recentLeads.length === 0) {
      p('Nenhum lead rastreado no período.');
    } else {
      // Build journey summary from allLeadsWithJourney grouped by visitorId
      const journeyMap = new Map<string, (typeof allLeadsWithJourney)[number][]>();
      for (const ev of allLeadsWithJourney) {
        const list = journeyMap.get(ev.visitorId) ?? [];
        list.push(ev);
        journeyMap.set(ev.visitorId, list);
      }

      // Sort leads by convertedAt DESC, limit 30
      const leadsForTable = [...recentLeads]
        .sort((a, b) => {
          const da = a.convertedAt ? new Date(a.convertedAt).getTime() : 0;
          const db = b.convertedAt ? new Date(b.convertedAt).getTime() : 0;
          return db - da;
        })
        .slice(0, 30);

      line('| Lead | Origem (utm_source) | Campanha | Medium | Conteúdo | Termo | Página | Primeiro Evento | Último Evento | Total Eventos | Tempo até Conversão |');
      line('|------|--------------------|----------|--------|----------|-------|--------|---------------|-------------|-------------|-------------------|');

      for (const lead of leadsForTable) {
        const journey = journeyMap.get(lead.visitorId);
        const totalEvents = journey ? journey.length : 0;
        const firstEvent = journey && journey.length > 0 ? fmtTs(journey[0].createdAt) : '—';
        const lastEvent = journey && journey.length > 0 ? fmtTs(journey[journey.length - 1].createdAt) : '—';

        let timeToConversion = '—';
        if (journey && journey.length > 0 && lead.firstSeenAt && lead.convertedAt) {
          const firstTs = new Date(lead.firstSeenAt).getTime();
          const convTs = new Date(lead.convertedAt).getTime();
          const diffMs = convTs - firstTs;
          if (diffMs >= 0) {
            const diffMin = Math.floor(diffMs / 60000);
            const diffSec = Math.floor((diffMs % 60000) / 1000);
            if (diffMin >= 60) {
              const hrs = Math.floor(diffMin / 60);
              const mins = diffMin % 60;
              timeToConversion = `${hrs}h ${mins}min`;
            } else if (diffMin >= 1) {
              timeToConversion = `${diffMin}min ${diffSec}s`;
            } else {
              timeToConversion = `${diffSec}s`;
            }
          }
        }

        const leadName = lead.clientName ?? lead.leadId?.slice(0, 8) ?? '—';
        const pageShort = lead.pageUrl && lead.pageUrl.length > 50 ? lead.pageUrl.slice(0, 47) + '...' : (lead.pageUrl ?? '—');

        line(
          `| ${leadName} | ${lead.utmSource ?? '—'} | ${lead.utmCampaign ?? '—'} | ${lead.utmMedium ?? '—'} | ${lead.utmContent ?? '—'} | ${lead.utmTerm ?? '—'} | ${pageShort} | ${firstEvent} | ${lastEvent} | ${totalEvents} | ${timeToConversion} |`,
        );
      }
      line();
      if (recentLeads.length > 30) {
        p(`*Exibindo 30 de ${recentLeads.length} leads. Ordenação por data de conversão (mais recente primeiro). Para ver todos, consulte a Seção 14.*`);
        line();
      }

      // Journey stats summary
      const allLeadTimes: number[] = [];
      for (const lead of recentLeads) {
        if (lead.firstSeenAt && lead.convertedAt) {
          const diff = new Date(lead.convertedAt).getTime() - new Date(lead.firstSeenAt).getTime();
          if (diff >= 0) allLeadTimes.push(diff);
        }
      }
      if (allLeadTimes.length > 0) {
        allLeadTimes.sort((a, b) => a - b);
        const avgTime = allLeadTimes.reduce((s, t) => s + t, 0) / allLeadTimes.length;
        const medianTime = allLeadTimes[Math.floor(allLeadTimes.length / 2)];
        const fmtDuration = (ms: number) => {
          const min = Math.floor(ms / 60000);
          const sec = Math.floor((ms % 60000) / 1000);
          if (min >= 60) return `${Math.floor(min / 60)}h ${min % 60}min`;
          if (min >= 1) return `${min}min ${sec}s`;
          return `${sec}s`;
        };
        p(`**Estatísticas de Tempo até Conversão:**`);
        bullet(`**Média:** ${fmtDuration(avgTime)}`);
        bullet(`**Mediana:** ${fmtDuration(medianTime)}`);
        bullet(`**Mais rápido:** ${fmtDuration(allLeadTimes[0])}`);
        bullet(`**Mais lento:** ${fmtDuration(allLeadTimes[allLeadTimes.length - 1])}`);
        line();
        if (avgTime < 60000) {
          p('**Análise:** O tempo médio de conversão é inferior a 1 minuto, indicando que os visitantes tomam decisão rapidamente — sinal de alta intenção de compra e/ou formulário simplificado.');
        } else if (avgTime < 180000) {
          p('**Análise:** O tempo médio de conversão está entre 1 e 3 minutos, o que é saudável para landing pages de imóveis. Os visitantes estão consumindo conteúdo antes de converter.');
        } else {
          p('**Análise:** O tempo médio de conversão é superior a 3 minutos. Considere simplificar o formulário e tornar o CTA mais visível para reduzir a fricção.');
        }
        line();
      }
    }

    // ──────────────────────────────────────────
    // 20. PÁGINAS DE ENTRADA — ANÁLISE DETALHADA
    // ──────────────────────────────────────────
    h2('20. Páginas de Entrada (Entry Pages) — Análise Detalhada');
    if (topEntryPages.length === 0) {
      p('Sem dados de páginas de entrada no período.');
    } else {
      const totalEntries = topEntryPages.reduce((s, e) => s + Number(e.count), 0);
      p(`Total de entradas registradas: **${fmt(totalEntries)}** visitações iniciais.`);
      line();
      line('| Página de Entrada | Visitantes | % do Total |');
      line('|-----------------|-----------|----------|');
      for (const r of topEntryPages) {
        const c = Number(r.count);
        const pctEntry = totalEntries > 0 ? round2((c / totalEntries) * 100) : 0;
        line(`| ${r.url} | ${fmt(c)} | ${pct(pctEntry)} |`);
      }
      line();

      // Identify which entry page has highest lead conversion
      // Cross-reference topEntryPages with topPages (which has leads per url)
      const pageLeadMap = new Map<string, number>();
      for (const pg of topPages) {
        pageLeadMap.set(pg.url, Number(pg.leads));
      }
      let bestEntryPage = '';
      let bestEntryLeads = 0;
      let bestEntryPct = 0;
      for (const ep of topEntryPages) {
        const leads = pageLeadMap.get(ep.url) ?? 0;
        const entries = Number(ep.count);
        const convPct = entries > 0 ? (leads / entries) * 100 : 0;
        if (convPct > bestEntryPct && entries > 0) {
          bestEntryPct = convPct;
          bestEntryLeads = leads;
          bestEntryPage = ep.url;
        }
      }
      if (bestEntryPage) {
        p(`**Página de entrada com maior conversão em leads:** ${bestEntryPage} com ${pct(round2(bestEntryPct))} de conversão (${fmt(bestEntryLeads)} leads).`);
        line();
      }

      // Dominance analysis
      const topEntry = topEntryPages[0];
      if (topEntry) {
        const topPct = totalEntries > 0 ? (Number(topEntry.count) / totalEntries) * 100 : 0;
        if (topPct > 90) {
          p(`**Insight:** ${pct(round2(topPct))} de todo o tráfego entra por uma única página (${topEntry.url}). Isso é esperado para landing pages únicas, mas se houver múltiplas páginas, investigue por que as outras não recebem tráfego.`);
        } else if (topPct > 60) {
          p(`**Insight:** A página principal (${topEntry.url}) concentra ${pct(round2(topPct))} das entradas. Considere direcionar campanhas para outras páginas para diversificar a captação.`);
        } else {
          p(`**Insight:** O tráfego está bem distribuído entre as páginas, com a principal respondendo por ${pct(round2(topPct))}. Isso indica uma estratégia de múltiplas entradas.`);
        }
        line();
      }
    }

    // ──────────────────────────────────────────
    // 21. COMPORTAMENTO DE SCROLL — ANÁLISE DE ENGAJAMENTO
    // ──────────────────────────────────────────
    h2('21. Comportamento de Scroll — Análise de Engajamento de Conteúdo');
    if (scrollDepthData.length === 0) {
      p('Sem dados de profundidade de scroll no período.');
    } else {
      // Standard scroll thresholds
      const thresholds = ['scroll_25', 'scroll_50', 'scroll_75', 'scroll_100'];
      const scrollMap = new Map<string, number>();
      let totalScrollEvents = 0;
      for (const r of scrollDepthData) {
        const c = Number(r.count);
        scrollMap.set(r.eventName, c);
        totalScrollEvents += c;
      }

      line('| Profundidade | Eventos | % do Total de Scrolls | % dos Visitantes |');
      line('|-------------|---------|---------------------|-----------------|');
      for (const t of thresholds) {
        const count = scrollMap.get(t) ?? 0;
        const pctScroll = totalScrollEvents > 0 ? round2((count / totalScrollEvents) * 100) : 0;
        const pctVisitors = totalVisitors > 0 ? round2((count / totalVisitors) * 100) : 0;
        const label = t.replace('scroll_', '') + '%';
        line(`| ${label} | ${fmt(count)} | ${pct(pctScroll)} | ${pct(pctVisitors)} |`);
      }
      line();

      // Also show any non-standard scroll events
      const nonStandard = scrollDepthData.filter(r => !thresholds.includes(r.eventName));
      if (nonStandard.length > 0) {
        p('*Outros marcos de scroll registrados:*');
        for (const r of nonStandard) {
          bullet(`**${r.eventName}**: ${fmt(Number(r.count))} eventos`);
        }
        line();
      }

      // Engagement analysis
      const scroll25 = scrollMap.get('scroll_25') ?? 0;
      const scroll50 = scrollMap.get('scroll_50') ?? 0;
      const scroll75 = scrollMap.get('scroll_75') ?? 0;
      const scroll100 = scrollMap.get('scroll_100') ?? 0;
      const reach75Pct = totalVisitors > 0 ? round2((scroll75 / totalVisitors) * 100) : 0;
      const reach100Pct = totalVisitors > 0 ? round2((scroll100 / totalVisitors) * 100) : 0;
      const drop25to50 = scroll25 > 0 ? round2(((scroll25 - scroll50) / scroll25) * 100) : 0;
      const drop50to75 = scroll50 > 0 ? round2(((scroll50 - scroll75) / scroll50) * 100) : 0;
      const drop75to100 = scroll75 > 0 ? round2(((scroll75 - scroll100) / scroll75) * 100) : 0;

      p('**Análise de Engajamento com Conteúdo:**');
      bullet(`${pct(reach75Pct)} dos visitantes alcançaram 75% da página (engajamento profundo).`);
      bullet(`${pct(reach100Pct)} dos visitantes chegaram ao final da página (leitura completa).`);
      bullet(`Queda 25%→50%: ${pct(drop25to50)} | 50%→75%: ${pct(drop50to75)} | 75%→100%: ${pct(drop75to100)}`);
      line();

      if (reach75Pct >= 40) {
        p('**Avaliação: EXCELENTE.** Mais de 40% dos visitantes atingem 75% do conteúdo, indicando que a página é altamente engajante e o copy/criativo está atraindo a atenção. A qualidade do conteúdo está alinhada com o interesse do público.');
      } else if (reach75Pct >= 20) {
        p('**Avaliação: BOM.** Entre 20% e 40% dos visitantes atingem 75% — dentro do esperado para landing pages de imóveis. Há espaço para otimização no conteúdo acima do fold.');
      } else if (reach75Pct >= 5) {
        p('**Avaliação: ATENÇÃO.** Apenas ' + pct(reach75Pct) + ' dos visitantes chegam a 75% da página. Possíveis causas: conteúdo longo demais sem pontos de atenção, formulário muito cedo na página, ou desconexão entre o anúncio e a landing page. Considere testar versões mais curtas ou com CTAs intermediários.');
      } else {
        p('**Avaliação: CRÍTICO.** Menos de 5% dos visitantes atingem 75% do conteúdo. A página não está retendo visitantes. Priorize: (1) revisar o conteúdo acima do fold, (2) adicionar elementos visuais que quebrem o texto, (3) mover o formulário para uma posição mais estratégica.');
      }

      // Identify biggest drop-off section
      if (drop25to50 > drop50to75 && drop25to50 > drop75to100) {
        p('**Maior queda:** Entre 25% e 50% da página. A primeira seção do conteúdo precisa ser mais atrativa.');
      } else if (drop50to75 > drop25to50 && drop50to75 > drop75to100) {
        p('**Maior queda:** Entre 50% e 75% da página. O conteúdo intermediário pode estar monótono — adicione elementos visuais, depoimentos ou CTAs intermediários.');
      } else if (scroll75 > 0) {
        p('**Maior queda:** Entre 75% e 100% da página. Os visitantes perdem interesse no final — considere mover informações importantes e o CTA principal para mais acima.');
      }
      line();
    }

    // ──────────────────────────────────────────
    // 22. INTERAÇÕES COM FORMULÁRIO — ANÁLISE DE ABANDONO POR CAMPO
    // ──────────────────────────────────────────
    h2('22. Interações com Formulário — Análise de Abandono por Campo');
    if (formInteractionData.length === 0) {
      p('Sem dados de interação com formulário no período.');
    } else {
      // Group by field name
      const fieldStats = new Map<string, { focus: number; blur: number; abandon: number }>();
      for (const r of formInteractionData) {
        const fieldName = r.eventName ?? '(desconhecido)';
        const stats = fieldStats.get(fieldName) ?? { focus: 0, blur: 0, abandon: 0 };
        if (r.eventType === 'form_focus') stats.focus += Number(r.count);
        else if (r.eventType === 'form_blur') stats.blur += Number(r.count);
        else if (r.eventType === 'form_abandon') stats.abandon += Number(r.count);
        fieldStats.set(fieldName, stats);
      }

      line('| Campo | Focos | Blurs | Abandonos | Interações Totais | Taxa de Abandono |');
      line('|-------|-------|-------|----------|-----------------|----------------|');
      const fieldEntries = Array.from(fieldStats.entries())
        .map(([field, stats]) => ({
          field,
          ...stats,
          total: stats.focus + stats.blur,
          abandonRate: stats.focus + stats.blur > 0
            ? round2((stats.abandon / (stats.focus + stats.blur)) * 100)
            : 0,
        }))
        .sort((a, b) => b.abandonRate - a.abandonRate);

      for (const f of fieldEntries) {
        line(
          `| ${f.field} | ${fmt(f.focus)} | ${fmt(f.blur)} | ${fmt(f.abandon)} | ${fmt(f.total)} | ${pct(f.abandonRate)} |`,
        );
      }
      line();

      // Analysis
      const highAbandonFields = fieldEntries.filter(f => f.abandonRate >= 50 && f.total >= 3);
      const mediumAbandonFields = fieldEntries.filter(f => f.abandonRate >= 20 && f.abandonRate < 50 && f.total >= 3);
      const lowAbandonFields = fieldEntries.filter(f => f.abandonRate < 20 && f.total >= 3);

      if (highAbandonFields.length > 0) {
        p('**Campos com alta taxa de abandono (≥ 50%):**');
        for (const f of highAbandonFields) {
          bullet(`**${f.field}**: ${pct(f.abandonRate)} de abandono (${fmt(f.abandon)} de ${fmt(f.total)} interações). *Recomendação: Verifique se o rótulo é claro, se o campo é realmente necessário, e se a validação não está confusa. Considere tooltips explicativos ou torná-lo opcional.*`);
        }
        line();
      }
      if (mediumAbandonFields.length > 0) {
        p('**Campos com taxa de abandono moderada (20-49%):**');
        for (const f of mediumAbandonFields) {
          bullet(`**${f.field}**: ${pct(f.abandonRate)} de abandono. *Monitore e considere simplificar ou adicionar placeholders com exemplos.*`);
        }
        line();
      }
      if (lowAbandonFields.length > 0) {
        p('**Campos com boa adesão (< 20% de abandono):**');
        for (const f of lowAbandonFields) {
          bullet(`**${f.field}**: ${pct(f.abandonRate)} de abandono — desempenho adequado.`);
        }
        line();
      }

      // Overall form health
      const totalFocus = fieldEntries.reduce((s, f) => s + f.focus, 0);
      const totalAbandon = fieldEntries.reduce((s, f) => s + f.abandon, 0);
      const overallAbandonRate = totalFocus > 0 ? round2((totalAbandon / totalFocus) * 100) : 0;
      p(`**Taxa geral de abandono de campos:** ${pct(overallAbandonRate)} (${fmt(totalAbandon)} abandonos de ${fmt(totalFocus)} focos).`);
      if (overallAbandonRate > 60) {
        p('O formulário apresenta atrito elevado. Considere reduzir o número de campos, usar autofill do navegador, e implementar progressão gradual (multi-step form).');
      } else if (overallAbandonRate > 30) {
        p('O formulário tem atrito moderado. Revise os campos com maior abandono listados acima e otimize o UX.');
      } else {
        p('O formulário apresenta boa fluidez com baixo atrito geral.');
      }
      line();
    }

    // ──────────────────────────────────────────
    // 23. INTENÇÕES DE SAÍDA (EXIT INTENT) — ANÁLISE
    // ──────────────────────────────────────────
    h2('23. Intenções de Saída (Exit Intent) — Análise');
    if (exitIntents === 0) {
      p('Nenhuma intenção de saída registrada no período.');
    } else {
      const exitRate = totalVisitors > 0 ? round2((exitIntents / totalVisitors) * 100) : 0;
      line('| Métrica | Valor |');
      line('|---------|-------|');
      line(`| Total de Exit Intents | ${fmt(exitIntents)} |`);
      line(`| Total de Visitantes | ${fmt(totalVisitors)} |`);
      line(`| **Taxa de Exit Intent** | **${pct(exitRate)}** |`);
      line(`| Exit Intents vs Leads | ${uniqueLeads > 0 ? round2(exitIntents / uniqueLeads) : 0}x |`);
      line();

      p('**O que é Exit Intent:** Evento disparado quando o visitante move o cursor para fora da viewport (em direção à barra de endereços ou fechar a aba), indicando intenção de sair sem converter.');
      line();

      if (exitRate >= 50) {
        p(`**Avaliação: CRÍTICO.** ${pct(exitRate)} dos visitantes demonstram intenção de sair — um sinal forte de desinteresse ou desconexão entre o anúncio e a página. **Ações imediatas:**`);
        bullet('Implementar um popup de exit intent com oferta especial (desconto, eBook, consulta gratuita).');
        bullet('Revisar a correspondência entre criativo do anúncio e conteúdo da landing page.');
        bullet('Adicionar prova social (depoimentos, números) acima do fold.');
        bullet('Testar landing pages diferentes (A/B test) para reduzir a rejeição.');
      } else if (exitRate >= 25) {
        p(`**Avaliação: ATENÇÃO.** ${pct(exitRate)} dos visitantes tentam sair — valor moderado. **Recomendações:**`);
        bullet('Implementar popup de exit intent para recuperar parte desses visitantes.');
        bullet('Verificar se o conteúdo está alinhado com a expectativa criada pelo anúncio.');
        bullet('Adicionar um CTA flutuante ou barra de atenção para reter visitantes.');
      } else if (exitRate >= 10) {
        p(`**Avaliação: BOM.** ${pct(exitRate)} de exit intent é aceitável para landing pages. A página está retendo a maioria dos visitantes. Ainda assim, um popup de exit intent pode recuperar leads adicionais.`);
      } else {
        p(`**Avaliação: EXCELENTE.** Apenas ${pct(exitRate)} dos visitantes demonstram intenção de saída. A página está muito bem otimizada para reter visitantes.`);
      }
      line();

      if (uniqueLeads > 0) {
        const ratio = round2(exitIntents / uniqueLeads);
        p(`**Proporção Exit Intent / Leads:** Para cada lead capturado, ${ratio} visitantes tentaram sair. ${ratio <= 2 ? 'Boa relação — a página converte mais do que perde.' : 'Alta proporção — há oportunidade significativa de recuperar mais leads com popup de exit intent.'}`);
        line();
      }
    }

    // ──────────────────────────────────────────
    // 24. DURAÇÃO MÉDIA DE SESSÃO — ANÁLISE
    // ──────────────────────────────────────────
    h2('24. Duração Média de Sessão — Análise');
    if (avgSessionSeconds <= 0) {
      p('Dados insuficientes para calcular a duração média de sessão.');
    } else {
      const minutes = Math.floor(avgSessionSeconds / 60);
      const seconds = Math.round(avgSessionSeconds % 60);
      const formatted = minutes > 0 ? `${minutes}min ${seconds}s` : `${seconds}s`;

      line('| Métrica | Valor |');
      line('|---------|-------|');
      line(`| **Duração Média da Sessão** | **${formatted}** |`);
      line(`| Duração em segundos (bruto) | ${round2(avgSessionSeconds)}s |`);
      line(`| Sessões Únicas | ${fmt(uniqueSessions)} |`);
      line(`| Eventos por Sessão | ${uniqueSessions > 0 ? round2(totalEvents / uniqueSessions) : 0} |`);
      line();

      p('**Benchmark do setor (landing pages de imóveis):**');
      bullet('**< 30 segundos:** Ruim — visitantes não estão engajando com o conteúdo.');
      bullet('**30s a 1 min:** Abaixo do esperado — conteúdo ou page load podem ser problemas.');
      bullet('**1 a 3 minutos:** Saudável — range ideal para landing pages de imóveis.');
      bullet('**3 a 5 minutos:** Bom engajamento — visitantes estão consumindo conteúdo detalhado.');
      bullet('**> 5 minutos:** Excelente — pode indicar alto interesse OU página muito longa.');
      line();

      if (avgSessionSeconds < 30) {
        p(`**Avaliação: RUIM.** Com média de ${formatted}, os visitantes estão saindo quase imediatamente. **Possíveis causas:** página lenta para carregar, conteúdo irrelevante, ou tráfego mal qualificado. **Ações:** otimizar velocidade de carregamento, revisar targeting de campanhas, e verificar se o anúncio corresponde à oferta.`);
      } else if (avgSessionSeconds < 60) {
        p(`**Avaliação: ABAIXO DO ESPERADO.** ${formatted} de sessão média é baixo para landing pages de imóveis. Os visitantes podem estar encontrando a página lenta ou o conteúdo não está retendo. **Ações:** verificar Core Web Vitals, simplificar o conteúdo acima do fold, e adicionar elementos visuais que prendam a atenção.`);
      } else if (avgSessionSeconds < 180) {
        p(`**Avaliação: SAUDÁVEL.** ${formatted} está dentro do range ideal (1-3 min) para landing pages de imóveis. Os visitantes estão consumindo o conteúdo antes de tomar uma decisão. Continue otimizando para manter ou melhorar este indicador.`);
      } else if (avgSessionSeconds < 300) {
        p(`**Avaliação: BOM.** ${formatted} indica que os visitantes estão engajando profundamente com o conteúdo. Isso pode ser resultado de um copy bem elaborado, imagens de qualidade, ou visitantes com alta intenção de compra.`);
      } else {
        p(`**Avaliação: EXCELENTE (ou possível alerta).** ${formatted} é muito alto. Pode indicar excelente engajamento, mas também pode significar que os visitantes estão tendo dificuldade em encontrar o CTA ou o formulário. Verifique se o caminho até a conversão está claro.`);
      }
      line();
    }

    // ──────────────────────────────────────────
    // 25. VISITANTES RECORRENTES VS NOVOS — ANÁLISE
    // ──────────────────────────────────────────
    h2('25. Visitantes Recorrentes vs Novos — Análise');
    {
      const totalV = returnVisitors + newVisitors;
      const returnRate = totalV > 0 ? round2((returnVisitors / totalV) * 100) : 0;
      const newRate = totalV > 0 ? round2((newVisitors / totalV) * 100) : 0;

      line('| Tipo de Visitante | Quantidade | % do Total |');
      line('|-----------------|-----------|----------|');
      line(`| Visitantes Novos | ${fmt(newVisitors)} | ${pct(newRate)} |`);
      line(`| Visitantes Recorrentes | ${fmt(returnVisitors)} | ${pct(returnRate)} |`);
      line(`| **Total** | **${fmt(totalV)}** | **100%** |`);
      line();

      // Conversion rate comparison
      // We can't easily split leads by new vs returning from current data,
      // but we can provide analysis based on rates
      p('**Análise de Audiência:**');
      line();

      if (returnRate >= 40) {
        p(`**Alta taxa de retorno (${pct(returnRate)}).** Isso pode indicar:`);
        bullet('Público com alto interesse — visitantes voltam para considerar a oferta.');
        bullet('Remarketing eficaz — campanhas de retargeting estão trazendo pessoas de volta.');
        bullet('Possível necessidade de melhoria na conversão inicial — se muitos voltam, talvez o primeiro contato não seja suficiente.');
        p('**Recomendação:** Implemente CTAs diferentes para visitantes recorrentes (ex: "Viu algo que gostou? Fale com um consultor") e considere campanhas de remarketing com ofertas específicas.');
      } else if (returnRate >= 15) {
        p(`**Taxa de retorno moderada (${pct(returnRate)}).** Perfil típico de campanhas de Meta Ads para imóveis. Parte do público demonstra interesse recorrente.`);
        p('**Recomendação:** Aproveite esta audiência para remarketing. Crie audiências personalizadas de visitantes que retornaram mas não converteram e direcione criativos diferentes para eles.');
      } else {
        p(`**Baixa taxa de retorno (${pct(returnRate)}).** A maioria do tráfego é de primeira visita. Isso é normal para campanhas com foco em topo de funil, mas pode indicar:`);
        bullet('Tráfego majoritariamente novo de anúncios — bom sinal de escala.');
        bullet('Falta de remarketing ativo — se não há campanhas de retargeting, está se perdendo a oportunidade de converter visitantes que já demonstraram interesse.');
        p('**Recomendação:** Se ainda não existe, crie campanhas de remarketing para visitantes da landing page com criativos que reforcem a proposta de valor.');
      }
      line();
    }

    // ──────────────────────────────────────────
    // 26. ENGAJAMENTO POR DIA DA SEMANA — RECOMENDAÇÃO DE AGENDAMENTO
    // ──────────────────────────────────────────
    h2('26. Engajamento por Dia da Semana — Análise e Recomendação de Agendamento');
    if (engagementByDayOfWeek.length === 0) {
      p('Sem dados de engajamento por dia da semana.');
    } else {
      const totalWeekVisitors = engagementByDayOfWeek.reduce((s, d) => s + Number(d.visitors), 0);
      const totalWeekLeads = engagementByDayOfWeek.reduce((s, d) => s + Number(d.leads), 0);

      line('| Dia | Visitantes | % do Total | Leads | Conversão | Volume de Leads |');
      line('|-----|-----------|----------|-------|----------|----------------|');
      const dayAnalysis = engagementByDayOfWeek.map(d => {
        const v = Number(d.visitors);
        const l = Number(d.leads);
        const cr = v > 0 ? round2((l / v) * 100) : 0;
        const visitorPct = totalWeekVisitors > 0 ? round2((v / totalWeekVisitors) * 100) : 0;
        return { day: d.dow_name.trim(), visitors: v, leads: l, cr, visitorPct };
      });

      for (const d of dayAnalysis) {
        line(
          `| ${d.day} | ${fmt(d.visitors)} | ${pct(d.visitorPct)} | ${fmt(d.leads)} | ${pct(d.cr)} | ${d.leads > 0 ? '●'.repeat(Math.min(Math.ceil(d.leads / (totalWeekLeads > 0 ? totalWeekLeads / 7 : 1)), 10)) : '—'} |`,
        );
      }
      line();

      // Best and worst days
      const sortedByCR = [...dayAnalysis].sort((a, b) => b.cr - a.cr);
      const sortedByVolume = [...dayAnalysis].sort((a, b) => b.leads - a.leads);
      const bestCR = sortedByCR[0];
      const worstCR = sortedByCR[sortedByCR.length - 1];
      const bestVol = sortedByVolume[0];

      if (bestCR && worstCR && bestCR.visitors > 0) {
        p('**Melhor dia por taxa de conversão:** ' + (bestCR.day) + ` (${pct(bestCR.cr)} com ${fmt(bestCR.leads)} leads de ${fmt(bestCR.visitors)} visitantes).`);
        p('**Pior dia por taxa de conversão:** ' + (worstCR.day) + ` (${pct(worstCR.cr)} com ${fmt(worstCR.leads)} leads de ${fmt(worstCR.visitors)} visitantes).`);
        if (bestVol && bestVol.day !== bestCR.day) {
          p('**Dia com maior volume de leads:** ' + (bestVol.day) + ` (${fmt(bestVol.leads)} leads).`);
        }
        line();
      }

      // Ad scheduling recommendation
      const top3Days = [...dayAnalysis].sort((a, b) => b.leads - a.leads).slice(0, 3).map(d => d.day);
      const top3CRDays = [...dayAnalysis].filter(d => d.visitors >= 5).sort((a, b) => b.cr - a.cr).slice(0, 3).map(d => d.day);

      p('**Recomendação de Agendamento de Anúncios:**');
      if (top3Days.length > 0) {
        bullet(`**Dias prioritários (maior volume de leads):** ${top3Days.join(', ')}. Concentre o orçamento principal nesses dias.`);
      }
      if (top3CRDays.length > 0) {
        bullet(`**Dias de alta conversão:** ${top3CRDays.join(', ')}. Considere aumentar lances nesses dias para maximizar ROI.`);
      }

      // Check weekends vs weekdays
      const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
      const weekendDays = dayAnalysis.filter(d => !weekdayNames.includes(d.dow_name.trim()));
      const weekdayData = dayAnalysis.filter(d => weekdayNames.includes(d.dow_name.trim()));
      if (weekendDays.length > 0 && weekdayData.length > 0) {
        const wkLeads = weekendDays.reduce((s, d) => s + d.leads, 0);
        const wkVisitors = weekendDays.reduce((s, d) => s + d.visitors, 0);
        const wdLeads = weekdayData.reduce((s, d) => s + d.leads, 0);
        const wdVisitors = weekdayData.reduce((s, d) => s + d.visitors, 0);
        const wkCR = wkVisitors > 0 ? round2((wkLeads / wkVisitors) * 100) : 0;
        const wdCR = wdVisitors > 0 ? round2((wdLeads / wdVisitors) * 100) : 0;
        bullet(`**Semana vs Fim de semana:** Dias úteis = ${pct(wdCR)} conversão (${fmt(wdLeads)} leads). Fim de semana = ${pct(wkCR)} conversão (${fmt(wkLeads)} leads). ${wkCR > wdCR ? 'O fim de semana tem melhor conversão — aumente o orçamento nesses dias.' : 'Dias úteis tem melhor conversão — foque o orçamento na semana.'}`);
      }
      line();
    }

    // ──────────────────────────────────────────
    // 27. ANÁLISE POR UTM MEDIUM — PAGO VS ORGÂNICO
    // ──────────────────────────────────────────
    h2('27. Análise por UTM Medium — Pago vs Orgânico');
    if (byMedium.length === 0) {
      p('Sem dados de UTM medium no período.');
    } else {
      // Classify mediums
      const paidMediums = ['cpc', 'cpm', 'paid', 'ppc', 'paid_social', 'retargeting'];
      const organicMediums = ['organic', 'referral', 'email', 'social', 'natural'];

      let paidVisitors = 0;
      let paidLeads = 0;
      let organicVisitors = 0;
      let organicLeads = 0;
      let otherVisitors = 0;
      let otherLeads = 0;

      line('| Medium | Visitantes | Leads | Conversão | Classificação |');
      line('|--------|-----------|-------|----------|-------------|');
      for (const r of byMedium) {
        const v = Number(r.visitors);
        const l = Number(r.leads);
        const cr = v > 0 ? round2((l / v) * 100) : 0;
        const med = r.medium.toLowerCase();
        let classification = 'Outro';
        if (paidMediums.includes(med) || med.includes('cpc') || med.includes('cpm')) {
          classification = '💰 Pago';
          paidVisitors += v;
          paidLeads += l;
        } else if (organicMediums.includes(med) || med.includes('organic') || med.includes('referral')) {
          classification = '🌱 Orgânico';
          organicVisitors += v;
          organicLeads += l;
        } else if (r.medium === '(não definido)') {
          classification = '❓ Não definido';
          otherVisitors += v;
          otherLeads += l;
        } else {
          otherVisitors += v;
          otherLeads += l;
        }
        line(`| ${r.medium} | ${fmt(v)} | ${fmt(l)} | ${pct(cr)} | ${classification} |`);
      }
      line();

      // Summary comparison
      if (paidVisitors > 0 || organicVisitors > 0) {
        const paidCR = paidVisitors > 0 ? round2((paidLeads / paidVisitors) * 100) : 0;
        const organicCR = organicVisitors > 0 ? round2((organicLeads / organicVisitors) * 100) : 0;

        p('**Resumo: Tráfego Pago vs Orgânico**');
        line('| Canal | Visitantes | Leads | Conversão |');
        line('|-------|-----------|-------|----------|');
        line(`| 💰 Tráfego Pago | ${fmt(paidVisitors)} | ${fmt(paidLeads)} | ${pct(paidCR)} |`);
        line(`| 🌱 Tráfego Orgânico | ${fmt(organicVisitors)} | ${fmt(organicLeads)} | ${pct(organicCR)} |`);
        line(`| ❓ Outro/Não Definido | ${fmt(otherVisitors)} | ${fmt(otherLeads)} | ${otherVisitors > 0 ? pct(round2((otherLeads / otherVisitors) * 100)) : 'N/A'} |`);
        line();

        if (paidVisitors > 0 && organicVisitors > 0) {
          if (paidCR > organicCR * 1.5) {
            p(`**Insight:** O tráfego pago (${pct(paidCR)}) tem conversão significativamente maior que o orgânico (${pct(organicCR)}). O investimento em anúncios está gerando tráfego mais qualificado. Considere aumentar o orçamento de campanhas que performam melhor.`);
          } else if (organicCR > paidCR * 1.5) {
            p(`**Insight:** O tráfego orgânico (${pct(organicCR)}) supera o pago (${pct(paidCR)}) em conversão. Isso pode indicar que o tráfego orgânico é mais qualificado, ou que as campanhas pagas precisam de otimização de targeting. Verifique se os critérios de segmentação estão adequados.`);
          } else {
            p(`**Insight:** Tráfego pago (${pct(paidCR)}) e orgânico (${pct(organicCR)}) têm taxas de conversão similares, indicando que os canais estão igualmente qualificados.`);
          }
        }

        if (otherVisitors > totalVisitors * 0.3) {
          p(`**Atenção:** ${pct(round2((otherVisitors / totalVisitors) * 100))} dos visitantes não têm medium definido. Verifique se os parâmetros UTM estão configurados em todas as campanhas e links. Sem UTM medium, não é possível otimizar a alocação de orçamento por canal.`);
        }
        line();
      }
    }

    // ──────────────────────────────────────────
    // 28. ANÁLISE POR UTM TERM — PALAVRAS-CHAVE
    // ──────────────────────────────────────────
    h2('28. Análise por UTM Term (Palavras-chave e Termos de Campanha)');
    if (byTerm.length === 0) {
      p('Sem dados de UTM term no período.');
    } else {
      line('| Termo / Palavra-chave | Visitantes | Leads | Conversão |');
      line('|--------------------|-----------|-------|----------|');
      const termData = byTerm
        .map(r => {
          const v = Number(r.visitors);
          return {
            term: r.term,
            visitors: v,
            leads: Number(r.leads),
            cr: v > 0 ? round2((Number(r.leads) / v) * 100) : 0,
          };
        })
        .sort((a, b) => b.cr - a.cr);

      for (const t of termData) {
        line(`| ${t.term} | ${fmt(t.visitors)} | ${fmt(t.leads)} | ${pct(t.cr)} |`);
      }
      line();

      // Identify best and worst performing terms
      const definedTerms = termData.filter(t => t.term !== '(não definido)');
      if (definedTerms.length > 0) {
        const bestTerm = definedTerms[0];
        const worstTerm = definedTerms[definedTerms.length - 1];
        if (bestTerm && bestTerm.visitors > 0) {
          p(`**Melhor termo:** "${bestTerm.term}" com ${pct(bestTerm.cr)} de conversão (${fmt(bestTerm.leads)} leads de ${fmt(bestTerm.visitors)} visitantes).`);
        }
        if (worstTerm && worstTerm !== bestTerm && worstTerm.visitors > 0) {
          p(`**Pior termo:** "${worstTerm.term}" com ${pct(worstTerm.cr)} de conversão. ${worstTerm.visitors > 10 ? 'Considere pausar ou otimizar campanhas com este termo.' : 'Volume baixo — insuficiente para avaliação conclusiva.'}`);
        }
        line();
      }

      const undefinedTerms = byTerm.find(t => t.term === '(não definido)');
      if (undefinedTerms && Number(undefinedTerms.visitors) > totalVisitors * 0.3) {
        p(`**Atenção:** ${pct(round2((Number(undefinedTerms.visitors) / totalVisitors) * 100))} dos visitantes não têm UTM term definido. Para campanhas de busca, isso impede a otimização por palavra-chave. Verifique se o parâmetro utm_term está sendo passado corretamente nos links dos anúncios.`);
        line();
      }
    }

    // ──────────────────────────────────────────
    // 29. INSIGHTS E RECOMENDAÇÕES AUTOMÁTICAS
    // ──────────────────────────────────────────
    h2('29. Insights e Recomendações Automáticas');
    p('Análise profissional gerada automaticamente com base nos dados do período. Esta seção sintetiza os principais achados e fornece ações concretas para otimização.');
    line();

    // Helper: compute campaign CR
    const campaignCR = (c: { visitors: bigint; leads: bigint }) => {
      const v = Number(c.visitors);
      return v > 0 ? round2((Number(c.leads) / v) * 100) : 0;
    };

    // ── 29.1 Best/Worst Campaigns ──
    h3('29.1. Desempenho por Campanha');
    const campaignsAnalysis = [...byCampaign]
      .filter(c => c.campaign !== '(sem campanha)')
      .map(c => ({
        campaign: c.campaign,
        visitors: Number(c.visitors),
        leads: Number(c.leads),
        cr: campaignCR(c),
      }))
      .filter(c => c.visitors >= 5) // Minimum statistical significance
      .sort((a, b) => b.cr - a.cr);

    if (campaignsAnalysis.length > 0) {
      // Best: highest CR with significant volume
      const bestCampaign = campaignsAnalysis[0];
      const worstCampaign = campaignsAnalysis[campaignsAnalysis.length - 1];
      // Also find highest volume campaign
      const highestVolume = [...campaignsAnalysis].sort((a, b) => b.leads - a.leads)[0];

      bullet(`**Campanha com melhor conversão:** "${bestCampaign.campaign}" — ${pct(bestCampaign.cr)} (${fmt(bestCampaign.leads)} leads de ${fmt(bestCampaign.visitors)} visitantes). *Ação: Aumentar orçamento e usar como modelo para novas campanhas.*`);
      bullet(`**Campanha com maior volume de leads:** "${highestVolume.campaign}" — ${fmt(highestVolume.leads)} leads. ${highestVolume.campaign === bestCampaign.campaign ? 'Também é a melhor em conversão — campanha de referência.' : `CR de ${pct(highestVolume.cr)}. *Verificar se pode melhorar a conversão mantendo o volume.*`}`);
      if (worstCampaign && worstCampaign.campaign !== bestCampaign.campaign) {
        bullet(`**Campanha com pior conversão:** "${worstCampaign.campaign}" — ${pct(worstCampaign.cr)} (${fmt(worstCampaign.leads)} leads de ${fmt(worstCampaign.visitors)} visitantes). *Ação: Revisar criativos, copy e targeting. Considerar pausa se o CPA for inviável.*`);
      }
      line();
    } else {
      p('Dados insuficientes para análise por campanha (necessário pelo menos 5 visitantes por campanha).');
      line();
    }

    // ── 29.2 Best Time of Day ──
    h3('29.2. Melhor Horário para Anúncios');
    if (hourlyData.length > 0) {
      const hourlyAnalysis = hourlyData
        .map(h => ({
          hour: h.hour,
          visitors: Number(h.visitors),
          leads: Number(h.leads),
          cr: Number(h.visitors) > 0 ? round2((Number(h.leads) / Number(h.visitors)) * 100) : 0,
        }))
        .filter(h => h.visitors >= 3);

      if (hourlyAnalysis.length > 0) {
        const bestHour = [...hourlyAnalysis].sort((a, b) => b.cr - a.cr)[0];
        const bestVolumeHour = [...hourlyAnalysis].sort((a, b) => b.leads - a.leads)[0];

        // Find best 3-hour window
        const windowScores: { startHour: number; leads: number; visitors: number; cr: number }[] = [];
        for (let i = 0; i < 24; i++) {
          const windowHours = [i, (i + 1) % 24, (i + 2) % 24];
          const wVisitors = windowHours.reduce((s, wh) => {
            const hd = hourlyAnalysis.find(h => h.hour === wh);
            return s + (hd ? hd.visitors : 0);
          }, 0);
          const wLeads = windowHours.reduce((s, wh) => {
            const hd = hourlyAnalysis.find(h => h.hour === wh);
            return s + (hd ? hd.leads : 0);
          }, 0);
          if (wVisitors > 0) {
            windowScores.push({
              startHour: i,
              leads: wLeads,
              visitors: wVisitors,
              cr: round2((wLeads / wVisitors) * 100),
            });
          }
        }
        windowScores.sort((a, b) => b.leads - a.leads);
        const bestWindow = windowScores[0];

        if (bestHour) {
          bullet(`**Melhor hora (por conversão):** ${String(bestHour.hour).padStart(2, '0')}:00 — ${pct(bestHour.cr)} de conversão.`);
        }
        if (bestVolumeHour) {
          bullet(`**Hora com mais leads:** ${String(bestVolumeHour.hour).padStart(2, '0')}:00 — ${fmt(bestVolumeHour.leads)} leads.`);
        }
        if (bestWindow) {
          const wh1 = String(bestWindow.startHour).padStart(2, '0') + ':00';
          const wh2 = String((bestWindow.startHour + 2) % 24).padStart(2, '0') + ':00';
          bullet(`**Melhor janela de 3 horas (por volume de leads):** ${wh1} às ${wh2} — ${fmt(bestWindow.leads)} leads em ${fmt(bestWindow.visitors)} visitantes (${pct(bestWindow.cr)}).`);
          p(`**Recomendação de agendamento:** Concentre o orçamento principal entre ${wh1} e ${wh2}. Use o Meta Ads scheduler para aumentar lances nesse horário e reduzir em horários de baixo desempenho.`);
        }
        line();
      }
    }

    // ── 29.3 Device Optimization ──
    h3('29.3. Otimização por Dispositivo');
    if (deviceBreakdown.length > 0) {
      const devAnalysis = deviceBreakdown.map(d => {
        const v = Number(d.visitors);
        return {
          device: d.device,
          visitors: v,
          leads: Number(d.leads),
          cr: v > 0 ? round2((Number(d.leads) / v) * 100) : 0,
          share: totalDev > 0 ? round2((v / totalDev) * 100) : 0,
        };
      });
      const mobileData = devAnalysis.find(d => d.device === 'Mobile');
      const desktopData = devAnalysis.find(d => d.device === 'Desktop');

      if (mobileData && desktopData) {
        if (mobileData.share > 70) {
          bullet(`**Mobile domina com ${pct(mobileData.share)} do tráfego.** CR mobile: ${pct(mobileData.cr)} vs Desktop: ${pct(desktopData.cr)}. *Priorize absoluta: formulário mobile-first, CTA grande e acessível, page speed mobile, e evite pop-ups intrusivos em mobile.*`);
        } else if (mobileData.share > 40) {
          bullet(`**Mobile é majority com ${pct(mobileData.share)} do tráfego.** CR mobile: ${pct(mobileData.cr)} vs Desktop: ${pct(desktopData.cr)}. *Mantenha experiência mobile otimizada mas não negligencie desktop.*`);
        }
        if (desktopData.cr > mobileData.cr * 1.5) {
          bullet(`**CR desktop (${pct(desktopData.cr)}) é significativamente maior que mobile (${pct(mobileData.cr)}).** Possíveis causas: formulário difícil de preencher no mobile, CTA não visível sem scroll, ou carregamento lento. *Ação: Auditar experiência mobile com ferramentas como Google PageSpeed Insights.*`);
        } else if (mobileData.cr > desktopData.cr * 1.5) {
          bullet(`**CR mobile (${pct(mobileData.cr)}) supera desktop (${pct(desktopData.cr)}).** O público mobile está mais engajado. *Ação: Aumentar orçamento de campanhas mobile.*`);
        }
      } else if (mobileData) {
        bullet(`**Todo o tráfego é mobile (${pct(mobileData.share)}).** Certifique-se de que a landing page está 100% otimizada para dispositivos móveis.`);
      }
      line();
    }

    // ── 29.4 Bounce Rate Assessment ──
    h3('29.4. Avaliação da Taxa de Rejeição');
    if (bounceRate > 80) {
      bullet(`**CRÍTICO — Bounce rate de ${pct(round2(bounceRate))}.** Mais de 80% dos visitantes saem sem interagir. *Causas prováveis: landing page lenta, conteúdo não correspondente ao anúncio, ou tráfego mal segmentado. Ações: (1) verificar velocidade de carregamento, (2) garantir match entre criativo e LP, (3) auditar segmentação de campanhas, (4) adicionar elementos visuais above the fold.*`);
    } else if (bounceRate > 60) {
      bullet(`**ATENÇÃO — Bounce rate de ${pct(round2(bounceRate))}.** Acima da média para landing pages. *Ações: (1) revisar correspondência anúncio-landing, (2) melhorar velocidade de carregamento, (3) adicionar CTA visível acima do fold, (4) testar A/B na headline.*`);
    } else if (bounceRate > 40) {
      bullet(`**OK — Bounce rate de ${pct(round2(bounceRate))}.** Dentro da faixa aceitável. Há espaço para melhoria — otimize o conteúdo acima do fold e a velocidade da página.`);
    } else {
      bullet(`**BOM — Bounce rate de ${pct(round2(bounceRate))}.** Abaixo de 40% é excelente para landing pages. A página está retendo bem os visitantes.`);
    }
    line();

    // ── 29.5 Funnel Drop-off Analysis ──
    h3('29.5. Análise de Gargalo no Funil');
    {
      const dropPVEng = pageviewCount > 0 ? round2(((pageviewCount - engagementCount) / pageviewCount) * 100) : 0;
      const dropEngWA = engagementCount > 0 ? round2(((engagementCount - whatsappClicksCount) / engagementCount) * 100) : 0;
      const dropWALead = whatsappClicksCount > 0 ? round2(((whatsappClicksCount - leadCount) / whatsappClicksCount) * 100) : 0;

      // Find biggest drop
      const drops = [
        { stage: 'Visualização → Engajamento', pct: dropPVEng },
        { stage: 'Engajamento → WhatsApp', pct: dropEngWA },
        { stage: 'WhatsApp → Lead', pct: dropWALead },
      ].sort((a, b) => b.pct - a.pct);

      const biggestLeak = drops[0];

      p(`**Maiores perdas no funil:**`);
      bullet(`Visualização → Engajamento: -${pct(dropPVEng)} (${fmt(pageviewCount - engagementCount)} visitantes perdidos)`);
      bullet(`Engajamento → WhatsApp: -${pct(dropEngWA)} (${fmt(engagementCount - whatsappClicksCount)} visitantes perdidos)`);
      bullet(`WhatsApp → Lead: -${pct(dropWALead)} (${fmt(whatsappClicksCount - leadCount)} visitantes perdidos)`);
      line();

      if (biggestLeak) {
        p(`**Maior gargalo: ${biggestLeak.stage} (${pct(biggestLeak.pct)} de perda).**`);
        if (biggestLeak.stage.includes('Visualização')) {
          p('*Ação prioritária:* A página não está engajando. Reveja o conteúdo acima do fold — headline forte, imagem impactante, CTA claro. Verifique também a velocidade de carregamento.');
        } else if (biggestLeak.stage.includes('Engajamento → WhatsApp')) {
          p('*Ação prioritária:* Visitantes engajam mas não clicam em WhatsApp. Tornar o botão de WhatsApp mais proeminente, flutuante, ou adicionar um CTA intermediário. Considere adicionar um telefone para ligação como alternativa.');
        } else if (biggestLeak.stage.includes('WhatsApp → Lead')) {
          p('*Ação prioritária:* Visitantes clicam em WhatsApp mas não se tornam leads. O problema pode estar no atendimento via WhatsApp — tempo de resposta, qualificação, ou o visitante desiste após o primeiro contato. Verifique o fluxo de atendimento.');
        }
      }
      line();
    }

    // ── 29.6 Meta Pixel Discrepancy ──
    h3('29.6. Avaliação de Discrepância Meta Pixel vs CRM');
    if (pixelLeads > 0) {
      const discrepancy = Math.abs(pixelLeads - crmMetaLeads);
      const discrepancyPct = pixelLeads > 0 ? round2((discrepancy / pixelLeads) * 100) : 0;

      if (matchRate < 30) {
        bullet(`**DISCREPÂNCIA GRAVE — Match rate de apenas ${pct(round2(matchRate))}.** O pixel reporta ${fmt(pixelLeads)} leads mas apenas ${fmt(matched)} foram confirmados no CRM. *Ações urgentes: (1) Verificar se o evento de lead do pixel está duplicando conversões, (2) Confirmar se a tag [Meta Ads] está sendo aplicada corretamente no CRM, (3) Verificar se há falha na vinculação visitor→lead, (4) Auditar os parâmetros UTM em todos os anúncios.*`);
      } else if (matchRate < 60) {
        bullet(`**DISCREPÂNCIA MODERADA — Match rate de ${pct(round2(matchRate))}.** Há uma diferença significativa entre o que o pixel registra e o que o CRM confirma. *Ações: (1) Verificar se UTMs estão presentes em todos os anúncios, (2) Confirmar se o webhook/pixel está disparando corretamente apenas em conversões reais, (3) Investigar leads que entram pelo CRM mas não passam pelo tracking.*`);
      } else if (matchRate < 85) {
        bullet(`**DISCREPÂNCIA LEVE — Match rate de ${pct(round2(matchRate))}.** A concordância é razoável mas pode melhorar. *Ações: Verificar events deduplication no pixel e garantir que UTMs estão completos.*`);
      } else {
        bullet(`**BOA CONCORDÂNCIA — Match rate de ${pct(round2(matchRate))}.** O pixel e o CRM estão bem alinhados. Continue monitorando para manter esta consistência.`);
      }
      line();
    }

    // ── 29.7 Form Abandonment ──
    h3('29.7. Recomendações de Formulário');
    if (formInteractionData.length > 0) {
      const fieldStatsMap = new Map<string, { focus: number; blur: number; abandon: number }>();
      for (const r of formInteractionData) {
        const fieldName = r.eventName ?? '(desconhecido)';
        const stats = fieldStatsMap.get(fieldName) ?? { focus: 0, blur: 0, abandon: 0 };
        if (r.eventType === 'form_focus') stats.focus += Number(r.count);
        else if (r.eventType === 'form_blur') stats.blur += Number(r.count);
        else if (r.eventType === 'form_abandon') stats.abandon += Number(r.count);
        fieldStatsMap.set(fieldName, stats);
      }
      const worstFields = Array.from(fieldStatsMap.entries())
        .map(([field, stats]) => ({
          field,
          abandonRate: stats.focus + stats.blur > 0 ? (stats.abandon / (stats.focus + stats.blur)) * 100 : 0,
          total: stats.focus + stats.blur,
        }))
        .filter(f => f.total >= 3)
        .sort((a, b) => b.abandonRate - a.abandonRate);

      if (worstFields.length > 0 && worstFields[0].abandonRate > 30) {
        const worst = worstFields[0];
        bullet(`**Campo problemático:** "${worst.field}" tem ${pct(round2(worst.abandonRate))} de abandono. *Ações: (1) Verificar se o rótulo é autoexplicativo, (2) Adicionar placeholder com exemplo, (3) Tornar opcional se não for essencial, (4) Considerar usar autocomplete/autofill.*`);
      }
      bullet('*Recomendação geral:* Implementar validação em tempo real, salvar dados parcialmente (para recovery), e considerar multi-step form para reduzir atrito percebido.');
      line();
    }

    // ── 29.8 Scroll Depth Assessment ──
    h3('29.8. Avaliação de Engajamento de Conteúdo (Scroll)');
    if (scrollDepthData.length > 0) {
      const scroll75 = Number(scrollDepthData.find(s => s.eventName === 'scroll_75')?.count ?? 0);
      const scroll25 = Number(scrollDepthData.find(s => s.eventName === 'scroll_25')?.count ?? 0);
      const engagementPct = totalVisitors > 0 ? round2((scroll75 / totalVisitors) * 100) : 0;

      if (engagementPct >= 40) {
        bullet(`**EXCELENTE:** ${pct(engagementPct)} dos visitantes chegam a 75% da página. O conteúdo está altamente engajante. Mantenha a estratégia atual de copy e layout.`);
      } else if (engagementPct >= 15) {
        bullet(`**MODERADO:** ${pct(engagementPct)} dos visitantes chegam a 75% da página. Há oportunidade de melhorar. *Ações: (1) Adicionar elementos visuais que quebrem o texto, (2) Incluir CTAs intermediários, (3) Testar versões mais curtas do conteúdo.*`);
      } else if (totalVisitors > 0) {
        bullet(`**FRACO:** Apenas ${pct(engagementPct)} dos visitantes chegam a 75% da página. O conteúdo não está retendo. *Ações prioritárias: (1) Reescrever o copy com foco em benefícios, (2) Adicionar imagens/vídeos, (3) Reduzir o tamanho da página, (4) Mover o formulário para cima.*`);
      }
      line();
    }

    // ── 29.9 Overall Health Score ──
    h3('29.9. Score de Saúde Geral da Campanha');
    {
      // Compute a simple 0-100 health score based on key metrics
      let score = 50; // Base score
      let reasons: string[] = [];
      let deductions: string[] = [];

      // Conversion rate scoring (target: >5% for real estate LPs)
      if (realConversionRate >= 8) { score += 15; reasons.push(`Conversão real de ${pct(round2(realConversionRate))} — excelente`); }
      else if (realConversionRate >= 5) { score += 10; reasons.push(`Conversão real de ${pct(round2(realConversionRate))} — bom`); }
      else if (realConversionRate >= 3) { score += 5; reasons.push(`Conversão real de ${pct(round2(realConversionRate))} — aceitável`); }
      else { score -= 5; deductions.push(`Conversão real de ${pct(round2(realConversionRate))} — abaixo do esperado`); }

      // Bounce rate scoring
      if (bounceRate <= 30) { score += 10; reasons.push(`Bounce rate de ${pct(round2(bounceRate))} — excelente`); }
      else if (bounceRate <= 50) { score += 5; reasons.push(`Bounce rate de ${pct(round2(bounceRate))} — aceitável`); }
      else { score -= 5; deductions.push(`Bounce rate de ${pct(round2(bounceRate))} — alto`); }

      // Session duration scoring
      if (avgSessionSeconds >= 120 && avgSessionSeconds <= 300) { score += 5; reasons.push(`Duração de sessão saudável (${Math.floor(avgSessionSeconds / 60)}min)`); }
      else if (avgSessionSeconds > 0 && avgSessionSeconds < 60) { score -= 5; deductions.push(`Duração de sessão muito baixa`); }

      // Meta Pixel match rate
      if (pixelLeads > 0) {
        if (matchRate >= 80) { score += 5; reasons.push(`Meta Pixel match rate de ${pct(round2(matchRate))} — bom`); }
        else if (matchRate < 50) { score -= 10; deductions.push(`Meta Pixel match rate de ${pct(round2(matchRate))} — crítico`); }
      }

      // Scroll engagement
      const scroll75v = Number(scrollDepthData.find(s => s.eventName === 'scroll_75')?.count ?? 0);
      const scrollEngagementPct = totalVisitors > 0 ? (scroll75v / totalVisitors) * 100 : 0;
      if (scrollEngagementPct >= 30) { score += 5; reasons.push('Engajamento de conteúdo excelente'); }
      else if (scrollEngagementPct > 0 && scrollEngagementPct < 15) { score -= 3; deductions.push('Engajamento de conteúdo fraco'); }

      // Exit intent
      const exitRate2 = totalVisitors > 0 ? (exitIntents / totalVisitors) * 100 : 0;
      if (exitRate2 <= 15) { score += 5; reasons.push('Taxa de exit intent baixa'); }
      else if (exitRate2 >= 40) { score -= 5; deductions.push('Taxa de exit intent muito alta'); }

      // Lead volume
      if (uniqueLeads >= 10) { score += 5; reasons.push(`Volume de leads saudável (${fmt(uniqueLeads)})`); }
      else if (uniqueLeads === 0 && totalVisitors > 50) { score -= 10; deductions.push('Nenhum lead com tráfego significativo'); }

      score = Math.max(0, Math.min(100, score));

      const getScoreEmoji = (s: number) => {
        if (s >= 80) return '🟢';
        if (s >= 60) return '🟡';
        if (s >= 40) return '🟠';
        return '🔴';
      };
      const getScoreLabel = (s: number) => {
        if (s >= 80) return 'Saudável';
        if (s >= 60) return 'Aceitável — com oportunidades de melhoria';
        if (s >= 40) return 'Precisa de atenção — há gargalos significativos';
        return 'Crítico — requer ação imediata';
      };

      line('| Métrica | Score |');
      line('|---------|-------|');
      line(`| **Score de Saúde Geral** | **${getScoreEmoji(score)} ${score}/100 — ${getScoreLabel(score)}** |`);
      line();

      if (reasons.length > 0) {
        p('**Pontos positivos:**');
        for (const r of reasons) { bullet(`✅ ${r}`); }
        line();
      }
      if (deductions.length > 0) {
        p('**Pontos de atenção:**');
        for (const d of deductions) { bullet(`⚠️ ${d}`); }
        line();
      }

      p('**Próximos passos recomendados (prioridade):**');
      const nextSteps: string[] = [];
      if (deductions.includes('Nenhum lead com tráfego significativo')) {
        nextSteps.push('1. **URGENTE:** Investigar por que nenhum visitante está convertendo — verificar formulário, pixel e fluxo de conversão.');
      }
      if (deductions.some(d => d.includes('Meta Pixel'))) {
        nextSteps.push('2. **URGENTE:** Corrigir a discrepância entre Meta Pixel e CRM — auditar UTMs e evento de conversão.');
      }
      if (deductions.some(d => d.includes('bounce rate') || d.includes('Bounce rate'))) {
        nextSteps.push(`${nextSteps.length + 1}. **ALTA PRIORIDADE:** Reduzir a taxa de rejeição — otimizar landing page e verificar correspondência anúncio-LP.`);
      }
      if (deductions.some(d => d.includes('sessão') || d.includes('Engajamento'))) {
        nextSteps.push(`${nextSteps.length + 1}. **MÉDIA PRIORIDADE:** Melhorar o engajamento de conteúdo — revisar copy, adicionar elementos visuais e CTAs intermediários.`);
      }
      if (deductions.some(d => d.includes('exit intent'))) {
        nextSteps.push(`${nextSteps.length + 1}. **MÉDIA PRIORIDADE:** Implementar popup de exit intent para recuperar visitantes que tentam sair.`);
      }
      if (reasons.length > 3) {
        nextSteps.push(`${nextSteps.length + 1}. **MANUTENÇÃO:** A campanha está com boa saúde geral. Continue monitorando e faça testes A/B para melhorar ainda mais.`);
      }
      if (nextSteps.length === 0) {
        nextSteps.push('1. A campanha está em boa saúde. Continue monitorando os KPIs e faça otimizações incrementais.');
        nextSteps.push('2. Considere testes A/B para criativos e copy da landing page.');
        nextSteps.push('3. Expanda campanhas que performam bem e otimize as que estão abaixo do esperado.');
      }
      for (const step of nextSteps) { bullet(step); }
      line();
    }

    // ── 29.8.1 Web Vitals ──
    if (webVitalsData && (webVitalsData as any[]).length > 0) {
      h3('29.8.1 Core Web Vitals');
      p('Métricas de performance real medidas nos navegadores dos visitantes. Valores baseados nos thresholds do Google.');
      line();
      table(
        ['Métrica', 'Média', 'P75', 'Amostras', 'Avaliação'],
        (webVitalsData as any[]).map((v: any) => {
          const thresholds: Record<string, [number, number]> = { LCP: [2500, 4000], FCP: [1800, 3000], TTFB: [800, 1800], CLS: [0.1, 0.25], FID: [100, 300], INP: [200, 500] };
          const units: Record<string, string> = { CLS: '' };
          const [good, poor] = thresholds[v.metric] ?? [Infinity, Infinity];
          const unit = units[v.metric] ?? 'ms';
          const avg = Number(v.avg_value);
          const rating = avg <= good ? 'Bom' : avg <= poor ? 'Precisa melhorar' : 'Ruim';
          return [v.metric, `${round2(avg)}${unit}`, `${round2(Number(v.p75))}${unit}`, fmt(Number(v.count)), rating];
        })
      );
      line();
    }

    // ── 29.8.2 Engaged Time ──
    if (engagedTimeData && (engagedTimeData as any[]).length > 0) {
      h3('29.8.2 Tempo de Engajamento');
      p('Distribuição de visitantes por tempo de engajamento contínuo na página. Indica qualidade do conteúdo e interesse do público.');
      line();
      const totalEngaged = (engagedTimeData as any[]).reduce((s: number, r: any) => s + Number(r.count), 0);
      table(
        ['Tempo', 'Visitantes', '% do Total', 'Interpretação'],
        (engagedTimeData as any[]).map((r: any) => {
          const c = Number(r.count);
          const pctVal = totalEngaged > 0 ? (c / totalEngaged) * 100 : 0;
          const label = r.seconds >= 180 ? 'Alto engajamento' : r.seconds >= 60 ? 'Engajamento moderado' : r.seconds >= 30 ? 'Engajamento inicial' : 'Muito breve';
          return [r.seconds >= 60 ? `${r.seconds / 60}min` : `${r.seconds}s`, fmt(c), pct(pctVal), label];
        })
      );
      line();
    }

    // ── 29.8.3 JS Errors ──
    if (jsErrorsData && (jsErrorsData as any[]).length > 0) {
      h3('29.8.3 Erros de JavaScript');
      const totalErrors = (jsErrorsData as any[]).reduce((s: number, r: any) => s + Number(r.count), 0);
      p(`${fmt(totalErrors)} erros de JavaScript detectados nos visitantes. Erros filtrados de terceiros (Meta/Facebook) são excluídos automaticamente pelo pixel. Erros recorrentes podem indicar problemas de compatibilidade ou bugs.`);
      line();
      table(
        ['Erro', 'Ocorrências', 'Última Ocorrência'],
        (jsErrorsData as any[]).slice(0, 10).map((r: any) => [r.error_message?.substring(0, 80) || 'N/A', fmt(Number(r.count)), r.latest?.substring(0, 19)?.replace('T', ' ') || 'N/A'])
      );
      line();
    }

    // ── 29.8.4 Section Views ──
    if (sectionViewsData && (sectionViewsData as any[]).length > 0) {
      h3('29.8.4 Visualização de Seções');
      p('Quais seções da landing page os visitantes visualizam. Seções com poucas visualizações podem estar abaixo do fold ou serem irrelevantes.');
      line();
      table(
        ['Seção', 'Visualizações', 'Visitantes Únicos', '% Único'],
        (sectionViewsData as any[]).map((r: any) => {
          const uniquePct = Number(r.views) > 0 ? (Number(r.unique_visitors) / Number(r.views)) * 100 : 0;
          return [r.section, fmt(Number(r.views)), fmt(Number(r.unique_visitors)), pct(uniquePct)];
        })
      );
      line();
    }

    // ── 29.8.5 CTA Clicks ──
    if (ctaClicksData && (ctaClicksData as any[]).length > 0) {
      h3('29.8.5 Cliques em CTAs');
      p('Botões de call-to-action clicados pelos visitantes. CTAs com mais cliques indicam maior interesse em conversão.');
      line();
      table(
        ['CTA', 'Seção', 'Cliques', 'Visitantes Únicos', 'CTR Estimado'],
        (ctaClicksData as any[]).map((r: any) => {
          const ctr = totalVisitors > 0 ? (Number(r.unique_visitors) / totalVisitors) * 100 : 0;
          return [r.cta_text, r.section, fmt(Number(r.clicks)), fmt(Number(r.unique_visitors)), pct(ctr)];
        })
      );
      line();
    }

    // ── 29.8.6 Form Funnel ──
    if (formFunnelData && (formFunnelData as any[]).length > 0) {
      h3('29.8.6 Funil do Formulário');
      p('Etapas de interação com o formulário de captação. Quedas bruscas entre etapas indicam pontos de fricção.');
      line();
      const stages = ['form_view', 'form_focus', 'form_submit_attempt', 'form_submit', 'form_submit_error'];
      const stageLabels: Record<string, string> = { form_view: 'Visualização', form_focus: 'Foco no Campo', form_submit_attempt: 'Tentativa de Envio', form_submit: 'Envio Concluído', form_submit_error: 'Erro no Envio' };
      table(
        ['Etapa', 'Eventos', '% da Etapa Anterior', 'Acumulado'],
        stages.map((stage, idx) => {
          const stageData = (formFunnelData as any[]).find((f: any) => f.stage === stage);
          const count = stageData ? Number(stageData.count) : 0;
          const prevStage = idx > 0 ? stages[idx - 1] : null;
          const prevCount = prevStage ? ((formFunnelData as any[]).find((f: any) => f.stage === prevStage)?.count ?? 0) : 0;
          const prevPct = prevCount > 0 ? (count / prevCount) * 100 : 100;
          const viewCount = (formFunnelData as any[]).find((f: any) => f.stage === 'form_view')?.count ?? 1;
          const accPct = (count / Number(viewCount)) * 100;
          return [stageLabels[stage] || stage, fmt(count), idx === 0 ? '100%' : pct(prevPct), pct(accPct)];
        })
      );
      const errorCount = (formFunnelData as any[]).find((f: any) => f.stage === 'form_submit_error')?.count ?? 0;
      if (errorCount > 0) {
        line();
        p(`**Atenção:** ${fmt(Number(errorCount))} erros de envio de formulário detectados. Verifique se há problemas de validação, connector ou backend.`);
      }
      line();
    }

    // ── 29.8.7 Visitor Context ──
    if (visitorContextData && (visitorContextData as any[]).length > 0) {
      const languages = (visitorContextData as any[]).filter((c: any) => c.context_type === 'language');
      const connections = (visitorContextData as any[]).filter((c: any) => c.context_type === 'connection');
      if (languages.length > 0) {
        h3('29.8.7 Idioma e Conexão dos Visitantes');
        p('Contexto técnico dos visitantes: idioma do navegador e tipo de conexão. Esses dados ajudam a otimizar a experiência para o público predominante.');
        line();
        p('**Distribuição por Idioma:**');
        line();
        table(
          ['Idioma', 'Visitantes Únicos'],
          languages.slice(0, 8).map((r: any) => [r.context_value, fmt(Number(r.visitors))])
        );
      }
      if (connections.length > 0) {
        line();
        p('**Tipo de Conexão:**');
        line();
        table(
          ['Conexão', 'Visitantes Únicos', 'Qualidade'],
          connections.slice(0, 8).map((r: any) => {
            const quality = r.context_value === '4g' ? 'Excelente' : r.context_value === '3g' ? 'Razoável' : 'Lenta';
            return [r.context_value, fmt(Number(r.visitors)), quality];
          })
        );
      }
      line();
    }

    // ── 29.8.8 Content Engagement ──
    if (contentEngagementData && (contentEngagementData as any[]).length > 0) {
      h3('29.8.8 Engajamento de Conteúdo (Galeria + FAQ)');
      p('Interações com galeria de imagens e perguntas frequentes. Indicam interesse ativo no conteúdo do empreendimento.');
      line();
      table(
        ['Tipo', 'Item', 'Interações'],
        (contentEngagementData as any[]).slice(0, 15).map((r: any) => [r.event_type === 'gallery_click' ? 'Galeria' : 'FAQ', r.label, fmt(Number(r.count))])
      );
      line();
    }

    // ── 29.11 Methodology Note ──
    h3('29.11. Nota Metodológica');
    p('Este relatório é gerado automaticamente com base em dados de tracking de primeira parte (server-side). As análises e recomendações são calculadas por algoritmos heurísticos e não substituem a análise de um profissional de marketing. Para decisões de investimento, considere também dados de custo (CPA, ROAS) disponíveis no gerenciador de anúncios (Meta Ads Manager, Google Ads).');
    p('Dados de conversão do Meta Pixel podem divergir do CRM devido a: (1) deduplicação de eventos, (2) cookies bloqueados, (3) tempo de processamento do pixel, (4) leads inseridos manualmente no CRM. A seção 16 (Discrepância Meta Pixel vs CRM) detalha esta análise.');
    line();

    const markdown = md.join('\n');

    return new NextResponse(markdown, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition':
          `attachment; filename="tracking-report-${periodLabel.replace(/\s/g, '-')}-${new Date().toISOString().split('T')[0]}.md"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('[Tracking Report] Error:', message, stack);
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 },
    );
  }
}
