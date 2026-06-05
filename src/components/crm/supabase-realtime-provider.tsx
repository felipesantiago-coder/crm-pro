'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createClient, RealtimeChannel } from '@supabase/supabase-js'
import { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { useCRMStore } from '@/store/crm-store'
import { toast } from 'sonner'
import { Bell, Database } from 'lucide-react'

interface SupabaseRealtimeProviderProps {
  children: React.ReactNode
}

function handleRealtimeEvent(
  table: string,
  payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
  setNotificationReminders: (reminders: Array<{ id: string; title: string }>) => void
) {
  const { eventType, new: newData, old: oldData } = payload

  switch (table) {
    case 'clients': {
      if (eventType === 'INSERT') {
        const name = (newData as Record<string, string>)?.name || 'Cliente'
        toast.success(`Novo cliente: ${name}`, {
          icon: <Database className="h-4 w-4 text-emerald-500" />,
        })
      } else if (eventType === 'UPDATE') {
        const name = (newData as Record<string, string>)?.name || 'Cliente'
        toast.info(`Cliente atualizado: ${name}`, {
          icon: <Database className="h-4 w-4 text-blue-500" />,
        })
      } else if (eventType === 'DELETE') {
        const name = (oldData as Record<string, string>)?.name || 'Cliente'
        toast.warning(`Cliente removido: ${name}`)
      }
      break
    }

    case 'reminders': {
      if (eventType === 'INSERT') {
        const title = (newData as Record<string, string>)?.title || 'Lembrete'
        toast.success(`Novo lembrete: ${title}`, {
          icon: <Bell className="h-4 w-4 text-amber-500" />,
        })
      }
      fetchNotificationCount(setNotificationReminders)
      break
    }

    case 'tags': {
      if (eventType === 'INSERT') {
        const name = (newData as Record<string, string>)?.name || 'Tag'
        toast.success(`Nova tag criada: ${name}`)
      } else if (eventType === 'DELETE') {
        const name = (oldData as Record<string, string>)?.name || 'Tag'
        toast.warning(`Tag removida: ${name}`)
      }
      break
    }

    case 'user_settings': {
      if (eventType === 'UPDATE') {
        toast.info('Configurações atualizadas em tempo real')
      }
      break
    }
  }
}

async function fetchNotificationCount(
  setNotificationReminders: (reminders: Array<{ id: string; title: string }>) => void
) {
  try {
    const res = await fetch('/api/reminders/check')
    const data = await res.json()
    setNotificationReminders(data || [])
  } catch {
    // Silencioso
  }
}

/**
 * Provider global que escuta mudanças em tempo real do Supabase
 * em todas as tabelas do CRM (clients, tags, reminders, user_settings).
 * Atualiza automaticamente a UI quando dados são modificados por qualquer
 * dispositivo/sessão conectada ao mesmo Supabase project.
 */
export function SupabaseRealtimeProvider({ children }: SupabaseRealtimeProviderProps) {
  const [connected, setConnected] = useState(false)
  const channelsRef = useRef<RealtimeChannel[]>([])
  const clientRef = useRef<ReturnType<typeof createClient> | null>(null)
  const { setNotificationReminders } = useCRMStore()

  const isSupabaseConfigured = !!(
    typeof window !== 'undefined' &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      realtime: {
        params: { eventsPerSecond: 10 },
      },
    })
    clientRef.current = supabase

    const tables = ['clients', 'tags', 'client_tags', 'reminders', 'user_settings']
    const channels: RealtimeChannel[] = []

    for (const table of tables) {
      const channel = supabase
        .channel(`crm-realtime-${table}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table },
          (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
            handleRealtimeEvent(table, payload, setNotificationReminders)
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            setConnected(true)
          }
        })

      channels.push(channel)
    }

    channelsRef.current = channels

    return () => {
      channels.forEach((ch) => ch.unsubscribe())
      supabase.removeAllChannels()
    }
  }, [isSupabaseConfigured, setNotificationReminders])

  // Se não tem Supabase configurado, renderiza children sem real-time
  if (!isSupabaseConfigured) {
    return <>{children}</>
  }

  return <>{children}</>
}
