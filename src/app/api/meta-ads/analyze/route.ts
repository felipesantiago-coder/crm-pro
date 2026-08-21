import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';

import { callAI } from '@/lib/ai-provider';

/**
 * API de Análise IA dos Leads do Meta Ads + Landing Pages
 * Envia dados agregados dos leads (webhook Meta + landing pages com UTM Meta)
 * e dados do pixel próprio para a IA gerar insights e recomendações de otimização.
 *
 * Fontes de leads consideradas:
 *   1. Webhook Meta Ads (notes contêm "[Meta Ads]")
 *   2. Landing pages com UTM de origem Meta (utmSource = facebook/instagram/meta/fb)
 *   3. Dados do pixel próprio (tracking_events/tracking_visitors) — sempre incluídos
 *
 * Query params:
 *   period=24h|48h|7d|30d  (default: 30d)
 */

// ── Period mapping ──────────────────────────────────────
const PERIOD_MS: Record<string, number> = {
  '24h': 86_400_000,
  '48h': 172_800_000,
  '7d':  604_800_000,
  '30d': 2_592_000_000,
  '15d': 1_296_000_000,
};

const PERIOD_LABELS: Record<string, string> = {
  '24h': 'últimas 24 horas',
  '48h': 'últimas 48 horas',
  '7d':  'última semana',
  '15d': 'últimos 15 dias',
  '30d': 'último mês',
};

export async function GET(request: NextRequest) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    // ── Parse period parameter ──────────────────────────────
    const { searchParams } = new URL(request.url);
    const periodParam = searchParams.get('period') || '30d';
    const periodLabel = PERIOD_LABELS[periodParam] || PERIOD_LABELS['30d'];
    const periodStartDate = new Date(Date.now() - (PERIOD_MS[periodParam] || PERIOD_MS['30d']));

    // ─────────────────────────────────────────
    // 1. Coletar dados dos leads (Meta Ads + Landing Pages com UTM Meta)
    // ─────────────────────────────────────────
    const META_UTM_SOURCES = ['facebook', 'instagram', 'meta', 'fb'];

    // Calculate date range for CRM leads based on period
    // periodStartDate already computed above

    const metaClients = await db.client.findMany({
      where: {
        OR: [
          // Webhook Meta Ads direto
          { notes: { contains: '[Meta Ads]' } },
          {
            interactions: {
              some: { description: { contains: '[Meta Ads]' } },
            },
          },
          // Landing pages com UTM de origem Meta (case-insensitive)
          ...META_UTM_SOURCES.map((source) => ({
            utmSource: { contains: source, mode: 'insensitive' as const },
          })),
        ],
        createdAt: { gte: periodStartDate },
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
        utmSource: true,
        utmMedium: true,
        utmCampaign: true,
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

    // Se não há leads CRM, permite análise apenas com dados do pixel
    const hasPixelDataOnly = metaClients.length === 0;
    if (hasPixelDataOnly) {
      // Verifica se há dados de pixel antes de bloquear
      try {
        const pixelCheck = await db.$queryRaw<{ cnt: string }[]>`
          SELECT COUNT(DISTINCT "visitorId")::text as cnt FROM "tracking_events"
          WHERE "createdAt" >= ${periodStartDate}
        `;
        if (!pixelCheck.length || Number(pixelCheck[0].cnt) === 0) {
          return NextResponse.json({
            analysis: null,
            message: `Nenhum lead do Meta Ads ou dado de pixel encontrado para análise (${periodLabel}). Configure o webhook, publique landing pages com o pixel e aguarde os primeiros visitantes.`,
          });
        }
        // Há dados de pixel mas nenhum lead CRM — prosseguir com pixel-only
      } catch {
        return NextResponse.json({
          analysis: null,
          message: `Nenhum lead do Meta Ads encontrado para análise (${periodLabel}). Configure o webhook ou publique landing pages com UTM do Meta e aguarde os primeiros leads.`,
        });
      }
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

      // Campanha (das notas OU do campo utmCampaign)
      const campaignName = (() => {
        // Prioridade 1: regex nas notas (webhook Meta)
        if (c.notes) {
          const m = c.notes.match(/Campanha:\s*(.+)/);
          if (m) return m[1].trim();
        }
        // Prioridade 2: campo utmCampaign (landing pages)
        if (c.utmCampaign) return c.utmCampaign;
        return null;
      })();
      if (campaignName) {
        campaigns[campaignName] = (campaigns[campaignName] || 0) + 1;
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

    // Leads recentes (últimos 7 dias ou período menor)
    const recentWindowMs = Math.min(7 * 86400000, PERIOD_MS[periodParam] || PERIOD_MS['30d']);
    const recentDate = new Date(Date.now() - recentWindowMs);
    const recentLeads = metaClients.filter((c) => c.createdAt >= recentDate).length;

    // Taxa de conversão (protege contra divisão por zero quando só há pixel)
    const converted = (stages['NEGOCIACAO'] || 0) + (stages['PROPOSTA'] || 0) + (stages['FECHADO'] || 0);
    const convRate = total > 0 ? ((converted / total) * 100).toFixed(1) : '0.0';

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
        if (c.notes) {
          const m = c.notes.match(/Campanha:\s*(.+)/);
          if (m) return m[1].trim();
        }
        return c.utmCampaign || 'N/A';
      })(),
      origem: (() => {
        if (c.notes && c.notes.includes('[Meta Ads]')) return 'Webhook Meta';
        if (c.notes && c.notes.includes('[Landing Page]')) return 'Landing Page';
        if (c.utmSource) return 'UTM: ' + c.utmSource;
        return 'N/A';
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
      geoBreakdown: Array<{ country: string; city: string; visitors: number; leads: number }>;
      // ── NEW: 6 improvements ──
      heartbeatAnalysis: {
        converterAvgHeartbeats: number;
        nonConverterAvgHeartbeats: number;
        converterAvgAttentionSec: number;
        nonConverterAvgAttentionSec: number;
        attentionDistribution: Array<{ buckets: string; visitors: number; converters: number; convRate: number }>;
      };
      eventConversionCorrelation: Array<{
        event_type: string;
        visitors_with_event: number;
        converters_with_event: number;
        visitors_without_event: number;
        converters_without_event: number;
        convRate_with: number;
        convRate_without: number;
        lift: number;
      }>;
      perPageMetrics: Array<{
        url: string;
        visitors: number;
        leads: number;
        convRate: number;
        avgTimeOnPage: number | null;
        bounceRate: number | null;
        avgScrollMax: number | null;
      }>;
      hourlyConversion: Array<{
        hour: number;
        visitors: number;
        leads: number;
        convRate: number;
      }>;
      jsErrorDetails: Array<{
        message: string;
        filename: string | null;
        count: number;
        firstSeen: string;
  }>; 
      engagementScore: {
        hot: number;
        warm: number;
        cold: number;
        hotConvRate: number;
        warmConvRate: number;
        coldConvRate: number;
      };
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
      geoBreakdown: [],
      // NEW fields defaults
      heartbeatAnalysis: {
        converterAvgHeartbeats: 0,
        nonConverterAvgHeartbeats: 0,
        converterAvgAttentionSec: 0,
        nonConverterAvgAttentionSec: 0,
        attentionDistribution: [],
      },
      eventConversionCorrelation: [],
      perPageMetrics: [],
      hourlyConversion: [],
      jsErrorDetails: [],
      engagementScore: {
        hot: 0,
        warm: 0,
        cold: 0,
        hotConvRate: 0,
        warmConvRate: 0,
        coldConvRate: 0,
      },
    };

    let pixelAvailable = false;

    // Wrapper: individual query failure won't kill all pixel data
    const safe = <T,>(p: Promise<T>): Promise<T | []> => p.catch((err: unknown) => {
      console.warn('[Meta Analyze] Pixel query failed:', (err as Error)?.message || err);
      return [] as unknown as T;
    });

    try {
      // ── Run ALL pixel queries in parallel for speed ──
      // periodStartDate is a JS Date — Prisma serializes it to PostgreSQL timestamp

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
        geoResult,
        // ── NEW: 6 improvement queries ──
        heartbeatResult,           // Improvement 1: heartbeat averages
        attentionDistResult,      // Improvement 1b: attention distribution buckets
        eventCorrelationResult,   // Improvement 2: event-conversion correlation
        perPageResult,            // Improvement 3
        hourlyResult,             // Improvement 4
        jsErrorDetailsResult,     // Improvement 5
        engagementScoreResult,    // Improvement 6
      ] = await Promise.all([

        // ═══════════════════════════════════════════
        // EXISTING QUERIES (1-19) — updated with dynamic interval
        // ═══════════════════════════════════════════

        // Query 1: Core funnel data
        safe(db.$queryRaw<{
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
          WHERE "createdAt" >= ${periodStartDate}
        `),

        // Query 2: Top campaigns from pixel data
        safe(db.$queryRaw<{
          campaign: string;
          visitors: string | number;
          leads: string | number;
        }[]>`
          SELECT
            COALESCE("utmCampaign", '(direto)') as campaign,
            COUNT(DISTINCT "visitorId") as visitors,
            COUNT(DISTINCT CASE WHEN "eventType" = 'lead' OR "eventType" = 'form_submit' THEN "visitorId" END) as leads
          FROM "tracking_events"
          WHERE "createdAt" >= ${periodStartDate}
          GROUP BY COALESCE("utmCampaign", '(direto)')
          ORDER BY leads DESC
          LIMIT 10
        `),

        // Query 3: Bounce rate
        safe(db.$queryRaw<{ bounce_rate: string | number }[]>`
          SELECT
            ROUND(COUNT(*) FILTER (WHERE total_events = 1)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as bounce_rate
          FROM (
            SELECT "visitorId", COUNT(*) as total_events
            FROM "tracking_events"
            WHERE "createdAt" >= ${periodStartDate}
            GROUP BY "visitorId"
          ) sub
        `),

        // Query 4: Scroll depth distribution
        safe(db.$queryRaw<{ depth: number; visitors: string | number }[]>`
          SELECT
            (metadata->>'depth')::int as depth,
            COUNT(DISTINCT "visitorId") as visitors
          FROM "tracking_events"
          WHERE "eventType" = 'scroll_depth'
            AND "createdAt" >= ${periodStartDate}
            AND metadata->>'depth' IS NOT NULL
          GROUP BY (metadata->>'depth')::int
          ORDER BY depth
        `),

        // Query 5: Average time on page
        safe(db.$queryRaw<{ avg_seconds: string | number; median_seconds: string | number }[]>`
          SELECT
            ROUND(AVG((metadata->>'time_on_page')::numeric))::text as avg_seconds,
            ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (metadata->>'time_on_page')::numeric))::text as median_seconds
          FROM "tracking_events"
          WHERE "eventType" = 'pageview_duration'
            AND "createdAt" >= ${periodStartDate}
            AND metadata->>'time_on_page' IS NOT NULL
        `),

        // Query 6: WhatsApp click breakdown
        safe(db.$queryRaw<{ source: string; clicks: string | number; unique_visitors: string | number }[]>`
          SELECT
            COALESCE(metadata->>'source', '(principal)') as source,
            COUNT(*) as clicks,
            COUNT(DISTINCT "visitorId") as unique_visitors
          FROM "tracking_events"
          WHERE "eventType" = 'whatsapp_click'
            AND "createdAt" >= ${periodStartDate}
          GROUP BY COALESCE(metadata->>'source', '(principal)')
          ORDER BY clicks DESC
        `),

        // Query 7: Device breakdown
        safe(db.$queryRaw<{ device: string; visitors: string | number; leads: string | number }[]>`
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
          WHERE v."lastSeenAt" >= ${periodStartDate}
          GROUP BY
            CASE
              WHEN LOWER("userAgent") LIKE '%mobile%' OR LOWER("userAgent") LIKE '%android%' OR LOWER("userAgent") LIKE '%iphone%'
              THEN 'Mobile'
              WHEN LOWER("userAgent") LIKE '%tablet%' OR LOWER("userAgent") LIKE '%ipad%'
              THEN 'Tablet'
              ELSE 'Desktop'
            END
          ORDER BY visitors DESC
        `),

        // Query 8: Referrer breakdown
        safe(db.$queryRaw<{ referrer: string; visitors: string | number; leads: string | number }[]>`
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
            AND e."createdAt" >= ${periodStartDate}
          GROUP BY
            CASE
              WHEN e."referrer" IS NULL OR e."referrer" = '' THEN '(direto)'
              WHEN LOWER(e."referrer") LIKE '%facebook%' OR LOWER(e."referrer") LIKE '%fb%' THEN 'Facebook'
              WHEN LOWER(e."referrer") LIKE '%instagram%' THEN 'Instagram'
              WHEN LOWER(e."referrer") LIKE '%google%' THEN 'Google'
              WHEN LOWER(e."referrer") LIKE '%whatsapp%' THEN 'WhatsApp'
              WHEN LOWER(e."referrer") LIKE '%linkedin%' THEN 'LinkedIn'
              ELSE 'Outros'
            END
          ORDER BY visitors DESC
          LIMIT 10
        `),

        // Query 9: Top landing pages with conversion
        safe(db.$queryRaw<{ url: string; views: string | number; leads: string | number }[]>`
          SELECT
            COALESCE("pageUrl", '(desconhecida)') as url,
            COUNT(*)::text as views,
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN e."visitorId" END)::text as leads
          FROM "tracking_events" e
          LEFT JOIN "tracking_visitors" v ON v."visitorId" = e."visitorId"
          WHERE e."eventType" = 'pageview'
            AND e."createdAt" >= ${periodStartDate}
          GROUP BY COALESCE("pageUrl", '(desconhecida)')
          ORDER BY COUNT(*) DESC
          LIMIT 10
        `),

        // Query 10: Full funnel stages
        safe(db.$queryRaw<{ stage: string; count: string | number }[]>`
          WITH base AS (
            SELECT e."visitorId", v."leadId", COUNT(*) OVER (PARTITION BY e."visitorId") AS event_count
            FROM tracking_events e
            LEFT JOIN tracking_visitors v ON v."visitorId" = e."visitorId"
            WHERE e."createdAt" >= ${periodStartDate}
          ),
          pv_visitors AS (
            SELECT COUNT(DISTINCT "visitorId")::text AS cnt FROM base WHERE EXISTS (
              SELECT 1 FROM tracking_events e2 WHERE e2."visitorId" = base."visitorId" AND e2."eventType" = 'pageview' AND e2."createdAt" >= ${periodStartDate}
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
        `),

        // Query 11: Web Vitals
        safe(db.$queryRaw<{ metric: string; avg_value: string | number; count: string | number }[]>`
          SELECT
            metadata->>'metric' as metric,
            ROUND(AVG((metadata->>'value')::numeric))::text as avg_value,
            COUNT(*)::text as count
          FROM "tracking_events"
          WHERE "eventType" = 'web_vital'
            AND "createdAt" >= ${periodStartDate}
            AND metadata->>'metric' IS NOT NULL
            AND metadata->>'value' IS NOT NULL
          GROUP BY metadata->>'metric'
          ORDER BY avg_value::numeric DESC
        `),

        // Query 12: Gallery engagement
        safe(db.$queryRaw<{ total_clicks: string | number; visitors_clicked: string | number; avg_images: string | number }[]>`
          SELECT
            COUNT(*)::text as total_clicks,
            COUNT(DISTINCT "visitorId")::text as visitors_clicked,
            ROUND(AVG((metadata->>'total_images')::numeric))::text as avg_images
          FROM "tracking_events"
          WHERE "eventType" = 'gallery_click'
            AND "createdAt" >= ${periodStartDate}
        `),

        // Query 13: FAQ engagement
        safe(db.$queryRaw<{ question_index: number; question: string; opens: string | number }[]>`
          SELECT
            COALESCE((metadata->>'question_index')::int, 0) as question_index,
            COALESCE(metadata->>'question', '(sem texto)') as question,
            COUNT(*)::text as opens
          FROM "tracking_events"
          WHERE "eventType" = 'faq_open'
            AND "createdAt" >= ${periodStartDate}
          GROUP BY COALESCE((metadata->>'question_index')::int, 0), COALESCE(metadata->>'question', '(sem texto)')
          ORDER BY opens DESC
        `),

        // Query 14: Form field drop-off
        safe(db.$queryRaw<{ field: string; avg_time_ms: string | number; focus_count: string | number; blur_count: string | number }[]>`
          SELECT
            COALESCE(metadata->>'field', '(desconhecido)') as field,
            ROUND(AVG((metadata->>'time_spent_ms')::numeric))::text as avg_time_ms,
            COUNT(*) FILTER (WHERE "eventType" = 'form_focus')::text as focus_count,
            COUNT(*) FILTER (WHERE "eventType" = 'form_blur')::text as blur_count
          FROM "tracking_events"
          WHERE ("eventType" = 'form_focus' OR "eventType" = 'form_blur')
            AND "createdAt" >= ${periodStartDate}
          GROUP BY COALESCE(metadata->>'field', '(desconhecido)')
          ORDER BY avg_time_ms::numeric DESC
        `),

        // Query 15: Section views
        safe(db.$queryRaw<{ section: string; visitors: string | number }[]>`
          SELECT
            COALESCE(metadata->>'section', '(desconhecida)') as section,
            COUNT(DISTINCT "visitorId")::text as visitors
          FROM "tracking_events"
          WHERE "eventType" = 'section_view'
            AND "createdAt" >= ${periodStartDate}
          GROUP BY COALESCE(metadata->>'section', '(desconhecida)')
          ORDER BY visitors DESC
        `),

        // Query 16: Exit intent, JS errors, print, form abandon counts
        safe(db.$queryRaw<{
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
          WHERE "createdAt" >= ${periodStartDate}
        `),

        // Query 17: Timezone breakdown
        safe(db.$queryRaw<{ timezone: string; visitors: string | number }[]>`
          SELECT
            COALESCE(metadata->>'timezone', '(desconhecido)') as timezone,
            COUNT(DISTINCT "visitorId")::text as visitors
          FROM "tracking_events"
          WHERE "eventType" = 'pageview'
            AND "createdAt" >= ${periodStartDate}
            AND metadata->>'timezone' IS NOT NULL
          GROUP BY COALESCE(metadata->>'timezone', '(desconhecido)')
          ORDER BY visitors DESC
          LIMIT 10
        `),

        // Query 18: Language breakdown
        safe(db.$queryRaw<{ language: string; visitors: string | number }[]>`
          SELECT
            COALESCE(metadata->>'language', '(desconhecido)') as language,
            COUNT(DISTINCT "visitorId")::text as visitors
          FROM "tracking_events"
          WHERE "eventType" = 'pageview'
            AND "createdAt" >= ${periodStartDate}
            AND metadata->>'language' IS NOT NULL
          GROUP BY COALESCE(metadata->>'language', '(desconhecido)')
          ORDER BY visitors DESC
          LIMIT 10
        `),

        // Query 19: Geographic breakdown
        safe(db.$queryRaw<{ country: string; city: string; visitors: string | number; leads: string | number }[]>`
          SELECT
            COALESCE(tv."country", '(desconhecido)') as country,
            COALESCE(tv."city", '(desconhecido)') as city,
            COUNT(DISTINCT tv."visitorId")::text as visitors,
            COUNT(DISTINCT CASE WHEN tv."leadId" IS NOT NULL THEN tv."visitorId" END)::text as leads
          FROM "tracking_visitors" tv
          WHERE tv."lastSeenAt" >= ${periodStartDate}
            AND tv."country" IS NOT NULL
          GROUP BY tv."country", tv."city"
          ORDER BY visitors DESC
          LIMIT 20
        `),

        // ═══════════════════════════════════════════
        // NEW QUERIES (20-25) — 6 improvements
        // ═══════════════════════════════════════════

        // Query 20 — Improvement 1: Deep heartbeat analysis
        // Compares attention (heartbeats + max time_on_page) between converters and non-converters
        safe(db.$queryRaw<{
          is_converter: boolean;
          avg_heartbeats: string | number;
          avg_attention_sec: string | number;
          visitors: string | number;
        }[]>`
          WITH visitor_stats AS (
            SELECT
              e."visitorId",
              v."leadId",
              COUNT(*) FILTER (WHERE e."eventType" = 'heartbeat') AS hb_count,
              GREATEST(
                MAX((e.metadata->>'time_on_page')::int) FILTER (WHERE e."eventType" = 'heartbeat'),
                MAX((e.metadata->>'time_on_page')::int) FILTER (WHERE e."eventType" = 'pageview_duration'),
                0
              ) AS max_attention_sec
            FROM "tracking_events" e
            LEFT JOIN "tracking_visitors" v ON v."visitorId" = e."visitorId"
            WHERE e."createdAt" >= ${periodStartDate}
            GROUP BY e."visitorId", v."leadId"
          )
          SELECT
            ("leadId" IS NOT NULL) as is_converter,
            ROUND(AVG(hb_count))::text as avg_heartbeats,
            ROUND(AVG(max_attention_sec))::text as avg_attention_sec,
            COUNT(*)::text as visitors
          FROM visitor_stats
          GROUP BY ("leadId" IS NOT NULL)
        `),

        // Query 21 — Improvement 1b: Attention distribution buckets for converters vs non-converters
        safe(db.$queryRaw<{
          bucket: string;
          visitors: string | number;
          converters: string | number;
        }[]>`
          WITH visitor_max_time AS (
            SELECT
              e."visitorId",
              v."leadId",
              GREATEST(
                MAX((e.metadata->>'time_on_page')::int) FILTER (WHERE e."eventType" = 'heartbeat'),
                MAX((e.metadata->>'time_on_page')::int) FILTER (WHERE e."eventType" = 'pageview_duration'),
                0
              ) AS max_sec
            FROM "tracking_events" e
            LEFT JOIN "tracking_visitors" v ON v."visitorId" = e."visitorId"
            WHERE e."createdAt" >= ${periodStartDate}
            GROUP BY e."visitorId", v."leadId"
          )
          SELECT
            CASE
              WHEN max_sec < 15 THEN '0-14s (saiu rapido)'
              WHEN max_sec < 30 THEN '15-29s'
              WHEN max_sec < 60 THEN '30-59s'
              WHEN max_sec < 120 THEN '1-2min'
              WHEN max_sec < 300 THEN '2-5min'
              ELSE '5min+'
            END as bucket,
            COUNT(*)::text as visitors,
            COUNT(*) FILTER (WHERE "leadId" IS NOT NULL)::text as converters
          FROM visitor_max_time
          GROUP BY bucket
          ORDER BY MIN(max_sec)
        `),

        // Query 22 — Improvement 2: Event-conversion correlation
        // For each engagement event, compare conversion rate of visitors who did vs didn't do it
        safe(db.$queryRaw<{
          event_type: string;
          visitors_with: string | number;
          converters_with: string | number;
          visitors_without: string | number;
          converters_without: string | number;
        }[]>`
          WITH all_visitors AS (
            SELECT DISTINCT "visitorId" FROM "tracking_events"
            WHERE "createdAt" >= ${periodStartDate}
          ),
          visitors_with_lead AS (
            SELECT DISTINCT v."visitorId"
            FROM "tracking_visitors" v
            WHERE v."leadId" IS NOT NULL
              AND v."lastSeenAt" >= ${periodStartDate}
          ),
          engagement_events AS (
            SELECT DISTINCT unnest(ARRAY['gallery_click', 'faq_open', 'scroll_depth', 'section_view', 'whatsapp_click', 'exit_intent']) AS evt
          ),
          event_visitors AS (
            SELECT
              ee.evt AS event_type,
              COUNT(DISTINCT e."visitorId") AS visitors_with,
              COUNT(DISTINCT CASE WHEN wvl."visitorId" IS NOT NULL THEN e."visitorId" END) AS converters_with
            FROM engagement_events ee
            LEFT JOIN "tracking_events" e ON e."eventType" = ee.evt AND e."createdAt" >= ${periodStartDate}
            LEFT JOIN visitors_with_lead wvl ON wvl."visitorId" = e."visitorId"
            GROUP BY ee.evt
          ),
          totals AS (
            SELECT
              COUNT(*)::int as total_visitors,
              COUNT(*) FILTER (WHERE wvl."visitorId" IS NOT NULL)::int as total_converters
            FROM all_visitors av
            LEFT JOIN visitors_with_lead wvl ON wvl."visitorId" = av."visitorId"
          )
          SELECT
            ev.event_type,
            ev.visitors_with::text,
            ev.converters_with::text,
            (t.total_visitors - ev.visitors_with)::text as visitors_without,
            (t.total_converters - ev.converters_with)::text as converters_without
          FROM event_visitors ev
          CROSS JOIN totals t
        `),

        // Query 23 — Improvement 3: Per-landing-page detailed metrics
        safe(db.$queryRaw<{
          url: string;
          visitors: string | number;
          leads: string | number;
          avg_time: string | number;
          bounce_pct: string | number;
          avg_scroll_max: string | number;
        }[]>`
          WITH page_visitors AS (
            SELECT
              e."pageUrl",
              e."visitorId",
              COUNT(*) OVER (PARTITION BY e."visitorId") AS total_events
            FROM "tracking_events" e
            WHERE e."eventType" = 'pageview'
              AND e."createdAt" >= ${periodStartDate}
          ),
          page_bounce AS (
            SELECT
              "pageUrl",
              COUNT(*) FILTER (WHERE total_events = 1)::float / NULLIF(COUNT(*), 0) * 100 AS bounce_pct
            FROM page_visitors
            GROUP BY "pageUrl"
          ),
          page_time AS (
            SELECT
              e."pageUrl",
              ROUND(AVG((e.metadata->>'time_on_page')::numeric))::text AS avg_time
            FROM "tracking_events" e
            WHERE e."eventType" = 'pageview_duration'
              AND e."createdAt" >= ${periodStartDate}
            GROUP BY e."pageUrl"
          ),
          page_scroll AS (
            SELECT
              e."pageUrl",
              ROUND(AVG((e.metadata->>'depth')::numeric))::text AS avg_scroll_max
            FROM "tracking_events" e
            WHERE e."eventType" = 'scroll_depth'
              AND e."createdAt" >= ${periodStartDate}
              AND e.metadata->>'depth' IS NOT NULL
            GROUP BY e."pageUrl"
          ),
          page_leads AS (
            SELECT
              COALESCE(e."pageUrl", '(desconhecida)') as "pageUrl",
              COUNT(DISTINCT e."visitorId")::text as visitors,
              COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN e."visitorId" END)::text as leads
            FROM "tracking_events" e
            LEFT JOIN "tracking_visitors" v ON v."visitorId" = e."visitorId"
            WHERE e."eventType" = 'pageview'
              AND e."createdAt" >= ${periodStartDate}
            GROUP BY COALESCE(e."pageUrl", '(desconhecida)')
          )
          SELECT
            pl."pageUrl" as url,
            pl.visitors,
            pl.leads,
            pt.avg_time,
            pb.bounce_pct,
            ps.avg_scroll_max
          FROM page_leads pl
          LEFT JOIN page_bounce pb ON pb."pageUrl" = pl.url
          LEFT JOIN page_time pt ON pt."pageUrl" = pl.url
          LEFT JOIN page_scroll ps ON ps."pageUrl" = pl.url
          ORDER BY pl.visitors::int DESC
          LIMIT 10
        `),

        // Query 24 — Improvement 4: Hourly conversion analysis
        safe(db.$queryRaw<{
          hour: number;
          visitors: string | number;
          leads: string | number;
        }[]>`
          SELECT
            EXTRACT(HOUR FROM e."createdAt")::int as hour,
            COUNT(DISTINCT e."visitorId")::text as visitors,
            COUNT(DISTINCT CASE WHEN v."leadId" IS NOT NULL THEN e."visitorId" END)::text as leads
          FROM "tracking_events" e
          LEFT JOIN "tracking_visitors" v ON v."visitorId" = e."visitorId"
          WHERE e."eventType" = 'pageview'
            AND e."createdAt" >= ${periodStartDate}
          GROUP BY EXTRACT(HOUR FROM e."createdAt")
          ORDER BY hour
        `),

        // Query 25 — Improvement 5: JS Error details (top 5 messages with context)
        safe(db.$queryRaw<{
          message: string;
          filename: string | null;
          count: string | number;
          first_seen: string;
        }[]>`
          SELECT
            COALESCE(metadata->>'message', '(sem mensagem)') as message,
            metadata->>'filename' as filename,
            COUNT(*)::text as count,
            MIN("createdAt")::text as first_seen
          FROM "tracking_events"
          WHERE "eventType" = 'js_error'
            AND "createdAt" >= ${periodStartDate}
          GROUP BY COALESCE(metadata->>'message', '(sem mensagem)'), metadata->>'filename'
          ORDER BY COUNT(*) DESC
          LIMIT 5
        `),

        // Query 26 — Improvement 6: Engagement score segmentation (cold/warm/hot)
        safe(db.$queryRaw<{
          segment: string;
          visitors: string | number;
          converters: string | number;
        }[]>`
          WITH visitor_engagement AS (
            SELECT
              e."visitorId",
              v."leadId",
              -- Engagement score: +1 for each distinct engagement event type
              (COUNT(DISTINCT CASE WHEN e."eventType" IN ('heartbeat','scroll_depth','section_view','gallery_click','faq_open','whatsapp_click','form_focus') THEN e."eventType" END)) AS engagement_types,
              -- +1 for deep scroll (>=75%)
              COUNT(DISTINCT CASE WHEN e."eventType" = 'scroll_depth' AND (e.metadata->>'depth')::int >= 75 THEN 1 END) AS deep_scroll,
              -- +1 for long attention (heartbeat with time_on_page >= 60s)
              COUNT(DISTINCT CASE WHEN e."eventType" = 'heartbeat' AND (e.metadata->>'time_on_page')::int >= 60 THEN 1 END) AS long_attention
            FROM "tracking_events" e
            LEFT JOIN "tracking_visitors" v ON v."visitorId" = e."visitorId"
            WHERE e."createdAt" >= ${periodStartDate}
            GROUP BY e."visitorId", v."leadId"
          ),
          scored AS (
            SELECT
              "visitorId",
              "leadId",
              engagement_types + deep_scroll + long_attention AS score
            FROM visitor_engagement
          )
          SELECT
            CASE
              WHEN score >= 4 THEN 'quente'
              WHEN score >= 2 THEN 'morno'
              ELSE 'frio'
            END as segment,
            COUNT(*)::text as visitors,
            COUNT(*) FILTER (WHERE "leadId" IS NOT NULL)::text as converters
          FROM scored
          GROUP BY CASE
            WHEN score >= 4 THEN 'quente'
            WHEN score >= 2 THEN 'morno'
            ELSE 'frio'
          END
          ORDER BY MIN(score) DESC
        `),
      ]);

      // ── Process existing query results ──
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

      const totalVisitors = pixelData.visitors || 1;
      pixelData.scrollDepth = scrollResult.map((row) => ({
        depth: Number(row.depth),
        visitors: Number(row.visitors) || 0,
        pct: Math.round((Number(row.visitors) / totalVisitors) * 1000) / 10,
      }));

      if (timeOnPageResult.length > 0 && timeOnPageResult[0].avg_seconds !== null) {
        pixelData.avgTimeOnPage = Number(timeOnPageResult[0].avg_seconds) || null;
      }

      pixelData.whatsappBreakdown = whatsappBreakdownResult.map((row) => ({
        source: row.source,
        clicks: Number(row.clicks) || 0,
        uniqueVisitors: Number(row.unique_visitors) || 0,
      }));

      pixelData.deviceBreakdown = deviceResult.map((row) => ({
        device: row.device,
        visitors: Number(row.visitors) || 0,
        leads: Number(row.leads) || 0,
      }));

      pixelData.referrerBreakdown = referrerResult.map((row) => ({
        referrer: row.referrer,
        visitors: Number(row.visitors) || 0,
        leads: Number(row.leads) || 0,
      }));

      pixelData.topPages = topPagesResult.map((row) => ({
        url: row.url,
        views: Number(row.views) || 0,
        leads: Number(row.leads) || 0,
      }));

      const pvCount = Number(funnelStagesResult.find((f) => f.stage === 'pageview')?.count ?? 0);
      pixelData.funnelStages = funnelStagesResult.map((f) => {
        const count = Number(f.count) || 0;
        return { stage: f.stage, count, rate: pvCount > 0 ? Math.round((count / pvCount) * 1000) / 10 : 0 };
      });

      pixelData.webVitals = webVitalsResult.map((r) => ({
        metric: r.metric,
        avg_value: Number(r.avg_value) || 0,
        count: Number(r.count) || 0,
      }));

      if (galleryResult.length > 0) {
        const gr = galleryResult[0];
        pixelData.galleryEngagement = {
          totalClicks: Number(gr.total_clicks) || 0,
          visitorsClicked: Number(gr.visitors_clicked) || 0,
          avgImagesViewed: Number(gr.avg_images) || 0,
        };
      }

      pixelData.faqEngagement = faqResult.map((r) => ({
        question_index: r.question_index,
        question: r.question,
        opens: Number(r.opens) || 0,
      }));

      pixelData.formFieldDropoff = formFieldResult.map((r) => ({
        field: r.field,
        avg_time_ms: Number(r.avg_time_ms) || 0,
        focus_count: Number(r.focus_count) || 0,
        blur_count: Number(r.blur_count) || 0,
      }));

      pixelData.sectionViews = sectionViewResult.map((r) => ({
        section: r.section,
        visitors: Number(r.visitors) || 0,
      }));

      if (eventCountsResult.length > 0) {
        const ec = eventCountsResult[0];
        pixelData.exitIntentCount = Number(ec.exit_intent) || 0;
        pixelData.jsErrorCount = Number(ec.js_errors) || 0;
        pixelData.printCount = Number(ec.prints) || 0;
        pixelData.formAbandonCount = Number(ec.form_abandons) || 0;
      }

      pixelData.timezoneBreakdown = timezoneResult.map((r) => ({
        timezone: r.timezone,
        visitors: Number(r.visitors) || 0,
      }));

      pixelData.languageBreakdown = languageResult.map((r) => ({
        language: r.language,
        visitors: Number(r.visitors) || 0,
      }));

      pixelData.geoBreakdown = geoResult.map((r) => ({
        country: r.country,
        city: r.city,
        visitors: Number(r.visitors) || 0,
        leads: Number(r.leads) || 0,
      }));

      // ═══════════════════════════════════════════
      // Process NEW query results (Improvements 1-6)
      // ═══════════════════════════════════════════

      // ── Improvement 1: Deep heartbeat analysis ──
      const converterRow = heartbeatResult.find((r) => r.is_converter === true);
      const nonConverterRow = heartbeatResult.find((r) => r.is_converter === false);
      pixelData.heartbeatAnalysis.converterAvgHeartbeats = Number(converterRow?.avg_heartbeats) || 0;
      pixelData.heartbeatAnalysis.nonConverterAvgHeartbeats = Number(nonConverterRow?.avg_heartbeats) || 0;
      pixelData.heartbeatAnalysis.converterAvgAttentionSec = Number(converterRow?.avg_attention_sec) || 0;
      pixelData.heartbeatAnalysis.nonConverterAvgAttentionSec = Number(nonConverterRow?.avg_attention_sec) || 0;

      // Attention distribution buckets (from query 21)
      const bucketOrder = ['0-14s (saiu rapido)', '15-29s', '30-59s', '1-2min', '2-5min', '5min+'];
      pixelData.heartbeatAnalysis.attentionDistribution = bucketOrder
        .map((label) => {
          const row = attentionDistResult.find((r) => r.bucket === label);
          if (!row) return null;
          const v = Number(row.visitors) || 0;
          const c = Number(row.converters) || 0;
          return {
            buckets: label,
            visitors: v,
            converters: c,
            convRate: v > 0 ? Math.round((c / v) * 1000) / 10 : 0,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      // ── Improvement 2: Event-conversion correlation ──
      pixelData.eventConversionCorrelation = eventCorrelationResult.map((r) => {
        const withV = Number(r.visitors_with) || 0;
        const withC = Number(r.converters_with) || 0;
        const withoutV = Number(r.visitors_without) || 0;
        const withoutC = Number(r.converters_without) || 0;
        const crWith = withV > 0 ? (withC / withV) * 100 : 0;
        const crWithout = withoutV > 0 ? (withoutC / withoutV) * 100 : 0;
        const lift = crWithout > 0 ? Math.round(((crWith - crWithout) / crWithout) * 100) : 0;
        return {
          event_type: r.event_type,
          visitors_with_event: withV,
          converters_with_event: withC,
          visitors_without_event: withoutV,
          converters_without_event: withoutC,
          convRate_with: Math.round(crWith * 10) / 10,
          convRate_without: Math.round(crWithout * 10) / 10,
          lift,
        };
      });

      // ── Improvement 3: Per-landing-page metrics ──
      pixelData.perPageMetrics = perPageResult.map((r) => {
        const v = Number(r.visitors) || 0;
        const l = Number(r.leads) || 0;
        return {
          url: r.url,
          visitors: v,
          leads: l,
          convRate: v > 0 ? Math.round((l / v) * 1000) / 10 : 0,
          avgTimeOnPage: r.avg_time !== null ? Number(r.avg_time) : null,
          bounceRate: r.bounce_pct !== null ? Math.round(Number(r.bounce_pct) * 10) / 10 : null,
          avgScrollMax: r.avg_scroll_max !== null ? Number(r.avg_scroll_max) : null,
        };
      });

      // ── Improvement 4: Hourly conversion ──
      pixelData.hourlyConversion = hourlyResult.map((r) => {
        const v = Number(r.visitors) || 0;
        const l = Number(r.leads) || 0;
        return {
          hour: Number(r.hour),
          visitors: v,
          leads: l,
          convRate: v > 0 ? Math.round((l / v) * 1000) / 10 : 0,
        };
      });

      // ── Improvement 5: JS Error details ──
      pixelData.jsErrorDetails = jsErrorDetailsResult.map((r) => ({
        message: r.message,
        filename: r.filename,
        count: Number(r.count) || 0,
        firstSeen: r.first_seen,
      }));

      // ── Improvement 6: Engagement score ──
      const hotRow = engagementScoreResult.find((r) => r.segment === 'quente');
      const warmRow = engagementScoreResult.find((r) => r.segment === 'morno');
      const coldRow = engagementScoreResult.find((r) => r.segment === 'frio');
      const hotV = Number(hotRow?.visitors) || 0;
      const hotC = Number(hotRow?.converters) || 0;
      const warmV = Number(warmRow?.visitors) || 0;
      const warmC = Number(warmRow?.converters) || 0;
      const coldV = Number(coldRow?.visitors) || 0;
      const coldC = Number(coldRow?.converters) || 0;
      pixelData.engagementScore = {
        hot: hotV,
        warm: warmV,
        cold: coldV,
        hotConvRate: hotV > 0 ? Math.round((hotC / hotV) * 1000) / 10 : 0,
        warmConvRate: warmV > 0 ? Math.round((warmC / warmV) * 1000) / 10 : 0,
        coldConvRate: coldV > 0 ? Math.round((coldC / coldV) * 1000) / 10 : 0,
      };
    } catch (pixelErr) {
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

      // CRM leads from same period
      const crmMetaLeadsPeriod = metaClients.length;

      // ── NEW: Improvement 1 — Heartbeat/attention analysis text ──
      const ha = pixelData.heartbeatAnalysis;
      const heartbeatSection = `
### Atenção e Retenção (Heartbeat)
- Tempo médio de atenção dos **conversores**: ${ha.converterAvgAttentionSec}s (${Math.floor(ha.converterAvgAttentionSec / 60)}min ${ha.converterAvgAttentionSec % 60}s)
- Tempo médio de atenção dos **não-conversores**: ${ha.nonConverterAvgAttentionSec}s (${Math.floor(ha.nonConverterAvgAttentionSec / 60)}min ${ha.nonConverterAvgAttentionSec % 60}s)
- Heartbeats médios dos conversores: ${ha.converterAvgHeartbeats} pulsos
- Heartbeats médios dos não-conversores: ${ha.nonConverterAvgHeartbeats} pulsos
- Diferença de atenção: ${ha.converterAvgAttentionSec > ha.nonConverterAvgAttentionSec ? '+' : ''}${ha.converterAvgAttentionSec - ha.nonConverterAvgAttentionSec}s (${ha.nonConverterAvgAttentionSec > 0 ? Math.round(((ha.converterAvgAttentionSec - ha.nonConverterAvgAttentionSec) / ha.nonConverterAvgAttentionSec) * 100) : 0}% ${ha.converterAvgAttentionSec >= ha.nonConverterAvgAttentionSec ? 'a mais' : 'a menos'} para conversores)

Distribuição de tempo de atenção (com taxa de conversão por faixa):
${ha.attentionDistribution.length > 0
  ? ha.attentionDistribution.map((b) => `- ${b.buckets}: ${b.visitors} visitantes, ${b.converters} converteram (${b.convRate}%)`).join('\n')
  : '- Nenhum dado disponível'}
`
      .trim();

      // ── NEW: Improvement 2 — Event-conversion correlation text ──
      const eventLabels: Record<string, string> = {
        gallery_click: 'Clique na Galeria',
        faq_open: 'Abertura de FAQ',
        scroll_depth: 'Scroll Profundo',
        section_view: 'Visualização de Seção',
        whatsapp_click: 'Clique no WhatsApp',
        exit_intent: 'Intenção de Saida',
      };
      const correlationSection = `
### Correlação Evento → Conversão
Qual a taxa de conversão dos visitantes que fizeram cada tipo de evento vs os que não fizeram?
${pixelData.eventConversionCorrelation.length > 0
  ? pixelData.eventConversionCorrelation.map((c) => {
      const label = eventLabels[c.event_type] || c.event_type;
      const liftStr = c.lift > 0 ? `+${c.lift}% lift` : `${c.lift}% lift`;
      return `- ${label}: ${c.convRate_with}% conversão (com evento, ${c.visitors_with_event} visitantes) vs ${c.convRate_without}% (sem evento, ${c.visitors_without_event} visitantes) — ${liftStr}`;
    }).join('\n')
  : '- Nenhum dado disponível'}
`
      .trim();

      // ── NEW: Improvement 3 — Per-page metrics text ──
      const perPageSection = `
### Diagnóstico por Landing Page (individual)
${pixelData.perPageMetrics.length > 0
  ? pixelData.perPageMetrics.map((p) => {
      const shortUrl = p.url.length > 60 ? p.url.substring(0, 57) + '...' : p.url;
      return `- ${shortUrl}: ${p.visitors} visitantes, ${p.leads} leads (${p.convRate}%), tempo médio: ${p.avgTimeOnPage !== null ? p.avgTimeOnPage + 's' : 'N/A'}, bounce rate: ${p.bounceRate !== null ? p.bounceRate + '%' : 'N/A'}, scroll médio máx: ${p.avgScrollMax !== null ? p.avgScrollMax + '%' : 'N/A'}`;
    }).join('\n')
  : '- Nenhuma landing page com dados suficientes'}
`
      .trim();

      // ── NEW: Improvement 4 — Hourly conversion text ──
      const hourlySection = `
### Conversão por Hora do Dia
${pixelData.hourlyConversion.length > 0
  ? (() => {
      // Show top 5 hours by conversion rate (min 3 visitors)
      const qualified = pixelData.hourlyConversion.filter((h) => h.visitors >= 3);
      const sorted = [...qualified].sort((a, b) => b.convRate - a.convRate);
      const topHours = sorted.slice(0, 5);
      const worstHours = [...sorted].sort((a, b) => a.convRate - b.convRate).slice(0, 3);
      const topLines = topHours.map((h) => `- ${String(h.hour).padStart(2, '0')}:00 — ${h.visitors} visitantes, ${h.leads} leads (${h.convRate}%)`);
      const worstLines = worstHours
        .filter((w) => !topHours.includes(w))
        .map((h) => `- ${String(h.hour).padStart(2, '0')}:00 — ${h.visitors} visitantes, ${h.leads} leads (${h.convRate}%)`);
      return `Melhores horários (maior conversão):
${topLines.join('\n') || '- N/A'}
${worstLines.length > 0 ? `\nPiores horários (menor conversão):\n${worstLines.join('\n')}` : ''}`;
    })()
  : '- Nenhum dado disponível'}
`
      .trim();

      // ── NEW: Improvement 5 — JS Error details text ──
      const jsErrorSection = `
### Detalhes dos Erros de JavaScript (top 5)
${pixelData.jsErrorDetails.length > 0
  ? pixelData.jsErrorDetails.map((e) => {
      const file = e.filename ? ` (${e.filename})` : '';
      return `- [${e.count}x] ${e.message}${file} — primeiro visto em ${e.firstSeen?.split('T')[0] || 'N/A'}`;
    }).join('\n')
  : '- Nenhum erro registrado'}
`
      .trim();

      // ── NEW: Improvement 6 — Engagement score text ──
      const es = pixelData.engagementScore;
      const totalES = es.hot + es.warm + es.cold;
      const engagementSection = `
### Score de Engajamento (frio/morno/quente)
Critério: frio (<2 pontos), morno (2-3), quente (4+). Pontos = tipos de eventos interativos + scroll profundo + atenção longa.
- Quentes (alto engajamento): ${es.hot} visitantes (${totalES > 0 ? ((es.hot / totalES) * 100).toFixed(1) : '0'}%) — taxa de conversão: ${es.hotConvRate}%
- Mornos (engajamento médio): ${es.warm} visitantes (${totalES > 0 ? ((es.warm / totalES) * 100).toFixed(1) : '0'}%) — taxa de conversão: ${es.warmConvRate}%
- Frios (baixo engajamento): ${es.cold} visitantes (${totalES > 0 ? ((es.cold / totalES) * 100).toFixed(1) : '0'}%) — taxa de conversão: ${es.coldConvRate}%
`
      .trim();

      pixelSection = `

## DADOS DO PIXEL PROPRIO (${periodLabel})
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
- Leads no pixel (form_submit + lead, ${periodLabel}): ${pixelData.pixelLeads}
- Leads no CRM (tag Meta Ads, ${periodLabel}): ${crmMetaLeadsPeriod}
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

### Visualizacao de Secoes (quais secoes os visitantes veem):
${pixelData.sectionViews.length > 0 ? pixelData.sectionViews.map((s) => `- ${s.section}: ${s.visitors} visitantes (${pixelData.visitors > 0 ? ((s.visitors / pixelData.visitors) * 100).toFixed(1) : '0.0'}%)`).join('\n') : '- Nenhum dado de secoes disponivel'}

### Comportamento de Saida e Erros:
- Exit intent (mouse saindo da pagina): ${pixelData.exitIntentCount} eventos (${pixelData.visitors > 0 ? ((pixelData.exitIntentCount / pixelData.visitors) * 100).toFixed(1) : '0.0'}% dos visitantes)
- Erros de JavaScript: ${pixelData.jsErrorCount} erros registrados
- Impressoes (print): ${pixelData.printCount}
- Formularios abandonados (usuario saiu sem enviar): ${pixelData.formAbandonCount}

### Fuso Horario dos Visitantes:
${pixelData.timezoneBreakdown.length > 0 ? pixelData.timezoneBreakdown.map((t) => `- ${t.timezone}: ${t.visitors} visitantes (${((t.visitors / pixelData.visitors) * 100).toFixed(1)}%)`).join('\n') : '- Nenhum dado de fuso horario disponivel'}

### Idioma do Navegador:
${pixelData.languageBreakdown.length > 0 ? pixelData.languageBreakdown.map((l) => `- ${l.language}: ${l.visitors} visitantes (${((l.visitors / pixelData.visitors) * 100).toFixed(1)}%)`).join('\n') : '- Nenhum dado de idioma disponivel'}

### Localizacao Geografica (Geo-IP):
${pixelData.geoBreakdown.length > 0 ? pixelData.geoBreakdown.map((g) => {
  const convPct = g.visitors > 0 ? ((g.leads / g.visitors) * 100).toFixed(1) : '0.0';
  return `- ${g.city}/${g.country}: ${g.visitors} visitantes, ${g.leads} leads (${convPct}% conversao)`;
}).join('\n') : '- Nenhum dado geografico disponivel (Geo-IP pode ainda nao estar ativo)'}

${heartbeatSection}

${correlationSection}

${perPageSection}

${hourlySection}

${jsErrorSection}

${engagementSection}`;
    }

    // Contar origens dos leads
    const sourceBreakdown: Record<string, number> = {};
    if (!hasPixelDataOnly) {
      for (const c of metaClients) {
        const origem = c.notes?.includes('[Meta Ads]') ? 'Webhook Meta'
          : c.notes?.includes('[Landing Page]') ? 'Landing Page'
          : c.utmSource ? 'UTM: ' + c.utmSource
          : 'Outros';
        sourceBreakdown[origem] = (sourceBreakdown[origem] || 0) + 1;
      }
    }

    // Montar seção de dados CRM
    const crmSection = hasPixelDataOnly
      ? '\n### Dados do CRM\nNenhum lead do CRM identificado com origem Meta Ads no período selecionado. A análise abaixo é baseada EXCLUSIVAMENTE nos dados do pixel próprio (landing pages).\n'
      : `
## Dados do Meta Ads para Análise (${periodLabel})

### Visão Geral
- Total de leads recebidos (CRM): ${total}
- Leads no período: ${recentLeads}
- Taxa de conversão (Leads → Negociação/Proposta/Fechado): ${convRate}%
- Leads sem nenhuma interação: ${withoutInteraction} (${((withoutInteraction / total) * 100).toFixed(1)}%)

### Origem dos Leads
${Object.entries(sourceBreakdown).sort((a, b) => b[1] - a[1]).map(([s, c]) => `- ${s}: ${c} (${((c / total) * 100).toFixed(1)}%)`).join('\n')}

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
`;

    const dataSummary = `${crmSection}${pixelSection}

---
FIM DOS DADOS. Os dados acima são os ÚNICOS dados disponíveis. Não existem mais dados além dos listados acima. Não invente, estime ou assuma nenhum dado adicional.
---`.trim();

    const systemPrompt = `Você é um consultor especialista em marketing digital e Meta Ads (Facebook/Instagram) para o mercado imobiliário brasileiro.
Seu papel é analisar os dados de leads (do webhook Meta, de landing pages com UTM Meta e do pixel próprio) e fornecer insights acionáveis em português brasileiro.

Cruze os dados do pixel próprio com os dados de leads do CRM. Identifique discrepâncias entre o que o pixel registrou e o que o CRM mostra. Analise a taxa de rejeição, o comportamento dos visitantes, engajamento (scroll depth), tempo na página, dispositivo (mobile vs desktop) e effectiveness dos CTAs de WhatsApp.

ORIGEM DOS LEADS: Os leads podem vir de 3 fontes:
- **Webhook Meta**: O lead preencheu o formulário nativo do Facebook/Instagram.
- **Landing Page**: O lead visitou a landing page do empreendimento e preencheu o formulário lá (com UTM do Meta).
- **Pixel**: Dados de navegação coletados pelo pixel próprio nas landing pages.

Analise os dados fornecidos e gere um relatório estruturado com as seguintes seções:

1. **Resumo Executivo** — Visão geral rápida dos números e tendências do período
2. **Análise de Funil Completo** — Use o funil do pixel (pageview → engagement → lead). Identifique gargalos. Analise a taxa de rejeição e o tempo médio na página.
3. **Atenção e Retenção** — ANALISE A SEÇÃO DE HEARTBEAT. Compare o tempo de atenção dos conversores vs não-conversores. Use a distribuição por faixas de tempo para identificar em qual momento os visitantes perdem interesse. Recomende ações específicas para reter visitantes (ex: se 40% saem antes de 30s, a hero section precisa ser mais impactante).
4. **Correlação Evento → Conversão** — Use os dados de correlação para identificar QUAIS comportamentos estão mais associados à conversão. Visitantes que clicam na galeria convertem mais? E os que abrem FAQ? Use os números de lift para priorizar recomendações.
5. **Diagnóstico por Landing Page** — Para cada landing page, analise: bounce rate, tempo médio, scroll médio e taxa de conversão. Identifique qual página tem pior performance e o que pode ser melhorado em cada uma especificamente.
6. **Melhores Horários** — Use os dados de conversão por hora do dia para recomendar horários ideais de atendimento via WhatsApp e horários de maior investimento em anúncios.
7. **Engajamento e Comportamento** — Analise scroll depth, dispositivos, fontes de tráfego e visualização de seções. Analise o score de engajamento (frio/morno/quente) e a taxa de conversão de cada segmento.
8. **Qualidade dos Leads** — Os leads parecem qualificados? Há padrões nos dados? Que tipo de visitante converte? Compare leads do webhook vs landing page.
9. **Performance da Landing Page** — Analise Web Vitals (LCP, FID, CLS). Há problemas de performance? Use os detalhes dos erros de JS para sugerir correções específicas (arquivo, mensagem, frequência).
10. **Desempenho por Campanha e Criativo** — Qual campanha traz os melhores leads? Qual landing page converte mais?
11. **Análise do Formulário** — Qual campo tem maior taxa de desistência? Quanto tempo os visitantes gastam em cada campo? Há formulários abandonados?
12. **Galeria e FAQ** — Os visitantes interagem com as imagens? Quais perguntas do FAQ mais geram interesse? A galeria influencia na conversão?
13. **Efetividade do WhatsApp** — Quantos cliques no WhatsApp? Qual CTA é mais efetivo? Qual a relação entre exit intent e cliques no WhatsApp?
14. **Geografia, Idioma e Localização** — De quais países/cidades vêm os visitantes (dados de Geo-IP)? Quais fusos horários? Quais idiomas? Há visitantes de fora do Brasil? Quais cidades convertem mais?
15. **Alertas e Problemas** — Leads sem interação, estagnados, alta taxa de rejeição, discrepância pixel vs CRM, erros de JS (com detalhes técnicos).
16. **Recomendações** — 10-15 recomendações práticas e específicas para melhorar os resultados. PRIORIZE recomendações baseadas nos dados de correlação e score de engajamento. Inclua sugestões sobre otimização de cada landing page individualmente, CTAs, campanhas, formulário, horários de atendimento e acompanhamento de leads.

## REGRAS ABSOLUTAS — NUNCA VIOLE

1. **USE APENAS OS DADOS FORNECIDOS.** Todos os números, percentuais e métricas que você citar DEVEM existir nos dados fornecidos. É **ESTRITAMENTE PROIBIDO** inventar, estimar, assumir ou fabricar qualquer dado numérico.
2. **Se um dado não estiver disponível**, escreva explicitamente "Dados não disponíveis". NUNCA invente um valor substituto.
3. **Cada afirmação numérica deve ser rastreável** aos dados fornecidos. Se você não encontrar um número nos dados, não o cite.
4. **Não generalize além dos dados.** Se há dados de apenas 1 landing page, não faça comparações entre "múltiplas landing pages". Se há apenas 1 campanha, não diga "as campanhas mostram...".
5. **Não invente nomes** de campanhas, criativos ou landing pages que não estejam listados nos dados.
6. **Não assuma comportamentos** que não foram registrados pelo pixel.
7. **Quando não houver dados para uma seção**, diga claramente que não há dados e pule para a próxima. Não preencha com suposições.

CONTEXTO:
- Período da análise: ${periodLabel}.
- Leads do webhook Meta Ads chegam diretamente do Facebook e NÃO geram eventos de pixel. A discrepancia entre pixel e CRM e esperada nesse caso.
- Leads cadastrados via formulario das landing pages GERAM eventos de pixel (form_submit) e campos UTM.
- Foque no que importa para um corretor/consultor imobiliário.
- Se houver dados de dispositivo, analise se mobile ou desktop tem melhor conversão.
- Se houver dados de Web Vitals, identifique problemas de performance (LCP > 2500ms, CLS > 0.1, FID > 100ms).
- Se houver dados de FAQ, identifique quais dúvidas são mais frequentes e sugira otimizações.
- Se houver dados de exit intent, sugira estratégias de retenção (popup, oferta especial, etc.).
- Se houver dados de fuso horário, sugira horários ótimos para atendimento via WhatsApp.
- Se houver dados de correlação, priorize ações que têm maior lift na conversão.
- Se houver dados de score de engajamento, recomende como transformar visitantes frios em mornos/quentes.
- Se houver dados de horários, recomende quando investir mais em anúncios e quando ter equipe disponível.
- Se os dados forem exclusivamente do pixel (sem leads CRM), foque a análise no comportamento dos visitantes, funil de conversão da landing page e performance técnica.`;

    // ─────────────────────────────────────────
    // 4. Chamar IA via camada unificada (Qwen → Gemini → Groq)
    // ─────────────────────────────────────────
    let analysis: string;
    let provider: string;

    try {
      const result = await callAI(systemPrompt, dataSummary, {
        temperature: 0.1,
        maxTokens: 8192,
      });
      analysis = result.reply;
      provider = result.provider;
    } catch (err) {
 console.error('[Meta Ads Analyze] Erro IA:', err);
      return NextResponse.json({
        analysis: null,
        error: 'Nenhum provedor de IA disponível. Configure DASHSCOPE_API_KEY ou GROQ_API_KEY.',
      }, { status: 503 });
    }

    console.log(`[Meta Ads Analyze] Análise gerada por: ${provider}`);

    return NextResponse.json({
      analysis,
      generatedAt: new Date().toISOString(),
      period: periodParam,
      periodLabel,
      dataPoints: {
        totalLeads: total,
        recentLeads,
        conversionRate: parseFloat(convRate),
        withoutInteraction,
        pixelDataIncluded: pixelAvailable && pixelData.visitors > 0,
        pixelQueriesSuccessful: pixelAvailable ? 26 : 0,
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