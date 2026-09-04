import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { hasBaseDocument } from '@/lib/ai/enterprise-info';

// Catálogo de empreendimentos exibido na aba "Empreendimentos" para TODOS os
// usuários autenticados (somente leitura, sem dados sensíveis). Ferramentas de
// gestão (CRUD de imagens, plantas, traduções) permanecem exclusivas de ADMIN.
//
// Task 41 (sincronização real): retorna a CADEIA COMPLETA de estado —
// verifiedInfo (aprovação mais recente), publishedInfo (publicado), datas e
// a presença de base documental (hasDocument). Antes só cachedInfo era
// retornado: o detalhe do painel exibia sempre o espelho legado (atualizado
// apenas no publish) e o admin via informação antiga após "salvar como
// verificado" — e via informação de base removida como se fosse atual.
export async function GET() {
  try {
    const { error } = await requireAuth();
    if (error) return error;

    const enterprises = await db.enterprise.findMany({
      select: {
        id: true,
        name: true,
        type: true,
        slug: true,
        region: true,
        imageUrl: true,
        landingTitle: true,
        landingSubtitle: true,
        landingDescription: true,
        cachedInfo: true,
        cachedInfoI18n: true,
        verifiedInfo: true,
        verifiedInfoAt: true,
        publishedInfo: true,
        publishedAt: true,
        publishedVersion: true,
        // Presença de base documental — pdfContent é grande (até 10MB), então
        // é selecionado apenas para computar o boolean e REMOVIDO do payload.
        pdfContent: true,
        createdAt: true,
        images: { select: { id: true, url: true, altText: true, sortOrder: true }, orderBy: { sortOrder: 'asc' } },
        _count: { select: { clients: true } },
      },
      orderBy: { name: 'asc' },
    });

    const withDerived = enterprises.map((e) => {
      const { pdfContent, ...rest } = e;
      return {
        ...rest,
        // §12-v2: mesma régua do resolver público (string vazia = ausente).
        hasDocument: hasBaseDocument(pdfContent),
      };
    });

    const regions = [...new Set(enterprises.map((e) => e.region).filter(Boolean))].sort();
    return NextResponse.json({ enterprises: withDerived, regions });
  } catch (error) {
    console.error('[Enterprise Panel] Erro:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}