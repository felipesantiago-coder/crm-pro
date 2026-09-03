/**
 * Constantes do Nexo — Assistente de IA do CRM Pro.
 * Valores espelham o backend (src/app/api/ai-assistant/route.ts) e os
 * tokens oficiais do pacote de assets v1.0 (06_Tokens).
 */

/** Base dos assets SVG oficiais (apenas SVG vai para o runtime — prompt §23). */
export const ASSET_BASE_PATH = '/brand/assistant';

/** Limite do backend para a última mensagem do usuário (sanitizeUserInput). */
export const MAX_INPUT_CHARS = 800;

/** A partir daqui o contador de caracteres fica visível (prompt §15). */
export const CHAR_COUNTER_THRESHOLD = 720;

/** Histórico enviado ao backend — mesmo corte do backend (slice(-10)). */
export const HISTORY_LIMIT = 10;

/** Duração do ciclo "speaking" (prompt §7: 700–1.200 ms). */
export const SPEAKING_DURATION_MS = 900;

/** Duração do ciclo "success" (prompt §7). */
export const SUCCESS_DURATION_MS = 1200;

/**
 * Inatividade máxima no estado "listening" antes de voltar a "idle"
 * (prompt §7: sem timers agressivos; curto e resetado a cada interação).
 */
export const LISTENING_IDLE_TIMEOUT_MS = 8000;

/** Chave de sessão do rótulo de descoberta do launcher (prompt §10.2). */
export const DISCOVERY_DISMISSED_KEY = 'nexo:discovery-dismissed';

/**
 * Textura do meio-caractere usado como placeholder interno no
 * renderizador de Markdown (Private Use Area — não colide com conteúdo).
 */
export const MD_PLACEHOLDER_START = '\uE000';
export const MD_PLACEHOLDER_END = '\uE001';
