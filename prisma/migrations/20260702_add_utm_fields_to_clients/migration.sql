-- AlterTable: Add UTM tracking fields to clients
ALTER TABLE "clients" ADD COLUMN "utmSource" TEXT;
ALTER TABLE "clients" ADD COLUMN "utmMedium" TEXT;
ALTER TABLE "clients" ADD COLUMN "utmCampaign" TEXT;
ALTER TABLE "clients" ADD COLUMN "utmContent" TEXT;
ALTER TABLE "clients" ADD COLUMN "utmTerm" TEXT;

-- CreateIndex: index on utmCampaign for filtering
CREATE INDEX "clients_utmCampaign_idx" ON "clients"("utmCampaign");