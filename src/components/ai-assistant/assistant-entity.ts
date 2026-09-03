/**
 * assistant-entity.ts — serialização de entidade do contexto do Nexo (§8.2).
 *
 * A entidade é serializada como "type:id" apenas como chave estável de
 * deduplicação. A reconstrução do objeto DEVE passar por `entityFromSerialized`
 * — nunca por `JSON.parse(serialized)`, que lança SyntaxError sobre uma
 * string que não é JSON (bug de produção corrigido em 2026-09).
 */
import type { AssistantPageContext } from './assistant.types';

export function serializeEntity(entity: AssistantPageContext['entity']): string {
  return entity?.id !== undefined && entity?.type ? `${entity.type}:${entity.id}` : '';
}

export function entityFromSerialized(serialized: string): AssistantPageContext['entity'] {
  const sep = serialized.indexOf(':');
  if (sep <= 0) return undefined;
  const type = serialized.slice(0, sep);
  if (type !== 'client' && type !== 'enterprise') return undefined;
  const id = serialized.slice(sep + 1);
  return id ? { type, id } : undefined;
}
