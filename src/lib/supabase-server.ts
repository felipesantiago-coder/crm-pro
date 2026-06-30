import { createClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase client using the SERVICE_ROLE key
 * for admin operations (storage uploads, etc.)
 */
export function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
  }

  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
    },
  });
}

/**
 * Server-side Supabase admin client for storage operations
 */
export const supabaseServer = createSupabaseServerClient();