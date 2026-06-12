import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { isAdmin } from '@/lib/auth';
import { db } from '@/lib/db';

// POST /api/enterprises/[id]/pdf — Upload de base de dados (PDF, Markdown ou TXT)
const ACCEPTED_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
];

const ACCEPTED_EXTENSIONS = ['.pdf', '.txt', '.md', '.markdown'];

function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot >= 0 ? filename.slice(lastDot).toLowerCase() : '';
}

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

    const enterprise = await db.enterprise.findUnique({ where: { id } });
    if (!enterprise) {
      return NextResponse.json({ error: 'Empreendimento não encontrado' }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 });
    }

    const ext = getFileExtension(file.name);
    const typeMatch = ACCEPTED_TYPES.includes(file.type) || file.type === '';
    const extMatch = ACCEPTED_EXTENSIONS.includes(ext);

    if (!typeMatch || !extMatch) {
      return NextResponse.json(
        { error: 'Formato inválido. Envie um arquivo PDF, Markdown (.md) ou texto (.txt).' },
        { status: 400 }
      );
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Arquivo muito grande. Máximo 10MB.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let extractedText: string;

    if (ext === '.pdf') {
      // Extrair texto do PDF
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
        console.error('[ENTERPRISE KB] Erro ao extrair texto do PDF:', err);
        return NextResponse.json(
          { error: 'Erro ao processar o PDF. O arquivo pode estar corrompido ou protegido.' },
          { status: 400 }
        );
      }
    } else {
      // TXT ou Markdown — ler diretamente como texto
      try {
        extractedText = buffer.toString('utf-8').trim();

        if (!extractedText || extractedText.length < 20) {
          return NextResponse.json(
            { error: 'O arquivo está vazio ou contém menos de 20 caracteres.' },
            { status: 400 }
          );
        }
      } catch (err) {
        console.error('[ENTERPRISE KB] Erro ao ler arquivo de texto:', err);
        return NextResponse.json(
          { error: 'Erro ao ler o arquivo. Verifique a codificação (use UTF-8).' },
          { status: 400 }
        );
      }
    }

    await db.enterprise.update({
      where: { id },
      data: { pdfContent: extractedText },
    });

    console.log(`[ENTERPRISE KB] Base de dados processada para "${enterprise.name}" (${file.name}): ${extractedText.length} caracteres`);

    return NextResponse.json({
      success: true,
      fileName: file.name,
      fileType: ext === '.pdf' ? 'PDF' : ext === '.md' || ext === '.markdown' ? 'Markdown' : 'Texto',
      extractedChars: extractedText.length,
      extractedPreview: extractedText.slice(0, 200) + (extractedText.length > 200 ? '...' : ''),
    });
  } catch (error) {
    console.error('[ENTERPRISE KB] Erro no upload:', error);
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
      return NextResponse.json({ error: 'Nenhuma base de dados vinculada a este empreendimento' }, { status: 404 });
    }

    await db.enterprise.update({
      where: { id },
      data: { pdfContent: null },
    });

    console.log(`[ENTERPRISE KB] Base de dados removida de "${enterprise.name}"`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[ENTERPRISE KB] Erro ao remover base de dados:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}