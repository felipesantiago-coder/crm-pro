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
      topPixelCampaigns: Array<{
        campaign: string;
        visitors: number;
        leads: number;
      }>;
    } = {
      visitors: 0,
      pageviews: 0,
      pixelLeads: 0,
      whatsappClicks: 0,
      campaignsCount: 0,
      creativesCount: 0,
      bounceRate: null,
      topPixelCampaigns: [],
    };

    let pixelAvailable = false;

    try {
      // Query 1: Tracking funnel data
      const funnelResult: Array<{
        visitors: string | number;
        pageviews: string | number;
        pixel_leads: string | number;
        whatsapp_clicks: string | number;
        campaigns_count: string | number;
        creatives_count: string | number;
      }> = await db.$queryRaw`
        SELECT
          COUNT(DISTINCT "visitorId") as visitors,
          COUNT(*) FILTER (WHERE "eventType" = 'pageview') as pageviews,
          COUNT(*) FILTER (WHERE "eventType" = 'lead' OR "eventType" = 'form_submit') as pixel_leads,
          COUNT(*) FILTER (WHERE "eventType" = 'whatsapp_click') as whatsapp_clicks,
          COUNT(DISTINCT "utmCampaign") as campaigns_count,
          COUNT(DISTINCT "utmContent") as creatives_count
        FROM "tracking_events"
        WHERE "createdAt" >= NOW() - INTERVAL '30 days'
      `;

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

      // Query 2: Top campaigns from pixel data
      const campaignResults: Array<{
        campaign: string;
        visitors: string | number;
        leads: string | number;
      }> = await db.$queryRaw`
        SELECT
          COALESCE("utmCampaign", '(direto)') as campaign,
          COUNT(DISTINCT "visitorId") as visitors,
          COUNT(*) FILTER (WHERE "eventType" = 'lead' OR "eventType" = 'form_submit') as leads
        FROM "tracking_events"
        WHERE "createdAt" >= NOW() - INTERVAL '30 days'
        GROUP BY COALESCE("utmCampaign", '(direto)')
        ORDER BY leads DESC
        LIMIT 10
      `;

      pixelData.topPixelCampaigns = campaignResults.map((row) => ({
        campaign: row.campaign,
        visitors: Number(row.visitors) || 0,
        leads: Number(row.leads) || 0,
      }));

      // Query 3: Bounce rate
      const bounceResult: Array<{ bounce_rate: string | number }> = await db.$queryRaw`
        SELECT
          ROUND(COUNT(*) FILTER (WHERE total_events = 1)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as bounce_rate
        FROM (
          SELECT "visitorId", COUNT(*) as total_events
          FROM "tracking_events"
          WHERE "createdAt" >= NOW() - INTERVAL '30 days'
          GROUP BY "visitorId"
        ) sub
      `;

      if (bounceResult.length > 0 && bounceResult[0].bounce_rate !== null) {
        pixelData.bounceRate = Number(bounceResult[0].bounce_rate) || null;
      }
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

      // CRM leads from Meta (same 30-day window for fair comparison)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const crmMetaLeads30d = metaClients.filter((c) => c.createdAt >= thirtyDaysAgo).length;

      pixelSection = `

## DADOS DO PIXEL PRÓPRIO (últimos 30 dias)
- Visitantes únicos rastreados: ${pixelData.visitors}
- Pageviews registrados: ${pixelData.pageviews}
- Leads capturados pelo pixel: ${pixelData.pixelLeads}
- Cliques no WhatsApp rastreados: ${pixelData.whatsappClicks}
- Taxa de rejeição: ${pixelData.bounceRate !== null ? pixelData.bounceRate + '%' : 'N/A'}
- Campanhas ativas (UTM): ${pixelData.campaignsCount}
- Criativos rastreados: ${pixelData.creativesCount}

### Desempenho por campanha (pixel):
${campaignLines}

### Discrepância Pixel vs CRM:
- Leads no pixel (origem Meta): ${pixelData.pixelLeads}
- Leads no CRM (tag Meta Ads, últimos 30 dias): ${crmMetaLeads30d}`;
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

Cruze os dados do pixel próprio com os dados de leads do CRM. Identifique discrepâncias entre o que o pixel registrou e o que o CRM mostra. Analise a taxa de rejeição e o comportamento dos visitantes antes de se tornarem leads.

Analise os dados fornecidos e gere um relatório estruturado com as seguintes seções:

1. **Resumo Executivo** — Visão geral rápida dos números e tendências
2. **Análise de Funil** — Onde os leads estão parando? Há gargalos?
3. **Qualidade dos Leads** — Os leads parecem qualificados? Há padrões nos dados?
4. **Desempenho por Campanha** — Qual campanha traz os melhores leads?
5. **Alertas e Problemas** — Leads sem interação, estagnados, etc.
6. **Recomendações** — 5-7 recomendações práticas e específicas para melhorar os resultados

Seja direto, prático e específico. Use dados numéricos nos argumentos. Foque no que importa para um corretor/consultor imobiliário.`;

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
        } : {}),
      },
    });
  } catch (error) {
    console.error('[Meta Ads Analyze] Erro:', error);
    return NextResponse.json({ error: 'Erro ao gerar análise' }, { status: 500 });
  }
}