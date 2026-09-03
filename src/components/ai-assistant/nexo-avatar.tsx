'use client';

/**
 * NexoAvatar — personagem do assistente com os SVGs oficiais do pacote
 * CRM_Pro_AI_Assistant_Assets_v1.0 (apenas SVG no runtime — prompt §23).
 *
 * Os SVGs animados são autocontidos: trazem @keyframes e o bloqueio de
 * `prefers-reduced-motion: reduce` embutidos, e são carregados via <img>
 * (documento isolado — sem colisão de IDs entre instâncias).
 * O estado `offline` não possui variante animada no pacote — usa estático.
 */
import React from 'react';
import { ASSET_BASE_PATH } from './assistant.constants';
import type { AssistantTheme, AssistantVisualState } from './assistant.types';

export interface NexoAvatarProps {
  state?: AssistantVisualState;
  theme?: AssistantTheme;
  animated?: boolean;
  size?: number;
  /** Decorativo: oculto de leitores de tela (o estado é anunciado em texto). */
  decorative?: boolean;
  /** Rótulo acessível quando `decorative={false}` (prompt §16.2). */
  label?: string;
  className?: string;
}

function assetSrc(
  state: AssistantVisualState,
  theme: AssistantTheme,
  animated: boolean,
): string {
  const hasAnimated = animated && state !== 'offline';
  const folder = hasAnimated ? 'animated' : 'static';
  const suffix = hasAnimated ? '-animado' : '';
  return `${ASSET_BASE_PATH}/${folder}/${theme}/nexo-${state}-${theme}${suffix}.svg`;
}

export function NexoAvatar({
  state = 'idle',
  theme = 'transparente',
  animated = true,
  size = 40,
  decorative = true,
  label,
  className,
}: NexoAvatarProps) {
  return (
    // SVG estático do pacote de marca via <img>: documento isolado (sem
    // colisão de IDs) e animações CSS internas preservadas; next/image não
    // agrega para SVG já dimensionado.
    <img
      src={assetSrc(state, theme, animated)}
      width={size}
      height={size}
      className={className}
      alt={decorative ? '' : (label ?? '')}
      aria-hidden={decorative || undefined}
      draggable={false}
      loading="eager"
      decoding="async"
    />
  );
}
