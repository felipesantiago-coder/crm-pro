-- AlterTable: Add pageAccessToken to meta_ad_accounts (idempotent)
ALTER TABLE "meta_ad_accounts" ADD COLUMN IF NOT EXISTS "pageAccessToken" TEXT;
