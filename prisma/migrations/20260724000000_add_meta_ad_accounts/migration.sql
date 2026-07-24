-- CreateTable: meta_ad_accounts
CREATE TABLE "meta_ad_accounts" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_ad_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meta_ad_accounts_adAccountId_key" ON "meta_ad_accounts"("adAccountId");

-- CreateIndex
CREATE INDEX "meta_ad_accounts_isActive_idx" ON "meta_ad_accounts"("isActive");
