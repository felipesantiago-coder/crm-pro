import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { db } from '@/lib/db';
import { authOptions } from '@/lib/auth-options';
import { classifyRecords, summarizeClassification, type ClassifiedRecord, type ResaleRecord } from '@/lib/ai/resale-classify';
import type { ParsedProperty } from '@/lib/parse-resale-pdf';
import { getFeatureFlags } from '@/lib/ai/flags';
import { logAiUsage } from '@/lib/ai/telemetry';

/**
 * POST /api/enterprises/resale-import — v2 (prompt v1.0 §13, Fase 6).
 *
 * Fluxo em duas fases (§13.1):
 *   mode=analyze — extrai e CLASSIFICA sem gravar nada (simulação/dry run).
 *                  Devolve cada registro com status (novo/alterado/inalterado/
 *                  duplicado/erro) e diff campo a campo.
 *   mode=commit  — re-extrai do MESMO arquivo (parser determinístico = fonte
 *                  de verdade) e grava APENAS os códigos selecionados,
 *                  preservando os dados existentes quando uma linha falha.
 *
 * O parser continua determinístico — nada aqui é IA generativa (§13).
 */

async function parsePdf(buffer: Buffer): Promise<{ properties: ResaleRecord[]; pageCount: number; textPreview: string }> {
  const { extractPropertiesFromPdf } = await import('@/lib/parse-resale-pdf');
  const result = await extractPropertiesFromPdf(buffer);
  return {
    properties: (result.properties ?? []) as ResaleRecord[],
    pageCount: result.pageCount ?? 0,
    textPreview: result.textPreview || '',
  };
}

function sanitizeFileName(name: string): string {
  return name.replace(/\.pdf$/i, '').trim();
}

export async function POST(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('mode') === 'commit' ? 'commit' : 'analyze';

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as { role?: string }).role !== 'ADMIN') {
      return NextResponse.json({ error: 'Acesso restrito' }, { status: 403 });
    }

    if (mode === 'commit' && !getFeatureFlags().resaleDryRun) {
      // flag desligada mantém o fluxo antigo (commit direto) fora do ar —
      // mas o analyze permanece disponível. Aqui commit segue normalmente;
      // a flag existe para desativar a UI de simulação.
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 });
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Apenas arquivos PDF sao aceitos' }, { status: 400 });
    }
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'Arquivo muito grande. Maximo 20MB.' }, { status: 400 });
    }

    const enterpriseName = sanitizeFileName(file.name);
    const buffer = Buffer.from(await file.arrayBuffer());

    // ── Extração determinística ──────────────────────────────────────────
    let parsed: { properties: ResaleRecord[]; pageCount: number; textPreview: string };
    try {
      parsed = await parsePdf(buffer);
    } catch (extractErr) {
      console.error('[resale-import v2] PDF extraction failed:', extractErr);
      const msg = extractErr instanceof Error ? extractErr.message : String(extractErr);
      // PDF digitalizado/sem texto recebe mensagem específica (§13.3)
      const friendly = msg.toLowerCase().includes('texto')
        ? 'Não foi possível extrair texto deste PDF — ele parece ser digitalizado (imagens). Envie um PDF com camada de texto.'
        : 'Erro ao processar o PDF: ' + msg;
      return NextResponse.json({ error: friendly }, { status: 422 });
    }

    const enterprise = await db.enterprise.findFirst({
      where: { name: enterpriseName },
      select: { id: true, name: true, type: true },
    });

    // ── Classificação contra o banco (sem gravar) ────────────────────────
    const existing = enterprise
      ? await db.resaleProperty.findMany({
          where: { enterpriseId: enterprise.id },
          select: {
            code: true, sortOrder: true, name: true, region: true, category: true, typology: true,
            bedrooms: true, area: true, address: true, captor: true, appointment: true,
            phone: true, phoneDigits: true, price: true, condo: true, iptu: true, notes: true,
            acceptsFinancing: true, acceptsFgts: true, url: true, dataNote: true, sourcePage: true,
          },
        })
      : [];

    const existingByCode = new Map<string, ResaleRecord>(existing.map((r) => [r.code, r]));
    const classified: ClassifiedRecord[] = classifyRecords(parsed.properties, existingByCode);
    const summary = summarizeClassification(classified);

    if (mode === 'analyze') {
      return NextResponse.json({
        mode: 'analyze',
        enterpriseId: enterprise?.id ?? null,
        enterpriseName,
        enterpriseExists: Boolean(enterprise),
        pageCount: parsed.pageCount,
        summary,
        records: classified.map((c) => ({
          code: c.record.code,
          name: c.record.name ?? null,
          region: c.record.region ?? null,
          price: c.record.price ?? null,
          status: c.status,
          diff: c.diff,
          reason: c.reason ?? null,
        })),
        textPreview: parsed.textPreview.slice(0, 1500),
      });
    }

    // ── Commit: grava apenas os códigos selecionados ─────────────────────
    let enterpriseId: string;
    let createdNow = false;
    if (enterprise) {
      enterpriseId = enterprise.id;
    } else {
      // Primeira importação com este nome — cria o empreendimento REVENDA
      // (comportamento do fluxo original, agora após a revisão do usuário).
      const created = await db.enterprise.create({
        data: { name: enterpriseName, type: 'REVENDA', region: null },
      });
      enterpriseId = created.id;
      createdNow = true;
    }

    let selectedCodes: string[] = [];
    try {
      const raw = formData.get('codes');
      selectedCodes = raw ? (JSON.parse(String(raw)) as string[]) : [];
    } catch {
      return NextResponse.json({ error: 'Parâmetro codes inválido' }, { status: 400 });
    }
    if (!Array.isArray(selectedCodes) || selectedCodes.length === 0) {
      return NextResponse.json({ error: 'Nenhum imóvel selecionado para importar.' }, { status: 400 });
    }

    const selectable = new Set(
      classified
        .filter((c) => c.status === 'novo' || c.status === 'alterado')
        .map((c) => c.record.code),
    );
    const targetCodes = selectedCodes.filter((c) => selectable.has(c));
    if (targetCodes.length === 0) {
      return NextResponse.json({ error: 'Nenhum dos códigos selecionados é novo ou alterado.' }, { status: 422 });
    }

    // Escrita preservando dados existentes: cada linha grava de forma
    // independente; falha em uma não afeta as demais (§13.3).
    let imported = 0;
    let updated = 0;
    const errors: string[] = [];
    const recordByCode = new Map(parsed.properties.map((p) => [p.code, p]));

    for (const code of targetCodes) {
      const prop = recordByCode.get(code);
      if (!prop) continue;
      try {
        const existingRow = existingByCode.get(code);
        // O parser é determinístico: os valores vêm com tipos numéricos
        // corretos (area/price/condo/iptu são Float no banco).
        const p = prop as ParsedProperty;
        const data = {
          sortOrder: p.sortOrder ?? 0,
          name: p.name || null, region: p.region || null,
          category: p.category || 'Outro', typology: p.typology || null,
          bedrooms: p.bedrooms ?? null, area: p.area ?? null,
          address: p.address || null, captor: p.captor || null,
          appointment: p.appointment || null, phone: p.phone || null,
          phoneDigits: p.phoneDigits || null,
          price: p.price ?? null, condo: p.condo ?? null, iptu: p.iptu ?? null,
          notes: p.notes || null,
          acceptsFinancing: p.acceptsFinancing ?? false,
          acceptsFgts: p.acceptsFgts ?? false,
          url: p.url || null,
          dataNote: p.dataNote || null, sourcePage: p.sourcePage ?? null,
        };
        await db.resaleProperty.upsert({
          where: { enterpriseId_code: { enterpriseId, code } },
          create: { enterpriseId, code, ...data },
          update: data,
        });
        if (existingRow) updated++; else imported++;
      } catch (e) {
        errors.push(`${code}: ${(e as Error).message}`);
      }
    }

    const totalProperties = await db.resaleProperty.count({ where: { enterpriseId } });

    // Região do empreendimento a partir dos registros importados (comportamento original)
    const regions = [...new Set(parsed.properties.map((x) => x.region).filter(Boolean))] as string[];
    if (regions.length > 0) {
      await db.enterprise.update({
        where: { id: enterpriseId },
        data: { region: regions.length === 1 ? regions[0] : `${regions.length} regioes` },
      });
    }

    logAiUsage({
      capability: 'resale_import', outcome: errors.length > 0 ? 'partial' : 'success',
      userRole: 'ADMIN', scopeId: enterpriseId,
      note: `commit · ${imported} novos, ${updated} alterados, ${errors.length} erros · seleção ${targetCodes.length}/${summary.total}`,
    });

    return NextResponse.json({
      mode: 'commit',
      extracted: parsed.properties.length,
      created: imported,
      updated,
      ignored: summary.inalterado + summary.duplicado + summary.erro,
      errors,
      pageCount: parsed.pageCount,
      totalProperties,
      enterpriseId,
      enterpriseName,
      isNew: createdNow,
    });
  } catch (error) {
    console.error('[resale-import v2] UNHANDLED:', error);
    const message = error instanceof Error ? error.message : 'Erro ao processar o PDF';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
