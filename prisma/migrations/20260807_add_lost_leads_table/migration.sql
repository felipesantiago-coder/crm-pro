-- CreateTable
CREATE TABLE "lost_leads" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "slug" TEXT,
    "source" TEXT NOT NULL,
    "formData" JSONB,
    "userAgent" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "isRecovered" BOOLEAN NOT NULL DEFAULT false,
    "recoveredToClientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lost_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lost_leads_isRecovered_idx" ON "lost_leads"("isRecovered");

-- CreateIndex
CREATE INDEX "lost_leads_createdAt_idx" ON "lost_leads"("createdAt");

-- CreateIndex
CREATE INDEX "lost_leads_email_idx" ON "lost_leads"("email");
