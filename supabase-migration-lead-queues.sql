-- ============================================================
-- LEAD QUEUES — Round-robin lead distribution
-- Execute this in Supabase SQL Editor
-- ============================================================

-- Table: lead_queues
CREATE TABLE IF NOT EXISTS "lead_queues" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "currentIdx" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "lead_queues_isDefault_idx" ON "lead_queues"("isDefault") WHERE "isActive" = true;

-- Table: lead_queue_members
CREATE TABLE IF NOT EXISTS "lead_queue_members" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "queueId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_queue_members_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "lead_queues"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lead_queue_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "lead_queue_members_queueId_userId_key" ON "lead_queue_members"("queueId", "userId");
CREATE INDEX IF NOT EXISTS "lead_queue_members_queueId_idx" ON "lead_queue_members"("queueId");

-- Table: lead_queue_assignments
CREATE TABLE IF NOT EXISTS "lead_queue_assignments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "queueId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "leadId" TEXT,
  "source" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_queue_assignments_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "lead_queues"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lead_queue_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "lead_queue_assignments_queueId_createdAt_idx" ON "lead_queue_assignments"("queueId", "createdAt");
CREATE INDEX IF NOT EXISTS "lead_queue_assignments_userId_idx" ON "lead_queue_assignments"("userId");
CREATE INDEX IF NOT EXISTS "lead_queue_assignments_leadId_idx" ON "lead_queue_assignments"("leadId");

-- Enable RLS
ALTER TABLE "lead_queues" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_queue_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_queue_assignments" ENABLE ROW LEVEL SECURITY;

-- RLS Policies (service role = full access from server-side)
CREATE POLICY "Service role full access on lead_queues" ON "lead_queues"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on lead_queue_members" ON "lead_queue_members"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on lead_queue_assignments" ON "lead_queue_assignments"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Updated at trigger for lead_queues
CREATE OR REPLACE FUNCTION "updateLeadQueueUpdatedAt"()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "lead_queues_updatedAt" ON "lead_queues";
CREATE TRIGGER "lead_queues_updatedAt"
  BEFORE UPDATE ON "lead_queues"
  FOR EACH ROW EXECUTE FUNCTION "updateLeadQueueUpdatedAt"();