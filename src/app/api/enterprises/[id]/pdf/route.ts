import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { isAdmin } from '@/lib/auth';
import { db } from '@/lib/db';

// POST /api/enterprises/[id]/pdf — Upload e extração de PDF
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const { id } = await params;

    // Verifica se o empreendimento existe
    const enterprise = await db.enterprise.findUnique({ where: { id } });
    if (!enterprise) {
      return NextResponse.json({ error: 'Empreendimento não encontrado' }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 });
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Apenas arquivos PDF são aceitos' }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Arquivo muito grande. Máximo 10MB.' }, { status: 400 });
    }

    // Extrair texto do PDF
    const buffer = Buffer.from(await file.arrayBuffer());
    let extractedText: string;

    try {
      const pdfParse = (await import('pdf-parse')).default;
      const pdfData = await pdfParse(buffer);
      extractedText = (pdfData.text || '').trim();

      if (!extractedText || extractedText.length < 20) {
        return NextResponse.json(
          { error: 'Não foi possível extrair texto deste PDF. Verifique se o PDF contém texto (não é apenas imagens).' },
          { status: 400 }
        );
      }
    } catch (err) {
      console.error('[ENTERPRISE PDF] Erro ao extrair texto:', err);
      return NextResponse.json(
        { error: 'Erro ao processar o PDF. O arquivo pode estar corrompido ou protegido.' },
        { status: 400 }
      );
    }

    // Salvar no banco
    await db.enterprise.update({
      where: { id },
      data: {
        pdfContent: extractedText,
      },
    });

    console.log(`[ENTERPRISE PDF] PDF processado para "${enterprise.name}": ${extractedText.length} caracteres extraídos`);

    return NextResponse.json({
      success: true,
      fileName: file.name,
      extractedChars: extractedText.length,
      extractedPreview: extractedText.slice(0, 200) + (extractedText.length > 200 ? '...' : ''),
    });
  } catch (error) {
    console.error('[ENTERPRISE PDF] Erro no upload:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}

// DELETE /api/enterprises/[id]/pdf — Remover PDF de um empreendimento
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });
    }

    const { id } = await params;

    const enterprise = await db.enterprise.findUnique({
      where: { id },
      select: { pdfContent: true, name: true },
    });

    if (!enterprise) {
      return NextResponse.json({ error: 'Empreendimento não encontrado' }, { status: 404 });
    }

    if (!enterprise.pdfContent) {
      return NextResponse.json({ error: 'Nenhum PDF vinculado a este empreendimento' }, { status: 404 });
    }

    await db.enterprise.update({
      where: { id },
      data: { pdfContent: null },
    });

    console.log(`[ENTERPRISE PDF] PDF removido de "${enterprise.name}"`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[ENTERPRISE PDF] Erro ao remover PDF:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}