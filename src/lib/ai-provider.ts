/**
 * ai-provider.ts — Unified AI Provider Layer
 *
 * Supports two providers with automatic failover:
 *   1. Qwen (DashScope / Alibaba Cloud) — PRIMARY if DASHSCOPE_API_KEY is set
 *   2. Groq — fallback
 *
 * All routes should use callAI() instead of calling providers directly.
 *
 * Usage:
 *   import { callAI } from '@/lib/ai-provider';
 *   const { reply, provider } = await callAI(systemPrompt, userContent, { temperature: 0.3 });
 *
 * For chat with message history:
 *   const { reply, provider } = await callAI(systemPrompt, messages, { temperature: 0.3, isChat: true });
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIOptions {
  /** Temperature (0–1). Default: 0.3 */
  temperature?: number;
  /** Max tokens for completion. Default: 2048 */
  maxTokens?: number;
  /** Enable retry with backoff. Default: false */
  retry?: boolean;
  /** Max retries when retry=true. Default: 2 */
  maxRetries?: number;
  /** Timeout per attempt in ms. Default: 30000 */
  timeoutMs?: number;
  /** If true, `userContent` is treated as AIMessage[] (chat history) */
  isChat?: boolean;
  /** Force a specific provider (skip failover). Useful for testing. */
  forceProvider?: 'qwen' | 'groq';
}

export interface AIResult {
  reply: string;
  provider: string;
}

// ── Provider Config ─────────────────────────────────────────────────────────

const QWEN_API_KEY = process.env.DASHSCOPE_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const QWEN_MODEL = 'qwen3-7b-flash';
const QWEN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const GROQ_CHAT_MODEL = 'llama-3.3-70b-versatile'; // Used for analysis/extraction (better quality)
const GROQ_FAST_MODEL = 'llama-3.1-8b-instant'; // Used for chat assistant (faster)

// ── Helpers ────────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms),
    ),
  ]);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Qwen (DashScope — OpenAI-compatible) ──────────────────────────────────

async function callQwen(
  systemText: string,
  userContent: string | AIMessage[],
  options: AIOptions,
): Promise<AIResult> {
  if (!QWEN_API_KEY) throw new Error('DASHSCOPE_API_KEY não configurada');

  const temperature = options.temperature ?? 0.3;
  const maxTokens = options.maxTokens ?? 2048;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxRetries = options.maxRetries ?? (options.retry ? 2 : 1);

  // Build messages array for OpenAI-compatible API
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemText },
  ];

  if (Array.isArray(userContent)) {
    // Chat history — filter to only user/assistant roles
    for (const m of userContent) {
      messages.push({ role: m.role, content: m.content });
    }
  } else {
    messages.push({ role: 'user', content: userContent });
  }

  // Qwen3 supports thinking mode — enable for complex tasks, disable for simple chat
  // extra_body enables thinking when temperature < 0.6
  const enableThinking = temperature <= 0.2;

  const body: Record<string, unknown> = {
    model: QWEN_MODEL,
    temperature,
    max_tokens: maxTokens,
    messages,
  };

  // Enable thinking for analytical/extraction tasks (low temperature)
  if (enableThinking) {
    body.extra_body = { enable_thinking: true };
  }

  const bodyStr = JSON.stringify(body);

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await withTimeout(
        fetch(QWEN_BASE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${QWEN_API_KEY}`,
          },
          body: bodyStr,
        }),
        timeoutMs,
        'Qwen',
      );

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Qwen ${res.status}: ${errText.slice(0, 300)}`);
      }

      const data = await res.json();

      // DashScope OpenAI-compatible response
      // When thinking is enabled, the response may include reasoning_content
      const choice = data.choices?.[0];
      if (!choice?.message?.content) {
        throw new Error('Qwen retornou resposta vazia');
      }

      return { reply: choice.message.content, provider: 'Qwen3-7B-Flash' };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[AI Provider] Qwen attempt ${attempt}/${maxRetries} failed:`, lastError.message);
      if (attempt < maxRetries) await sleep(1000 * attempt);
    }
  }
  throw lastError || new Error('Qwen falhou');
}

// ── Groq ───────────────────────────────────────────────────────────────────

async function callGroq(
  systemText: string,
  userContent: string | AIMessage[],
  options: AIOptions,
): Promise<AIResult> {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY não configurada');

  const temperature = options.temperature ?? 0.3;
  const maxTokens = options.maxTokens ?? 2048;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxRetries = options.maxRetries ?? (options.retry ? 2 : 1);

  // Choose model based on use case:
  // Higher temperature (chat) → fast model; lower (analysis) → larger model
  const model = temperature >= 0.3 ? GROQ_FAST_MODEL : GROQ_CHAT_MODEL;

  // Build messages array
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemText },
  ];

  if (Array.isArray(userContent)) {
    for (const m of userContent) {
      messages.push({ role: m.role, content: m.content });
    }
  } else {
    messages.push({ role: 'user', content: userContent });
  }

  const url = 'https://api.groq.com/openai/v1/chat/completions';
  const bodyStr = JSON.stringify({ model, temperature, max_tokens: maxTokens, messages });

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await withTimeout(
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GROQ_API_KEY}`,
          },
          body: bodyStr,
        }),
        timeoutMs,
        'Groq',
      );

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Groq ${res.status}: ${errText.slice(0, 300)}`);
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error('Groq retornou resposta vazia');

      return { reply: text, provider: `Groq (${model})` };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[AI Provider] Groq attempt ${attempt}/${maxRetries} failed:`, lastError.message);
      if (attempt < maxRetries) await sleep(1000 * attempt);
    }
  }
  throw lastError || new Error('Groq falhou');
}

// ── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Call AI with automatic failover chain: Qwen → Groq
 *
 * @param systemPrompt  The system instruction text
 * @param userContent   Either a string (single user message) or AIMessage[] (chat history)
 * @param options       Optional configuration
 * @returns             { reply: string, provider: string }
 * @throws             If no provider is available or all fail
 */
export async function callAI(
  systemPrompt: string,
  userContent: string | AIMessage[],
  options: AIOptions = {},
): Promise<AIResult> {
  // Build ordered list of providers to try
  const providers: Array<{ name: string; key: string | undefined; fn: typeof callQwen }> = [];

  if (options.forceProvider) {
    // Force a specific provider (for testing)
    const map: Record<string, { key: string | undefined; fn: typeof callQwen }> = {
      qwen: { key: QWEN_API_KEY, fn: callQwen },
      groq: { key: GROQ_API_KEY, fn: callGroq },
    };
    const forced = map[options.forceProvider];
    if (!forced?.key) {
      throw new Error(`Provider forçado "${options.forceProvider}" não tem API key configurada.`);
    }
    return forced.fn(systemPrompt, userContent, options);
  }

  // Normal failover chain
  if (QWEN_API_KEY) providers.push({ name: 'Qwen', key: QWEN_API_KEY, fn: callQwen });
  if (GROQ_API_KEY) providers.push({ name: 'Groq', key: GROQ_API_KEY, fn: callGroq });

  if (providers.length === 0) {
    throw new Error(
      'Nenhum provedor de IA disponível. Configure DASHSCOPE_API_KEY ou GROQ_API_KEY.',
    );
  }

  let lastError: Error | null = null;

  for (const provider of providers) {
    try {
      const result = await provider.fn(systemPrompt, userContent, options);
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(
        `[AI Provider] ${provider.name} falhou, tentando próximo provedor:`,
        lastError.message,
      );
    }
  }

  throw lastError || new Error('Todos os provedores de IA falharam.');
}

/**
 * Check which providers are configured (useful for UI hints).
 */
export function getConfiguredProviders(): Array<{ name: string; isPrimary: boolean }> {
  const list: Array<{ name: string; isPrimary: boolean }> = [];
  if (QWEN_API_KEY) list.push({ name: 'Qwen3-7B-Flash', isPrimary: true });
  if (GROQ_API_KEY) list.push({ name: 'Groq', isPrimary: !QWEN_API_KEY });
  return list;
}
