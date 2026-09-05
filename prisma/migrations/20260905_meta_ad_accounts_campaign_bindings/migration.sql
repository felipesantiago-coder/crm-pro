-- Multi-conta Meta Ads: entidade "Ad Account" dedicada + vínculo
-- campanha → fila por campaignId + tokens por página/conta na captação.
-- Aditivo e não destrutivo (tabelas novas + colunas nullable + índices).

-- CreateTable
CREATE TABLE "meta_ad_accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "verifyToken" TEXT,
    "appSecret" TEXT,
    "pageIds" TEXT,
    "formIds" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "queueId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_ad_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_campaign_bindings" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT,
    "adAccountId" TEXT,
    "queueId" TEXT,
    "leadCount" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_campaign_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meta_ad_accounts_adAccountId_key" ON "meta_ad_accounts"("adAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "meta_campaign_bindings_campaignId_key" ON "meta_campaign_bindings"("campaignId");

-- CreateIndex
CREATE INDEX "meta_campaign_bindings_queueId_idx" ON "meta_campaign_bindings"("queueId");

-- CreateIndex
CREATE INDEX "meta_campaign_bindings_adAccountId_idx" ON "meta_campaign_bindings"("adAccountId");

-- AddForeignKey
ALTER TABLE "meta_ad_accounts" ADD CONSTRAINT "meta_ad_accounts_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "lead_queues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_campaign_bindings" ADD CONSTRAINT "meta_campaign_bindings_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "meta_ad_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_campaign_bindings" ADD CONSTRAINT "meta_campaign_bindings_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "lead_queues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Conta de anúncios de origem no mapeamento de formulários (auto-aprendida)
-- AlterTable
ALTER TABLE "lead_form_mappings" ADD COLUMN "adAccountId" TEXT;

-- CreateIndex
CREATE INDEX "lead_form_mappings_adAccountId_idx" ON "lead_form_mappings"("adAccountId");

-- AddForeignKey
ALTER TABLE "lead_form_mappings" ADD CONSTRAINT "lead_form_mappings_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "meta_ad_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Conta de anúncios no config CAPI (multi-conta)
-- AlterTable
ALTER TABLE "meta_cap_configs" ADD COLUMN "adAccountId" TEXT;

-- CreateIndex
CREATE INDEX "meta_cap_configs_adAccountId_idx" ON "meta_cap_configs"("adAccountId");

-- AddForeignKey
ALTER TABLE "meta_cap_configs" ADD CONSTRAINT "meta_cap_configs_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "meta_ad_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
