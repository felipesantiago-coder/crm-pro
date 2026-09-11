import { createClient, type SupabaseClient } from '@supabase/supabase-js';

//
// SUPABASE SERVER CLIENT — Object Storage (apenas)
// ================================================
// Este cliente NÃO é usado para banco de dados.
// O banco de dados conecta via DATABASE_URL (Prisma ORM em @/lib/db);
// o Supabase hospeda o Postgres E fornece Storage/Realtime do mesmo projeto.
//
// Este cliente é usado EXCLUSIVAMENTE para:
//   - Upload de imagens para o bucket "enterprise-images" (Storage)
//   - Delete de imagens do bucket
//
// Usa SUPABASE_SERVICE_ROLE_KEY (permissões de admin no Storage).
//

/**
 * Cria client Supabase server-side com permissões de admin (service_role).
 * Usado APENAS para operações de Storage (upload/delete de imagens).
 * NÃO usado para banco de dados — o banco conecta via DATABASE_URL (Prisma).
 */
export function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios ' +
      '(usados para Storage de imagens — o banco de dados conecta via DATABASE_URL/Prisma)'
    );
  }

  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
    },
  });
}

// Singleton LAZY: o client só é instanciado no primeiro USO, não na
// importação do módulo. Motivos (otimização Vercel — Fase 5):
//   1. `next build` não exige envs de Storage (build local/CI sem envs de
//      produção completa — antes, a importação lançava e quebrava a coleta
//      de dados de página);
//   2. Rotas que importam este módulo não pagam a criação do client no
//      cold start se não usarem Storage;
//   3. Comportamento preservado: chamar uma operação sem envs configuradas
//      lança exatamente o mesmo erro — só muda o momento (uso, não import).
const globalForSupabase = globalThis as unknown as {
  __crmSupabaseServer?: SupabaseClient;
};

function getSupabaseServerInstance(): SupabaseClient {
  if (!globalForSupabase.__crmSupabaseServer) {
    globalForSupabase.__crmSupabaseServer = createSupabaseServerClient();
  }
  return globalForSupabase.__crmSupabaseServer;
}

/**
 * Singleton do client Supabase server-side para Storage (lazy).
 * NÃO usar para queries de banco de dados — use `db` de @/lib/db.
 *
 * Proxy transparente: todas as propriedades (`.storage`, `.from`, etc.)
 * são resolvidas contra a instância real, criada no primeiro acesso.
 */
export const supabaseServer = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getSupabaseServerInstance() as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(client, prop, receiver);
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
});
