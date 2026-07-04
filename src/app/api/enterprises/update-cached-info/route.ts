import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { db } from '@/lib/db';

// Accepts a single enterprise update: { id, cachedInfo }
// Or batch: { updates: Array<{ id, cachedInfo }> }
export async function POST(request: NextRequest) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const body = await request.json();

    // Batch mode
    if (body.updates && Array.isArray(body.updates)) {
      const results: Array<{ id: string; name: string; success: boolean; error?: string }> = [];

      for (const item of body.updates) {
        if (!item.id || !item.cachedInfo) {
          results.push({ id: item.id || '?', name: '?', success: false, error: 'ID ou cachedInfo ausente' });
          continue;
        }
        try {
          await db.enterprise.update({
            where: { id: item.id },
            data: { cachedInfo: item.cachedInfo },
          });
          const ent = await db.enterprise.findUnique({ where: { id: item.id }, select: { name: true } });
          results.push({ id: item.id, name: ent?.name || '?', success: true });
        } catch (err) {
          results.push({ id: item.id, name: item.name || '?', success: false, error: 'Erro ao atualizar registro.' });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      return NextResponse.json({
        message: `${successCount} de ${results.length} empreendimentos atualizados com sucesso.`,
        processed: successCount,
        total: results.length,
        results,
      });
    }

    // Single mode
    const { id, cachedInfo } = body;
    if (!id || !cachedInfo) {
      return NextResponse.json({ error: 'ID e cachedInfo são obrigatórios' }, { status: 400 });
    }

    await db.enterprise.update({
      where: { id },
      data: { cachedInfo },
    });

    const enterprise = await db.enterprise.findUnique({ where: { id }, select: { name: true } });
    return NextResponse.json({
      message: `Empreendimento "${enterprise?.name}" atualizado com sucesso.`,
      success: true,
    });
  } catch (error) {
    console.error('[Update Cached Info] Error:', error);
    return NextResponse.json({ error: 'Erro ao atualizar informações' }, { status: 500 });
  }
}