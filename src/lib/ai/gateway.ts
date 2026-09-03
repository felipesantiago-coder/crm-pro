/**
 * gateway.ts — Gateway comum das capacidades de IA do Nexo
 * (prompt v1.0 §8).
 *
 * Uma "capacidade" é uma função generativa nomeada (client_brief,
 * enterprise_extraction, …) que:
 *  1. respeita feature flags e kill switch;
 *  2. tem timeout real (AbortController, herdado do ai-provider);
 *  3. tem retry apenas para falhas transitórias (ai-provider);
 *  4. valida a SAÍDA com Zod, com no máximo UMA reparação controlada;
 *  5. tem cache canônico + deduplicação de chamadas concorrentes;
 *  6. tem rate limit por usuário;
 *  7. tem circuit breaker por capacidade;
 *  8. emite telemetria sem conteúdo sensível;
 *  9. normaliza erros para NexoError com código estável.
 *
 * O provedor continua um detalhe interno (DeepSeek via callAI). O transporte
 * é injetável para testes unitários sem rede.
 */
import { randomUUID } from 'crypto';
import type { z } from 'zod';
import { callAI } from '@/lib/ai-provider';
import { computeDataHash, buildCacheKey, cachedRun } from './cache';
import { NexoError, classifyProviderError } from './errors';
import { getFeatureFlags, isAiKillSwitchActive } from './flags';
import { logAiUsage, type AiCapability, type AiOutcome } from './telemetry';

export type AiTransport = (
  systemPrompt: string,
  userContent: string,
  opts: { temperature: number; maxTokens: number; timeoutMs: number },
) => Promise<{ reply: string; modelId: string }>;

const defaultTransport: AiTransport = async (systemPrompt, userContent, opts) => {
  const { reply } = await callAI(systemPrompt, userContent, {
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    timeoutMs: opts.timeoutMs,
    retry: true,
    maxRetries: 2,
  });
  return { reply, modelId: 'deepseek-v4-flash' };
};

// ── Rate limit por usuário (janela deslizante simples em memória) ──────────

interface RateEntry { count: number; windowStart: number }
const rateStore = new Map<string, RateEntry>();
const MAX_RATE_ENTRIES = 1000;

function pruneRateStore() {
  if (rateStore.size <= MAX_RATE_ENTRIES) return;
  const now = Date.now();
  for (const [k, v] of rateStore) {
    if (now - v.windowStart > 60_000) rateStore.delete(k);
  }
}

export function checkUserRateLimit(userId: string, capability: string, maxPerMinute: number): boolean {
  pruneRateStore();
  const key = `${capability}:${userId}`;
  const now = Date.now();
  let entry = rateStore.get(key);
  if (!entry || now - entry.windowStart > 60_000) {
    entry = { count: 0, windowStart: now };
    rateStore.set(key, entry);
  }
  entry.count++;
  return entry.count <= maxPerMinute;
}

// ── Circuit breaker por capacidade ──────────────────────────────────────────

const BREAKER_THRESHOLD = 5;      // falhas consecutivas para abrir
const BREAKER_COOLDOWN_MS = 60_000;

interface BreakerState { consecutiveFailures: number; openedAt: number | null }
const breakers = new Map<AiCapability | string, BreakerState>();

export function isCircuitOpen(capability: string): boolean {
  const b = breakers.get(capability);
  if (!b || b.openedAt === null) return false;
  if (Date.now() - b.openedAt >= BREAKER_COOLDOWN_MS) {
    // Meio-aberto: libera tentativa de recuperação.
    breakers.set(capability, { consecutiveFailures: BREAKER_THRESHOLD - 1, openedAt: null });
    return false;
  }
  return true;
}

function recordSuccess(capability: string): void {
  breakers.set(capability, { consecutiveFailures: 0, openedAt: null });
}

function recordFailure(capability: string): void {
  const b = breakers.get(capability) ?? { consecutiveFailures: 0, openedAt: null };
  b.consecutiveFailures++;
  if (b.consecutiveFailures >= BREAKER_THRESHOLD) b.openedAt = Date.now();
  breakers.set(capability, b);
}

// ── Reparação de saída ──────────────────────────────────────────────────────

function extractJsonLoose(raw: string): string | null {
  let cleaned = raw.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return cleaned.substring(start, end + 1);
}

/**
 * Tenta validar `raw` contra `schema`. Em falha, faz UMA tentativa de
 * reparação (re-solicita ao modelo com o erro resumido) e revalida.
 * Persistir nunca acontece aqui — quem chama decide após validação.
 */
export async function parseWithRepair<T>(
  raw: string,
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ message: string; path: Array<string | number | symbol> }> } } },
  repair: ((repairPrompt: string) => Promise<string>) | null,
): Promise<T> {
  const first = schema.safeParse(safeJsonParse(raw));
  if (first.success) return first.data as T;

  // Reparação determinística local: JSON cercado de texto/markdown.
  const loose = extractJsonLoose(raw);
  if (loose) {
    const second = schema.safeParse(safeJsonParse(loose));
    if (second.success) return second.data as T;
  }

  if (!repair) throw new NexoError('invalid_output', 'saída do modelo não passou na validação (sem reparação configurada)');

  const issuesSummary = first.error.issues
    .slice(0, 8)
    .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
    .join('; ');

  const repairedRaw = await repair(
    `A resposta anterior não passou na validação de schema. Erros: ${issuesSummary}. ` +
    `Reenvie APENAS o JSON corrigido, sem texto antes ou depois, sem markdown. ` +
    `Resposta anterior (entre marcadores): <<<${raw.slice(0, 4000)}>>>`,
  );

  const repaired = schema.safeParse(safeJsonParse(repairedRaw));
  if (repaired.success) return repaired.data as T;

  const repairedLoose = extractJsonLoose(repairedRaw);
  if (repairedLoose) {
    const final = schema.safeParse(safeJsonParse(repairedLoose));
    if (final.success) return final.data as T;
  }

  throw new NexoError('invalid_output', 'saída do modelo falhou na validação mesmo após 1 reparação');
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { __unparseable: text.slice(0, 200) };
  }
}

// ── Entrada principal ───────────────────────────────────────────────────────

export interface RunCapabilityParams<T> {
  capability: AiCapability;
  /** Versão do prompt — altera cache e auditoria. */
  promptVersion: string;
  /** Dados relevantes (normalizados) que compõem o dataHash. */
  relevantData: unknown;
  /** Identificador do escopo (ex.: clientId, enterpriseId:userId). */
  scopeId: string;
  userId: string;
  userRole?: string;
  /** monta o texto de usuário a partir dos dados (sem PII desnecessária). */
  buildUserContent: () => string;
  systemPrompt: string;
  /** Schema Zod estrito da saída — validação no servidor (§8.2). */
  schema: z.ZodType<T>;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  cacheTtlMs?: number;
  /** limite por usuário/minuto para a capacidade. */
  ratePerMinute?: number;
  /** permite invalidar cache explicitamente (ex.: botão "atualizar"). */
  forceRefresh?: boolean;
  transport?: AiTransport;
  /** dados não sufficientes antes de chamar o modelo (economia). */
  insufficientDataReason?: string;
}

export interface RunCapabilityResult<T> {
  result: T;
  cacheHit: boolean;
  deduplicated: boolean;
  dataHash: string;
  modelId: string;
  latencyMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  /** repassado ao transport para registro de uso do provedor. */
  correlationId: string;
}

const MODEL_ID = 'deepseek-v4-flash';

export async function runCapability<T>(params: RunCapabilityParams<T>): Promise<RunCapabilityResult<T>> {
  const {
    capability, promptVersion, relevantData, scopeId, userId, userRole,
    systemPrompt, buildUserContent, schema, transport = defaultTransport,
    temperature = 0.2, maxTokens = 2048, timeoutMs = 30_000,
    cacheTtlMs = 10 * 60_000, ratePerMinute = 10, forceRefresh = false,
    insufficientDataReason,
  } = params;

  const dataHash = computeDataHash(relevantData);
  const startedAt = Date.now();
  const correlationId = randomUUID();

  const emit = (outcome: AiOutcome, extra: Partial<Parameters<typeof logAiUsage>[0]> = {}) =>
    logAiUsage({
      capability, outcome, userId, userRole, scopeId, dataHash,
      promptVersion, modelId: MODEL_ID, latencyMs: Date.now() - startedAt,
      ...extra,
    });

  // 1. Kill switch global / feature flags fora daqui (chamador checa a flag
  //    específica da capacidade; aqui apenas o kill switch global).
  if (isAiKillSwitchActive()) {
    emit('error', { errorCode: 'capability_disabled', note: 'kill switch' });
    throw new NexoError('capability_disabled', 'kill switch ativo', 503);
  }

  // 2. Circuit breaker.
  if (isCircuitOpen(capability)) {
    emit('error', { errorCode: 'provider_unavailable', note: 'circuit breaker aberto' });
    throw new NexoError('provider_unavailable', 'circuit breaker aberto', 503);
  }

  // 3. Dados insuficientes — não chama o modelo (§17: custo consciente).
  if (insufficientDataReason) {
    emit('insufficient_data', { note: insufficientDataReason });
    throw new NexoError('insufficient_data', insufficientDataReason, 422);
  }

  // 4. Rate limit por usuário/capacidade.
  if (!checkUserRateLimit(userId, capability, ratePerMinute)) {
    emit('error', { errorCode: 'rate_limited', note: 'gateway rate limit' });
    throw new NexoError('rate_limited', 'gateway rate limit', 429);
  }

  // 5. Cache canônico + deduplicação. Com `forceRefresh`, a chave recebe um
  //    bucket temporal de 15s: cliques repetidos em "atualizar" coalescem
  //    numa única execução (proteção de custo), sem tocar o cache normal.
  const key = buildCacheKey({ capability, scopeId, dataHash, promptVersion, modelId: MODEL_ID });

  try {
    const { value, cacheHit, deduplicated } = await cachedRun<T>(
      forceRefresh ? `${key}:refresh:${Math.floor(Date.now() / 15_000)}` : key,
      cacheTtlMs,
      (): Promise<T> => {
        const userContent = buildUserContent();
        return transport(systemPrompt, userContent, {
          temperature, maxTokens, timeoutMs,
        }).then(({ reply }) =>
          parseWithRepair<T>(reply, schema, (repairPrompt) =>
            transport(systemPrompt, repairPrompt, { temperature: 0, maxTokens, timeoutMs })
              .then((r) => r.reply),
          ),
        );
      },
    );

    recordSuccess(capability);
    emit(cacheHit ? 'cache_hit' : deduplicated ? 'deduplicated' : 'success');

    return {
      result: value,
      cacheHit,
      deduplicated,
      dataHash,
      modelId: MODEL_ID,
      latencyMs: Date.now() - startedAt,
      tokensIn: null,
      tokensOut: null,
      correlationId,
    };
  } catch (err) {
    const nexoErr = err instanceof NexoError ? err : classifyProviderError(err);
    recordFailure(capability);
    emit('error', { errorCode: nexoErr.code, note: nexoErr.detail?.slice(0, 120) });
    throw nexoErr;
  }
}

/** Chave vista nos últimos 15s (coalescing do force refresh). */
const freshRefreshKeys = new Map<string, number>();
function isCircuitKeyFresh(key: string): boolean {
  const now = Date.now();
  const ts = freshRefreshKeys.get(key);
  freshRefreshKeys.set(key, now);
  if (freshRefreshKeys.size > 500) {
    for (const [k, t] of freshRefreshKeys) if (now - t > 60_000) freshRefreshKeys.delete(k);
  }
  return ts !== undefined && now - ts < 15_000;
}

/** Visível para testes. */
export function __resetGatewayStateForTests(): void {
  rateStore.clear();
  breakers.clear();
  freshRefreshKeys.clear();
}
