'use client';

/**
 * SocketioRealtimeProvider — substituto drop-in para SupabaseRealtimeProvider.
 *
 * Comportamento IDÊNTICO ao Supabase Realtime atual:
 * - Escuta mudanças nas mesmas 5 tabelas (clients, tags, client_tags, reminders, user_settings)
 * - Mostra toasts via sonner
 * - Atualiza contagem de notificações (reminders)
 *
 * Para ativar:
 *   1. Defina NEXT_PUBLIC_SOCKET_URL no Vercel
 *   2. Troque <SupabaseRealtimeProvider> por <SocketioRealtimeProvider> em src/app/page.tsx
 *   3. Adicione realtimeEmit() nas API routes (veja docs)
 *
 * Para desativar:
 *   1. Remova NEXT_PUBLIC_SOCKET_URL
 *   2. Volte ao SupabaseRealtimeProvider
 */

import React, { useCallback } from 'react';
import { useSocketRealtime } from '@/hooks/use-socket-realtime';
import { useCRMStore } from '@/store/crm-store';
import { toast } from 'sonner';
import { Bell, Database } from 'lucide-react';
import { type RealtimeEvent } from '@/lib/realtime/realtime-types';

interface SocketioRealtimeProviderProps {
  children: React.ReactNode;
}

/**
 * Busca contagem de notificações (lemmbretes pendentes).
 * Mesma lógica do SupabaseRealtimeProvider original.
 */
async function fetchNotificationCount(
  setNotificationReminders: (reminders: Array<Record<string, unknown>>) => void
) {
  try {
    const res = await fetch('/api/reminders/check');
    const data = await res.json();
    setNotificationReminders(data || []);
  } catch {
    // Silencioso
  }
}

/**
 * Processa um evento de realtime e mostra o toast apropriado.
 * Reproduz fielmente a lógica do SupabaseRealtimeProvider.
 */
function handleSocketEvent(
  event: RealtimeEvent,
  setNotificationReminders: (reminders: Array<Record<string, unknown>>) => void
) {
  const { table, eventType, label } = event;

  switch (table) {
    case 'clients': {
      if (eventType === 'INSERT') {
        toast.success(`Novo cliente: ${label || 'Cliente'}`, {
          icon: <Database className="h-4 w-4 text-emerald-500" />,
        });
      } else if (eventType === 'UPDATE') {
        toast.info(`Cliente atualizado: ${label || 'Cliente'}`, {
          icon: <Database className="h-4 w-4 text-blue-500" />,
        });
      } else if (eventType === 'DELETE') {
        toast.warning(`Cliente removido: ${label || 'Cliente'}`);
      }
      break;
    }

    case 'reminders': {
      if (eventType === 'INSERT') {
        toast.success(`Novo lembrete: ${label || 'Lembrete'}`, {
          icon: <Bell className="h-4 w-4 text-amber-500" />,
        });
      }
      fetchNotificationCount(setNotificationReminders);
      break;
    }

    case 'tags': {
      if (eventType === 'INSERT') {
        toast.success(`Nova tag criada: ${label || 'Tag'}`);
      } else if (eventType === 'DELETE') {
        toast.warning(`Tag removida: ${label || 'Tag'}`);
      }
      break;
    }

    case 'user_settings': {
      if (eventType === 'UPDATE') {
        toast.info('Configurações atualizadas em tempo real');
      }
      break;
    }

    // Tabelas extras suportadas pelo Socket.io (não monitoradas pelo Supabase atual)
    case 'interactions': {
      if (eventType === 'INSERT') {
        toast.success(`Nova interação registrada`, {
          icon: <Database className="h-4 w-4 text-blue-500" />,
        });
      }
      break;
    }

    case 'schedules': {
      if (eventType === 'INSERT') {
        toast.success(`Novo agendamento: ${label || 'Agendamento'}`, {
          icon: <Bell className="h-4 w-4 text-violet-500" />,
        });
      } else if (eventType === 'UPDATE') {
        toast.info(`Agendamento atualizado: ${label || 'Agendamento'}`);
      }
      break;
    }

    case 'enterprises': {
      if (eventType === 'INSERT') {
        toast.success(`Novo empreendimento: ${label || 'Empreendimento'}`);
      } else if (eventType === 'UPDATE') {
        toast.info(`Empreendimento atualizado: ${label || 'Empreendimento'}`);
      }
      break;
    }

    // client_tags, lead_queues, users — sem toast específico por enquanto
    default:
      break;
  }
}

/**
 * Provider que gerencia a conexão Socket.io e processa eventos.
 * Interface idêntica ao SupabaseRealtimeProvider.
 */
export function SocketioRealtimeProvider({ children }: SocketioRealtimeProviderProps) {
  const { setNotificationReminders } = useCRMStore();

  const onEvent = useCallback(
    (event: RealtimeEvent) => {
      handleSocketEvent(event, setNotificationReminders);
    },
    [setNotificationReminders]
  );

  // A conexão é gerenciada pelo hook internamente
  useSocketRealtime({ onEvent });

  // Renderiza children incondicionalmente
  // (a conexão acontece em background, não bloqueia a UI)
  return <>{children}</>;
}