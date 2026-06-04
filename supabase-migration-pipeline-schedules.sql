-- =====================================================
-- Migration: Pipeline de Etapas + Agendamentos de Visitas
-- Execute no Supabase SQL Editor ou via cliente psql
-- =====================================================

-- 1. Adicionar coluna "stage" na tabela clients
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "stage" VARCHAR(255) NOT NULL DEFAULT 'LEAD';

-- 2. Criar tabela de agendamentos (schedules)
CREATE TABLE IF NOT EXISTS "schedules" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "scheduledDate" TIMESTAMP(3) NOT NULL,
  "scheduledTime" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "status" VARCHAR(255) NOT NULL DEFAULT 'PENDING',
  "completedAt" TIMESTAMP(3),
  "clientId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "schedules_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "schedules_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 3. Criar índices para performance
CREATE INDEX IF NOT EXISTS "schedules_clientId_idx" ON "schedules"("clientId");
CREATE INDEX IF NOT EXISTS "schedules_scheduledDate_idx" ON "schedules"("scheduledDate");
CREATE INDEX IF NOT EXISTS "schedules_status_idx" ON "schedules"("status");
CREATE INDEX IF NOT EXISTS "schedules_createdBy_idx" ON "schedules"("createdBy");
CREATE INDEX IF NOT EXISTS "clients_stage_idx" ON "clients"("stage");

-- 4. Habilitar RLS (Row Level Security) na tabela schedules
ALTER TABLE "schedules" ENABLE ROW LEVEL SECURITY;

-- 5. Políticas RLS para schedules
-- Qualquer usuário autenticado pode ver agendamentos dos clientes que tem acesso
CREATE POLICY "schedules_select_for_accessible_clients" ON "schedules"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "clients"
      WHERE "clients"."id" = "schedules"."clientId"
      AND (
        "clients"."createdBy" = auth.uid()::text
        OR EXISTS (
          SELECT 1 FROM "client_partners"
          WHERE "client_partners"."clientId" = "clients"."id"
          AND "client_partners"."userId" = auth.uid()::text
        )
        OR (
          -- ADMIN vê tudo
          EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = auth.uid()::text AND "users"."role" = 'ADMIN')
        )
      )
    )
  );

-- Usuário autenticado pode criar agendamentos
CREATE POLICY "schedules_insert_authenticated" ON "schedules"
  FOR INSERT WITH CHECK (
    "createdBy" = auth.uid()::text
    OR EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = auth.uid()::text AND "users"."role" = 'ADMIN')
  );

-- Apenas o criador ou admin pode atualizar
CREATE POLICY "schedules_update_owner_or_admin" ON "schedules"
  FOR UPDATE USING (
    "createdBy" = auth.uid()::text
    OR EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = auth.uid()::text AND "users"."role" = 'ADMIN')
  );

-- Apenas o criador ou admin pode deletar
CREATE POLICY "schedules_delete_owner_or_admin" ON "schedules"
  FOR DELETE USING (
    "createdBy" = auth.uid()::text
    OR EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = auth.uid()::text AND "users"."role" = 'ADMIN')
  );

-- 6. Atualizar RLS da tabela clients para incluir stage (se já tiver RLS, recriar políticas)
-- Nota: se a tabela clients já tem RLS, as políticas existentes continuam valendo
-- Apenas garantir que o campo stage seja visível

-- =====================================================
-- VALIDAÇÃO: Execute para verificar se tudo foi criado
-- =====================================================
-- SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'stage';
-- SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'schedules';
