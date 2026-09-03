/**
 * errors.ts — Códigos de erro estáveis e mensagens seguras (prompt v1.0 §8.4).
 *
 * O frontend só recebe `code` + mensagem operacional pt-BR. Detalhes do
 * provedor, stack e payloads brutos permanecem no log do servidor.
 */

export type NexoErrorCode =
  | 'timeout'
  | 'provider_unavailable'
  | 'rate_limited'
  | 'invalid_input'
  | 'invalid_output'
  | 'permission_denied'
  | 'insufficient_data'
  | 'document_without_text'
  | 'cancelled'
  | 'partial_failure'
  | 'capability_disabled'
  | 'internal_error';

const SAFE_MESSAGES: Record<NexoErrorCode, string> = {
  timeout: 'A análise demorou mais do que o esperado e foi interrompida. Nada foi alterado — tente novamente.',
  provider_unavailable: 'O serviço de IA está temporariamente indisponível. Nada foi alterado — tente novamente em instantes.',
  rate_limited: 'Limite de uso temporário atingido. Aguarde um momento e tente novamente.',
  invalid_input: 'Não foi possível processar a solicitação com os dados recebidos. Verifique e tente novamente.',
  invalid_output: 'A resposta da análise não passou na validação. A última versão válida foi preservada — tente novamente.',
  permission_denied: 'Você não tem permissão para esta ação.',
  insufficient_data: 'Não há dados suficientes para gerar este resultado. Complete as informações e tente de novo.',
  document_without_text: 'Este documento não tem texto legível (parece digitalizado). Envie um PDF com camada de texto.',
  cancelled: 'A operação foi cancelada. Nada foi alterado.',
  partial_failure: 'A análise terminou parcialmente. O que já foi obtido está disponível, e o restante pode ser reprocessado.',
  capability_disabled: 'Esta função está temporariamente desativada pelo administrador.',
  internal_error: 'Ocorreu um erro inesperado. Nada foi alterado — tente novamente.',
};

export class NexoError extends Error {
  readonly code: NexoErrorCode;
  /** Detalhe técnico apenas para log do servidor — nunca vai ao cliente. */
  readonly detail?: string;
  readonly httpStatus: number;

  constructor(code: NexoErrorCode, detail?: string, httpStatus = 502) {
    super(SAFE_MESSAGES[code]);
    this.name = 'NexoError';
    this.code = code;
    this.detail = detail;
    this.httpStatus = httpStatus;
  }

  toResponse() {
    return {
      status: this.httpStatus,
      body: { error: this.message, code: this.code },
    };
  }
}

/** Mapeia um erro desconhecido (provedor/rede) para um código estável. */
export function classifyProviderError(err: unknown): NexoError {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes('timeout') || lower.includes('abort')) {
    return new NexoError('timeout', msg, 504);
  }
  if (lower.includes('429') || lower.includes('rate')) {
    return new NexoError('rate_limited', msg, 429);
  }
  if (lower.includes('não configurada') || lower.includes('not configured')) {
    return new NexoError('provider_unavailable', msg, 503);
  }
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized')) {
    return new NexoError('provider_unavailable', msg, 503);
  }
  if (lower.includes('402') || lower.includes('insufficient') || lower.includes('quota') || lower.includes('credits') || lower.includes('balance')) {
    return new NexoError('provider_unavailable', msg, 503);
  }
  return new NexoError('internal_error', msg, 502);
}
