-- Hardening de segurança (Security Advisor do Supabase — lint 0013
-- rls_disabled_in_public):
--
-- A tabela de histórico do Prisma Migrate (`_prisma_migrations`) vive
-- obrigatoriamente no schema do datasource (`public`), que no Supabase é
-- exposto via PostgREST. Sem RLS, quem tivesse a anon key (pública no
-- bundle do frontend) poderia ler o histórico de migrations (nomes,
-- checksums, logs) pela API REST.
--
-- Efeito:
--   - RLS habilitado SEM policies = deny-all para anon/authenticated
--     via PostgREST (nenhuma linha visível).
--   - O Prisma NÃO é afetado: conecta como owner (`postgres`), e owner
--     bypassa RLS por padrão (não usamos FORCE ROW LEVEL SECURITY) —
--     migrate deploy/resolve continuam lendo e gravando normalmente.
--   - Não mover a tabela de schema: o Prisma Migrate a procura sempre
--     no schema do datasource.
--
-- Idempotente: seguro em bancos novos (migrate deploy) e em bancos onde
-- os comandos já rodaram manualmente no SQL Editor. Os REVOKE são
-- guardados por verificação de existência do role para não quebrar em
-- Postgres sem os roles padrão do Supabase (dev local, Neon etc.).

ALTER TABLE "public"."_prisma_migrations" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "public"."_prisma_migrations" FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "public"."_prisma_migrations" FROM authenticated;
  END IF;
END
$$;
