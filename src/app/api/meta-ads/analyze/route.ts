import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash';

/**
 * API de Análise IA dos Leads do Meta Ads
 * Envia dados agregados dos leads para a IA gerar insights
 * e recomendações de otimização.
 */
export async function GET() {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    // ─────────────────────────────────────────
    // 1. Coletar dados dos leads do Meta
    // ─────────────────────────────────────────
    const metaClients = await db.client.findMany({
      where: {
        OR: [
          { notes: { contains: '[Meta Ads]' } },
          {
            interactions: {
              some: { description: { contains: '[Meta Ads]' } },
            },
          },
        ],
      },
      select: {
        name: true,
        phone: true,
        email: true,
        region: true,
        stage: true,
        notes: true,
        createdAt: true,
        lastInteractionAt: true,
        enterprise: true,
        interactions: {
          select: {
            description: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 3,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    if (metaClients.length === 0) {
      return NextResponse.json({
        analysis: null,
        message: 'Nenhum lead do Meta Ads encontrado para análise. Configure o webhook e aguarde os primeiros leads.',
      });
    }

    // ─────────────────────────────────────────
    // 2. Montar dados agregados
    // ─────────────────────────────────────────
    const total = metaClients.length;
    const stages: Record<string, number> = {};
    const regions: Record<string, number> = {};
    const campaigns: Record<string, number> = {};
    const byMonth: Record<string, number> = {};
    let withoutInteraction = 0;

    for (const c of metaClients) {
      // Estágio
      stages[c.stage] = (stages[c.stage] || 0) + 1;

      // Região
      if (c.region) {
        regions[c.region] = (regions[c.region] || 0) + 1;
      }

      // Campanha (das notas)
      if (c.notes) {
        const campaignMatch = c.notes.match(/Campanha:\s*(.+)/);
        if (campaignMatch) {
          campaigns[campaignMatch[1].trim()] = (campaigns[campaignMatch[1].trim()] || 0) + 1;
        }
      }

      // Por mês
      const monthKey = c.createdAt.toISOString().slice(0, 7);
      byMonth[monthKey] = (byMonth[monthKey] || 0) + 1;

      // Sem interação após criação
      if (!c.lastInteractionAt || c.lastInteractionAt.getTime() === c.createdAt.getTime()) {
        withoutInteraction++;
      }
    }

    // Top 5 campanhas
    const topCampaigns = Object.entries(campaigns)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Top 5 regiões
    const topRegions = Object.entries(regions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Leads recentes (últimos 7 dias)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const recentLeads = metaClients.filter((c) => c.createdAt >= weekAgo).length;

    // Taxa de conversão
    const converted = (stages['NEGOCIACAO'] || 0) + (stages['PROPOSTA'] || 0) + (stages['FECHADO'] || 0);
    const convRate = ((converted / total) * 100).toFixed(1);

    // Amostra de leads para contexto
    const sampleLeads = metaClients.slice(0, 15).map((c) => ({
      nome: c.name,
      telefone: c.phone || 'N/A',
      email: c.email || 'N/A',
      regiao: c.region || 'N/A',
      etapa: c.stage,
      criadoEm: c.createdAt.toISOString().split('T')[0],
      ultimaInteracao: c.lastInteractionAt?.toISOString().split('T')[0] || 'Nenhuma',
      campanha: (() => {
        if (!c.notes) return 'N/A';
        const m = c.notes.match(/Campanha:\s*(.+)/);
        return m ? m[1].trim() : 'N/A';
      })(),
    }));

    // ─────────────────────────────────────────
    // 2b. Coletar dados do pixel próprio (raw SQL)
    // ─────────────────────────────────────────
    let pixelData: {
      visitors: number;
      pageviews: number;
      pixelLeads: number;
      whatsappClicks: number;
      campaignsCount: number;
      creativesCount: number;
      bounceRate: number | null;
      avgTimeOnPage: number | null;
      topPixelCampaigns: Array<{
        campaign: string;
        visitors: number;
        leads: number;
      }>;
      scrollDepth: Array<{ depth: number; visitors: number; pct: number }>;
      whatsappBreakdown: Array<{ source: string; clicks: number; uniqueVisitors: number }>;
      deviceBreakdown: Array<{ device: string; visitors: number; leads: number }>;
      referrerBreakdown: Array<{ referrer: string; visitors: number; leads: number }>;
      topPages: Array<{ url: string; views: number; leads: number }>;
      funnelStages: Array<{ stage: string; count: number; rate: number }>;
      webVitals: Array<{ metric: string; avg_value: number; count: number }>;
      galleryEngagement: { totalClicks: number; visitorsClicked: number; avgImagesViewed: number };
      faqEngagement: Array<{ question_index: number; question: string; opens: number }>;
      formFieldDropoff: Array<{ field: string; avg_time_ms: number; focus_count: number; blur_count: number }>;
      sectionViews: Array<{ section: string; visitors: number }>;
      exitIntentCount: number;
      jsErrorCount: number;
      printCount: number;
      formAbandonCount: number;
      timezoneBreakdown: Array<{ timezone: string; visitors: number }>;
      languageBreakdown: Array<{ language: string; visitors: number }>;
    } = {
      visitors: 0,
      pageviews: 0,
      pixelLeads: 0,
      whatsappClicks: 0,
      campaignsCount: 0,
      creativesCount: 0,
      bounceRate: null,
      avgTimeOnPage: null,
      topPixelCampaigns: [],
      scrollDepth: [],
      whatsappBreakdown: [],
      deviceBreakdown: [],
      referrerBreakdown: [],
      topPages: [],
      funnelStages: [],
      webVitals: [],
      galleryEngagement: { totalClicks: 0, visitorsClicked: 0, avgImagesViewed: 0 },
      faqEngagement: [],
      formFieldDropoff: [],
      sectionViews: [],
      exitIntentCount: 0,
      jsErrorCount: 0,
      printCount: 0,
      formAbandonCount: 0,
      timezoneBreakdown: [],
      languageBreakdown: [],
    };

    let pixelAvailable = false;

    try {
      // Run all pixel queries in parallel for speed
      const [
        funnelResult,
        campaignResults,
        bounceResult,
        scrollResult,
        timeOnPageResult,
        whatsappBreakdownResult,
        deviceResult,
        referrerResult,
        topPagesResult,
        funnelStagesResult,
        webVitalsResult,
        galleryResult,
        faqResult,
        formFieldResult,
        sectionViewResult,
        eventCountsResult,
        timezoneResult,
        languageResult,
      ] = await Promise.all([
        // Query 1: Core funnel data
        db.$queryRaw<{
          visitors: string | number;
          pageviews: string | number;
          pixel_leads: string | number;
          whatsapp_clicks: string | number;
          campaigns_count: string | number;
          creatives_count: string | number;
        }[]>`
          SELECT
            COUNT(DISTINCT "visitorId") as visitors,
            COUNT(*) FILTER (WHERE "eventType" = 'pageview') as pageviews,
            COUNT(*) FILTER (WHERE "eventType" = 'lead' OR "eventType" = 'form_submit') as pixel_leads,
            COUNT(DISTINCT CASE WHEN "eventType" = 'whatsapp_click' THEN "visitorId" END) as whatsapp_clicks,
            COUNT(DISTINCT "utmCampaign") as campaigns_count,
            COUNT(DISTINCT "utmContent") as creatives_count
          FROM "tracking_events"
          WHERE "createdAt" >= NOW() - INTERVAL '30 days'
        `,

        // Query 2: Top campaigns from pixel data
        db.$queryRaw<{
          campaign: string;
          visitors: string | number;
          leads: string | number;
        }[]>`
          SELECT
            COALESCE("utmCampaign", '(direto)') as campaign,
            COUNT(DISTINCT "visitorId") as visitors,
            COUNT(DISTINCT CASE WHEN "eventType" = 'lead' OR "eventType" = 'form_submit' THEN "visitorId" END) as leads
          FROM "tracking_events"
          WHERE "createdAt" >= NOW() - INTERVAL '30 days'
          GROUP BY COALESCE("utmCampaign", '(direto)')
          ORDER BY leads DESC
          LIMIT 10
        `,

        // Query 3: Bounce rate
        db.$queryRaw<{ bounce_rate: string | number }[]>`
          SELECT
            ROUND(COUNT(*) FILTER (WHERE total_events = 1)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as bounce_rate
          FROM (
            SELECT "visitorId", COUNT(*) as total_events
            FROM "tracking_events"
            WHERE "createdAt" >= NOW() - INTERVAL '30 days'
            GROUP BY "visitorId"
          ) sub
        `,

        // Query 4: Scroll depth distribution
        db.$queryRaw<{ depth: number; visitors: string | number }[]>`
          SELECT
            (metadata->>'depth')::int as depth,
            COUNT(DISTINCT "visitorId") as visitors
          FROM "tracking_events"
          WHERE "eventType" = 'scroll_depth'
            AND "createdAt" >= NOW() - INTERVAL '30 days'
            AND metadata->>'depth' IS NOT NULL
          GROUP BY (metadata->>'depth')::int
          ORDER BY depth
        `,

        // Query 5: Average time on page (from pageview_duration events)
        db.$queryRaw<{ avg_seconds: string | number; median_seconds: string | number }[]>`
          SELECT
            ROUND(AVG((metadata->>'time_on_page')::numeric))::text as avg_seconds,
            ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (metadata->>'time_on_page')::numeric))::text as median_seconds
          FROM "tracking_events"
          WHERE "eventType" = 'pageview_duration'
            AND "createdAt" >= NOW() - INTERVAL '30 days'
            AND metadata->>'time_on_page' IS NOT NULL
        `,

        // Query 6: WhatsApp click breakdown by source
        db.$queryRaw<{ source: string; clicks: string | number; unique_visitors: string | number }[]>`
          SELECT
            COALESCE(metadata->>'source', '(principal)') as source,
            COUNT(*) as clicks,
            COUNT(DISTINCT "visitorId") as unique_visitors
          FROM "tracking_events"
          WHERE "eventType" = 'whatsapp_click'
            AND "createdAt" >= NOW() - INTERVAL '30 days'
          GROUP BY COALESCE(metadata->>'source', '(principal)')
          ORDER BY clicks DESC
        `,

        // Query 7: Device breakdown (mobile vs tablet vs desktop)
        db.$queryRaw<{ device: string; visitors: string | number; leads: string | number }[]>`
          SELECT
            CASE
              WHEN LOWER("userAgent") LIKE '%mobile%' OR LOWER("userAgent") LIKE '%android%' OR LOWER("userAgent") LIKE '%iphone%'
              THEN 'Mobile'
              WHEN LOWER("userAgent") LIKE '%tablet%' OR LOWER("userAgent") LIKE '%ipad%'
              THEN 'Tablet'
              ELSE 'Desktop'
            END as device,
            COUNT(DISTINCT v."visitorId")::text as visitors,
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN v."visitorId" END)::text as leads
          FROM "tracking_visitors" v
          WHERE v."lastSeenAt" >= NOW() - INTERVAL '30 days'
          GROUP BY
            CASE
              WHEN LOWER("userAgent") LIKE '%mobile%' OR LOWER("userAgent") LIKE '%android%' OR LOWER("userAgent") LIKE '%iphone%'
              THEN 'Mobile'
              WHEN LOWER("userAgent") LIKE '%tablet%' OR LOWER("userAgent") LIKE '%ipad%'
              THEN 'Tablet'
              ELSE 'Desktop'
            END
          ORDER BY visitors DESC
        `,

        // Query 8: Referrer breakdown (top sources)
        db.$queryRaw<{ referrer: string; visitors: string | number; leads: string | number }[]>`
          SELECT
            CASE
              WHEN "referrer" IS NULL OR "referrer" = '' THEN '(direto)'
              WHEN LOWER("referrer") LIKE '%facebook%' OR LOWER("referrer") LIKE '%fb%' THEN 'Facebook'
              WHEN LOWER("referrer") LIKE '%instagram%' THEN 'Instagram'
              WHEN LOWER("referrer") LIKE '%google%' THEN 'Google'
              WHEN LOWER("referrer") LIKE '%whatsapp%' THEN 'WhatsApp'
              WHEN LOWER("referrer") LIKE '%linkedin%' THEN 'LinkedIn'
              ELSE 'Outros'
            END as referrer,
            COUNT(DISTINCT "visitorId")::text as visitors,
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN e."visitorId" END)::text as leads
          FROM "tracking_events" e
          LEFT JOIN "tracking_visitors" v ON v."visitorId" = e."visitorId"
          WHERE e."eventType" = 'pageview'
            AND e."createdAt" >= NOW() - INTERVAL '30 days'
          GROUP BY
            CASE
              WHEN "referrer" IS NULL OR "referrer" = '' THEN '(direto)'
              WHEN LOWER("referrer") LIKE '%facebook%' OR LOWER("referrer") LIKE '%fb%' THEN 'Facebook'
              WHEN LOWER("referrer") LIKE '%instagram%' THEN 'Instagram'
              WHEN LOWER("referrer") LIKE '%google%' THEN 'Google'
              WHEN LOWER("referrer") LIKE '%whatsapp%' THEN 'WhatsApp'
              WHEN LOWER("referrer") LIKE '%linkedin%' THEN 'LinkedIn'
              ELSE 'Outros'
            END
          ORDER BY visitors DESC
          LIMIT 10
        `,

        // Query 9: Top landing pages with conversion
        db.$queryRaw<{ url: string; views: string | number; leads: string | number }[]>`
          SELECT
            COALESCE("pageUrl", '(desconhecida)') as url,
            COUNT(*)::text as views,
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN e."visitorId" END)::text as leads
          FROM "tracking_events" e
          LEFT JOIN "tracking_visitors" v ON v."visitorId" = e."visitorId"
          WHERE e."eventType" = 'pageview'
            AND e."createdAt" >= NOW() - INTERVAL '30 days'
          GROUP BY COALESCE("pageUrl", '(desconhecida)')
          ORDER BY COUNT(*) DESC
          LIMIT 10
        `,

        // Query 10: Full funnel stages (pageview visitors → engaged → leads)
        db.$queryRaw<{ stage: string; count: string | number }[]>`
          WITH base AS (
            SELECT e."visitorId", v."leadId", COUNT(*) OVER (PARTITION BY e."visitorId") AS event_count
            FROM tracking_events e
            LEFT JOIN tracking_visitors v ON v."visitorId" = e."visitorId"
            WHERE e."createdAt" >= NOW() - INTERVAL '30 days'
          ),
          pv_visitors AS (
            SELECT COUNT(DISTINCT "visitorId")::text AS cnt FROM base WHERE EXISTS (
              SELECT 1 FROM tracking_events e2 WHERE e2."visitorId" = base."visitorId" AND e2."eventType" = 'pageview'
            )
          ),
          engaged AS (
            SELECT COUNT(DISTINCT "visitorId")::text AS cnt FROM base WHERE event_count > 1
          ),
          leads AS (
            SELECT COUNT(DISTINCT "visitorId")::text AS cnt FROM base WHERE "leadId" IS NOT NULL
          )
          SELECT 'pageview' AS stage, (SELECT cnt FROM pv_visitors) AS count
          UNION ALL
          SELECT 'engagement' AS stage, (SELECT cnt FROM engaged) AS count
          UNION ALL
          SELECT 'lead' AS stage, (SELECT cnt FROM leads) AS count
        `,

        // Query 11: Web Vitals (average LCP, FID, CLS, FCP, TTFB, INP)
        db.$queryRaw<{ metric: string; avg_value: string | number; count: string | number }[]>`
          SELECT
            metadata->>'metric' as metric,
            ROUND(AVG((metadata->>'value')::numeric))::text as avg_value,
            COUNT(*)::text as count
          FROM "tracking_events"
          WHERE "eventType" = 'web_vital'
            AND "createdAt" >= NOW() - INTERVAL '30 days'
            AND metadata->>'metric' IS NOT NULL
            AND metadata->>'value' IS NOT NULL
          GROUP BY metadata->>'metric'
          ORDER BY avg_value::numeric DESC
        `,

        // Query 12: Gallery engagement
        db.$queryRaw<{ total_clicks: string | number; visitors_clicked: string | number; avg_images: string | number }[]>`
          SELECT
            COUNT(*)::text as total_clicks,
            COUNT(DISTINCT "visitorId")::text as visitors_clicked,
            ROUND(AVG((metadata->>'total_images')::numeric))::text as avg_images
          FROM "tracking_events"
          WHERE "eventType" = 'gallery_click'
            AND "createdAt" >= NOW() - INTERVAL '30 days'
        `,

        // Query 13: FAQ engagement
        db.$queryRaw<{ question_index: number; question: string; opens: string | number }[]>`
          SELECT
            COALESCE((metadata->>'question_index')::int, 0) as question_index,
            COALESCE(metadata->>'question', '(sem texto)') as question,
            COUNT(*)::text as opens
          FROM "tracking_events"
          WHERE "eventType" = 'faq_open'
            AND "createdAt" >= NOW() - INTERVAL '30 days'
          GROUP BY COALESCE((metadata->>'question_index')::int, 0), COALESCE(metadata->>'question', '(sem texto)')
          ORDER BY opens DESC
        `,

        // Query 14: Form field drop-off (avg time per field, focus vs blur counts)
        db.$queryRaw<{ field: string; avg_time_ms: string | number; focus_count: string | number; blur_count: string | number }[]>`
          SELECT
            COALESCE(metadata->>'field', '(desconhecido)') as field,
            ROUND(AVG((metadata->>'time_spent_ms')::numeric))::text as avg_time_ms,
            COUNT(*) FILTER (WHERE "eventType" = 'form_focus')::text as focus_count,
            COUNT(*) FILTER (WHERE "eventType" = 'form_blur')::text as blur_count
          FROM "tracking_events"
          WHERE ("eventType" = 'form_focus' OR "eventType" = 'form_blur')
            AND "createdAt" >= NOW() - INTERVAL '30 days'
          GROUP BY COALESCE(metadata->>'field', '(desconhecido)')
          ORDER BY avg_time_ms::numeric DESC
        `,

        // Query 15: Section views
        db.$queryRaw<{ section: string; visitors: string | number }[]>`
          SELECT
            COALESCE(metadata->>'section', '(desconhecida)') as section,
            COUNT(DISTINCT "visitorId")::text as visitors
          FROM "tracking_events"
          WHERE "eventType" = 'section_view'
            AND "createdAt" >= NOW() - INTERVAL '30 days'
          GROUP BY COALESCE(metadata->>'section', '(desconhecida)')
          ORDER BY visitors DESC
        `,

        // Query 16: Exit intent, JS errors, print, form abandon counts
        db.$queryRaw<{
          exit_intent: string | number;
          js_errors: string | number;
          prints: string | number;
          form_abandons: string | number;
        }[]>`
          SELECT
            COUNT(*) FILTER (WHERE "eventType" = 'exit_intent')::text as exit_intent,
            COUNT(*) FILTER (WHERE "eventType" = 'js_error')::text as js_errors,
            COUNT(*) FILTER (WHERE "eventType" = 'print')::text as prints,
            COUNT(*) FILTER (WHERE "eventType" = 'form_abandon')::text as form_abandons
          FROM "tracking_events"
          WHERE "createdAt" >= NOW() - INTERVAL '30 days'
        `,

        // Query 17: Timezone breakdown (from metadata of pageview events)
        db.$queryRaw<{ timezone: string; visitors: string | number }[]>`
          SELECT
            COALESCE(metadata->>'timezone', '(desconhecido)') as timezone,
            COUNT(DISTINCT "visitorId")::text as visitors
          FROM "tracking_events"
          WHERE "eventType" = 'pageview'
            AND "createdAt" >= NOW() - INTERVAL '30 days'
            AND metadata->>'timezone' IS NOT NULL
          GROUP BY COALESCE(metadata->>'timezone', '(desconhecido)')
          ORDER BY visitors DESC
          LIMIT 10
        `,

        // Query 18: Language breakdown
        db.$queryRaw<{ language: string; visitors: string | number }[]>`
          SELECT
            COALESCE(metadata->>'language', '(desconhecido)') as language,
            COUNT(DISTINCT "visitorId")::text as visitors
          FROM "tracking_events"
          WHERE "eventType" = 'pageview'
            AND "createdAt" >= NOW() - INTERVAL '30 days'
            AND metadata->>'language' IS NOT NULL
          GROUP BY COALESCE(metadata->>'language', '(desconhecido)')
          ORDER BY visitors DESC
          LIMIT 10
        `,
      ]);

      if (funnelResult.length > 0) {
        const row = funnelResult[0];
        pixelData.visitors = Number(row.visitors) || 0;
        pixelData.pageviews = Number(row.pageviews) || 0;
        pixelData.pixelLeads = Number(row.pixel_leads) || 0;
        pixelData.whatsappClicks = Number(row.whatsapp_clicks) || 0;
        pixelData.campaignsCount = Number(row.campaigns_count) || 0;
        pixelData.creativesCount = Number(row.creatives_count) || 0;
        pixelAvailable = true;
      }

      pixelData.topPixelCampaigns = campaignResults.map((row) => ({
        campaign: row.campaign,
        visitors: Number(row.visitors) || 0,
        leads: Number(row.leads) || 0,
      }));

      if (bounceResult.length > 0 && bounceResult[0].bounce_rate !== null) {
        pixelData.bounceRate = Number(bounceResult[0].bounce_rate) || null;
      }

      // Scroll depth
      const totalVisitors = pixelData.visitors || 1;
      pixelData.scrollDepth = scrollResult.map((row) => ({
        depth: Number(row.depth),
        visitors: Number(row.visitors) || 0,
        pct: Math.round((Number(row.visitors) / totalVisitors) * 1000) / 10,
      }));

      // Time on page
      if (timeOnPageResult.length > 0 && timeOnPageResult[0].avg_seconds !== null) {
        pixelData.avgTimeOnPage = Number(timeOnPageResult[0].avg_seconds) || null;
      }

      // WhatsApp breakdown
      pixelData.whatsappBreakdown = whatsappBreakdownResult.map((row) => ({
        source: row.source,
        clicks: Number(row.clicks) || 0,
        uniqueVisitors: Number(row.unique_visitors) || 0,
      }));

      // Device breakdown
      pixelData.deviceBreakdown = deviceResult.map((row) => ({
        device: row.device,
        visitors: Number(row.visitors) || 0,
        leads: Number(row.leads) || 0,
      }));

      // Referrer breakdown
      pixelData.referrerBreakdown = referrerResult.map((row) => ({
        referrer: row.referrer,
        visitors: Number(row.visitors) || 0,
        leads: Number(row.leads) || 0,
      }));

      // Top pages
      pixelData.topPages = topPagesResult.map((row) => ({
        url: row.url,
        views: Number(row.views) || 0,
        leads: Number(row.leads) || 0,
      }));

      // Funnel stages
      const pvCount = Number(funnelStagesResult.find((f) => f.stage === 'pageview')?.count ?? 0);
      pixelData.funnelStages = funnelStagesResult.map((f) => {
        const count = Number(f.count) || 0;
        return {
          stage: f.stage,
          count,
          rate: pvCount > 0 ? Math.round((count / pvCount) * 1000) / 10 : 0,
        };
      });

      // Web vitals
      pixelData.webVitals = webVitalsResult.map((r) => ({
        metric: r.metric,
        avg_value: Number(r.avg_value) || 0,
        count: Number(r.count) || 0,
      }));

      // Gallery engagement
      if (galleryResult.length > 0) {
        const gr = galleryResult[0];
        pixelData.galleryEngagement = {
          totalClicks: Number(gr.total_clicks) || 0,
          visitorsClicked: Number(gr.visitors_clicked) || 0,
          avgImagesViewed: Number(gr.avg_images) || 0,
        };
      }

      // FAQ engagement
      pixelData.faqEngagement = faqResult.map((r) => ({
        question_index: r.question_index,
        question: r.question,
        opens: Number(r.opens) || 0,
      }));

      // Form field drop-off
      pixelData.formFieldDropoff = formFieldResult.map((r) => ({
        field: r.field,
        avg_time_ms: Number(r.avg_time_ms) || 0,
        focus_count: Number(r.focus_count) || 0,
        blur_count: Number(r.blur_count) || 0,
      }));

      // Section views
      pixelData.sectionViews = sectionViewResult.map((r) => ({
        section: r.section,
        visitors: Number(r.visitors) || 0,
      }));

      // Event counts (exit intent, errors, prints, form abandons)
      if (eventCountsResult.length > 0) {
        const ec = eventCountsResult[0];
        pixelData.exitIntentCount = Number(ec.exit_intent) || 0;
        pixelData.jsErrorCount = Number(ec.js_errors) || 0;
        pixelData.printCount = Number(ec.prints) || 0;
        pixelData.formAbandonCount = Number(ec.form_abandons) || 0;
      }

      // Timezone breakdown
      pixelData.timezoneBreakdown = timezoneResult.map((r) => ({
        timezone: r.timezone,
        visitors: Number(r.visitors) || 0,
      }));

      // Language breakdown
      pixelData.languageBreakdown = languageResult.map((r) => ({
        language: r.language,
        visitors: Number(r.visitors) || 0,
      }));
    } catch (pixelErr) {
      // tracking_events table may not exist yet (migration not run) — continue without pixel data
      console.warn('[Meta Ads Analyze] Tabela tracking_events não disponível, prosseguindo sem dados de pixel:', pixelErr);
      pixelAvailable = false;
    }

    // ─────────────────────────────────────────
    // 3. Montar prompt para IA
    // ─────────────────────────────────────────

    // Pixel data section (only included if data is available)
    let pixelSection = '';
    if (pixelAvailable && pixelData.visitors > 0) {
      const campaignLines = pixelData.topPixelCampaigns
        .map((c) => {
          const convPct = c.visitors > 0 ? ((c.leads / c.visitors) * 100).toFixed(1) : '0.0';
          return `- ${c.campaign}: ${c.visitors} visitantes, ${c.leads} leads (${convPct}% conversão)`;
        })
        .join('\n');

      const scrollLines = pixelData.scrollDepth.length > 0
        ? pixelData.scrollDepth.map((s) => `- ${s.depth}%: ${s.visitors} visitantes (${s.pct}% do total)`).join('\n')
        : '- Nenhum dado de scroll disponível';

      const waLines = pixelData.whatsappBreakdown.length > 0
        ? pixelData.whatsappBreakdown.map((w) => `- ${w.source}: ${w.clicks} cliques (${w.uniqueVisitors} visitantes únicos)`).join('\n')
        : '- Nenhum clique no WhatsApp registrado';

      const deviceLines = pixelData.deviceBreakdown.length > 0
        ? pixelData.deviceBreakdown.map((d) => {
            const convPct = d.visitors > 0 ? ((d.leads / d.visitors) * 100).toFixed(1) : '0.0';
            return `- ${d.device}: ${d.visitors} visitantes, ${d.leads} leads (${convPct}% conversão)`;
          }).join('\n')
        : '- Nenhum dado de dispositivo disponível';

      const referrerLines = pixelData.referrerBreakdown.length > 0
        ? pixelData.referrerBreakdown.map((r) => {
            const convPct = r.visitors > 0 ? ((r.leads / r.visitors) * 100).toFixed(1) : '0.0';
            return `- ${r.referrer}: ${r.visitors} visitantes, ${r.leads} leads (${convPct}% conversão)`;
          }).join('\n')
        : '- Nenhum dado de referrer disponível';

      const pageLines = pixelData.topPages.length > 0
        ? pixelData.topPages.slice(0, 5).map((p) => {
            const convPct = p.views > 0 ? ((p.leads / p.views) * 100).toFixed(1) : '0.0';
            return `- ${p.url}: ${p.views} visualizações, ${p.leads} leads (${convPct}% conversão)`;
          }).join('\n')
        : '- Nenhum dado de páginas disponível';

      const funnelLines = pixelData.funnelStages.length > 0
        ? pixelData.funnelStages.map((f) => `- ${f.stage}: ${f.count} visitantes (${f.rate}%)`).join('\n')
        : '- Funil não disponível';

      const avgTime = pixelData.avgTimeOnPage ? Math.round(pixelData.avgTimeOnPage) : null;

      // CRM leads from Meta (same 30-day window for fair comparison)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const crmMetaLeads30d = metaClients.filter((c) => c.createdAt >= thirtyDaysAgo).length;

      pixelSection = `

## DADOS DO PIXEL PROPRIO (ultimos 30 dias)
- Visitantes unicos rastreados: ${pixelData.visitors}
- Pageviews registrados: ${pixelData.pageviews}
- Leads capturados pelo pixel (form_submit + lead): ${pixelData.pixelLeads}
- Cliques no WhatsApp rastreados: ${pixelData.whatsappClicks}
- Taxa de rejeicao: ${pixelData.bounceRate !== null ? pixelData.bounceRate + '%' : 'N/A'}
- Tempo medio na pagina: ${avgTime ? avgTime + ' segundos (' + Math.floor(avgTime / 60) + 'min ' + (avgTime % 60) + 's)' : 'N/A'}
- Campanhas ativas (UTM): ${pixelData.campaignsCount}
- Criativos rastreados: ${pixelData.creativesCount}

### Funil completo de conversao (pixel):
${funnelLines}

### Profundidade de scroll dos visitantes:
${scrollLines}

### Cliques no WhatsApp por origem:
${waLines}

### Dispositivos dos visitantes:
${deviceLines}

### Principais fontes de trafego (referrer):
${referrerLines}

### Top landing pages:
${pageLines}

### Desempenho por campanha (pixel):
${campaignLines}

### Discrepancia Pixel vs CRM:
- Leads no pixel (form_submit + lead, ultimos 30 dias): ${pixelData.pixelLeads}
- Leads no CRM (tag Meta Ads, ultimos 30 dias): ${crmMetaLeads30d}
- NOTA: Leads do webhook Meta Ads NAO geram eventos de pixel. A discrepancia e esperada quando ha leads vindos diretamente do formulario do Facebook.

### Performance da Pagina (Web Vitals):
${pixelData.webVitals.length > 0 ? pixelData.webVitals.map((v) => `- ${v.metric}: media ${v.avg_value}ms (${v.count} amostras)`).join('\n') : '- Nenhum dado de Web Vitals disponivel'}

### Engajamento com Galeria de Imagens:
- Total de cliques na galeria: ${pixelData.galleryEngagement.totalClicks}
- Visitantes que clicaram: ${pixelData.galleryEngagement.visitorsClicked} (${pixelData.visitors > 0 ? ((pixelData.galleryEngagement.visitorsClicked / pixelData.visitors) * 100).toFixed(1) : '0.0'}% dos visitantes)
- Media de imagens por sessao com galeria: ${pixelData.galleryEngagement.avgImagesViewed.toFixed(1)}

### Perguntas Frequentes (FAQ) - Engajamento:
${pixelData.faqEngagement.length > 0 ? pixelData.faqEngagement.map((f) => `- P${f.question_index + 1}: "${f.question}" — ${f.opens} aberturas`).join('\n') : '- Nenhum dado de FAQ disponivel'}

### Comportamento no Formulario (tempo por campo):
${pixelData.formFieldDropoff.length > 0 ? pixelData.formFieldDropoff.map((f) => {
  const dropoff = f.focus_count > 0 ? ((1 - f.blur_count / f.focus_count) * 100).toFixed(1) : 'N/A';
  return `- Campo "${f.field}": focos=${f.focus_count}, blurs=${f.blur_count}, tempo medio=${f.avg_time_ms}ms, taxa de desistencia=${dropoff}%`;
}).join('\n') : '- Nenhum dado de formulario disponivel'}

### Visualizacao de Secoes (quais secos os visitantes veem):
${pixelData.sectionViews.length > 0 ? pixelData.sectionViews.map((s) => `- ${s.section}: ${s.visitors} visitantes (${pixelData.visitors > 0 ? ((s.visitors / pixelData.visitors) * 100).toFixed(1) : '0.0'}%)`).join('\n') : '- Nenhum dado de secoes disponivel'}

### Comportamento de Saida e Erros:
- Exit intent (mouse saindo da pagina): ${pixelData.exitIntentCount} eventos (${pixelData.visitors > 0 ? ((pixelData.exitIntentCount / pixelData.visitors) * 100).toFixed(1) : '0.0'}% dos visitantes)
- Erros de JavaScript: ${pixelData.jsErrorCount} erros registrados
- Impressoes (print): ${pixelData.printCount}
- Formularios abandonados (usuario saiu sem enviar): ${pixelData.formAbandonCount}

### Fuso Horario dos Visitantes:
${pixelData.timezoneBreakdown.length > 0 ? pixelData.timezoneBreakdown.map((t) => `- ${t.timezone}: ${t.visitors} visitantes (${((t.visitors / pixelData.visitors) * 100).toFixed(1)}%)`).join('\n') : '- Nenhum dado de fuso horario disponivel'}

### Idioma do Navegador:
${pixelData.languageBreakdown.length > 0 ? pixelData.languageBreakdown.map((l) => `- ${l.language}: ${l.visitors} visitantes (${((l.visitors / pixelData.visitors) * 100).toFixed(1)}%)`).join('\n') : '- Nenhum dado de idioma disponivel'}`;
    }

    const dataSummary = `
## Dados do Meta Ads para Análise

### Visão Geral
- Total de leads recebidos: ${total}
- Leads nos últimos 7 dias: ${recentLeads}
- Taxa de conversão (Leads → Negociação/Proposta/Fechado): ${convRate}%
- Leads sem nenhuma interação: ${withoutInteraction} (${((withoutInteraction / total) * 100).toFixed(1)}%)

### Distribuição por Estágio do Funil
${Object.entries(stages).sort((a, b) => b[1] - a[1]).map(([s, c]) => `- ${s}: ${c} (${((c / total) * 100).toFixed(1)}%)`).join('\n')}

### Top Campanhas
${topCampaigns.length > 0 ? topCampaigns.map(([name, count]) => `- "${name}": ${count} leads`).join('\n') : '- Nenhuma campanha identificada nos dados'}

### Top Regiões
${topRegions.length > 0 ? topRegions.map(([name, count]) => `- ${name}: ${count} leads`).join('\n') : '- Nenhuma região identificada'}

### Volume Mensal
${Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0])).map(([m, c]) => `- ${m}: ${c} leads`).join('\n')}

### Amostra de 15 Leads (mais recentes)
${JSON.stringify(sampleLeads, null, 2)}
${pixelSection}
`.trim();

    const systemPrompt = `Você é um consultor especialista em marketing digital e Meta Ads (Facebook/Instagram) para o mercado imobiliário brasileiro.
Seu papel é analisar os dados de leads do Meta Ads e fornecer insights acionáveis em português brasileiro.

Cruze os dados do pixel próprio com os dados de leads do CRM. Identifique discrepâncias entre o que o pixel registrou e o que o CRM mostra. Analise a taxa de rejeição, o comportamento dos visitantes, engajamento (scroll depth), tempo na página, dispositivo (mobile vs desktop) e effectiveness dos CTAs de WhatsApp.

Analise os dados fornecidos e gere um relatório estruturado com as seguintes seções:

1. **Resumo Executivo** — Visão geral rápida dos números e tendências
2. **Análise de Funil Completo** — Use o funil do pixel (pageview → engagement → lead). Identifique gargalos. Analise a taxa de rejeição e o tempo médio na página.
3. **Engajamento e Comportamento** — Analise scroll depth, tempo na página, dispositivos, fontes de tráfego e visualização de seções. Identifique padrões de comportamento.
4. **Qualidade dos Leads** — Os leads parecem qualificados? Há padrões nos dados? Que tipo de visitante converte?
5. **Performance da Landing Page** — Analise Web Vitals (LCP, FID, CLS). Há problemas de performance que afetam a conversão? Há erros de JavaScript?
6. **Desempenho por Campanha e Criativo** — Qual campanha traz os melhores leads? Qual landing page converte mais?
7. **Análise do Formulário** — Qual campo tem maior taxa de desistência? Quanto tempo os visitantes gastam em cada campo? Há formulários abandonados?
8. **Galeria e FAQ** — Os visitantes interagem com as imagens? Quais perguntas do FAQ mais geram interesse? A galeria influencia na conversão?
9. **Efetividade do WhatsApp** — Quantos cliques no WhatsApp? Qual CTA é mais efetivo? Qual a relação entre exit intent e cliques no WhatsApp?
10. **Geografia e Idioma** — De quais fusos horários vêm os visitantes? Quais idiomas? Quais horários têm mais engajamento?
11. **Alertas e Problemas** — Leads sem interação, estagnados, alta taxa de rejeição, discrepância pixel vs CRM, erros de JS.
12. **Recomendações** — 10-15 recomendações práticas e específicas para melhorar os resultados. Inclua sugestões sobre otimização de landing pages, CTAs, campanhas, formulário, horários de atendimento e acompanhamento de leads.

IMPORTANTE:
- Leads do webhook Meta Ads chegam diretamente do Facebook e NÃO geram eventos de pixel. A discrepancia entre pixel e CRM e esperada nesse caso.
- Leads cadastrados via formulario das landing pages GERAM eventos de pixel (form_submit).
- Use dados numericos em TODOS os argumentos. Nunca faca afirmações vagas.
- Foque no que importa para um corretor/consultor imobiliário.
- Se houver dados de dispositivo, analise se mobile ou desktop tem melhor conversão.
- Se houver dados de Web Vitals, identifique problemas de performance (LCP > 2500ms, CLS > 0.1, FID > 100ms).
- Se houver dados de FAQ, identifique quais dúvidas são mais frequentes e sugira otimizações.
- Se houver dados de exit intent, sugira estratégias de retenção (popup, oferta especial, etc.).
- Se houver dados de fuso horario, sugira horários otimos para atendimento via WhatsApp.`;

    // ─────────────────────────────────────────
    // 4. Chamar IA
    // ─────────────────────────────────────────
    let analysis: string | null = null;

    if (GEMINI_API_KEY) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: dataSummary }] }],
            generationConfig: {
              temperature: 0.4,
              maxOutputTokens: 4096,
            },
          }),
        });

        if (res.ok) {
          const data = await res.json();
          analysis = data.candidates?.[0]?.content?.parts?.[0]?.text || null;
        }
      } catch (err) {
        console.error('[Meta Ads Analyze] Erro Gemini:', err);
      }
    }

    if (!analysis && GROQ_API_KEY) {
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: dataSummary },
            ],
            temperature: 0.4,
            max_tokens: 4096,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          analysis = data.choices?.[0]?.message?.content || null;
        }
      } catch (err) {
        console.error('[Meta Ads Analyze] Erro Groq:', err);
      }
    }

    if (!analysis) {
      return NextResponse.json({
        analysis: null,
        error: 'Nenhum provedor de IA disponível. Configure GEMINI_API_KEY ou GROQ_API_KEY.',
      }, { status: 503 });
    }

    return NextResponse.json({
      analysis,
      generatedAt: new Date().toISOString(),
      dataPoints: {
        totalLeads: total,
        recentLeads,
        conversionRate: parseFloat(convRate),
        withoutInteraction,
        ...(pixelAvailable ? {
          pixelVisitors: pixelData.visitors,
          pixelLeads: pixelData.pixelLeads,
          pixelWhatsappClicks: pixelData.whatsappClicks,
          pixelBounceRate: pixelData.bounceRate,
          pixelAvgTimeOnPage: pixelData.avgTimeOnPage,
          pixelDeviceBreakdown: pixelData.deviceBreakdown,
          pixelFunnelStages: pixelData.funnelStages,
        } : {}),
      },
    });
  } catch (error) {
    console.error('[Meta Ads Analyze] Erro:', error);
    return NextResponse.json({ error: 'Erro ao gerar análise' }, { status: 500 });
  }
}