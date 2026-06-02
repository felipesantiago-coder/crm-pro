'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { createClient, RealtimeChannel } from '@supabase/supabase-js'
import { RealtimePostgresChangesPayload } from '@supabase/supabase-js'

interface UseSupabaseRealtimeOptions {
  table: string
  schema?: string
  filter?: string
  enabled?: boolean
  onInsert?: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void
  onUpdate?: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void
  onDelete?: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void
}

interface UseSupabaseRealtimeReturn {
  connected: boolean
  reconnect: () => void
}

/**
 * Hook para subscrição real-time do Supabase.
 * Escuta mudanças INSERT, UPDATE, DELETE na tabela especificada
 * e invoca os callbacks correspondentes para atualizar a UI.
 */
export function useSupabaseRealtime({
  table,
  schema = 'public',
  filter,
  enabled = true,
  onInsert,
  onUpdate,
  onDelete,
}: UseSupabaseRealtimeOptions): UseSupabaseRealtimeReturn {
  const channelRef = useRef<RealtimeChannel | null>(null)
  const clientRef = useRef<ReturnType<typeof createClient> | null>(null)
  const [connected, setConnected] = useState(false)

  const cleanup = useCallback(() => {
    if (channelRef.current) {
      channelRef.current.unsubscribe()
      channelRef.current = null
    }
  }, [])

  const setupSubscription = useCallback(() => {
    cleanup()

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey || !enabled) {
      return
    }

    // Criar cliente apenas se não existir
    if (!clientRef.current) {
      clientRef.current = createClient(supabaseUrl, supabaseAnonKey, {
        realtime: {
          params: { eventsPerSecond: 10 },
        },
      })
    }

    const channelName = `realtime-${table}-${schema}`

    const channel = clientRef.current
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema,
          table,
          filter: filter || undefined,
        },
        (payload) => {
          switch (payload.eventType) {
            case 'INSERT':
              onInsert?.(payload as RealtimePostgresChangesPayload<Record<string, unknown>>)
              break
            case 'UPDATE':
              onUpdate?.(payload as RealtimePostgresChangesPayload<Record<string, unknown>>)
              break
            case 'DELETE':
              onDelete?.(payload as RealtimePostgresChangesPayload<Record<string, unknown>>)
              break
          }
        }
      )
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED')
      })

    channelRef.current = channel
  }, [table, schema, filter, enabled, onInsert, onUpdate, onDelete, cleanup])

  const reconnect = useCallback(() => {
    setupSubscription()
  }, [setupSubscription])

  useEffect(() => {
    setupSubscription()
    return cleanup
  }, [setupSubscription, cleanup])

  return { connected, reconnect }
}
