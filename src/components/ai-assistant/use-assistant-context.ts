'use client';

/**
 * use-assistant-context.ts — Bridges de view (prompt v2.0 §8.2).
 *
 * Cada view registra apenas enum, IDs, filtros estruturados e contagens não
 * sensíveis. O hook:
 *  - publica o contexto no mount e a cada mudança relevante;
 *  - limpa no unmount SOMENTE o que a view registrou (não apaga fixação);
 *  - nunca publica texto livre de busca ou conteúdo de formulário em edição.
 *
 * Modos:
 *  - 'view'  (padrão): publica o contexto completo da tela; no unmount,
 *            reseta para a base. Um único registro 'view' por tela.
 *  - 'entity': publica apenas entity/subview (ficha do cliente, empreendimento
 *            selecionado) por cima do contexto da view; no unmount, limpa
 *            somente a entidade/subview que registrou.
 */
import { useEffect, useRef } from 'react';
import { useAssistantContextStore } from './assistant-context-store';
import type { AssistantPageContext } from './assistant.types';

export interface UseRegisterAssistantContextOptions {
  /** View principal — obrigatória e estável por view. */
  view: AssistantPageContext['view'];
  /** Sub-view opcional (kanban, analytics, ficha…). */
  subview?: AssistantPageContext['subview'];
  /** Entidade carregada e autorizada (ficha do cliente, empreendimento). */
  entity?: AssistantPageContext['entity'];
  /** Filtros estruturados ativos (não sensíveis). */
  filters?: AssistantPageContext['filters'];
  /** Contagens não sensíveis usadas apenas para ordenar sugestões. */
  signals?: AssistantPageContext['signals'];
  /**
   * Desliga a publicação (ex.: formulário de criação em edição aberto).
   * Enquanto true, nenhum dado novo é publicado.
   */
  disabled?: boolean;
  /** 'view' (padrão) publica contexto completo; 'entity' só entidade/subview. */
  mode?: 'view' | 'entity';
}

export function useRegisterAssistantContext(options: UseRegisterAssistantContextOptions): void {
  const { view, subview, entity, filters, signals, disabled, mode = 'view' } = options;

  // Serialização estável — evita republicar a cada render.
  const serialized =
    entity?.id !== undefined
      ? `${entity?.type}:${entity?.id}`
      : '';
  const filtersKey = JSON.stringify(filters ?? {});
  const signalsKey = JSON.stringify(signals ?? {});
  const subviewKey = subview ?? '';

  const lastPublishedRef = useRef<string>('');
  const didPublishRef = useRef(false);

  useEffect(() => {
    const store = useAssistantContextStore.getState();
    if (disabled) return;

    if (mode === 'entity') {
      // Patch restrito: não derruba os filtros/sinais da view hospedeira.
      const patch: Partial<AssistantPageContext> = {
        ...(subviewKey ? { subview: (subviewKey as AssistantPageContext['subview']) } : {}),
        ...(serialized ? { entity: JSON.parse(serialized) as AssistantPageContext['entity'] } : { entity: undefined }),
      };
      const key = `entity:${subviewKey}:${serialized}`;
      if (key !== lastPublishedRef.current) {
        lastPublishedRef.current = key;
        didPublishRef.current = true;
        store.patchPageContext(patch);
      }
      return;
    }

    const context: AssistantPageContext = {
      version: 1,
      view,
      ...(subviewKey ? { subview: (subviewKey as AssistantPageContext['subview']) } : {}),
      ...(serialized ? { entity: JSON.parse(serialized) as AssistantPageContext['entity'] } : {}),
      ...(filtersKey !== '{}' ? { filters: JSON.parse(filtersKey) as AssistantPageContext['filters'] } : {}),
      ...(signalsKey !== '{}' ? { signals: JSON.parse(signalsKey) as AssistantPageContext['signals'] } : {}),
    };

    const key = JSON.stringify(context);
    if (key !== lastPublishedRef.current) {
      lastPublishedRef.current = key;
      didPublishRef.current = true;
      store.setPageContext(context);
    }
  }, [view, subviewKey, serialized, filtersKey, signalsKey, disabled, mode]);

  // Unmount: limpa apenas o que esta view registrou; fixação do usuário permanece.
  useEffect(() => {
    return () => {
      if (!didPublishRef.current) return;
      const store = useAssistantContextStore.getState();
      if (mode === 'entity') {
        // Remove somente a entidade/subview desta bridge — a tela hospedeira continua.
        store.patchPageContext({ entity: undefined, subview: undefined });
      } else if (store.pinnedContext) {
        // Contexto fixado: mantém a entidade, reseta o resto para a view base.
        store.patchPageContext({ view: 'dashboard', subview: undefined, filters: undefined, signals: undefined });
      } else {
        store.setPageContext({ version: 1, view: 'dashboard' });
      }
      lastPublishedRef.current = '';
      didPublishRef.current = false;
    };
    // mode é estático por uso do hook.
  }, [mode]);
}
