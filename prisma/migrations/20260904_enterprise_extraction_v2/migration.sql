-- AlterTable
ALTER TABLE "enterprises" ADD COLUMN     "documentHash" TEXT,
ADD COLUMN     "extractionDraft" JSONB,
ADD COLUMN     "extractionDraftAt" TIMESTAMP(3),
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "publishedInfo" JSONB,
ADD COLUMN     "publishedVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "verifiedInfo" JSONB,
ADD COLUMN     "verifiedInfoAt" TIMESTAMP(3),
ADD COLUMN     "verifiedInfoBy" TEXT;

-- CreateTable
CREATE TABLE "enterprise_extraction_runs" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "documentHash" TEXT,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedById" TEXT,
    "promptVersion" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "blocksTotal" INTEGER NOT NULL DEFAULT 0,
    "blocksProcessed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "previousRunId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "enterprise_extraction_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_info_versions" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "info" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enterprise_info_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_brief_cache" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "brief" JSONB NOT NULL,
    "facts" JSONB NOT NULL,
    "dataHash" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "generatedById" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usefulCount" INTEGER NOT NULL DEFAULT 0,
    "notUsefulCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "client_brief_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_events" (
    "id" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "userId" TEXT,
    "userRole" TEXT,
    "scopeId" TEXT,
    "dataHash" TEXT,
    "promptVersion" TEXT,
    "modelId" TEXT,
    "latencyMs" INTEGER,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "cacheHit" BOOLEAN NOT NULL DEFAULT false,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "enterprise_extraction_runs_enterpriseId_startedAt_idx" ON "enterprise_extraction_runs"("enterpriseId", "startedAt");

-- CreateIndex
CREATE INDEX "enterprise_extraction_runs_documentHash_idx" ON "enterprise_extraction_runs"("documentHash");

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_info_versions_enterpriseId_version_key" ON "enterprise_info_versions"("enterpriseId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "client_brief_cache_clientId_key" ON "client_brief_cache"("clientId");

-- CreateIndex
CREATE INDEX "client_brief_cache_generatedAt_idx" ON "client_brief_cache"("generatedAt");

-- CreateIndex
CREATE INDEX "ai_usage_events_capability_createdAt_idx" ON "ai_usage_events"("capability", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_events_userId_createdAt_idx" ON "ai_usage_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "enterprises_documentHash_idx" ON "enterprises"("documentHash");

-- AddForeignKey
ALTER TABLE "enterprise_extraction_runs" ADD CONSTRAINT "enterprise_extraction_runs_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_info_versions" ADD CONSTRAINT "enterprise_info_versions_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_brief_cache" ADD CONSTRAINT "client_brief_cache_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

