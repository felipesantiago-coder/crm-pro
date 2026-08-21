/**
 * ai-provider.ts — Unified AI Provider Layer
 *
 * Uses DeepSeek V4 Flash as the sole AI provider.
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
}

export interface AIResult {
  reply: string;
  provider: string;
}

// ── Provider Config ─────────────────────────────────────────────────────────

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL = 'deepseek-v4-flash';
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/chat/completions';

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

// ── DeepSeek (OpenAI-compatible) ──────────────────────────────────────────

async function callDeepSeek(
  systemText: string,
  userContent: string | AIMessage[],
  options: AIOptions,
): Promise<AIResult> {
  if (!DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY não configurada');

  const temperature = options.temperature ?? 0.3;
  const maxTokens = options.maxTokens ?? 2048;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxRetries = options.maxRetries ?? (options.retry ? 2 : 1);

  // Build messages array for OpenAI-compatible API
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

  const body: Record<string, unknown> = {
    model: DEEPSEEK_MODEL,
    temperature,
    max_tokens: maxTokens,
    messages,
  };

  const bodyStr = JSON.stringify(body);

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await withTimeout(
        fetch(DEEPSEEK_BASE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          },
          body: bodyStr,
        }),
        timeoutMs,
        'DeepSeek',
      );

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`DeepSeek ${res.status}: ${errText.slice(0, 300)}`);
      }

      const data = await res.json();
      const choice = data.choices?.[0];
      if (!choice?.message?.content) {
        throw new Error('DeepSeek retornou resposta vazia');
      }

      // Log de tokens para monitoramento de custo
      const usage = data.usage;
      if (usage) {
        console.log(`[AI Provider] Tokens — input: ${usage.prompt_tokens ?? '?'} | output: ${usage.completion_tokens ?? '?'} | total: ${usage.total_tokens ?? '?'}`);
      }

      return { reply: choice.message.content, provider: 'DeepSeek-V4-Flash' };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[AI Provider] DeepSeek attempt ${attempt}/${maxRetries} failed:`, lastError.message);
      if (attempt < maxRetries) await sleep(1000 * attempt);
    }
  }
  throw lastError || new Error('DeepSeek falhou');
}

// ── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Call AI using DeepSeek V4 Flash.
 *
 * @param systemPrompt  The system instruction text
 * @param userContent   Either a string (single user message) or AIMessage[] (chat history)
 * @param options       Optional configuration
 * @returns             { reply: string, provider: string }
 * @throws             If DEEPSEEK_API_KEY is not configured or the call fails
 */
export async function callAI(
  systemPrompt: string,
  userContent: string | AIMessage[],
  options: AIOptions = {},
): Promise<AIResult> {
  if (!DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY não configurada. Defina a variável de ambiente no painel da Vercel.');
  }

  return callDeepSeek(systemPrompt, userContent, options);
}

/**
 * Check which providers are configured (useful for UI hints).
 */
export function getConfiguredProviders(): Array<{ name: string; isPrimary: boolean }> {
  if (DEEPSEEK_API_KEY) return [{ name: 'DeepSeek-V4-Flash', isPrimary: true }];
  return [];
}
