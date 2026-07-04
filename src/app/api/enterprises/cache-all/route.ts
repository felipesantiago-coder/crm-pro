import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { extractAndCache } from '../extract-info/route';

export async function POST() {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    // Find all enterprises with pdfContent
    const enterprises = await db.enterprise.findMany({
      where: {
        AND: [
          { pdfContent: { not: null as any } },
          { pdfContent: { not: '' as any } },
        ],
      },
      select: { id: true, name: true, cachedInfo: true },
    });

    // Filter to only those without cachedInfo (JS-side to avoid Prisma JSON filter issues)
    const toProcess = enterprises.filter((e) => !e.cachedInfo);

    if (toProcess.length === 0) {
      return NextResponse.json({
        message: 'Todos os empreendimentos já possuem informações em cache.',
        processed: 0,
        total: 0,
      });
    }

    const results: Array<{ id: string; name: string; success: boolean; error?: string }> = [];
    let successCount = 0;

    for (const enterprise of toProcess) {
      try {
        await extractAndCache(enterprise.id);
        results.push({ id: enterprise.id, name: enterprise.name, success: true });
        successCount++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erro desconhecido';
        results.push({ id: enterprise.id, name: enterprise.name, success: false, error: msg });
        console.error(`[Cache All] Falha em "${enterprise.name}":`, msg);
      }
      // Small delay to avoid rate limits
      await new Promise((r) => setTimeout(r, 500));
    }

    return NextResponse.json({
      message: `${successCount} de ${toProcess.length} empreendimentos processados com sucesso.`,
      processed: successCount,
      total: toProcess.length,
      results,
    });
  } catch (error) {
    console.error('[Cache All] Error:', error);
    return NextResponse.json({ error: 'Erro ao processar em lote' }, { status: 500 });
  }
}