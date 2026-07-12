-- CreateTable: tracking_visitors
CREATE TABLE "tracking_visitors" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "visitorId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "leadId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    "country" TEXT,
    "city" TEXT,

    CONSTRAINT "tracking_visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable: tracking_events
CREATE TABLE "tracking_events" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "visitorId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventName" TEXT,
    "pageUrl" TEXT,
    "referrer" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracking_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: tracking_visitors_visitorId_key
CREATE UNIQUE INDEX "tracking_visitors_visitorId_key" ON "tracking_visitors"("visitorId");

-- CreateIndex: tracking_visitors_siteId_idx
CREATE INDEX "tracking_visitors_siteId_idx" ON "tracking_visitors"("siteId");

-- CreateIndex: tracking_visitors_leadId_idx
CREATE INDEX "tracking_visitors_leadId_idx" ON "tracking_visitors"("leadId");

-- CreateIndex: tracking_visitors_lastSeenAt_idx
CREATE INDEX "tracking_visitors_lastSeenAt_idx" ON "tracking_visitors"("lastSeenAt");

-- CreateIndex: tracking_events_siteId_eventType_idx
CREATE INDEX "tracking_events_siteId_eventType_idx" ON "tracking_events"("siteId", "eventType");

-- CreateIndex: tracking_events_siteId_utmCampaign_idx
CREATE INDEX "tracking_events_siteId_utmCampaign_idx" ON "tracking_events"("siteId", "utmCampaign");

-- CreateIndex: tracking_events_visitorId_idx
CREATE INDEX "tracking_events_visitorId_idx" ON "tracking_events"("visitorId");

-- CreateIndex: tracking_events_sessionId_idx
CREATE INDEX "tracking_events_sessionId_idx" ON "tracking_events"("sessionId");

-- CreateIndex: tracking_events_createdAt_idx
CREATE INDEX "tracking_events_createdAt_idx" ON "tracking_events"("createdAt");

-- AddForeignKey: tracking_events -> tracking_visitors
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "tracking_visitors"("visitorId") ON DELETE CASCADE ON UPDATE CASCADE;