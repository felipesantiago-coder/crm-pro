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
-- ATENÇÃO: Este script irá APAGAR e recriar todas as tabelas.
-- Se já tiver dados importantes, faça backup antes.
-- =============================================================


-- =============================================================
-- 0. LIMPAR TABELAS EXISTENTES (ordem correta para FKs)
-- =============================================================

DROP TABLE IF EXISTS client_tags CASCADE;
DROP TABLE IF EXISTS reminders CASCADE;
DROP TABLE IF EXISTS clients CASCADE;
DROP TABLE IF EXISTS tags CASCADE;
DROP TABLE IF EXISTS enterprises CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS user_settings CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;


-- =============================================================
-- 1. CRIAR TODAS AS TABELAS DO CRM
-- =============================================================

-- Tabela de Clientes
CREATE TABLE clients (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  phone               TEXT,
  email               TEXT,
  region              TEXT,
  enterprise          TEXT,
  "enterpriseId"      TEXT,
  notes               TEXT,
  "updatePeriod"      INTEGER NOT NULL DEFAULT 30,
  "lastInteractionAt" TIMESTAMP,
  "createdAt"         TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMP NOT NULL DEFAULT now()
);

-- Tabela de Tags
CREATE TABLE tags (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  color      TEXT NOT NULL DEFAULT '#6366f1',
  "createdAt" TIMESTAMP NOT NULL DEFAULT now()
);

-- Tabela de Relação Cliente-Tag
CREATE TABLE client_tags (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "clientId" TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  "tagId"    TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE("clientId", "tagId")
);

-- Tabela de Lembretes
CREATE TABLE reminders (
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
CREATE TABLE enterprises (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  region     TEXT,
  "imageUrl" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

-- Chave estrangeira de Clientes para Empreendimentos
ALTER TABLE clients
  ADD CONSTRAINT fk_clients_enterprise
  FOREIGN KEY ("enterpriseId") REFERENCES enterprises(id) ON DELETE SET NULL;

-- Tabela de Usuários
CREATE TABLE users (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  email               TEXT NOT NULL UNIQUE,
  "passwordHash"      TEXT NOT NULL,
  role                TEXT NOT NULL DEFAULT 'USER',
  "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"         TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMP NOT NULL DEFAULT now()
);

-- Tabela de Configurações do Usuário
CREATE TABLE user_settings (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  key        TEXT NOT NULL UNIQUE,
  value      TEXT NOT NULL,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);


-- =============================================================
-- 2. CRIAR ÍNDICES PARA PERFORMANCE
-- =============================================================

CREATE INDEX idx_clients_name ON clients (name);
CREATE INDEX idx_clients_region ON clients (region);
CREATE INDEX idx_clients_enterprise ON clients (enterprise);
CREATE INDEX idx_clients_enterprise_id ON clients ("enterpriseId");
CREATE INDEX idx_clients_created_at ON clients ("createdAt" DESC);
CREATE INDEX idx_clients_update_period ON clients ("updatePeriod");
CREATE INDEX idx_clients_last_interaction ON clients ("lastInteractionAt");

CREATE INDEX idx_tags_name ON tags (name);

CREATE INDEX idx_client_tags_client_id ON client_tags ("clientId");
CREATE INDEX idx_client_tags_tag_id ON client_tags ("tagId");

CREATE INDEX idx_reminders_client_id ON reminders ("clientId");
CREATE INDEX idx_reminders_due_date ON reminders ("dueDate");
CREATE INDEX idx_reminders_notified ON reminders (notified);

CREATE INDEX idx_enterprises_name ON enterprises (name);
CREATE INDEX idx_enterprises_region ON enterprises (region);

CREATE INDEX idx_users_email ON users (email);


-- =============================================================
-- 3. HABILITAR REALTIME PARA TODAS AS TABELAS
-- =============================================================

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

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_reminders_updated_at
  BEFORE UPDATE ON reminders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_enterprises_updated_at
  BEFORE UPDATE ON enterprises
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- =============================================================
-- 5. INSERIR USUÁRIO ADMINISTRADOR PADRÃO
-- =============================================================
-- Email: felipesantiagoquadra@gmail.com
-- Senha: admincrmquadra@!
-- Hash gerado com bcryptjs (12 rounds) — compatível com NextAuth

INSERT INTO users (name, email, "passwordHash", role, "mustChangePassword")
VALUES (
  'Administrador',
  'felipesantiagoquadra@gmail.com',
  '$2b$12$CvOHZh0/QwurtsEB.x6bdep4chbE0naUnZEOIMNqsiWQqm4v4Nbd6',
  'ADMIN',
  true
);


-- =============================================================
-- 6. INSERIR CONFIGURAÇÃO PADRÃO
-- =============================================================

INSERT INTO user_settings (key, value)
VALUES ('crmName', 'CRM Pro');

INSERT INTO user_settings (key, value)
VALUES ('defaultRegion', '');


-- =============================================================
-- 7. VERIFICAR INSERÇÃO DO ADMIN
-- =============================================================

-- Este SELECT deve retornar o usuário admin com o hash da senha
SELECT id, name, email, role, "mustChangePassword",
       LEFT("passwordHash", 20) AS "hashPreview"
FROM users WHERE email = 'felipesantiagoquadra@gmail.com';


-- =============================================================
-- CONCLUÍDO!
-- =============================================================
