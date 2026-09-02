'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Componentes de marca oficiais CRM Pro v2.0 — "Nexus Relacional".
 *
 * Os ativos são servidos de /brand e alternados entre tema claro e escuro
 * via classes CSS (`.dark .hidden-dark` / `.hidden-light`), sem leitura
 * imperativa do tema antes da hidratação, evitando flash e layout shift
 * (todas as imagens declaram dimensões explícitas).
 */

export type BrandLogoVariant = 'horizontal' | 'horizontal-tagline';

interface BrandLogoProps {
  /** Largura em px. A altura é derivada da proporção oficial do ativo. */
  width?: number;
  /** Escolhe a assinatura com ou sem tagline. */
  variant?: BrandLogoVariant;
  className?: string;
  /** Prioriza carregamento quando o logo está above-the-fold. */
  priority?: boolean;
  /** Texto alternativo. Padrão "CRM Pro" (a marca é semântica). */
  alt?: string;
}

interface BrandSymbolProps {
  /** Tamanho (largura e altura) em px. */
  size?: number;
  className?: string;
  priority?: boolean;
  /**
   * Quando `decorative`, o símbolo recebe alt="" e aria-hidden="true".
   * Padrão: true, pois o símbolo costuma acompanhar um rótulo textual.
   */
  decorative?: boolean;
  alt?: string;
}

const HORIZONTAL_ASPECT = 930 / 240; // 3.875
const HORIZONTAL_TAGLINE_ASPECT = 960 / 280; // 3.4286
const SYMBOL_ASPECT = 1; // 256x256
const WORDMARK_ASPECT = 630 / 170; // 3.7059

/**
 * Assinatura horizontal oficial. Alterna automaticamente entre
 * `logo-horizontal-light.svg` e `logo-horizontal-dark.svg`.
 */
export function BrandLogo({
  width = 152,
  variant = 'horizontal',
  className,
  priority = false,
  alt = 'CRM Pro',
}: BrandLogoProps) {
  const aspect =
    variant === 'horizontal-tagline' ? HORIZONTAL_TAGLINE_ASPECT : HORIZONTAL_ASPECT;
  const height = Math.round(width / aspect);
  const prefix =
    variant === 'horizontal-tagline'
      ? '/brand/logo-horizontal-tagline'
      : '/brand/logo-horizontal';

  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center', className)}
      style={{ width, height }}
      aria-hidden={alt ? undefined : true}
    >
      <img
        src={`${prefix}-light.svg`}
        alt={alt}
        width={width}
        height={height}
        className="hidden-dark block h-auto w-full"
        draggable={false}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
      />
      <img
        src={`${prefix}-dark.svg`}
        alt=""
        aria-hidden="true"
        width={width}
        height={height}
        className="hidden-light block h-auto w-full"
        draggable={false}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
      />
    </span>
  );
}

/**
 * Símbolo oficial "Nexus Relacional" (dois módulos entrelaçados).
 * Use `decorative` (padrão) quando acompanhado de rótulo textual.
 */
export function BrandSymbol({
  size = 32,
  className,
  priority = false,
  decorative = true,
  alt,
}: BrandSymbolProps) {
  const height = Math.round(size / SYMBOL_ASPECT);
  const isDecorative = decorative || !alt;

  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height }}
    >
      <img
        src="/brand/symbol-light.svg"
        alt={isDecorative ? '' : alt || 'CRM Pro'}
        aria-hidden={isDecorative ? true : undefined}
        width={size}
        height={height}
        className="hidden-dark block h-auto w-full"
        draggable={false}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
      />
      <img
        src="/brand/symbol-dark.svg"
        alt=""
        aria-hidden="true"
        width={size}
        height={height}
        className="hidden-light block h-auto w-full"
        draggable={false}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
      />
    </span>
  );
}

/**
 * Wordmark oficial ("CRM Pro" sem símbolo). Texto convertido em curvas
 * no ativo oficial — nunca reproduzir com HTML.
 */
export function BrandWordmark({
  width = 118,
  className,
  priority = false,
  alt = 'CRM Pro',
}: Omit<BrandLogoProps, 'variant'>) {
  const height = Math.round(width / WORDMARK_ASPECT);

  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center', className)}
      style={{ width, height }}
    >
      <img
        src="/brand/wordmark-light.svg"
        alt={alt}
        width={width}
        height={height}
        className="hidden-dark block h-auto w-full"
        draggable={false}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
      />
      <img
        src="/brand/wordmark-dark.svg"
        alt=""
        aria-hidden="true"
        width={width}
        height={height}
        className="hidden-light block h-auto w-full"
        draggable={false}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
      />
    </span>
  );
}
