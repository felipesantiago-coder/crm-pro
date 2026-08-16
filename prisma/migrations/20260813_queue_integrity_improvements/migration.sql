-- ============================================================
-- Migration: Queue Integrity Improvements
-- Date: 2026-08-13
--
-- 3 changes:
--   1. Add metaLeadgenId column to clients (dedicated Meta dedup)
--   2. Add FK lead_queue_assignments.leadId → clients.id (SetNull)
--   3. (Code change only) DB-backed idempotency in lead-queue.ts
-- ============================================================

-- ============================================================
-- PONTO 3: metaLeadgenId dedicado no Client
-- ============================================================

-- Add column (nullable first, no unique constraint yet)
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "metaLeadgenId" TEXT;

-- Backfill: extract Lead ID from existing notes for Meta-sourced clients
-- Pattern in notes: "Lead ID: 123456789012345"
UPDATE "clients"
SET "metaLeadgenId" = regexp_replace(
    substring(notes FROM 'Lead ID: ([^\n]+)'),
    '^\s+|\s+$', '', 'g'
)
WHERE notes LIKE '%Lead ID: %'
  AND "metaLeadgenId" IS NULL;

-- Clean up any empty strings from failed regex
UPDATE "clients" SET "metaLeadgenId" = NULL WHERE "metaLeadgenId" = '';

-- Now add unique constraint (after backfill to avoid conflicts)
CREATE UNIQUE INDEX IF NOT EXISTS "clients_metaLeadgenId_key" ON "clients" ("metaLeadgenId")
  WHERE "metaLeadgenId" IS NOT NULL;

-- ============================================================
-- PONTO 1: FK lead_queue_assignments.leadId → clients.id
-- ============================================================

-- First: nullify orphaned leadIds (pointing to non-existent clients)
UPDATE "lead_queue_assignments"
SET "leadId" = NULL
WHERE "leadId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "clients" c WHERE c.id = "lead_queue_assignments"."leadId"
  );

-- Add FK constraint with ON DELETE SET NULL
ALTER TABLE "lead_queue_assignments"
  ADD CONSTRAINT "lead_queue_assignments_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "clients"("id")
  ON DELETE SET NULL;
