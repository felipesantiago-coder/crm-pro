-- Migration: i18n enterprise fields
-- Convert landingTitle, landingSubtitle, landingDescription from text to jsonb (locale-keyed)
-- Add cachedInfoI18n for translated cachedInfo

-- Step 1: Add new JSONB columns alongside existing text columns
ALTER TABLE "enterprises" ADD COLUMN IF NOT EXISTS "landingTitle_jsonb" JSONB;
ALTER TABLE "enterprises" ADD COLUMN IF NOT EXISTS "landingSubtitle_jsonb" JSONB;
ALTER TABLE "enterprises" ADD COLUMN IF NOT EXISTS "landingDescription_jsonb" JSONB;
ALTER TABLE "enterprises" ADD COLUMN IF NOT EXISTS "cachedInfoI18n" JSONB;

-- Step 2: Migrate existing text data into JSONB format { "pt-BR": "existing_value" }
UPDATE "enterprises" SET "landingTitle_jsonb" = jsonb_build_object('pt-BR', "landingTitle") WHERE "landingTitle" IS NOT NULL;
UPDATE "enterprises" SET "landingSubtitle_jsonb" = jsonb_build_object('pt-BR', "landingSubtitle") WHERE "landingSubtitle" IS NOT NULL;
UPDATE "enterprises" SET "landingDescription_jsonb" = jsonb_build_object('pt-BR', "landingDescription") WHERE "landingDescription" IS NOT NULL;

-- Step 3: Drop old text columns
ALTER TABLE "enterprises" DROP COLUMN IF EXISTS "landingTitle";
ALTER TABLE "enterprises" DROP COLUMN IF EXISTS "landingSubtitle";
ALTER TABLE "enterprises" DROP COLUMN IF EXISTS "landingDescription";

-- Step 4: Rename JSONB columns to original names
ALTER TABLE "enterprises" RENAME COLUMN "landingTitle_jsonb" TO "landingTitle";
ALTER TABLE "enterprises" RENAME COLUMN "landingSubtitle_jsonb" TO "landingSubtitle";
ALTER TABLE "enterprises" RENAME COLUMN "landingDescription_jsonb" TO "landingDescription";
