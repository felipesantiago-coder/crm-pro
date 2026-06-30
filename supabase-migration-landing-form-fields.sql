-- Migration: Add landing_form_fields table
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS "landing_form_fields" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "enterpriseId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "fieldType" TEXT NOT NULL DEFAULT 'text',
  "placeholder" TEXT,
  "options" TEXT,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "landing_form_fields_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "landing_form_fields_enterpriseId_idx" ON "landing_form_fields"("enterpriseId");