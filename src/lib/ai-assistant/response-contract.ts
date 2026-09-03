/**
 * response-contract.ts — Contrato de resposta v2 do Nexo (prompt v2.0 §19).
 *
 * O modelo fornece apenas `reply`. Intent, contextUsed, sugestões e ações
 * são construídos/validados por lógica determinística no servidor.
 * Retrocompatível: clientes antigos que leem só `reply` continuam funcionando.
 */

export interface AssistantSuggestedReply {
  id: string;
  label: string;
  prompt: string;
}

export type AssistantResponseV2 = {
  version: 2;
  reply: string;
  intent: string;
  contextUsed?: {
    view: string;
    entityType?: 'client' | 'enterprise';
    label: string;
    resolvedAt: string;
  };
  suggestedReplies: AssistantSuggestedReply[];
  navigationActions: Array<Record<string, unknown>>;
  warnings?: Array<'partial_data' | 'stale_context'>;
};

export function buildResponseV2(params: {
  reply: string;
  intent: string;
  contextUsed?: AssistantResponseV2['contextUsed'];
  suggestedReplies: AssistantSuggestedReply[];
  navigationActions: Array<Record<string, unknown>>;
  warnings?: AssistantResponseV2['warnings'];
}): AssistantResponseV2 {
  return {
    version: 2,
    reply: params.reply,
    intent: params.intent,
    ...(params.contextUsed ? { contextUsed: params.contextUsed } : {}),
    suggestedReplies: params.suggestedReplies,
    navigationActions: params.navigationActions,
    ...(params.warnings && params.warnings.length > 0 ? { warnings: params.warnings } : {}),
  };
}
