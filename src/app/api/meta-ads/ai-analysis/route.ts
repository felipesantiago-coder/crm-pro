import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { callAI } from '@/lib/ai-provider';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const currentUser = await db.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true },
    });

    if (!currentUser || currentUser.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Acesso restrito a administradores' }, { status: 403 });
    }

    // 1. Buscar dados dos leads Meta
    const metaClients = await db.client.findMany({
      where: { notes: { contains: '[Meta Ads]' } },
      select: {
        name: true, stage: true, region: true, enterprise: true,
        notes: true, createdAt: true, updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (metaClients.length === 0) {
      return NextResponse.json({
        analysis: 'Ainda não há leads originados do Meta Ads no CRM. Configure o webhook e aguarde os primeiros leads chegarem para que a IA possa gerar insights.',
        provider: 'none',
      });
    }

    // 2. Montar contexto estruturado
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const parsedLeads = metaClients.map((c) => {
      const adMatch = c.notes?.match(/Anúncio:\s*(.+)/i);
      const campaignMatch = c.notes?.match(/Campanha:\s*(.+)/i);
      return {
        nome: c.name, etapa: c.stage, regiao: c.region || 'N/A',
        empreendimento: c.enterprise || 'N/A',
        anuncio: adMatch?.[1]?.trim() || 'Não identificado',
        campanha: campaignMatch?.[1]?.trim() || 'Não identificada',
        dataCriacao: c.createdAt.toISOString(),
        dataAtualizacao: c.updatedAt.toISOString(),
      };
    });

    const total = parsedLeads.length;
    const thisMonth = parsedLeads.filter((l) => new Date(l.dataCriacao) >= monthStart).length;
    const won = parsedLeads.filter((l) => l.etapa === 'FECHADO_GANHO').length;
    const lost = parsedLeads.filter((l) => l.etapa === 'FECHADO_PERDIDO').length;
    const stillLead = parsedLeads.filter((l) => l.etapa === 'LEAD').length;
    const convRate = total > 0 ? Math.round((won / total) * 100) : 0;

    const campaignStats = new Map<string, { total: number; won: number; lost: number; stages: Record<string, number> }>();
    for (const lead of parsedLeads) {
      const key = lead.campanha;
      if (!campaignStats.has(key)) campaignStats.set(key, { total: 0, won: 0, lost: 0, stages: {} });
      const entry = campaignStats.get(key)!;
      entry.total++;
      if (lead.etapa === 'FECHADO_GANHO') entry.won++;
      if (lead.etapa === 'FECHADO_PERDIDO') entry.lost++;
      entry.stages[lead.etapa] = (entry.stages[lead.etapa] || 0) + 1;
    }

    const adStats = new Map<string, { total: number; won: number; campanha: string }>();
    for (const lead of parsedLeads) {
      const key = lead.anuncio;
      if (!adStats.has(key)) adStats.set(key, { total: 0, won: 0, campanha: lead.campanha });
      const entry = adStats.get(key)!;
      entry.total++;
      if (lead.etapa === 'FECHADO_GANHO') entry.won++;
    }

    const topCampaigns = Array.from(campaignStats.entries())
      .sort((a, b) => b[1].total - a[1].total).slice(0, 10)
      .map(([name, data]) => ({
        nome: name, total: data.total, ganhos: data.won, perdidos: data.lost,
        taxaConversao: data.total > 0 ? Math.round((data.won / data.total) * 100) : 0,
        distribuicao: data.stages,
      }));

    const topAds = Array.from(adStats.entries())
      .sort((a, b) => b[1].total - a[1].total).slice(0, 10)
      .map(([name, data]) => ({
        nome: name, total: data.total, ganhos: data.won, campanha: data.campanha,
        taxaConversao: data.total > 0 ? Math.round((data.won / data.total) * 100) : 0,
      }));

    const regionCount = new Map<string, number>();
    for (const lead of parsedLeads) {
      if (lead.regiao !== 'N/A') regionCount.set(lead.regiao, (regionCount.get(lead.regiao) || 0) + 1);
    }
    const topRegions = Array.from(regionCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, count]) => ({ regiao: name, leads: count }));

    const entCount = new Map<string, number>();
    for (const lead of parsedLeads) {
      if (lead.empreendimento !== 'N/A') entCount.set(lead.empreendimento, (entCount.get(lead.empreendimento) || 0) + 1);
    }
    const topEnterprises = Array.from(entCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, count]) => ({ empreendimento: name, leads: count }));

    const staleLeads = parsedLeads.filter((l) => {
      const age = (Date.now() - new Date(l.dataCriacao).getTime()) / 86400000;
      return l.etapa === 'LEAD' && age > 7;
    });

    const dataSummary = JSON.stringify({
      periodo: `Dados até ${now.toLocaleDateString('pt-BR')}`,
      resumo: { total, esteMes: thisMonth, ganhos: won, perdidos: lost, aindaLead: stillLead, taxaConversao: `${convRate}%` },
      campanhas: topCampaigns, anuncios: topAds, regioes: topRegions,
      empreendimentos: topEnterprises,
      leadsEstagnados: {
        quantidade: staleLeads.length,
        nomes: staleLeads.slice(0, 10).map((l) => `${l.nome} (${Math.round((Date.now() - new Date(l.dataCriacao).getTime()) / 86400000)}d)`),
      },
    }, null, 2);

    const systemPrompt = `Você é um analista de marketing digital especializado em Meta Ads (Facebook/Instagram) para o mercado imobiliário de luxo no Brasil. Analise os dados de leads recebidos via Meta Lead Ads e gere insights acionáveis em português brasileiro.

CONTEXTO: O CRM Pro é um sistema de gestão imobiliária. Os leads entram automaticamente via webhook do Meta Lead Ads e são atribuídos a corretores. O funil tem 8 etapas: LEAD → PROSPECT → VISITA_AGENDADA → VISITA_REALIZADA → CARTA_PROPOSTA → CONTRATO_GERADO → FECHADO_GANHO/FECHADO_PERDIDO.

DADOS DISPONÍVEIS:
${dataSummary}

REGRAS DE ANÁLISE:
1. Use formatação Markdown com negrito, listas e cabeçalhos.
2. Estruture a análise em seções claras.
3. Inclua uma seção "Avaliação Geral" com a situação atual.
4. Destaque campanhas e anúncios com melhor e pior desempenho.
5. Identifique padrões (ex: regiões que mais convertem, horários de pico se visível).
6. Aponte leads estagnados que precisam de atenção urgente.
7. Sugira de 3 a 5 ações concretas e priorizadas para melhorar os resultados.
8. Use dados numéricos para embasar cada insight.
9. Se houver poucos dados, seja transparente sobre as limitações.
10. Não invente dados que não estejam no contexto fornecido.
11. Mantenha o tom profissional mas acessível, como um consultor falando com o gestor do CRM.`;

    // Chamar IA via camada unificada (DeepSeek)
    const { reply: analysis, provider } = await callAI(
      systemPrompt,
      'Analise os dados dos anúncios Meta e gere um relatório completo com insights e recomendações.',
      { temperature: 0.4, maxTokens: 4096 },
    );

    console.log(`[META ADS AI] Análise gerada por: ${provider}`);

    return NextResponse.json({ analysis, provider });
  } catch (error) {
    console.error('[META ADS AI] Erro:', error);
    const msg = error instanceof Error ? error.message : 'Erro desconhecido';
    return NextResponse.json({ error: `Erro ao gerar análise: ${msg}` }, { status: 500 });
  }
}
