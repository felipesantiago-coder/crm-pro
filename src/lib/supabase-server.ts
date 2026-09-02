import { createClient } from '@supabase/supabase-js';

//
// SUPABASE SERVER CLIENT — Object Storage (apenas)
// ================================================
// Este cliente NÃO é usado para banco de dados.
// O banco de dados é o Neon (via Prisma ORM em @/lib/db).
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
 * NÃO usado para banco de dados — o banco é o Neon via Prisma.
 */
export function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios ' +
      '(usados para Storage de imagens, NÃO para banco de dados — o banco é o Neon)'
    );
  }

  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
    },
  });
}

/**
 * Singleton do client Supabase server-side para Storage.
 * NÃO usar para queries de banco de dados — use `db` de @/lib/db.
 */
export const supabaseServer = createSupabaseServerClient();