-- Migration: Add EnterpriseImage table + missing Enterprise fields
-- Run this in the Supabase SQL Editor

-- Add missing columns to enterprises table
ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS "slug" TEXT UNIQUE;
ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS "landingTitle" TEXT;
ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS "landingSubtitle" TEXT;
ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS "landingDescription" TEXT;

-- Add cachedInfo column for pre-extracted enterprise information
ALTER TABLE enterprises ADD COLUMN IF NOT EXISTS "cachedInfo" JSONB;

-- Create enterprise_images table
CREATE TABLE IF NOT EXISTS "enterprise_images" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "url" TEXT NOT NULL,
  "altText" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "enterpriseId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "enterprise_images_enterpriseId_fkey"
    FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS "enterprise_images_enterpriseId_idx" ON "enterprise_images"("enterpriseId");