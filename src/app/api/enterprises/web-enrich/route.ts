import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';
import { Prisma } from '@prisma/client';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash';
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ============================================================
// Types — same as extract-info for consistency
// ============================================================
interface ExtractedInfo {
  location: {
    address: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    region: string | null;
    additionalInfo: string | null;
  };
  builder: string | null;
  architecture: string | null;
  landscaping: string | null;
 status: string | null;
  deliveryDate: string | null;
  price: string | null;
  totalUnits: number | null;
  floors: number | null;
  parkingSpots: number | null;
  differentials: string[];
  apartmentTypes: Array<{
    name: string;
    area: string | null;
    bedrooms: string | null;
    description: string | null;
    price: string | null;
  }>;
  summary: string | null;
}

// ============================================================
// Web Search via z-ai-web-dev-sdk
// ============================================================
async function webSearch(query: string, num = 5): Promise<Array<{ url: string; name: string; snippet: string }>> {
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();
    const results = await zai.functions.invoke('web_search', { query, num });
    return (results || []).map((r: any) => ({
      url: r.url || '',
      name: r.name || '',
      snippet: r.snippet || '',
    }));
  } catch (err) {
    console.error('[Web Enrich] Erro na busca web:', err);
    return [];
  }
}

// ============================================================
// AI structuring — Gemini (primary) / Groq (fallback)
// ============================================================
const STRUCTURING_PROMPT = `Você é um assistente especializado em pesquisar e estruturar informações sobre empreendimentos imobiliários no Brasil.

Você recebeu os resultados de uma busca na internet sobre um empreendimento imobiliário. Sua tarefa é extrair as informações relevantes e retornar como JSON válido (sem markdown, sem code fences, apenas JSON puro).

Campos a extrair:
1. "location": objeto com:
   - "address": endereço completo se encontrado, null se não houver
   - "neighborhood": bairro, null se não houver
   - "city": cidade, null se não houver
   - "state": estado (sigla), null se não houver
   - "region": região ou zona, null se não houver
   - "additionalInfo": informações complementares de localização, null se não houver

2. "builder": nome da construtora/incorporadora responsável, null se não houver

3. "architecture": nome do escritório de arquitetura responsável, null se não houver

4. "landscaping": nome do escritório de paisagismo responsável, null se não houver

5. "differentials": array de strings com os diferenciais do empreendimento. Máximo 8 itens. Retorne [] se não houver.

6. "apartmentTypes": array de objetos, cada um com:
   - "name": nome/tipo do apartamento (ex: "Tipo 1", "2 quartos")
   - "area": metragem (ex: "45m²" ou "45 a 60m²"), null se não houver
   - "bedrooms": número de quartos (ex: "2" ou "1 a 3"), null se não houver
   - "description": descrição breve, null se não houver
   Retorne [] se não houver.

7. "summary": resumo descritivo do empreendimento em 2-3 frases, focando nas informações mais relevantes para um corretor de imóveis. null se não houver informações suficientes.

REGRAS IMPORTANTES:
- Use APENAS as informações encontradas nos resultados da busca. NÃO invente dados.
- Se não encontrar informação para um campo, retorne null ou [].
- O JSON deve ser válido e bem formatado.
- Prefira dados específicos e concretos.
- Endereços e metragens devem ser mantidos como encontrados.`;

async function structureWithAI(
  enterpriseName: string,
  searchResults: Array<{ url: string; name: string; snippet: string }>
): Promise<ExtractedInfo | null> {
  if (searchResults.length === 0) return null;

  const context = searchResults
    .map((r, i) => `--- Resultado ${i + 1} ---\nTítulo: ${r.name}\nURL: ${r.url}\nResumo: ${r.snippet}`)
    .join('\n\n');

  const userMessage = `Empreendimento: "${enterpriseName}"\n\nResultados da busca na internet:\n\n${context}`;

  // Try Gemini
  if (GEMINI_API_KEY) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: STRUCTURING_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: userMessage }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return parseAIResponse(text);
      }
    } catch (err) {
      console.error('[Web Enrich] Erro Gemini:', err);
    }
  }

  // Fallback: Groq
  if (GROQ_API_KEY) {
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
            { role: 'system', content: STRUCTURING_PROMPT },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.2,
          max_tokens: 2048,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (text) return parseAIResponse(text);
      }
    } catch (err) {
      console.error('[Web Enrich] Erro Groq:', err);
    }
  }

  return null;
}

function parseAIResponse(text: string): ExtractedInfo | null {
  try {
    // Try to extract JSON from the response (may be wrapped in markdown code fences)
    let jsonStr = text.trim();

    // Remove markdown code fences if present
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    // Try to find JSON object in the text
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const parsed = JSON.parse(jsonStr);

    // Validate and fill defaults (dedicated fields default to null — web search doesn't extract them)
    return {
      location: {
        address: parsed.location?.address || null,
        neighborhood: parsed.location?.neighborhood || null,
        city: parsed.location?.city || null,
        state: parsed.location?.state || null,
        region: parsed.location?.region || null,
        additionalInfo: parsed.location?.additionalInfo || null,
      },
      builder: parsed.builder || null,
      architecture: parsed.architecture || null,
      landscaping: parsed.landscaping || null,
      status: null,
      deliveryDate: null,
      price: null,
      totalUnits: null,
      floors: null,
      parkingSpots: null,
      differentials: Array.isArray(parsed.differentials) ? parsed.differentials.slice(0, 8) : [],
      apartmentTypes: Array.isArray(parsed.apartmentTypes)
        ? parsed.apartmentTypes.map((a: any) => ({
            name: String(a.name || ''),
            area: a.area || null,
            bedrooms: a.bedrooms || null,
            description: a.description || null,
          }))
        : [],
      summary: parsed.summary || null,
    };
  } catch (err) {
    console.error('[Web Enrich] Erro ao parsear resposta da IA:', err);
    return null;
  }
}

// ============================================================
// Merge with existing cachedInfo (PDF-based)
// ============================================================
function mergeWithExisting(
  existing: Record<string, any> | null,
  webData: ExtractedInfo
): Record<string, any> {
  if (!existing) return webData as unknown as Record<string, any>;

  // Preserve all existing fields (including dedicated fields not in web-enrich scope)
  const merged: Record<string, any> = { ...existing };

  // Location — merge field by field
  merged.location = {
    ...(existing.location || {}),
    address: webData.location.address || existing.location?.address || null,
    neighborhood: webData.location.neighborhood || existing.location?.neighborhood || null,
    city: webData.location.city || existing.location?.city || null,
    state: webData.location.state || existing.location?.state || null,
    region: webData.location.region || existing.location?.region || null,
    additionalInfo: webData.location.additionalInfo || existing.location?.additionalInfo || null,
  };

  // Simple string fields — web wins if non-null
  if (webData.builder) merged.builder = webData.builder;
  if (webData.architecture) merged.architecture = webData.architecture;
  if (webData.landscaping) merged.landscaping = webData.landscaping;
  if (webData.summary) merged.summary = webData.summary;

  // Differentials — merge and deduplicate
  if (webData.differentials.length > 0) {
    const existingDiffs: string[] = Array.isArray(merged.differentials) ? merged.differentials : [];
    merged.differentials = [...new Set([...webData.differentials, ...existingDiffs])].slice(0, 10);
  }

  // Apartment types — web wins if non-empty
  if (webData.apartmentTypes.length > 0) {
    merged.apartmentTypes = webData.apartmentTypes;
  }

  return merged;
}

// ============================================================
// POST — Enrich all (or specific) enterprises from web
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const body = await request.json().catch(() => ({}));
    const enterpriseId = body.enterpriseId || null;
    const force = body.force === true;

    // 1. Fetch enterprises to enrich
    const whereClause: Prisma.EnterpriseWhereInput = enterpriseId
      ? { id: enterpriseId }
      : {};

    if (!force) {
      // By default, only enrich enterprises WITHOUT cachedInfo
      // If force=true, enrich all
      whereClause.cachedInfo = { equals: Prisma.DbNull };
    }

    const enterprises = await db.enterprise.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        slug: true,
        region: true,
        cachedInfo: true,
        landingTitle: true,
        landingDescription: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (enterprises.length === 0) {
      return NextResponse.json({
        success: true,
        message: force
          ? 'Nenhum empreendimento encontrado no sistema.'
          : 'Todos os empreendimentos já possuem informações em cache. Use {"force": true} para reprocessar todos.',
        enriched: 0,
        results: [],
      });
    }

    // 2. Process each enterprise
    const results: Array<{
      id: string;
      name: string;
      status: 'success' | 'partial' | 'no_results' | 'error';
      searchResults: number;
      message: string;
    }> = [];

    for (const enterprise of enterprises) {
      const searchName = enterprise.landingTitle || enterprise.name;
      const regionSuffix = enterprise.region ? ` ${enterprise.region}` : '';

      // Multiple search queries for better coverage
      const queries = [
        `${searchName} empreendimento imobiliário${regionSuffix}`,
        `${searchName} incorporadora construtora`,
        `${enterprise.name} lançamento imóvel`,
      ];

      console.log(`[Web Enrich] Processando: ${searchName}`);

      try {
        // Search the web with multiple queries
        const allResults: Array<{ url: string; name: string; snippet: string }> = [];
        for (const query of queries) {
          const results = await webSearch(query, 5);
          allResults.push(...results);
          // Small delay between searches
          if (queries.indexOf(query) < queries.length - 1) {
            await new Promise((r) => setTimeout(r, 500));
          }
        }

        // Deduplicate by URL
        const seenUrls = new Set<string>();
        const uniqueResults = allResults.filter((r) => {
          if (!r.url || seenUrls.has(r.url)) return false;
          seenUrls.add(r.url);
          return true;
        });

        if (uniqueResults.length === 0) {
          results.push({
            id: enterprise.id,
            name: searchName,
            status: 'no_results',
            searchResults: 0,
            message: 'Nenhum resultado encontrado na busca.',
          });
          continue;
        }

        // Structure with AI
        const webInfo = await structureWithAI(searchName, uniqueResults);

        if (!webInfo) {
          results.push({
            id: enterprise.id,
            name: searchName,
            status: 'error',
            searchResults: uniqueResults.length,
            message: 'IA não conseguiu estruturar os dados.',
          });
          continue;
        }

        // Merge with existing cachedInfo (preserves dedicated fields like status, price, etc.)
        const existingInfo = enterprise.cachedInfo as Record<string, any> | null;
        const finalInfo = mergeWithExisting(existingInfo, webInfo);

        // Determine if this is a full or partial enrichment
        const hasSubstantiveData =
          finalInfo.location.city ||
          finalInfo.location.neighborhood ||
          finalInfo.builder ||
          finalInfo.differentials.length > 0 ||
          finalInfo.apartmentTypes.length > 0;

        // Save to database
        await db.enterprise.update({
          where: { id: enterprise.id },
          data: { cachedInfo: finalInfo as any },
        });

        results.push({
          id: enterprise.id,
          name: searchName,
          status: hasSubstantiveData ? 'success' : 'partial',
          searchResults: uniqueResults.length,
          message: hasSubstantiveData
            ? 'Informações enriquecidas com sucesso.'
            : 'Dados limitados encontrados na busca.',
        });

        console.log(`[Web Enrich] ✓ ${searchName}: ${hasSubstantiveData ? 'success' : 'partial'}`);
      } catch (err: any) {
        console.error(`[Web Enrich] ✗ ${searchName}:`, err);
        results.push({
          id: enterprise.id,
          name: searchName,
          status: 'error',
          searchResults: 0,
          message: 'Erro ao processar empreendimento.',
        });
      }

      // Delay between enterprises to avoid rate limiting
      await new Promise((r) => setTimeout(r, 1000));
    }

    const successCount = results.filter((r) => r.status === 'success').length;
    const partialCount = results.filter((r) => r.status === 'partial').length;
    const errorCount = results.filter((r) => r.status === 'error').length;

    return NextResponse.json({
      success: true,
      message: `Enriquecimento concluído: ${successCount} sucesso, ${partialCount} parcial, ${errorCount} erros.`,
      enriched: successCount + partialCount,
      total: results.length,
      results,
    });
  } catch (error) {
    console.error('[Web Enrich] Erro:', error);
    return NextResponse.json({ error: 'Erro ao enriquecer empreendimentos' }, { status: 500 });
  }
}

// ============================================================
// GET — Status: how many enterprises need enrichment
// ============================================================
export async function GET() {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const [total, withCache] = await Promise.all([
      db.enterprise.count(),
      db.enterprise.count({ where: { cachedInfo: { not: Prisma.DbNull } } }),
    ]);
    const withoutCache = total - withCache;

    const enterprises = await db.enterprise.findMany({
      select: {
        id: true,
        name: true,
        region: true,
        cachedInfo: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const list = enterprises.map((e) => ({
      id: e.id,
      name: e.name,
      region: e.region,
      hasCachedInfo: e.cachedInfo !== null,
    }));

    return NextResponse.json({
      total,
      withCache,
      withoutCache,
      enterprises: list,
    });
  } catch (error) {
    console.error('[Web Enrich] Erro GET:', error);
    return NextResponse.json({ error: 'Erro ao verificar status' }, { status: 500 });
  }
}