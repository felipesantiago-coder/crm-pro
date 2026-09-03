/**
 * extraction.ts — Pipeline de extração revisável de empreendimentos
 * (prompt v1.0 §10 — prioridade máxima: integridade de dados e comunicação
 * pública).
 *
 * Garantias implementadas:
 *  - FALHA NUNCA SOBRESCREVE: erros não tocam draft anterior, verifiedInfo,
 *    publishedInfo nem cachedInfo. Cada tentativa é uma run auditável.
 *  - Cobertura por blocos com ranking por relevância (fim do corte em 30k).
 *  - Deduplicação por hash + run auditável com promptVersion/modelId.
 *
 * A lógica PURA (chunking, ranking, consolidação, decisões) vive em
 * extraction-core.ts e é reexportada aqui.
 */
import { db } from '@/lib/db';
import { callAI } from '@/lib/ai-provider';
import { blockExtractionSchema, type ExtractionCandidate } from './contracts';
import { NexoError } from './errors';
import { getFeatureFlags } from './flags';
import { logAiUsage } from './telemetry';
import {
  EXTRACTION_SYSTEM_PROMPT,
  MAX_BLOCKS_PER_RUN,
  BLOCK_TIMEOUT_MS,
  MIN_SLICE_MS,
  attemptPlan,
  chunkDocument,
  rankBlocks,
  consolidateBlocks,
  buildInfoFromDecisions,
  sanitizeEnterpriseInfo,
  emptyEnterpriseInfo,
  computeDocumentHash,
  buildConflictNote,
  buildBlockUserPrompt,
  normalizeBlockOutput,
  repairTruncatedJson,
} from './extraction-core';
import type { DocumentBlock, ExtractionDraft, BlockExtraction } from './extraction-core';

export {
  EXTRACTION_SYSTEM_PROMPT,
  MAX_BLOCKS_PER_RUN,
  chunkDocument,
  rankBlocks,
  consolidateBlocks,
  buildInfoFromDecisions,
  sanitizeEnterpriseInfo,
  emptyEnterpriseInfo,
  computeDocumentHash,
  buildConflictNote,
  criticalsPendingDecision,
  valuesDiffer,
} from './extraction-core';
export type {
  DocumentBlock,
  ExtractionDraft,
  BlockExtraction,
} from './extraction-core';

// ── Pipeline principal ──────────────────────────────────────────────────────

export const EXTRACTION_PROMPT_VERSION = 'ext-v2-2026-09-04b';
const MODEL_ID = 'deepseek-v4-flash';

/**
 * CORREÇÃO DE PRODUÇÃO (2026-09): o pipeline sequencial (6 blocos × 45 s de
 * timeout × retentativas) podia ultrapassar o maxDuration da function na
 * Vercel — a function era morta e o cliente via 502 sem corpo, com a run
 * presa em RUNNING. Agora o processamento tem orçamento de parede
 * (wall-clock): ao esgotar, o que já foi extraído é persistido como rascunho
 * PARCIAL (falha nunca sobrescreve; partial_data avisado na revisão).
 */
const EXTRACTION_WALL_BUDGET_MS = Number(process.env.NEXO_EXTRACTION_WALL_BUDGET_MS ?? 48_000);

/**
 * CORREÇÃO DE PRODUÇÃO (2026-09, 504 FUNCTION_INVOCATION_TIMEOUT no upload):
 * o orçamento de 48 s cobria APENAS o loop de blocos — sessão, upload, as
 * ~10 queries Prisma (Supabase) e os writes de finalize ficavam SEM teto e
 * somaram o resto até o maxDuration 60 da function → kill sem corpo JSON.
 * Agora cada rota captura este prazo no PRIMEIRO linha do handler e o repassa
 * a runExtraction (deadlineAt) — o ciclo completo fica dentro do maxDuration
 * 120, e a resposta JSON é garantida mesmo no pior caso.
 */
export const EXTRACTION_REQUEST_BUDGET_MS = Number(
  process.env.NEXO_EXTRACTION_REQUEST_BUDGET_MS ?? 100_000,
);
/**
 * CORREÇÃO (2026-09): 3000 tokens truncava o JSON de blocos densos (12
 * tipologias com descrições + 10 diferenciais) — finish_reason=length,
 * parse falhava e o reparo também era truncado. 8000 cobre também modelos
 * com raciocínio que consomem tokens antes do conteúdo útil.
 */
const BLOCK_MAX_TOKENS = 8000;

/**
 * Executa a extração e grava SEMPRE apenas no draft + run. Nunca toca
 * verifiedInfo, publishedInfo ou cachedInfo (§10.1/§10.5).
 */
export async function runExtraction(params: {
  enterpriseId: string;
  userId: string;
  trigger: 'UPLOAD' | 'MANUAL' | 'REPROCESS';
  force?: boolean;
  /**
   * Prazo absoluto de parede (epoch ms) capturado no início da request.
   * Quando ausente (chamadores antigos), cai no orçamento default de 48 s
   * a partir de agora — apenas o loop de blocos fica coberto.
   */
  deadlineAt?: number;
}): Promise<ExtractionDraft> {
  const { enterpriseId, userId, trigger, force = false } = params;
  const flags = getFeatureFlags();
  if (!flags.extractionV2) {
    throw new NexoError('capability_disabled', 'extractionV2 flag off', 503);
  }

  const enterprise = await db.enterprise.findUnique({
    where: { id: enterpriseId },
    select: { id: true, name: true, region: true, pdfContent: true, documentHash: true },
  });
  if (!enterprise) throw new NexoError('invalid_input', 'empreendimento não encontrado', 404);

  const content = enterprise.pdfContent ?? '';
  if (content.trim().length < 20) {
    await logAiUsage({
      capability: 'enterprise_extraction', outcome: 'insufficient_data',
      userId, scopeId: enterpriseId, note: 'documento sem texto legível',
    });
    throw new NexoError('document_without_text', 'pdfContent vazio ou ilegível', 422);
  }

  const documentHash = await computeDocumentHash(content);

  // Deduplicação por hash — mesmo documento/prompt/modelo não reprocessa.
  const lastRun = await db.enterpriseExtractionRun.findFirst({
    where: { enterpriseId, documentHash, promptVersion: EXTRACTION_PROMPT_VERSION, modelId: MODEL_ID, status: { in: ['SUCCEEDED', 'PARTIAL'] } },
    orderBy: { startedAt: 'desc' },
    select: { id: true, status: true },
  });
  if (lastRun && !force) {
    const existing = await db.enterprise.findUnique({
      where: { id: enterpriseId },
      select: { extractionDraft: true },
    });
    if (existing?.extractionDraft) {
      return existing.extractionDraft as unknown as ExtractionDraft;
    }
  }

  const allBlocks = chunkDocument(content);
  const ranked = rankBlocks(allBlocks);
  const selected = ranked.slice(0, MAX_BLOCKS_PER_RUN);
  const blocksTotal = allBlocks.length;

  // Runs presas em RUNNING de execuções anteriores (function morta por
  // timeout/OOM) são encerradas como FAILED para não poluir a auditoria.
  await db.enterpriseExtractionRun.updateMany({
    where: { enterpriseId, status: 'RUNNING', startedAt: { lt: new Date(Date.now() - 15 * 60_000) } },
    data: { status: 'FAILED', error: 'run interrompida (function encerrada antes de completar)', completedAt: new Date() },
  });

  const run = await db.enterpriseExtractionRun.create({
    data: {
      enterpriseId,
      documentHash,
      status: 'RUNNING',
      trigger,
      startedById: userId,
      promptVersion: EXTRACTION_PROMPT_VERSION,
      modelId: MODEL_ID,
      blocksTotal,
      previousRunId: lastRun?.id ?? null,
    },
  });

  try {
    // Prazo externo (topo da request) tem prioridade — cobre TAMBÉM o
    // overhead de DB/upload, não só o loop de blocos.
    const deadlineAt = params.deadlineAt ?? Date.now() + EXTRACTION_WALL_BUDGET_MS;
    const { results, stoppedByBudget } = await processBlocksSequentially(selected, {
      enterpriseName: enterprise.name,
      region: enterprise.region,
    }, deadlineAt);

    const okBlocks = results.filter((r) => r.block).map((r) => r.block!);
    const okMeta = results.filter((r) => r.block).map((r) => selected[r.originalIndex]);

    if (okBlocks.length === 0) {
      const errMsg = results[0]?.error ?? 'todos os blocos falharam';
      // Diagnóstico: cada falha de bloco vai ao log do servidor (Vercel)
      results.forEach((r, i) => {
        if (r.error) console.error(`[Extraction v2] bloco ${i + 1}/${selected.length} falhou: ${r.error}`);
      });
      await db.enterpriseExtractionRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', error: errMsg.slice(0, 200), completedAt: new Date() },
      });
      await logAiUsage({
        capability: 'enterprise_extraction', outcome: 'error', userId,
        scopeId: enterpriseId, dataHash: documentHash, promptVersion: EXTRACTION_PROMPT_VERSION,
        modelId: MODEL_ID, errorCode: 'invalid_output', note: 'nenhum bloco processado',
      });
      // Detalhe da 1ª falha vai no NexoError.detail — aparece no log, no toast
      // do upload e no corpo da resposta do extract-info (rota admin).
      throw new NexoError('invalid_output', `nenhum bloco pôde ser processado — ${errMsg}`.slice(0, 300), 502);
    }

    const { fields, needsReview } = consolidateBlocks(okBlocks, okMeta, enterprise.region);
    const limitations: string[] = [];
    if (stoppedByBudget) {
      limitations.push(`Análise interrompida por limite de tempo após ${okBlocks.length} de ${blocksTotal} blocos. O rascunho parcial já está disponível para revisão; use "Reprocessar" para tentar os blocos restantes.`);
    } else if (okBlocks.length < blocksTotal) {
      limitations.push(`Documento longo: ${okBlocks.length} de ${blocksTotal} blocos analisados nesta passada. Use "Reprocessar" para nova tentativa com os blocos restantes.`);
    }

    const status: ExtractionDraft['status'] = okBlocks.length < blocksTotal ? 'PARTIAL' : 'SUCCEEDED';

    const draft: ExtractionDraft = {
      runId: run.id,
      documentHash,
      generatedAt: new Date().toISOString(),
      status,
      blocksTotal,
      blocksProcessed: okBlocks.length,
      needsReview,
      promptVersion: EXTRACTION_PROMPT_VERSION,
      modelId: MODEL_ID,
      fields,
      limitations,
    };

    await db.$transaction([
      db.enterprise.update({
        where: { id: enterpriseId },
        data: {
          documentHash,
          extractionDraft: draft as unknown as object,
          extractionDraftAt: new Date(),
        },
      }),
      db.enterpriseExtractionRun.update({
        where: { id: run.id },
        data: { status, blocksProcessed: okBlocks.length, completedAt: new Date() },
      }),
    ]);

    await logAiUsage({
      capability: 'enterprise_extraction', outcome: status === 'SUCCEEDED' ? 'success' : 'partial',
      userId, scopeId: enterpriseId, dataHash: documentHash,
      promptVersion: EXTRACTION_PROMPT_VERSION, modelId: MODEL_ID,
      note: `blocos ${okBlocks.length}/${blocksTotal}${needsReview ? ' · revisão necessária' : ''}`,
    });

    return draft;
  } catch (err) {
    const code = err instanceof NexoError ? err.code : 'internal_error';
    await db.enterpriseExtractionRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', error: String(err instanceof Error ? err.message : err).slice(0, 200), completedAt: new Date() },
    }).catch(() => undefined);
    if (!(err instanceof NexoError)) {
      await logAiUsage({
        capability: 'enterprise_extraction', outcome: 'error', userId,
        scopeId: enterpriseId, dataHash: documentHash, errorCode: code,
        promptVersion: EXTRACTION_PROMPT_VERSION, modelId: MODEL_ID,
      });
    }
    throw err;
  }
}

async function processBlocksSequentially(
  blocks: DocumentBlock[],
  ctx: { enterpriseName: string; region: string | null },
  deadlineAt: number,
): Promise<{
  results: Array<{ originalIndex: number; block: BlockExtraction | null; error: string | null }>;
  stoppedByBudget: boolean;
}> {
  const results: Array<{ originalIndex: number; block: BlockExtraction | null; error: string | null }> = [];
  let stoppedByBudget = false;
  for (const [i, block] of blocks.entries()) {
    // Orçamento de parede: sem tempo útil para mais um bloco, encerra
    // graciosamente — o chamador persiste o rascunho parcial.
    if (deadlineAt - Date.now() < MIN_SLICE_MS) {
      stoppedByBudget = true;
      break;
    }
    const remainingMs = () => deadlineAt - Date.now();
    // Plano consciente do orçamento: retries só quando cabe 2× timeout + backoff
    const plan = attemptPlan(remainingMs());
    try {
      const { reply } = await callAI(EXTRACTION_SYSTEM_PROMPT, buildBlockUserPrompt({ ...ctx, block }), {
        temperature: 0.1,
        maxTokens: BLOCK_MAX_TOKENS,
        timeoutMs: plan.timeoutMs,
        retry: true,
        maxRetries: plan.retries,
      });
      const parsed = blockExtractionSchema.safeParse(normalizeBlockOutput(safeParseJson(reply)));
      if (parsed.success) {
        results.push({ originalIndex: i, block: parsed.data, error: null });
      } else if (remainingMs() >= MIN_SLICE_MS) {
        // Reparação única controlada (§8.2), também dentro do orçamento
        const retry = await callAI(
          EXTRACTION_SYSTEM_PROMPT,
          `${buildBlockUserPrompt({ ...ctx, block })}\n\nATENÇÃO: sua resposta anterior não era JSON válido. Devolva APENAS JSON válido.`,
          { temperature: 0, maxTokens: BLOCK_MAX_TOKENS, timeoutMs: Math.min(BLOCK_TIMEOUT_MS, remainingMs()), retry: false, maxRetries: 1 },
        );
        const parsedRetry = blockExtractionSchema.safeParse(normalizeBlockOutput(safeParseJson(retry.reply)));
        results.push({
          originalIndex: i,
          block: parsedRetry.success ? parsedRetry.data : null,
          error: parsedRetry.success ? null : 'bloco com saída inválida após reparação',
        });
      } else {
        results.push({ originalIndex: i, block: null, error: 'bloco com saída inválida (sem tempo para reparação)' });
        stoppedByBudget = true;
        break;
      }
    } catch (err) {
      results.push({ originalIndex: i, block: null, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { results, stoppedByBudget };
}

function safeParseJson(text: string): unknown {
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) cleaned = cleaned.substring(start, end + 1);
  try {
    return JSON.parse(cleaned);
  } catch {
    // CORREÇÃO (2026-09): JSON truncado (finish_reason=length) é fechado
    // conservadoramente; lixo irrecuperável vira null — o bloco conta como
    // falha e segue para reparação (nunca vira bloco "válido vazio").
    return repairTruncatedJson(cleaned);
  }
}

/** Lê o draft persistido com validação mínima de forma. */
export function parseDraft(raw: unknown): ExtractionDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<ExtractionDraft>;
  if (!Array.isArray(d.fields) || typeof d.runId !== 'string') return null;
  return d as ExtractionDraft;
}
