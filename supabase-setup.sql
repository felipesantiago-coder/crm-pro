-- =============================================================
-- CRM PRO - CONFIGURAÇÃO COMPLETA DO SUPABASE
-- =============================================================
-- Execute ESTE SCRIPT INTEIRO no SQL Editor do Supabase:
--   1. Acesse https://supabase.com/dashboard
--   2. Selecione seu projeto
--   3. Vá em "SQL Editor" no menu lateral
--   4. Clique em "New Query"
--   5. Cole todo este script e clique em "Run"
--
-- IMPORTANTE: Execute APÓS conectar o projeto no Vercel
-- com DATABASE_URL. O Prisma usará estas tabelas.
-- =============================================================


-- =============================================================
-- 1. CRIAR TODAS AS TABELAS DO CRM
-- =============================================================

-- Tabela de Clientes
CREATE TABLE IF NOT EXISTS clients (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  phone             TEXT,
  email             TEXT,
  region            TEXT,
  enterprise        TEXT,
  "enterpriseId"    TEXT,
  notes             TEXT,
  "updatePeriod"    INTEGER NOT NULL DEFAULT 30,
  "lastInteractionAt" TIMESTAMP,
  "createdAt"       TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMP NOT NULL DEFAULT now()
);

-- Tabela de Tags
CREATE TABLE IF NOT EXISTS tags (
  id        TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  name      TEXT NOT NULL UNIQUE,
  color     TEXT NOT NULL DEFAULT '#6366f1',
  "createdAt" TIMESTAMP NOT NULL DEFAULT now()
);

-- Tabela de Relação Cliente-Tag
CREATE TABLE IF NOT EXISTS client_tags (
  id        TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "clientId" TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  "tagId"    TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE("clientId", "tagId")
);

-- Tabela de Lembretes
CREATE TABLE IF NOT EXISTS reminders (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  description TEXT,
  "dueDate"   TIMESTAMP NOT NULL,
  notified    BOOLEAN NOT NULL DEFAULT false,
  "clientId"  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

-- Tabela de Empreendimentos
CREATE TABLE IF NOT EXISTS enterprises (
  id        TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  name      TEXT NOT NULL,
  region    TEXT,
  "imageUrl" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

-- Chave estrangeira de Clientes para Empreendimentos
ALTER TABLE clients
  ADD CONSTRAINT fk_clients_enterprise
  FOREIGN KEY ("enterpriseId") REFERENCES enterprises(id) ON DELETE SET NULL;

-- Tabela de Usuários
CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  email             TEXT NOT NULL UNIQUE,
  passwordHash      TEXT NOT NULL,
  role              TEXT NOT NULL DEFAULT 'USER',
  "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"       TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMP NOT NULL DEFAULT now()
);

-- Tabela de Configurações do Usuário
CREATE TABLE IF NOT EXISTS user_settings (
  id        TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  key       TEXT NOT NULL UNIQUE,
  value     TEXT NOT NULL,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);


-- =============================================================
-- 2. CRIAR ÍNDICES PARA PERFORMANCE
-- =============================================================

-- Clientes
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients (name);
CREATE INDEX IF NOT EXISTS idx_clients_region ON clients (region);
CREATE INDEX IF NOT EXISTS idx_clients_enterprise ON clients (enterprise);
CREATE INDEX IF NOT EXISTS idx_clients_enterprise_id ON clients ("enterpriseId");
CREATE INDEX IF NOT EXISTS idx_clients_created_at ON clients ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_clients_update_period ON clients ("updatePeriod");
CREATE INDEX IF NOT EXISTS idx_clients_last_interaction ON clients ("lastInteractionAt");

-- Tags
CREATE INDEX IF NOT EXISTS idx_tags_name ON tags (name);

-- Relação Cliente-Tag
CREATE INDEX IF NOT EXISTS idx_client_tags_client_id ON client_tags ("clientId");
CREATE INDEX IF NOT EXISTS idx_client_tags_tag_id ON client_tags ("tagId");

-- Lembretes
CREATE INDEX IF NOT EXISTS idx_reminders_client_id ON reminders ("clientId");
CREATE INDEX IF NOT EXISTS idx_reminders_due_date ON reminders ("dueDate");
CREATE INDEX IF NOT EXISTS idx_reminders_notified ON reminders (notified);

-- Empreendimentos
CREATE INDEX IF NOT EXISTS idx_enterprises_name ON enterprises (name);
CREATE INDEX IF NOT EXISTS idx_enterprises_region ON enterprises (region);

-- Usuários
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);


-- =============================================================
-- 3. HABILITAR REALTIME PARA TODAS AS TABELAS
-- =============================================================
-- Permite que o CRM receba atualizações em tempo real
-- quando dados forem modificados por qualquer dispositivo

ALTER PUBLICATION supabase_realtime ADD TABLE clients;
ALTER PUBLICATION supabase_realtime ADD TABLE tags;
ALTER PUBLICATION supabase_realtime ADD TABLE client_tags;
ALTER PUBLICATION supabase_realtime ADD TABLE reminders;
ALTER PUBLICATION supabase_realtime ADD TABLE enterprises;
ALTER PUBLICATION supabase_realtime ADD TABLE users;
ALTER PUBLICATION supabase_realtime ADD TABLE user_settings;


-- =============================================================
-- 4. CRIAR GATILHOS (TRIGGERS) PARA updatedAt
-- =============================================================
-- Atualiza automaticamente o campo updatedAt quando
-- um registro for modificado

-- Função genérica de atualização de timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: clients
DROP TRIGGER IF EXISTS trg_clients_updated_at ON clients;
CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger: reminders
DROP TRIGGER IF EXISTS trg_reminders_updated_at ON reminders;
CREATE TRIGGER trg_reminders_updated_at
  BEFORE UPDATE ON reminders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger: enterprises
DROP TRIGGER IF EXISTS trg_enterprises_updated_at ON enterprises;
CREATE TRIGGER trg_enterprises_updated_at
  BEFORE UPDATE ON enterprises
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger: users
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger: user_settings
DROP TRIGGER IF EXISTS trg_user_settings_updated_at ON user_settings;
CREATE TRIGGER trg_user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- =============================================================
-- 5. INSERIR USUÁRIO ADMINISTRADOR PADRÃO
-- =============================================================
-- Email: felipesantiagoquadra@gmail.com
-- Senha: admincrmquadra@!
-- O usuário será solicitado a alterar a senha no primeiro login
--
-- IMPORTANTE: A senha é hasheada com bcryptjs (12 rounds).
-- Este hash corresponde à senha "admincrmquadra@!"
-- Se precisar gerar um novo hash, use o endpoint /api/auth/seed
-- após o primeiro deploy.

INSERT INTO users (name, email, "passwordHash", role, "mustChangePassword")
VALUES (
  'Administrador',
  'felipesantiagoquadra@gmail.com',
  '$2b$12$CvOHZh0/QwurtsEB.x6bdep4chbE0naUnZEOIMNqsiWQqm4v4Nbd6',
  'ADMIN',
  true
)
ON CONFLICT (email) DO NOTHING;


-- =============================================================
-- 6. INSERIR CONFIGURAÇÃO PADRÃO
-- =============================================================

INSERT INTO user_settings (key, value)
VALUES ('crmName', 'CRM Pro')
ON CONFLICT (key) DO NOTHING;

INSERT INTO user_settings (key, value)
VALUES ('defaultRegion', '')
ON CONFLICT (key) DO NOTHING;


-- =============================================================
-- CONCLUÍDO!
-- =============================================================
-- Todas as tabelas, índices, triggers, Realtime e o admin
-- padrão foram configurados com sucesso.
--
-- Próximos passos:
-- 1. No Vercel, configure as variáveis de ambiente:
--    - DATABASE_URL (string de conexão Supabase - porta 6543)
--    - NEXTAUTH_SECRET (gerado com: openssl rand -base64 32)
--    - NEXTAUTH_URL (URL do seu deploy no Vercel)
--    - NEXT_PUBLIC_SUPABASE_URL
--    - NEXT_PUBLIC_SUPABASE_ANON_KEY
-- 2. Faça deploy no Vercel
-- 3. Acesse o app e faça login com:
--    Email: felipesantiagoquadra@gmail.com
--    Senha: admincrmquadra@!
-- 4. Altere a senha quando solicitado
-- =============================================================
