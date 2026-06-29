-- =============================================================
-- CRM PRO - MIGRAÇÃO DE SEGURANÇA (IDEMPOTENTE)
-- =============================================================
-- Execute ESTE SCRIPT no SQL Editor do Supabase.
-- Seguro para re-executar — usa IF NOT EXISTS / DO $$ blocks.
-- NÃO apaga dados — apenas adiciona RLS, corrige Realtime.
-- =============================================================


-- =============================================================
-- 1. REMOVER users E user_settings DO REALTIME (vaza passwordHash)
-- =============================================================
-- Usa DO $$ para ignorar erro se a tabela já não estiver na publicação.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE users;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'users já não está na publicação realtime (ok): %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE user_settings;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'user_settings já não está na publicação realtime (ok): %', SQLERRM;
END $$;

-- Remover enterprise_images se por acaso existir na publicação
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE enterprise_images;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'enterprise_images não está na publicação (ok): %', SQLERRM;
END $$;


-- =============================================================
-- 2. HABILITAR RLS EM TODAS AS TABELAS
-- =============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprises ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;


-- =============================================================
-- 3. CRIAR POLÍTICAS RLS (idempotente com DROP + CREATE)
-- =============================================================
-- As policies usam current_setting('request.jwt.claims.sub', true)
-- para obter o user_id do JWT do NextAuth.
-- Quando a key não existe (anon), retorna NULL e as policies negam acesso.
--
-- NOTA: O CRM usa Prisma (service_role key) para acessar o DB.
-- Estas políticas RLS protegem contra acesso DIRETO via Supabase anon key.
-- O service_role do Prisma BYPASSA o RLS — isso é intencional.
-- =============================================================

-- ── 3a. users ──

DO $$ BEGIN CREATE POLICY "users_select_self_or_admin" ON users FOR SELECT USING ( (current_setting('request.jwt.claims.sub', true) IS NOT NULL AND id = current_setting('request.jwt.claims.sub', true)) OR (current_setting('request.jwt.claims.role', true) = 'ADMIN') ); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy users_select_self_or_admin already exists'; END $$;

DO $$ BEGIN CREATE POLICY "users_update_self_or_admin" ON users FOR UPDATE USING ( (current_setting('request.jwt.claims.sub', true) IS NOT NULL AND id = current_setting('request.jwt.claims.sub', true)) OR (current_setting('request.jwt.claims.role', true) = 'ADMIN') ); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy users_update_self_or_admin already exists'; END $$;

DO $$ BEGIN CREATE POLICY "users_insert_admin_only" ON users FOR INSERT WITH CHECK (current_setting('request.jwt.claims.role', true) = 'ADMIN'); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy users_insert_admin_only already exists'; END $$;

DO $$ BEGIN CREATE POLICY "users_delete_admin_only" ON users FOR DELETE USING (current_setting('request.jwt.claims.role', true) = 'ADMIN'); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy users_delete_admin_only already exists'; END $$;


-- ── 3b. clients ──

DO $$ BEGIN CREATE POLICY "clients_select_own_or_partner_or_admin" ON clients FOR SELECT USING ( (current_setting('request.jwt.claims.sub', true) IS NOT NULL AND ("createdBy" = current_setting('request.jwt.claims.sub', true) OR EXISTS (SELECT 1 FROM client_partners cp WHERE cp."clientId" = clients.id AND cp."userId" = current_setting('request.jwt.claims.sub', true)))) OR (current_setting('request.jwt.claims.role', true) = 'ADMIN') ); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy clients_select already exists'; END $$;

DO $$ BEGIN CREATE POLICY "clients_insert_authenticated" ON clients FOR INSERT WITH CHECK (current_setting('request.jwt.claims.sub', true) IS NOT NULL); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy clients_insert already exists'; END $$;

DO $$ BEGIN CREATE POLICY "clients_update_own_or_admin" ON clients FOR UPDATE USING ( (current_setting('request.jwt.claims.sub', true) IS NOT NULL AND ("createdBy" = current_setting('request.jwt.claims.sub', true) OR current_setting('request.jwt.claims.role', true) = 'ADMIN')) ); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy clients_update already exists'; END $$;

DO $$ BEGIN CREATE POLICY "clients_delete_admin_only" ON clients FOR DELETE USING (current_setting('request.jwt.claims.role', true) = 'ADMIN'); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy clients_delete already exists'; END $$;


-- ── 3c. interactions ──

DO $$ BEGIN CREATE POLICY "interactions_select_via_client" ON interactions FOR SELECT USING ( EXISTS (SELECT 1 FROM clients c WHERE c.id = interactions."clientId" AND (c."createdBy" = current_setting('request.jwt.claims.sub', true) OR current_setting('request.jwt.claims.role', true) = 'ADMIN' OR EXISTS (SELECT 1 FROM client_partners cp WHERE cp."clientId" = c.id AND cp."userId" = current_setting('request.jwt.claims.sub', true)))) ); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy interactions_select already exists'; END $$;

DO $$ BEGIN CREATE POLICY "interactions_insert_authenticated" ON interactions FOR INSERT WITH CHECK (current_setting('request.jwt.claims.sub', true) IS NOT NULL); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy interactions_insert already exists'; END $$;

DO $$ BEGIN CREATE POLICY "interactions_delete_admin_only" ON interactions FOR DELETE USING (current_setting('request.jwt.claims.role', true) = 'ADMIN'); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy interactions_delete already exists'; END $$;


-- ── 3d. tags ──

DO $$ BEGIN CREATE POLICY "tags_select_authenticated" ON tags FOR SELECT USING (current_setting('request.jwt.claims.sub', true) IS NOT NULL); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy tags_select already exists'; END $$;

DO $$ BEGIN CREATE POLICY "tags_insert_admin_only" ON tags FOR INSERT WITH CHECK (current_setting('request.jwt.claims.role', true) = 'ADMIN'); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy tags_insert already exists'; END $$;

DO $$ BEGIN CREATE POLICY "tags_update_admin_only" ON tags FOR UPDATE USING (current_setting('request.jwt.claims.role', true) = 'ADMIN'); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy tags_update already exists'; END $$;

DO $$ BEGIN CREATE POLICY "tags_delete_admin_only" ON tags FOR DELETE USING (current_setting('request.jwt.claims.role', true) = 'ADMIN'); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy tags_delete already exists'; END $$;


-- ── 3e. client_tags ──

DO $$ BEGIN CREATE POLICY "client_tags_select_via_client" ON client_tags FOR SELECT USING ( EXISTS (SELECT 1 FROM clients c WHERE c.id = client_tags."clientId" AND (c."createdBy" = current_setting('request.jwt.claims.sub', true) OR current_setting('request.jwt.claims.role', true) = 'ADMIN' OR EXISTS (SELECT 1 FROM client_partners cp WHERE cp."clientId" = c.id AND cp."userId" = current_setting('request.jwt.claims.sub', true)))) ); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy client_tags_select already exists'; END $$;

DO $$ BEGIN CREATE POLICY "client_tags_insert_authenticated" ON client_tags FOR INSERT WITH CHECK (current_setting('request.jwt.claims.sub', true) IS NOT NULL); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy client_tags_insert already exists'; END $$;

DO $$ BEGIN CREATE POLICY "client_tags_delete_via_client" ON client_tags FOR DELETE USING ( EXISTS (SELECT 1 FROM clients c WHERE c.id = client_tags."clientId" AND (c."createdBy" = current_setting('request.jwt.claims.sub', true) OR current_setting('request.jwt.claims.role', true) = 'ADMIN')) ); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy client_tags_delete already exists'; END $$;


-- ── 3f. reminders ──

DO $$ BEGIN CREATE POLICY "reminders_select_via_client" ON reminders FOR SELECT USING ( EXISTS (SELECT 1 FROM clients c WHERE c.id = reminders."clientId" AND (c."createdBy" = current_setting('request.jwt.claims.sub', true) OR current_setting('request.jwt.claims.role', true) = 'ADMIN' OR EXISTS (SELECT 1 FROM client_partners cp WHERE cp."clientId" = c.id AND cp."userId" = current_setting('request.jwt.claims.sub', true)))) ); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy reminders_select already exists'; END $$;

DO $$ BEGIN CREATE POLICY "reminders_insert_authenticated" ON reminders FOR INSERT WITH CHECK (current_setting('request.jwt.claims.sub', true) IS NOT NULL); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy reminders_insert already exists'; END $$;

DO $$ BEGIN CREATE POLICY "reminders_update_own_or_admin" ON reminders FOR UPDATE USING ( EXISTS (SELECT 1 FROM clients c WHERE c.id = reminders."clientId" AND (c."createdBy" = current_setting('request.jwt.claims.sub', true) OR current_setting('request.jwt.claims.role', true) = 'ADMIN')) ); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy reminders_update already exists'; END $$;

DO $$ BEGIN CREATE POLICY "reminders_delete_admin_only" ON reminders FOR DELETE USING (current_setting('request.jwt.claims.role', true) = 'ADMIN'); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy reminders_delete already exists'; END $$;


-- ── 3g. enterprises ──

DO $$ BEGIN CREATE POLICY "enterprises_select_authenticated" ON enterprises FOR SELECT USING (current_setting('request.jwt.claims.sub', true) IS NOT NULL); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy enterprises_select already exists'; END $$;

DO $$ BEGIN CREATE POLICY "enterprises_insert_admin_only" ON enterprises FOR INSERT WITH CHECK (current_setting('request.jwt.claims.role', true) = 'ADMIN'); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy enterprises_insert already exists'; END $$;

DO $$ BEGIN CREATE POLICY "enterprises_update_admin_only" ON enterprises FOR UPDATE USING (current_setting('request.jwt.claims.role', true) = 'ADMIN'); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy enterprises_update already exists'; END $$;

DO $$ BEGIN CREATE POLICY "enterprises_delete_admin_only" ON enterprises FOR DELETE USING (current_setting('request.jwt.claims.role', true) = 'ADMIN'); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy enterprises_delete already exists'; END $$;


-- ── 3h. client_partners ──

DO $$ BEGIN CREATE POLICY "client_partners_select_own_or_admin" ON client_partners FOR SELECT USING ( "userId" = current_setting('request.jwt.claims.sub', true) OR "addedBy" = current_setting('request.jwt.claims.sub', true) OR current_setting('request.jwt.claims.role', true) = 'ADMIN' ); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy client_partners_select already exists'; END $$;

DO $$ BEGIN CREATE POLICY "client_partners_insert_authenticated" ON client_partners FOR INSERT WITH CHECK (current_setting('request.jwt.claims.sub', true) IS NOT NULL); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy client_partners_insert already exists'; END $$;

DO $$ BEGIN CREATE POLICY "client_partners_delete_own_or_admin" ON client_partners FOR DELETE USING ( "addedBy" = current_setting('request.jwt.claims.sub', true) OR current_setting('request.jwt.claims.role', true) = 'ADMIN' ); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy client_partners_delete already exists'; END $$;


-- ── 3i. user_settings ──

DO $$ BEGIN CREATE POLICY "user_settings_select_admin_only" ON user_settings FOR SELECT USING (current_setting('request.jwt.claims.role', true) = 'ADMIN'); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy user_settings_select already exists'; END $$;

DO $$ BEGIN CREATE POLICY "user_settings_update_admin_only" ON user_settings FOR UPDATE USING (current_setting('request.jwt.claims.role', true) = 'ADMIN'); EXCEPTION WHEN duplicate_object THEN RAISE NOTICE 'policy user_settings_update already exists'; END $$;


-- =============================================================
-- 4. FORÇAR TROCA DE SENHA PARA TODOS OS ADMINS
-- =============================================================

UPDATE users
SET "mustChangePassword" = true
WHERE role = 'ADMIN'
  AND "mustChangePassword" = false;


-- =============================================================
-- 5. VERIFICAÇÃO FINAL
-- =============================================================

SELECT
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('users','clients','tags','client_tags','interactions','enterprises','reminders','client_partners','user_settings')
ORDER BY tablename;

SELECT
  schemaname,
  tablename,
  policyname
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;