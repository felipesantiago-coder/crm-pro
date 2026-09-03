import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { isAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import { runExtraction, computeDocumentHash } from '@/lib/ai/extraction';
import { extractTextFromPdf } from '@/lib/extract-pdf-text';
import { logAiUsage } from '@/lib/ai/telemetry';

// POST /api/enterprises/[id]/pdf — Upload de base de dados (PDF, Markdown ou TXT)
//
// CORREÇÃO DE PRODUÇÃO (2026-09): esta rota executa a extração v2 inline
// (orçamento de parede de 48 s), mas não declarava maxDuration — na Vercel a
// function era morta pelo default do plano (~10–15 s) ANTES de o rascunho ser
// persistido. Resultado: documento salvo, run presa em RUNNING, draft nunca
// gravado e o cliente via erro (ou nada) — "o sistema não extrai a nova base".
// Mesma família de bug da rota extract-info (corrigida na Task 22).
export const maxDuration = 60;

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
      // Extrair texto do PDF (pdfjs-dist — funciona no Vercel serverless)
      try {
        const result = await extractTextFromPdf(buffer);
        extractedText = result.text;

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

    // ── Fase 3 (P0 da auditoria): o upload NÃO apaga dados existentes.
    // cachedInfo (legado), verifiedInfo e publishedInfo permanecem intactos —
    // a substituição do documento apenas gera um NOVO rascunho de extração
    // para revisão humana. Publicação continua exigindo decisão do admin.
    const documentHash = await computeDocumentHash(extractedText);
    await db.enterprise.update({
      where: { id },
      data: { pdfContent: extractedText, documentHash },
    });

    // Extração v2 → apenas rascunho revisável (nunca publica). O upload
    // NÃO depende da IA estar disponível — falha de extração não falha o upload.
    const sessionForExtract = await getServerSession(authOptions);
    let extractionStatus: 'completed' | 'partial' | 'failed' | 'disabled' = 'failed';
    let extractionError: string | null = null;
    let extractionBlocks: { processed: number; total: number } | null = null;
    try {
      const userIdForExtract = sessionForExtract?.user?.id
        || (await db.user.findFirst({ where: { email: sessionForExtract?.user?.email ?? '' }, select: { id: true } }))?.id;
      if (userIdForExtract) {
        const draft = await runExtraction({ enterpriseId: id, userId: userIdForExtract, trigger: 'UPLOAD' });
        extractionStatus = draft.status === 'SUCCEEDED' ? 'completed' : draft.status === 'PARTIAL' ? 'partial' : 'failed';
        extractionBlocks = { processed: draft.blocksProcessed, total: draft.blocksTotal };
      } else {
        extractionError = 'usuário não identificado para registrar a execução';
      }
    } catch (err) {
      const nexoErr = err as { code?: string; detail?: string };
      const code = nexoErr?.code ?? 'unknown';
      // CORREÇÃO (2026-09): a causa real (ex.: "DeepSeek 429: ...", "bloco com
      // saída inválida após reparação") ficava só no log do servidor e o toast
      // mostrava texto genérico — impossível diagnosticar. Agora o detalhe
      // sanitizado (140 chars) acompanha a mensagem operacional.
      const shortDetail = typeof nexoErr?.detail === 'string' && nexoErr.detail.trim() !== ''
        ? ` (${nexoErr.detail.trim().slice(0, 140)})`
        : '';
      extractionError = code === 'capability_disabled'
        ? 'Extração revisável desativada por flag.'
        : `Extração falhou${shortDetail} — o rascunho anterior e os dados publicados foram preservados.`;
      console.warn(`[ENTERPRISE KB] Extração v2 não executada para "${enterprise.name}":`, code, nexoErr?.detail ?? err);
      if (code !== 'capability_disabled') {
        logAiUsage({
          capability: 'enterprise_extraction', outcome: 'error',
          scopeId: id, dataHash: documentHash, errorCode: code,
          note: 'pós-upload',
        });
      }
    }

    return NextResponse.json({
      success: true,
      fileName: file.name,
      fileType: ext === '.pdf' ? 'PDF' : ext === '.md' || ext === '.markdown' ? 'Markdown' : 'Texto',
      extractedChars: extractedText.length,
      extractedPreview: extractedText.slice(0, 200) + (extractedText.length > 200 ? '...' : ''),
      extractionStatus,
      extractionBlocks,
      extractionError,
      // Dados preservados — comunicar na resposta para a UI exibir
      preservedData: true,
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

    // ── Remoção da base documental (§11.2): remove APENAS a fonte.
    // Dados verificados/publicados e o legado cachedInfo permanecem —
    // nunca há perda silenciosa de conteúdo publicado.
    await db.enterprise.update({
      where: { id },
      data: { pdfContent: null, documentHash: null },
    });

    logAiUsage({
      capability: 'enterprise_extraction', outcome: 'success',
      scopeId: id, note: 'base documental removida — dados verificados/publicados preservados',
    });

    return NextResponse.json({
      success: true,
      preservedData: true,
      message: 'Base removida. Dados verificados e publicados foram preservados; o Nexo deixa de consultar este documento.',
    });
  } catch (error) {
    console.error('[ENTERPRISE KB] Erro ao remover base de dados:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}