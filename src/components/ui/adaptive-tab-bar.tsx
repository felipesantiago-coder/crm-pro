'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'

export interface AdaptiveTabItem {
  value: string
  label: React.ReactNode
  /** Ícone opcional exibido antes do rótulo */
  icon?: React.ReactNode
  /** Contador opcional exibido após o rótulo, ex.: (3) */
  count?: number
}

/** Máximo de itens exibidos inline como abas/filtros; acima disso renderiza dropdown. */
const MAX_INLINE_ITEMS = 4

interface AdaptiveTabBarProps {
  items: AdaptiveTabItem[]
  value: string
  onValueChange: (value: string) => void
  /** Classes aplicadas ao TabsList (modo inline, <=4 itens) */
  className?: string
  /** Classes aplicadas ao SelectTrigger (modo dropdown, >4 itens) */
  triggerClassName?: string
  'aria-label'?: string
}

/**
 * Barra de abas/filtros adaptativa:
 * - <= 4 itens: abas inline (TabsList), comportamento atual;
 * - > 4 itens: menu dropdown (Select) em TODOS os tamanhos de tela,
 *   garantindo que a navegação nunca ultrapasse os limites visíveis
 *   (sem scroll horizontal, sem quebra de linha, sem aperto no desktop).
 *
 * Deve ser usada dentro de <Tabs value onValueChange> quando houver
 * <TabsContent> (o dropdown controla o mesmo estado do Tabs root);
 * fora de um contexto de Tabs, use-a apenas com mais de 4 itens
 * (ramo dropdown não depende de Radix Tabs).
 */
export function AdaptiveTabBar({
  items,
  value,
  onValueChange,
  className,
  triggerClassName,
  'aria-label': ariaLabel,
}: AdaptiveTabBarProps) {
  if (items.length > MAX_INLINE_ITEMS) {
    return (
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger
          className={cn('w-full sm:w-72', triggerClassName)}
          aria-label={ariaLabel}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value} className="text-sm">
              <span className="flex min-w-0 items-center gap-2">
                {item.icon}
                <span className="truncate">{item.label}</span>
                {typeof item.count === 'number' && (
                  <span className="text-xs font-medium text-muted-foreground">
                    ({item.count})
                  </span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  return (
    <TabsList className={cn('w-full sm:w-fit', className)}>
      {items.map((item) => (
        <TabsTrigger key={item.value} value={item.value} className="gap-1.5">
          {item.icon}
          <span className="truncate">{item.label}</span>
        </TabsTrigger>
      ))}
    </TabsList>
  )
}
