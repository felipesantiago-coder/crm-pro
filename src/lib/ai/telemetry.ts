/**
 * telemetry.ts — Telemetria de capacidades de IA sem PII de conteúdo
 * (prompt v1.0 §8.1, §17).
 *
 * Dois destinos:
 *  1. console estruturado (funciona em qualquer runtime, incl. serverless);
 *  2. tabela `AiUsageEvent` (fire-and-forget; falha de telemetria NUNCA
 *     quebra a capacidade).
 *
 * Proibido aqui (§16.2/§17): texto integral de documentos/prompts/respostas,
 * telefones, e-mails, nomes de clientes/leads. Somente identificadores
 * técnicos controlados (ids internos, hashes) e métricas.
 */
import { db } from '@/lib/db';

export type AiCapability =
  | 'assistant_chat'
  | 'client_brief'
  | 'enterprise_extraction'
  | 'enterprise_info_publish'
  | 'resale_import';

export type AiOutcome =
  | 'success'
  | 'partial'
  | 'insufficient_data'
  | 'validation_error'
  | 'error'
  | 'cache_hit'
  | 'deduplicated'
  | 'cancelled';

export interface AiUsageEventInput {
  capability: AiCapability;
  outcome: AiOutcome;
  /** id interno do usuário autenticado (identificador técnico controlado). */
  userId?: string;
  /** papel no momento da chamada (ADMIN/USER) — sem PII. */
  userRole?: string;
  /** id da entidade no escopo (cliente/empreendimento), quando aplicável. */
  scopeId?: string;
  /** hash canônico dos dados de entrada (não é conteúdo). */
  dataHash?: string;
  promptVersion?: string;
  modelId?: string;
  latencyMs?: number;
  tokensIn?: number | null;
  tokensOut?: number | null;
  cacheHit?: boolean;
  fallbackUsed?: boolean;
  /** código estável NexoErrorCode quando outcome = error/validation_error. */
  errorCode?: string;
  /** contexto técnico curto, sem conteúdo sensível (ex.: "block 3/6"). */
  note?: string;
}

function logToConsole(ev: AiUsageEventInput): void {
  // Uma linha por evento — greppable no runtime da Vercel.
  console.log(
    `[AI Telemetry] ${JSON.stringify({
      ts: new Date().toISOString(),
      capability: ev.capability,
      outcome: ev.outcome,
      latencyMs: ev.latencyMs ?? null,
      cacheHit: ev.cacheHit ?? false,
      tokensIn: ev.tokensIn ?? null,
      tokensOut: ev.tokensOut ?? null,
      errorCode: ev.errorCode ?? null,
      promptVersion: ev.promptVersion ?? null,
      modelId: ev.modelId ?? null,
      role: ev.userRole ?? null,
      scopeId: ev.scopeId ?? null,
      dataHash: ev.dataHash ? `${ev.dataHash.slice(0, 12)}…` : null,
      note: ev.note ?? null,
    })}`,
  );
}

function logToDatabase(ev: AiUsageEventInput): void {
  // Fire-and-forget: telemetria nunca bloqueia nem derruba a capacidade.
  const timeout = setTimeout(() => clearTimeout(timeout), 5000);
  void db
    .aiUsageEvent
    .create({
      data: {
        capability: ev.capability,
        outcome: ev.outcome,
        userId: ev.userId ?? null,
        userRole: ev.userRole ?? null,
        scopeId: ev.scopeId ?? null,
        dataHash: ev.dataHash ?? null,
        promptVersion: ev.promptVersion ?? null,
        modelId: ev.modelId ?? null,
        latencyMs: ev.latencyMs ?? null,
        tokensIn: ev.tokensIn ?? null,
        tokensOut: ev.tokensOut ?? null,
        cacheHit: ev.cacheHit ?? false,
        fallbackUsed: ev.fallbackUsed ?? false,
        errorCode: ev.errorCode ?? null,
        note: ev.note ?? null,
      },
    })
    .catch((err) => {
      console.warn('[AI Telemetry] Falha ao persistir evento (ignorado):', err instanceof Error ? err.message : err);
    })
    .finally(() => clearTimeout(timeout));
}

export function logAiUsage(ev: AiUsageEventInput): void {
  logToConsole(ev);
  logToDatabase(ev);
}
