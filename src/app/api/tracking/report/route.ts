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
