-- =====================================================
-- Migration: Campo phone na tabela users (notificações WhatsApp)
-- Execute no Supabase SQL Editor
-- =====================================================

-- Adicionar coluna "phone" na tabela users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" VARCHAR(255);

-- Criar índice para busca por telefone
CREATE INDEX IF NOT EXISTS "users_phone_idx" ON "users"("phone") WHERE "phone" IS NOT NULL;
