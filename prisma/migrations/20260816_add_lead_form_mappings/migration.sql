-- CreateTable: lead_form_mappings
-- Auto-populated mapping of Meta form_id → campaign/ad info.
-- Every webhook lead upserts here so admin can see which Form IDs exist.

CREATE TABLE "lead_form_mappings" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "formName" TEXT,
    "adId" TEXT,
    "adName" TEXT,
    "campaignId" TEXT,
    "campaignName" TEXT,
    "leadCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capiConfigId" TEXT,

    CONSTRAINT "lead_form_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_form_mappings_formId_idx" ON "lead_form_mappings"("formId");

-- CreateIndex
CREATE INDEX "lead_form_mappings_capiConfigId_idx" ON "lead_form_mappings"("capiConfigId");

-- CreateIndex
CREATE INDEX "lead_form_mappings_campaignName_idx" ON "lead_form_mappings"("campaignName");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "lead_form_mappings_formId_campaignId_key" ON "lead_form_mappings"("formId", "campaignId");

-- AddForeignKey
ALTER TABLE "lead_form_mappings" ADD CONSTRAINT "lead_form_mappings_capiConfigId_fkey" FOREIGN KEY ("capiConfigId") REFERENCES "meta_cap_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
