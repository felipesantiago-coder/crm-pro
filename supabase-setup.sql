-- CRM Pro - Script de configuração do Supabase
-- Execute este SQL no SQL Editor do Supabase Dashboard
-- (Database → SQL Editor → New Query)
--
-- Este script configura o Realtime e as permissões necessárias
-- para que o CRM funcione corretamente com o Supabase.

-- =============================================================
-- 1. HABILITAR REALTIME PARA AS TABELAS DO CRM
-- =============================================================
-- O Prisma cria as tabelas via `prisma db push`, mas o Realtime
-- precisa ser habilitado manualmente no Supabase.

ALTER PUBLICATION supabase_realtime ADD TABLE clients;
ALTER PUBLICATION supabase_realtime ADD TABLE tags;
ALTER PUBLICATION supabase_realtime ADD TABLE client_tags;
ALTER PUBLICATION supabase_realtime ADD TABLE reminders;
ALTER PUBLICATION supabase_realtime ADD TABLE user_settings;

-- =============================================================
-- 2. CONFIGURAR RLS (ROW LEVEL SECURITY) - OPCIONAL
-- =============================================================
-- Se for usar autenticação (Auth), descomente os blocos abaixo.
-- Para uso sem autenticação (apenas com a anon key), o Supabase
-- já permite acesso por padrão enquanto RLS estiver desabilitado.

-- Habilitar RLS nas tabelas
-- ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE client_tags ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- Permitir acesso total para usuários autenticados
-- CREATE POLICY "Acesso total para autenticados" ON clients
--   FOR ALL USING (auth.role() = 'authenticated');
-- CREATE POLICY "Acesso total para autenticados" ON tags
--   FOR ALL USING (auth.role() = 'authenticated');
-- CREATE POLICY "Acesso total para autenticados" ON client_tags
--   FOR ALL USING (auth.role() = 'authenticated');
-- CREATE POLICY "Acesso total para autenticados" ON reminders
--   FOR ALL USING (auth.role() = 'authenticated');
-- CREATE POLICY "Acesso total para autenticados" ON user_settings
--   FOR ALL USING (auth.role() = 'authenticated');

-- =============================================================
-- 3. CRIAR ÍNDICES PARA PERFORMANCE
-- =============================================================
-- Melhora a performance das consultas mais comuns do CRM

CREATE INDEX IF NOT EXISTS idx_clients_name ON clients (name);
CREATE INDEX IF NOT EXISTS idx_clients_region ON clients (region);
CREATE INDEX IF NOT EXISTS idx_clients_created_at ON clients (createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_clients_update_period ON clients (updatePeriod);
CREATE INDEX IF NOT EXISTS idx_clients_last_interaction ON clients (lastInteractionAt);
CREATE INDEX IF NOT EXISTS idx_client_tags_client_id ON client_tags (clientId);
CREATE INDEX IF NOT EXISTS idx_client_tags_tag_id ON client_tags (tagId);
CREATE INDEX IF NOT EXISTS idx_reminders_client_id ON reminders (clientId);
CREATE INDEX IF NOT EXISTS idx_reminders_due_date ON reminders (dueDate);
CREATE INDEX IF NOT EXISTS idx_reminders_notified ON reminders (notified);
