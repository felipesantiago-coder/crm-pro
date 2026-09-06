-- ============================================================
-- Cartão de lead no Telegram (redesign das notificações)
--
-- Aditiva e idempotente. Nenhuma coluna ou tabela existente é
-- alterada destrutivamente.
--
-- Rollback (documentado, executar manualmente se necessário):
--   DROP TABLE IF EXISTS "telegram_link_tokens";
--   DROP TABLE IF EXISTS "telegram_delivery_logs";
--   DROP TABLE IF EXISTS "meta_ad_bindings";
--   DROP INDEX IF EXISTS "lead_form_mappings_enterpriseId_idx";
--   ALTER TABLE "lead_form_mappings" DROP COLUMN IF EXISTS "enterpriseId";
--   DROP INDEX IF EXISTS "meta_campaign_bindings_enterpriseId_idx";
--   ALTER TABLE "meta_campaign_bindings" DROP COLUMN IF EXISTS "enterpriseId";
-- ============================================================

-- ── 1. Empreendimento explícito nos vínculos de campanha e formulário ──

-- AlterTable
ALTER TABLE "meta_campaign_bindings" ADD COLUMN IF NOT EXISTS "enterpriseId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "meta_campaign_bindings_enterpriseId_idx" ON "meta_campaign_bindings"("enterpriseId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'meta_campaign_bindings_enterpriseId_fkey'
  ) THEN
    ALTER TABLE "meta_campaign_bindings" ADD CONSTRAINT "meta_campaign_bindings_enterpriseId_fkey"
      FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AlterTable
ALTER TABLE "lead_form_mappings" ADD COLUMN IF NOT EXISTS "enterpriseId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_form_mappings_enterpriseId_idx" ON "lead_form_mappings"("enterpriseId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_form_mappings_enterpriseId_fkey'
  ) THEN
    ALTER TABLE "lead_form_mappings" ADD CONSTRAINT "lead_form_mappings_enterpriseId_fkey"
      FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 2. Vínculo explícito por anúncio (nível mais específico) ──

-- CreateTable
CREATE TABLE IF NOT EXISTS "meta_ad_bindings" (
    "id" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "adName" TEXT,
    "enterpriseId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_ad_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "meta_ad_bindings_adId_key" ON "meta_ad_bindings"("adId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "meta_ad_bindings_enterpriseId_idx" ON "meta_ad_bindings"("enterpriseId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'meta_ad_bindings_enterpriseId_fkey'
  ) THEN
    ALTER TABLE "meta_ad_bindings" ADD CONSTRAINT "meta_ad_bindings_enterpriseId_fkey"
      FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 3. Log de entrega/idempotência das notificações (sem PII) ──

-- CreateTable
CREATE TABLE IF NOT EXISTS "telegram_delivery_logs" (
    "id" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sending',
    "kind" TEXT NOT NULL,
    "ingestionMethod" TEXT,
    "recipientUserId" TEXT,
    "clientId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "messageIds" TEXT,
    "errorCode" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_delivery_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_delivery_logs_dedupKey_key" ON "telegram_delivery_logs"("dedupKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "telegram_delivery_logs_clientId_idx" ON "telegram_delivery_logs"("clientId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "telegram_delivery_logs_createdAt_idx" ON "telegram_delivery_logs"("createdAt");

-- ── 4. Tokens de uso único para vinculação segura do chat ──

-- CreateTable
CREATE TABLE IF NOT EXISTS "telegram_link_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_link_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_link_tokens_tokenHash_key" ON "telegram_link_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "telegram_link_tokens_userId_idx" ON "telegram_link_tokens"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "telegram_link_tokens_expiresAt_idx" ON "telegram_link_tokens"("expiresAt");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'telegram_link_tokens_userId_fkey'
  ) THEN
    ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
