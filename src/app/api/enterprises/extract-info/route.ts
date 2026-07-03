import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.1-8b-instant';

// ============================================================
// Types
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

const EMPTY_INFO: ExtractedInfo = {
  location: { address: null, neighborhood: null, city: null, state: null, region: null, additionalInfo: null },
  builder: null,
  architecture: null,
  landscaping: null,
  status: null,
  deliveryDate: null,
  price: null,
  totalUnits: null,
  floors: null,
  parkingSpots: null,
  differentials: [],
  apartmentTypes: [],
  summary: null,
};

// ============================================================
// System prompt — structured JSON extraction
// ============================================================
const EXTRACTION_PROMPT = `Você é um assistente especializado em extrair informações de documentos de empreendimentos imobiliários no Brasil.

Abaixo está o conteúdo de um documento (extraído de PDF/Markdown) sobre um empreendimento imobiliário. Sua tarefa é extrair APENAS as seguintes informações e retornar como JSON válido (sem markdown, sem code fences, apenas JSON puro):

Campos a extrair:
1. "location": objeto com:
   - "address": endereço completo se encontrado (rua, número), null se não houver
   - "neighborhood": bairro, null se não houver
   - "city": cidade, null se não houver
   - "state": estado (sigla), null se não houver
   - "region": região ou zona (ex: "Zona Sul", "Litoral Norte"), null se não houver
   - "additionalInfo": informações complementares de localização (ex: "próximo ao parque X", "frente para o mar"), null se não houver

2. "builder": nome da construtora/incorporadora responsável, null se não houver

3. "architecture": nome do escritório de arquitetura responsável, null se não houver

4. "landscaping": nome do escritório de paisagismo responsável, null se não houver

5. "status": status atual do empreendimento. Use EXATAMENTE um destes valores: "Lançamento", "Em Construção" ou "Entregue". Derive do contexto geral do documento (ex: menções a "pré-lançamento", "obras em andamento", "pronto para morar", "habite-se concedido"). null se não for possível determinar.

6. "deliveryDate": data ou previsão de entrega EXATAMENTE como encontrada no texto. NÃO reformatar. Exemplos aceitáveis: "Dezembro/2026", "2º semestre de 2027", "3º trimestre 2026", "12/2026", "junho de 2026", "2028". null se não houver.

7. "price": menor preço ou faixa de preço EXATAMENTE como encontrada no texto. NÃO reformatar. Exemplos: "a partir de R$ 350.000", "R$ 480.000 a R$ 720.000", "R$ 1.200.000". null se não houver.

8. "totalUnits": número total de unidades do empreendimento (inteiro). null se não houver.

9. "floors": número de andares/pavimentos do empreendimento (inteiro). null se não houver.

10. "parkingSpots": número total de vagas de garagem (inteiro). null se não houver.

11. "differentials": array de strings com os diferenciais do empreendimento (ex: ["Piscina aquecida", "Arena 50m", "Coworking"]). Máximo 10 itens. Inclua TODOS os diferenciais mencionados no documento (lazer, infraestrutura, segurança, sustentabilidade, etc). Retorne [] se não houver.

12. "apartmentTypes": array de objetos, cada um com:
   - "name": tipo/nome do apartamento (ex: "Tipo 1", "Suíte Master", "Apartamento 2 quartos")
   - "area": metragem formatada (ex: "65m²", "120,5 m²"), null se não houver
   - "bedrooms": quantidade de quartos (ex: "2 quartos", "3 suítes"), null se não houver
   - "description": descrição breve do tipo, null se não houver
   - "price": preço ou faixa de preço deste tipo EXATAMENTE como no texto, null se não houver
   Retorne [] se não houver informações de tipologias.

13. "summary": resumo em UMA frase (máximo 200 caracteres) sobre o empreendimento, incluindo dados-chave como tipo de unidades, metragem e preço se disponíveis. null se não houver informações suficientes.

REGRAS IMPORTANTES:
- Retorne APENAS o JSON, sem nenhum texto antes ou depois.
- Não invente informações que não estejam claramente no documento.
- Se uma informação não for encontrada, use null (nunca deixe em branco ou use string vazia).
- Diferenciais devem ser curtos (máximo 5 palavras cada).
- Para "area", use sempre o formato numérico+m² (ex: "75m²").
- Para "deliveryDate" e "price", preserve EXATAMENTE o formato original do texto. Isso é essencial.
- O JSON deve ser válido e bem formatado.`;

// ============================================================
// Helpers
// ============================================================

/** Abort a fetch after `ms` milliseconds */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms),
    ),
  ]);
}

/** Sleep helper */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ============================================================
// AI providers (with retry)
// ============================================================
const AI_TIMEOUT_MS = 30_000; // 30s per attempt
const MAX_RETRIES = 2;

async function askGemini(systemText: string, userContent: string): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemText }] },
    contents: [{ role: 'user', parts: [{ text: userContent }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
  });

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await withTimeout(
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        }),
        AI_TIMEOUT_MS,
        'Gemini',
      );

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini ${res.status}: ${errText.slice(0, 300)}`);
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      if (!text) throw new Error('Gemini retornou resposta vazia');

      return text;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[Extract Info] Gemini attempt ${attempt}/${MAX_RETRIES} failed:`, lastError.message);
      if (attempt < MAX_RETRIES) await sleep(1000 * attempt); // 1s, 2s
    }
  }
  throw lastError || new Error('Gemini falhou');
}

async function askGroq(systemText: string, userContent: string): Promise<string> {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY não configurada');

  const url = 'https://api.groq.com/openai/v1/chat/completions';
  const body = JSON.stringify({
    model: GROQ_MODEL,
    temperature: 0.1,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: systemText },
      { role: 'user', content: userContent },
    ],
  });

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await withTimeout(
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
          body,
        }),
        AI_TIMEOUT_MS,
        'Groq',
      );

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Groq ${res.status}: ${errText.slice(0, 300)}`);
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';

      if (!text) throw new Error('Groq retornou resposta vazia');

      return text;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[Extract Info] Groq attempt ${attempt}/${MAX_RETRIES} failed:`, lastError.message);
      if (attempt < MAX_RETRIES) await sleep(1000 * attempt);
    }
  }
  throw lastError || new Error('Groq falhou');
}

function parseJSON(raw: string): ExtractedInfo {
  let cleaned = raw.trim();

  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  const jsonStart = cleaned.indexOf('{');
  const jsonEnd = cleaned.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd !== -1) {
    cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
  }

  try {
    const parsed = JSON.parse(cleaned);
    return {
      location: {
        address: parsed?.location?.address || null,
        neighborhood: parsed?.location?.neighborhood || null,
        city: parsed?.location?.city || null,
        state: parsed?.location?.state || null,
        region: parsed?.location?.region || null,
        additionalInfo: parsed?.location?.additionalInfo || null,
      },
      builder: parsed?.builder || null,
      architecture: parsed?.architecture || null,
      landscaping: parsed?.landscaping || null,
      status: (parsed?.status === 'Lançamento' || parsed?.status === 'Em Construção' || parsed?.status === 'Entregue')
        ? parsed.status : null,
      deliveryDate: parsed?.deliveryDate || null,
      price: parsed?.price || null,
      totalUnits: typeof parsed?.totalUnits === 'number' ? parsed.totalUnits : null,
      floors: typeof parsed?.floors === 'number' ? parsed.floors : null,
      parkingSpots: typeof parsed?.parkingSpots === 'number' ? parsed.parkingSpots : null,
      differentials: Array.isArray(parsed?.differentials) ? parsed.differentials.filter(Boolean).slice(0, 10) : [],
      apartmentTypes: Array.isArray(parsed?.apartmentTypes)
        ? parsed.apartmentTypes.map((apt: any) => ({
            name: apt?.name || 'Tipo',
            area: apt?.area || null,
            bedrooms: apt?.bedrooms || null,
            description: apt?.description || null,
            price: apt?.price || null,
          }))
        : [],
      summary: parsed?.summary || null,
    };
  } catch {
    console.warn('[Extract Info] Failed to parse AI response as JSON, raw:', cleaned.substring(0, 200));
    return EMPTY_INFO;
  }
}

// ============================================================
// Core extraction logic (reusable by cache-all)
// ============================================================
export async function extractAndCache(enterpriseId: string): Promise<ExtractedInfo> {
  const enterprise = await db.enterprise.findUnique({
    where: { id: enterpriseId },
    select: { id: true, name: true, region: true, pdfContent: true },
  });

  if (!enterprise) return { ...EMPTY_INFO };

  // If no content, return with region fallback
  if (!enterprise.pdfContent || enterprise.pdfContent.trim().length < 20) {
    const result: ExtractedInfo = {
      ...EMPTY_INFO,
      location: { ...EMPTY_INFO.location, region: enterprise.region || null },
    };
    await db.enterprise.update({
      where: { id: enterpriseId },
      data: { cachedInfo: result as any },
    });
    return result;
  }

  // Increased from 12000 to 30000 to avoid truncating delivery dates
  // and other info that typically appear at the end of documents
  const content = enterprise.pdfContent.length > 30000
    ? enterprise.pdfContent.substring(0, 30000) + '\n\n[Conteúdo truncado...]'
    : enterprise.pdfContent;

  const userMessage = `Empreendimento: "${enterprise.name}"${enterprise.region ? `\nRegião (banco de dados): ${enterprise.region}` : ''}\n\nConteúdo do documento:\n${content}`;

  let rawReply = '';

  // 1) Try Gemini first (better quality)
  if (GEMINI_API_KEY) {
    try {
      rawReply = await askGemini(EXTRACTION_PROMPT, userMessage);
    } catch (err) {
      console.warn('[Extract Info] Gemini failed after retries:', err instanceof Error ? err.message : err);
    }
  }

  // 2) Fallback to Groq
  if (!rawReply && GROQ_API_KEY) {
    try {
      rawReply = await askGroq(EXTRACTION_PROMPT, userMessage);
    } catch (err) {
      console.error('[Extract Info] Groq also failed after retries:', err instanceof Error ? err.message : err);
    }
  }

  let info: ExtractedInfo;
  if (!rawReply) {
    info = {
      ...EMPTY_INFO,
      location: { ...EMPTY_INFO.location, region: enterprise.region || null },
    };
  } else {
    info = parseJSON(rawReply);
    if (!info.location.region && enterprise.region) {
      info.location.region = enterprise.region;
    }
  }

  // Save to cache
  await db.enterprise.update({
    where: { id: enterpriseId },
    data: { cachedInfo: info as any },
  });

  return info;
}

// ============================================================
// POST handler — extract for a single enterprise (still used by admin)
// ============================================================
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { enterpriseId } = await req.json();
    if (!enterpriseId) {
      return NextResponse.json({ error: 'enterpriseId é obrigatório' }, { status: 400 });
    }

    const info = await extractAndCache(enterpriseId);
    return NextResponse.json(info);
  } catch (error) {
    console.error('[Extract Info] Error:', error);
    return NextResponse.json(
      { error: 'Erro ao extrair informações' },
      { status: 500 },
    );
  }
}