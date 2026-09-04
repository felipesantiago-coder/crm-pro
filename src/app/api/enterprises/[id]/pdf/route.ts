import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { isAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { runExtraction, computeDocumentHash, EXTRACTION_REQUEST_BUDGET_MS } from '@/lib/ai/extraction';
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
//
// CORREÇÃO 2 (2026-09, 504 FUNCTION_INVOCATION_TIMEOUT): com maxDuration 60 o
// ciclo completo (sessão + upload + ~10 queries Supabase + 45–48 s de IA +
// writes de finalize) cruzava o limite quando o provedor respondia devagar —
// a function era morta SEM corpo JSON. Agora: maxDuration 120 com prazo de
// request de 100 s capturado no topo do handler (EXTRACTION_REQUEST_BUDGET_MS)
// e repassado a runExtraction — a resposta JSON é garantida mesmo no pior caso.
export const maxDuration = 120;

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
  // Prazo de parede da REQUEST INTEIRA — capturado antes de qualquer await
  // (sessão/DB/upload ficam fora de qualquer orçamento interno).
  const requestDeadlineAt = Date.now() + EXTRACTION_REQUEST_BUDGET_MS;
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

    // ── Fase 3 (P0 da auditoria) + rev. Task 41 (§12-v2): o upload NÃO apaga
    // dados quando há SUBSTITUIÇÃO de base (pdfContent existente) — verified/
    // published/cached permanecem exibíveis até a nova aprovação (continuidade).
    // PORÉM, quando o upload INTRODUZ uma base onde não havia nenhuma, qualquer
    // cadeia remanescente (verifiedInfo/publishedInfo/cachedInfo/cachedInfoI18n/
    // rascunho) é ÓRFÃ — derivada de uma base removida, já oculta ao público
    // pelo gate §12-v2. Mantê-la faria o painel e o público exibirem dados
    // ANTIGOS como se fossem da nova base assim que o gate abrisse — exatamente
    // o sintoma "as informações não mudam com uma nova extração". Reset antes
    // de gravar o novo documento: a nova base começa com estado limpo.
    const documentHash = await computeDocumentHash(extractedText);
    const hadNoBase = !enterprise.pdfContent;
    await db.enterprise.update({
      where: { id },
      data: {
        pdfContent: extractedText,
        documentHash,
        ...(hadNoBase
          ? {
              extractionDraft: Prisma.DbNull,
              extractionDraftAt: null,
              verifiedInfo: Prisma.DbNull,
              verifiedInfoAt: null,
              verifiedInfoBy: null,
              publishedInfo: Prisma.DbNull,
              publishedAt: null,
              cachedInfo: Prisma.DbNull,
              cachedInfoI18n: Prisma.DbNull,
            }
          : {}),
      },
    });

    // Extração v2 → apenas rascunho revisável (nunca publica). O upload
    // NÃO depende da IA estar disponível — falha de extração não falha o upload.
    // CORREÇÃO (2026-09): reusa a sessão já obtida (o 2º getServerSession
    // custava outra ida ao banco dentro do ciclo crítico).
    let extractionStatus: 'completed' | 'partial' | 'failed' | 'disabled' = 'failed';
    let extractionError: string | null = null;
    let extractionBlocks: { processed: number; total: number } | null = null;
    try {
      const userIdForExtract = session?.user?.id
        || (await db.user.findFirst({ where: { email: session?.user?.email ?? '' }, select: { id: true } }))?.id;
      if (userIdForExtract) {
        const draft = await runExtraction({
          enterpriseId: id,
          userId: userIdForExtract,
          trigger: 'UPLOAD',
          deadlineAt: requestDeadlineAt,
        });
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
      // Dados preservados? (substituição mantém a cadeia; primeira base com
      // cadeia órfã reseta — comunicar na resposta para a UI exibir)
      preservedData: !hadNoBase,
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

    // ── Remoção da base documental (§11.2 + §12-v2 rev. Task 41): a base é a
    // ÚNICA fonte da verdade — removida a fonte, removem-se TODOS os derivados:
    // rascunho, verificado, publicado, o espelho legado (cachedInfo) e as
    // traduções da ficha (cachedInfoI18n). Antes os campos verificado/
    // publicado permaneciam no banco "para recoverabilidade" — mas eles
    // continuavam sendo EXIBIDOS no painel do admin (detalhe do empreendimento
    // lê verifiedInfo ?? cachedInfo), mascarando o estado real e impedindo a
    // sincronização percebida entre a área administrativa e a seção
    // empreendimentos. Com o reset total, "remover base" = a seção pública E o
    // painel deixam de exibir informações até nova extração + aprovação.
    //
    // Preservado: histórico de versões (EnterpriseInfoVersion — auditoria
    // append-only; a RESTAURAÇÃO continua bloqueada sem base documental) e o
    // contador publishedVersion (evita colisão de unique com versões antigas).
    // Galeria/imagens/landingTitle etc. são curados à mão — não derivados da
    // base — e permanecem.
    await db.enterprise.update({
      where: { id },
      data: {
        pdfContent: null,
        documentHash: null,
        extractionDraft: Prisma.DbNull,
        extractionDraftAt: null,
        verifiedInfo: Prisma.DbNull,
        verifiedInfoAt: null,
        verifiedInfoBy: null,
        publishedInfo: Prisma.DbNull,
        publishedAt: null,
        cachedInfo: Prisma.DbNull,
        cachedInfoI18n: Prisma.DbNull,
      },
    });

    logAiUsage({
      capability: 'enterprise_extraction', outcome: 'success',
      scopeId: id, note: 'base documental removida — cadeia completa resetada (rascunho/verificado/publicado/cached/i18n); §12-v2',
    });

    return NextResponse.json({
      success: true,
      preservedData: false,
      message: 'Base removida. Todas as informações extraídas (rascunho, verificadas e publicadas) foram apagadas — a seção pública e o painel deixam de exibi-las até que uma nova base seja enviada, extraída e aprovada.',
    });
  } catch (error) {
    console.error('[ENTERPRISE KB] Erro ao remover base de dados:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}