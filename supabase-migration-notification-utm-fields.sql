-- ============================================================
-- MIGRAÇÃO: UTM tracking + Telegram + Ntfy notification fields
-- Data: 2026-07-02
-- Execute este SQL no Supabase SQL Editor
-- ============================================================

-- 1) UTM tracking fields na tabela clients
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clients' AND column_name = 'utmSource'
  ) THEN
    ALTER TABLE "clients" ADD COLUMN "utmSource" TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clients' AND column_name = 'utmMedium'
  ) THEN
    ALTER TABLE "clients" ADD COLUMN "utmMedium" TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clients' AND column_name = 'utmCampaign'
  ) THEN
    ALTER TABLE "clients" ADD COLUMN "utmCampaign" TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clients' AND column_name = 'utmContent'
  ) THEN
    ALTER TABLE "clients" ADD COLUMN "utmContent" TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clients' AND column_name = 'utmTerm'
  ) THEN
    ALTER TABLE "clients" ADD COLUMN "utmTerm" TEXT;
  END IF;
END $$;

-- Índice no utmCampaign
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'clients_utmCampaign_idx'
  ) THEN
    CREATE INDEX "clients_utmCampaign_idx" ON "clients"("utmCampaign");
  END IF;
END $$;

-- 2) Telegram chat ID na tabela users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'telegramChatId'
  ) THEN
    ALTER TABLE "users" ADD COLUMN "telegramChatId" TEXT;
  END IF;
END $$;

-- Índice único parcial no telegramChatId
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'users_telegramChatId_key'
  ) THEN
    CREATE UNIQUE INDEX "users_telegramChatId_key" ON "users"("telegramChatId") WHERE "telegramChatId" IS NOT NULL;
  END IF;
END $$;

-- 3) Ntfy fields na tabela users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'ntfyTopic'
  ) THEN
    ALTER TABLE "users" ADD COLUMN "ntfyTopic" TEXT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'ntfyToken'
  ) THEN
    ALTER TABLE "users" ADD COLUMN "ntfyToken" TEXT;
  END IF;
END $$;

-- Índice único parcial no ntfyTopic
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'users_ntfyTopic_key'
  ) THEN
    CREATE UNIQUE INDEX "users_ntfyTopic_key" ON "users"("ntfyTopic") WHERE "ntfyTopic" IS NOT NULL;
  END IF;
END $$;

