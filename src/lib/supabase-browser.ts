import { createClient } from '@supabase/supabase-js'

//
// SUPABASE BROWSER CLIENT — Realtime (apenas)
// ==============================================
// Este cliente NÃO é usado para banco de dados.
// O banco de dados é o Neon (via Prisma ORM em @/lib/db).
//
// Este cliente é usado EXCLUSIVAMENTE para:
//   - Supabase Realtime subscriptions (postgres_changes)
//     em tabelas do Neon para exibir toasts de mudanças na UI.
//
// NOTE: Este arquivo é código morto no momento — o componente
// SupabaseRealtimeProvider cria seu próprio client diretamente.
// Se precisar usar este client, garanta que o Supabase Realtime
// esteja configurado para escutar as tabelas do Neon.
//
export function createSupabaseBrowserClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

  if (!supabaseUrl || !supabaseAnonKey) {
    return null
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  })
}
