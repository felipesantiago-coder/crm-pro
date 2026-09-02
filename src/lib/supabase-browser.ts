import { createClient } from '@supabase/supabase-js'

//
// SUPABASE BROWSER CLIENT — Realtime (apenas)
// ==============================================
// Este cliente NÃO é usado para banco de dados.
// O banco de dados conecta via DATABASE_URL (Prisma ORM em @/lib/db);
// o Supabase hospeda o Postgres E fornece Realtime/Storage do mesmo projeto.
//
// Este cliente é usado EXCLUSIVAMENTE para:
//   - Supabase Realtime subscriptions (postgres_changes)
//     em tabelas do próprio banco para exibir toasts de mudanças na UI.
//
// NOTE: Este arquivo é código morto no momento — o componente
// SupabaseRealtimeProvider cria seu próprio client diretamente.
// Se precisar usar este client, garanta que as tabelas estejam na
// publication supabase_realtime.
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
