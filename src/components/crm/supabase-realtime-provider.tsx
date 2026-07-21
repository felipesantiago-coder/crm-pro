'use client'

import React, { useEffect, useRef, useCallback } from 'react'
import { useCRMStore } from '@/store/crm-store'
import { toast } from 'sonner'
import { Bell, Database } from 'lucide-react'

interface DataSyncProviderProps {
  children: React.ReactNode
}

/**
 * Provider de sincronização de dados via polling.
 * Substitui o Supabase Realtime (WebSocket) que não funcionava por falta de
 * políticas RLS para a chave anon. Mantém os usuários atualizados verificando
 * periodicamente novos clientes e lembretes pendentes.
 *
 * - A cada 30s: busca lembretes pendentes para notificação
 * - A cada 30s: verifica se há clientes novos desde a última checagem
 * - Toasts informativos quando detecta mudanças
 */
export function SupabaseRealtimeProvider({ children }: DataSyncProviderProps) {
  const { setNotificationReminders } = useCRMStore()
  const knownClientIdsRef = useRef<Set<string>>(new Set())
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchNotificationReminders = useCallback(async () => {
    try {
      const res = await fetch('/api/reminders/check')
      if (res.ok) {
        const data = await res.json()
        setNotificationReminders(data || [])
      }
    } catch {
      // silencioso
    }
  }, [setNotificationReminders])

  const checkForNewClients = useCallback(async () => {
    try {
      const res = await fetch('/api/clients/recent')
      if (!res.ok) return

      const recent: Array<{ id: string; name: string; createdAt: string }> = await res.json()

      for (const client of recent) {
        if (!knownClientIdsRef.current.has(client.id)) {
          // Verifica se o cliente foi criado nos últimos 60s (evita toasts de clientes antigos na primeira carga)
          const age = Date.now() - new Date(client.createdAt).getTime()
          if (age < 60_000) {
            toast.success(`Novo cliente: ${client.name}`, {
              icon: <Database className="h-4 w-4 text-emerald-500" />,
              duration: 5000,
            })
          }
        }
      }

      // Atualiza o set de IDs conhecidos
      knownClientIdsRef.current = new Set(recent.map((c) => c.id))
    } catch {
      // silencioso
    }
  }, [])

  useEffect(() => {
    // Carga inicial
    fetchNotificationReminders()
    checkForNewClients()

    // Polling a cada 30 segundos
    intervalRef.current = setInterval(() => {
      fetchNotificationReminders()
      checkForNewClients()
    }, 30_000)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [fetchNotificationReminders, checkForNewClients])

  return <>{children}</>
}