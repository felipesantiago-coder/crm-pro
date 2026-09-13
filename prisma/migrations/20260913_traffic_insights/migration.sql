-- ============================================================
-- Fase 8 (gestor de tráfego, estágio A) — 20260913_traffic_insights
-- Espelho diário de insights da Marketing API (custo × resultado)
-- + estado de sincronização por conta. PURAMENTE ADITIVO: nenhuma
-- tabela/coluna existente é alterada ou removida.
-- Idempotente: pode ser re-executado sem erro (IF NOT EXISTS).
-- Ordem dos statements espelha o diff canônico do Prisma
-- (validate-traffic-migration.sh compara 1:1 normalizado).
-- ============================================================

-- 1. Insight diário por (conta, nível, entidade, dia)
CREATE TABLE IF NOT EXISTS "meta_ad_insight_daily" (
    "id" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityName" TEXT,
    "campaignId" TEXT,
    "campaignName" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "leadsMeta" INTEGER NOT NULL DEFAULT 0,
    "cpm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cpc" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_ad_insight_daily_pkey" PRIMARY KEY ("id")
);

-- 2. Estado da última sincronização por conta
CREATE TABLE IF NOT EXISTS "meta_ads_sync_state" (
    "id" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "lastStatus" TEXT NOT NULL DEFAULT 'never',
    "lastSyncedAt" TIMESTAMP(3),
    "lastWindowDays" INTEGER,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_ads_sync_state_pkey" PRIMARY KEY ("id")
);

-- 3. Índices e chaves (ordem = emissão do diff canônico do Prisma)
-- Chave de idempotência do snapshot: a Meta retrocorrige atribuição,
-- a re-sincronização substitui a janela e a UNIQUE é rede de segurança.
CREATE INDEX IF NOT EXISTS "meta_ad_insight_daily_level_date_idx" ON "meta_ad_insight_daily"("level", "date");
CREATE INDEX IF NOT EXISTS "meta_ad_insight_daily_campaignId_idx" ON "meta_ad_insight_daily"("campaignId");
CREATE UNIQUE INDEX IF NOT EXISTS "meta_ad_insight_daily_adAccountId_level_entityId_date_key" ON "meta_ad_insight_daily"("adAccountId", "level", "entityId", "date");
CREATE UNIQUE INDEX IF NOT EXISTS "meta_ads_sync_state_adAccountId_key" ON "meta_ads_sync_state"("adAccountId");
